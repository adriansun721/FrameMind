import { unitPresentation } from "../domain/units";
import { reportSourceLabel, type EngineeringReport } from "../domain/engineering-report";
import type { Vector3 } from "../domain/project";

const escapeXml = (text: string) => text.replace(/[<>&"']/g, (value) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[value]!);
const text = (x: number, y: number, content: string, size = 24) => `<text x="${x}" y="${y}" font-size="${size}">${escapeXml(content)}</text>`;
function svg(report: EngineeringReport, title: string, body: string, height = 660): string {
  const source = `${reportSourceLabel(report.result)} · R${report.result.projectRevision}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}"><rect width="1200" height="${height}" fill="white"/><g font-family="Microsoft YaHei,Arial,sans-serif" fill="#222">${text(30, 35, title, 28)}${text(30, 68, source.length > 65 ? source.slice(0, 62) + "…" : source)}${body}${text(30, height - 17, `分析 ${report.result.id}`, 22)}</g></svg>`;
}

export function createReportFigures(report: EngineeringReport): Record<string, string> & { model: string; displacement: string } {
  const u = unitPresentation(report.displayUnitPreset);
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
  model += text(200, 607, `示意投影  单位 ${u.unit("m")}    标签拥挤时省略；完整编号与支座见正文表`);
  const values = nodes.map((node) => ({ label: input.nodes.find((item) => item.id === node.nodeId)!.label, value: Math.hypot(node.displacement.x, node.displacement.y, node.displacement.z) }))
    .sort((a, b) => b.value - a.value).slice(0, 12);
  const maximum = Math.max(...values.map((item) => item.value), 1e-30);
  const chartHeight = 200 + values.length * 37;
  let chart = text(30, 105, "全局 XYZ  按幅值排序  最多 12 个节点  方向分量见正文表");
  values.forEach((item, index) => {
    const y = 125 + index * 37;
    chart += text(30, y + 20, item.label) + `<rect x="150" y="${y}" width="${760 * item.value / maximum}" height="25" fill="#245979"/>` + text(925, y + 20, u.quantity(item.value, "m", 7));
  });
  chart += text(30, chartHeight - 52, `蓝色条 |u| = √(ux² + uy² + uz²)  单位 ${u.unit("m")}  零值为空条`);
  const shapes = Object.fromEntries((report.result.modal?.modes ?? report.result.buckling?.modes ?? []).map((mode) => [`shape-${mode.number}`, createReportShapeFigure(report, mode.number)]));
  return { model: svg(report, "冻结输入模型", model), displacement: svg(report, "节点位移幅值", chart, chartHeight), ...shapes };
}

/** Uses saved engineering-member samples; each mode has its own disclosed display scale. */
export function createReportShapeFigure(report: EngineeringReport, modeNumber: number): string {
  const { result } = report;
  const mode = (result.modal?.modes ?? result.buckling?.modes ?? []).find((m) => m.number === modeNumber)!;
  const input = result.input;
  const positions = new Map(input.nodes.map((n) => [n.id, n.position]));
  const span = Math.max(1e-9, ...(["x", "y", "z"] as const).map((k) => Math.max(...input.nodes.map((n) => n.position[k])) - Math.min(...input.nodes.map((n) => n.position[k]))));
  const peak = Math.max(1e-30, ...mode.members.flatMap((m) => m.samples.map((s) => Math.hypot(s.translation.x, s.translation.y, s.translation.z))));
  const factor = .12 * span / peak;
  const project = (p: Vector3) => ({ x: p.x - .6 * p.y, y: -p.z + .3 * (p.x + p.y) });
  const lines = mode.members.map((record) => {
    const member = input.members.find((m) => m.id === record.memberId)!;
    const a = positions.get(member.startNodeId)!, b = positions.get(member.endNodeId)!;
    const length = input.meshPlan!.frames[member.id].length;
    const base = record.samples.map((s) => ({ x: a.x + (b.x - a.x) * s.position / length, y: a.y + (b.y - a.y) * s.position / length, z: a.z + (b.z - a.z) * s.position / length }));
    return { base: base.map(project), shape: base.map((p, i) => project({ x: p.x + factor * record.samples[i].translation.x, y: p.y + factor * record.samples[i].translation.y, z: p.z + factor * record.samples[i].translation.z })) };
  });
  const points = lines.flatMap((l) => [...l.base, ...l.shape]);
  const minX = Math.min(...points.map((p) => p.x)), maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)), maxY = Math.max(...points.map((p) => p.y));
  const scale = Math.min(1000 / Math.max(maxX - minX, 1e-9), 360 / Math.max(maxY - minY, 1e-9));
  const path = (values: typeof points) => values.map((p) => `${600 + (p.x - (minX + maxX) / 2) * scale},${300 + (p.y - (minY + maxY) / 2) * scale}`).join(" ");
  let body = lines.map((l) => `<polyline points="${path(l.base)}" fill="none" stroke="#999" stroke-dasharray="8 6" stroke-width="2"/><polyline points="${path(l.shape)}" fill="none" stroke="#245979" stroke-width="4"/>`).join("");
  body += text(30, 510, "全局 XYZ 示意投影  蓝线 归一化形态  虚线 冻结分析线");
  body += text(30, 545, "每阶单独缩放至模型跨度的 12%  不是实际位移  幅值不随显示单位换算");
  const scalar = "frequencyHz" in mode ? `f = ${Number(mode.frequencyHz.toPrecision(7))} Hz` : `λ = ${Number(mode.factor.toPrecision(7))}`;
  return svg(report, `${result.modal ? "振型" : "屈曲形态"} 第 ${modeNumber} 阶  ${scalar}`, body, 600);
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
