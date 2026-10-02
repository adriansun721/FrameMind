import { getSelfWeightSummary } from "../domain/analysis";
import { reportNumber as n, reportSourceLabel, type EngineeringReport } from "../domain/engineering-report";
import type { ResourceProvenance, Vector3 } from "../domain/project";
import { createReportFigures } from "./report-figures";
import { reportAppendixContent } from "./report-appendix-content";
import { heading, paragraph, table, tableCaption, title, image, type ReportBlock } from "./report-content-blocks";

const vector = (value: Vector3) => [n(value.x), n(value.y), n(value.z)];
function provenance(label: string, value: ResourceProvenance): ReportBlock {
  const source = value.source ?? value.derivedFrom?.source;
  return paragraph(`${label}：${value.kind === "catalog" ? "库资源" : value.derivedFrom ? "由库资源修改的自定义参数" : "用户自定义参数"}${source ? `；${source.publisher}，${source.title}，${source.edition}；${source.url}；核对日期 ${source.accessedOn}；${source.units}` : ""}`);
}

export function createReportContent(report: EngineeringReport): ReportBlock[] {
  const { result } = report; const { input } = result;
  const figures = createReportFigures(report);
  const nodeLabel = (id: string) => input.nodes.find((item) => item.id === id)!.label;
  const memberLabel = (id: string) => input.members.find((item) => item.id === id)!.label;
  const maxNode = result.nodes.reduce((maximum, item) => Math.hypot(item.displacement.x, item.displacement.y, item.displacement.z) > Math.hypot(maximum.displacement.x, maximum.displacement.y, maximum.displacement.z) ? item : maximum);
  const source = reportSourceLabel(result);
  const children: ReportBlock[] = [
    title(`${report.projectName} 工程计算书`),
    paragraph(`本计算书记录 ${source} 的空间刚架线弹性分析模型、输入参数、荷载和响应，供计算结果复核。`),
    heading("1 模型概况与来源"),
    paragraph(`项目 ${report.projectName}；项目 ID ${result.projectId}`),
    paragraph(`分析 ID ${result.id}；输入修订 R${result.projectRevision}；状态 已完成`),
    paragraph(`分析时间 ${result.createdAt}；报告生成时间 ${report.generatedAt}（ISO 8601）`),
    paragraph(`选定来源 ${source}；${input.nodes.length} 个节点，${input.members.length} 根杆件，${input.supports.length} 个支座。正文、表格及图片均使用本次分析的冻结输入与输出。`),
    paragraph("单位约定：坐标与长度 m；力 kN；力矩 kN·m；位移 m；转角 rad；均布荷载 kN/m。材料 E 以 GPa 输入；密度 kg/m³；面积 m²；Iy、Iz、J 为 m⁴。"),
    image(figures.model, `冻结输入模型 ${source}`),
    paragraph("图 1 冻结输入模型。全局 +X、+Y、+Z 方向见图，杆件连接和支座自由度以正文表为准。大模型省略对象标签，稳定 ID 见表。"),
    heading("2 理论假设与适用边界"),
    paragraph("空间 Euler–Bernoulli 直杆单元，每节点 ux、uy、uz、rx、ry、rz 六个自由度。线弹性、小变形、刚性节点，忽略剪切变形；支座采用零位移自由度约束。"),
    paragraph("分析不包含几何非线性、材料非线性、屈曲、动力响应、截面强度或规范符合性验算。本报告给出分析响应，不据此判定结构满足设计规范。用户定义组合系数为输入值。"),
    paragraph("整体方程 K · u = F；约束处理消除受限自由度，求解 Kff · uf = Ff；反力 R = K · u − F。局部转换 ul = T · ug，Kg = Tᵀ · Kl · T；G = E / [2(1 + ν)]。"),
    paragraph("总体位移、转角、支座反力及反力矩按全局 XYZ。局部 x 由杆件起点指向终点，y、z 随截面转角；局部轴向量见表。杆端 N、Vy、Vz、T、My、Mz 为局部轴端部作用分量，两个端点分别记录，不能直接当作截面内力包络。"),
    paragraph(`求解器 ${input.solver?.implementation ?? "历史结果未记录版本"}；算法 ${input.solver?.algorithm ?? "未记录"}；约束 ${input.solver?.constraints ?? "未记录"}；相对主元阈值 ${input.solver ? n(input.solver.relativePivotTolerance) : "未记录"}。`),
    heading("3 材料截面与模型参数"),
    tableCaption("材料参数"),
    table(["材料", "名称", "E (GPa)", "ν", "ρ (kg/m³)"], input.materials.map((item) => [item.label, item.name, n(item.elasticModulusGPa), n(item.poissonRatio), n(item.densityKgM3)])),
    ...input.materials.map((item) => provenance(`${item.label} · ${item.id}`, item.provenance)),
    tableCaption("截面参数"),
    table(["截面", "名称", "A (m²)", "Iy (m⁴)", "Iz (m⁴)", "J (m⁴)"], input.sections.map((item) => [item.label, item.name, n(item.areaM2), n(item.secondMomentYM4), n(item.secondMomentZM4), n(item.torsionalConstantM4)])),
    ...input.sections.map((item) => provenance(`${item.label} · ${item.id}`, item.provenance)),
    tableCaption("节点坐标与稳定标识"),
    table(["节点", "ID", "X (m)", "Y (m)", "Z (m)"], input.nodes.map((item) => [item.label, item.id, ...vector(item.position)])),
    tableCaption("杆件连接、分配与截面朝向"),
    table(["杆件及 ID", "起点 → 终点", "材料 / 截面", "长度 (m)", "转角 (°)"], input.members.map((item) => [item.label + "\n" + item.id, `${nodeLabel(item.startNodeId)} → ${nodeLabel(item.endNodeId)}`, `${input.materials.find((m) => m.id === item.materialId)!.label} / ${input.sections.find((s) => s.id === item.sectionId)!.label}`, n(result.members.find((m) => m.memberId === item.id)!.length), n(item.rotationDegrees)])),
    tableCaption("局部单位轴向量按全局 XYZ 分量表示"),
    table(["杆件", "局部 x", "局部 y", "局部 z"], result.members.map((item) => [memberLabel(item.memberId), vector(item.localAxes.x).join(", "), vector(item.localAxes.y).join(", "), vector(item.localAxes.z).join(", ")])),
    heading("4 支座与边界条件"),
    paragraph("约束表示该自由度位移或转角为零；自由表示未施加该约束。平移方向为全局 XYZ，转动方向为绕全局 XYZ。"),
    table(["支座 / 节点", "ux", "uy", "uz", "rx", "ry", "rz"], input.supports.map((item) => [`${item.label} / ${nodeLabel(item.nodeId)}`, ...item.restraints.map((value) => value ? "约束" : "自由")])),
    heading("5 荷载自重与工况组合"),
    paragraph(`本次来源 ${source}。节点力和力矩按全局 XYZ；杆件均布荷载的坐标系逐项列示，作用于整根杆件。`),
  ];
  if (input.combination) {
    children.push(paragraph("组合结果按用户定义系数线性叠加。下表和各分项工况保留未加权荷载；加权等效荷载见后续汇总表，避免自重和外荷载重复计入。"),
      table(["工况", "名称", "系数"], input.combination.definition.terms.map((term) => [term.loadCaseId, input.combination!.cases.find((item) => item.loadCase.id === term.loadCaseId)!.loadCase.name, n(term.factor)])));
  }
  const loadTables = (label: string, loads: typeof input.nodalLoads, uniform: NonNullable<typeof input.uniformLoads>) => {
    children.push(tableCaption(label), loads.length ? table(["荷载 / 节点", "FX (kN)", "FY (kN)", "FZ (kN)", "MX (kN·m)", "MY (kN·m)", "MZ (kN·m)"], loads.map((item) => [`${item.label} / ${nodeLabel(item.nodeId)}`, ...vector(item.force), ...vector(item.moment)])) : paragraph("无节点集中荷载。"));
    children.push(uniform.length ? table(["荷载 / 杆件", "坐标系", "qx (kN/m)", "qy (kN/m)", "qz (kN/m)"], uniform.map((item) => [`${item.label} / ${memberLabel(item.memberId)}`, item.coordinateSystem === "global" ? "全局 XYZ" : "局部 xyz", ...vector(item.intensity)])) : paragraph("无显式杆件均布荷载。"));
  };
  const selfWeightText = (selfWeight: typeof input.selfWeight, label: string) => {
    const summary = getSelfWeightSummary({ ...input, selfWeight });
    children.push(paragraph(`${label}：${summary.enabled ? "启用" : "未启用"}；归属工况 ${summary.loadCaseId}；重力向量 (${selfWeight ? vector(selfWeight.gravity).join(", ") : "未记录"}) m/s²。`));
    if (summary.enabled) children.push(paragraph(`按 m = ρ · A · L，qg = ρ · A · g / 1000 (kN/m) 施加一次；总质量 ${n(summary.totalMassKg)} kg；重力合力 (${vector(summary.totalForce).join(", ")}) kN；合力幅值 ${n(Math.hypot(summary.totalForce.x, summary.totalForce.y, summary.totalForce.z))} kN。`));
  };
  if (input.combination) for (const item of input.combination.cases) {
    loadTables(`${item.loadCase.id} · ${item.loadCase.name} 分项工况原始荷载`, item.nodalLoads, item.uniformLoads);
    selfWeightText(item.selfWeight, `${item.loadCase.id} 原始自重`);
  }
  loadTables(input.combination ? "本次组合加权等效荷载" : "本次工况荷载", input.nodalLoads, input.uniformLoads ?? []);
  selfWeightText(input.selfWeight, input.combination ? "本次组合等效自重" : "本次工况自重");
  children.push(
    heading("6 关键响应与完整结果"),
    paragraph(`最大节点位移幅值 ${n(Math.hypot(maxNode.displacement.x, maxNode.displacement.y, maxNode.displacement.z))} m，节点 ${nodeLabel(maxNode.nodeId)}；分量 (${vector(maxNode.displacement).join(", ")}) m。`),
    image(figures.displacement, `节点位移幅值 ${source}`, 100 + Math.min(12, result.nodes.length) * 18.5),
    paragraph(`图 2 ${source} 节点位移幅值，未放大数值；图中最多显示幅值最大的 12 个节点，全部方向分量如下。`),
    tableCaption("节点位移与转角 按全局 XYZ"),
    table(["节点", "UX (m)", "UY (m)", "UZ (m)", "RX (rad)", "RY (rad)", "RZ (rad)"], result.nodes.map((item) => [nodeLabel(item.nodeId), ...vector(item.displacement), ...vector(item.rotation)])),
    tableCaption("节点反力与反力矩 按全局 XYZ 包括未约束自由度的数值残差"),
    table(["节点", "FX (kN)", "FY (kN)", "FZ (kN)", "MX (kN·m)", "MY (kN·m)", "MZ (kN·m)"], result.nodes.map((item) => [nodeLabel(item.nodeId), ...vector(item.reaction), ...vector(item.reactionMoment)])),
    tableCaption("杆端局部内力 正值沿局部正轴 端点以起点和终点区分"),
    table(["杆件 / 端点", "N (kN)", "Vy (kN)", "Vz (kN)", "T (kN·m)", "My (kN·m)", "Mz (kN·m)"], result.members.flatMap((item) => [
      [`${memberLabel(item.memberId)} / 起点`, ...item.localEndForces.start.map(n)], [`${memberLabel(item.memberId)} / 终点`, ...item.localEndForces.end.map(n)],
    ])),
    paragraph("以上数值保留七位有效数字供逐项核对；内部计算未按报告显示精度舍入。杆端表不代表杆件全长极值，也不构成强度或稳定性结论。"),
  );
  children.push(...reportAppendixContent(report));
  return children;
}
