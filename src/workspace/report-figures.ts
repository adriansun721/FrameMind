import { reportNumber, reportSourceLabel, type EngineeringReport } from "../domain/engineering-report";
import type { Vector3 } from "../domain/project";

const escapeXml = (text: string) => text.replace(/[<>&"']/g, (value) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[value]!);
const text = (x: number, y: number, content: string, size = 24) => `<text x="${x}" y="${y}" font-size="${size}">${escapeXml(content)}</text>`;
function svg(report: EngineeringReport, title: string, body: string, height = 660): string {
  const source = `${reportSourceLabel(report.result)} · R${report.result.projectRevision}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}"><rect width="1200" height="${height}" fill="white"/><g font-family="Microsoft YaHei,Arial,sans-serif" fill="#222">${text(30, 35, title, 28)}${text(30, 68, source.length > 65 ? source.slice(0, 62) + "…" : source)}${body}${text(30, height - 17, `分析 ${report.result.id}`, 22)}</g></svg>`;
}

export function createReportFigures(report: EngineeringReport): { model: string; displacement: string } {
  const { input, nodes } = report.result;
  const project = (p: Vector3) => ({ x: p.x - p.y * 0.6, y: -p.z + (p.x + p.y) * 0.3 });
  const projected = input.nodes.map((node) => project(node.position));
  const minX = Math.min(...projected.map((p) => p.x)); const maxX = Math.max(...projected.map((p) => p.x));
  const minY = Math.min(...projected.map((p) => p.y)); const maxY = Math.max(...projected.map((p) => p.y));
  const scale = Math.min(900 / Math.max(maxX - minX, 1e-9), 410 / Math.max(maxY - minY, 1e-9));
  const points = new Map(input.nodes.map((node, index) => [String(node.id), {
    x: 140 + (projected[index].x - (minX + maxX) / 2) * scale + 450,
    y: 110 + (projected[index].y - (minY + maxY) / 2) * scale + 205,
  }]));
  let model = "";
  const labelBounds: { left: number; right: number; top: number; bottom: number }[] = [];
  const modelLabel = (x: number, y: number, label: string) => {
    const bounds = { left: x - 10, right: x + label.length * 15 + 10, top: y - 27, bottom: y + 8 };
    if (bounds.left < 130 || bounds.right > 1130 || bounds.top < 80 || bounds.bottom > 535
      || labelBounds.some((other) => bounds.left < other.right && bounds.right > other.left && bounds.top < other.bottom && bounds.bottom > other.top)) return "";
    labelBounds.push(bounds);
    return text(x, y, label);
  };
  for (const member of input.members) {
    const a = points.get(member.startNodeId)!; const b = points.get(member.endNodeId)!;
    model += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#245979" stroke-width="4"/>`;
    if (input.members.length <= 40) model += modelLabel((a.x + b.x) / 2 + 8, (a.y + b.y) / 2 - 8, member.label);
  }
  for (const node of input.nodes) {
    const p = points.get(node.id)!;
    model += `<circle cx="${p.x}" cy="${p.y}" r="5" fill="#245979"/>`;
    if (input.nodes.length <= 40) model += modelLabel(p.x + 8, p.y - 12, node.label);
    if (input.supports.some((support) => support.nodeId === node.id && support.restraints.some(Boolean))) {
      model += `<path d="M ${p.x - 11} ${p.y + 14} L ${p.x} ${p.y} L ${p.x + 11} ${p.y + 14} Z" fill="none" stroke="#85572b" stroke-width="2"/>`;
    }
  }
  model += `<g stroke="#777" stroke-width="2"><path d="M60 530 L120 548 M60 530 L24 548 M60 530 L60 470" fill="none"/></g>${text(124, 553, "+X")}${text(8, 567, "+Y")}${text(49, 461, "+Z")}`;
  model += text(200, 577, "蓝线 杆件    蓝点 节点    棕色三角 受约束节点");
  model += text(200, 607, "示意投影  单位 m    标签拥挤时省略；完整编号与支座见正文表");
  const values = nodes.map((node) => ({ label: input.nodes.find((item) => item.id === node.nodeId)!.label, value: Math.hypot(node.displacement.x, node.displacement.y, node.displacement.z) }))
    .sort((a, b) => b.value - a.value).slice(0, 12);
  const maximum = Math.max(...values.map((item) => item.value), 1e-30);
  const chartHeight = 200 + values.length * 37;
  let chart = text(30, 105, "全局 XYZ  按幅值排序  最多 12 个节点  方向分量见正文表");
  values.forEach((item, index) => {
    const y = 125 + index * 37;
    chart += text(30, y + 20, item.label) + `<rect x="150" y="${y}" width="${760 * item.value / maximum}" height="25" fill="#245979"/>` + text(925, y + 20, `${reportNumber(item.value)} m`);
  });
  chart += text(30, chartHeight - 52, "蓝色条 |u| = √(ux² + uy² + uz²)  单位 m  零值为空条");
  return { model: svg(report, "冻结输入模型", model), displacement: svg(report, "节点位移幅值", chart, chartHeight) };
}

/** PNG fallback keeps the document readable in Word and other OOXML readers. */
export async function reportSvgToPng(svg: string): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("计算书图表生成失败")); image.src = url; });
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d"); if (!context) throw new Error("计算书图表渲染不可用");
    context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("计算书图表编码失败")), "image/png"));
    return new Uint8Array(await blob.arrayBuffer());
  } finally { URL.revokeObjectURL(url); }
}
