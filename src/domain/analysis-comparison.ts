import { getAnalysisSourceId } from "./project";
import { requireAnalysisCapability } from "./analysis-capabilities";
import { sameInputValue, type AnalysisResult, type MemberAnalysisResult, type NodeAnalysisResult } from "./analysis";

export interface AnalysisComparisonChange {
  kind: "node" | "member" | "material" | "section" | "support" | "load" | "uniform-load" | "self-weight";
  id: string;
  label: string;
  changes: string[];
}

export type AnalysisForceVector = [number, number, number, number, number, number];
export const ANALYSIS_FORCE_COMPONENTS = [
  { label: "N", unit: "kN" }, { label: "Vy", unit: "kN" }, { label: "Vz", unit: "kN" },
  { label: "T", unit: "kN·m" }, { label: "My", unit: "kN·m" }, { label: "Mz", unit: "kN·m" },
] as const;

export interface NodeComparisonRow {
  id: string;
  label: string;
  before: NodeAnalysisResult;
  after: NodeAnalysisResult;
  displacementDelta: { x: number; y: number; z: number };
  reactionDelta: { x: number; y: number; z: number };
}

export interface MemberComparisonRow {
  id: string;
  label: string;
  before: MemberAnalysisResult;
  after: MemberAnalysisResult;
  startDelta: AnalysisForceVector;
  endDelta: AnalysisForceVector;
}

export interface AnalysisComparison {
  before: AnalysisResult;
  after: AnalysisResult;
  compatible: boolean;
  issues: string[];
  changes: AnalysisComparisonChange[];
  nodes: NodeComparisonRow[];
  members: MemberComparisonRow[];
}

const ids = (items: Array<{ id: string }>) => new Set(items.map((item) => item.id));
const deltaVector = (after: { x: number; y: number; z: number }, before: { x: number; y: number; z: number }) => ({ x: after.x - before.x, y: after.y - before.y, z: after.z - before.z });
const deltaArray = (after: AnalysisForceVector, before: AnalysisForceVector): AnalysisForceVector => after.map((value, index) => value - before[index]) as AnalysisForceVector;

function compareCollection<T extends { id: string; label: string }>(
  before: T[], after: T[], fields: Array<[keyof T, string]>, kind: AnalysisComparisonChange["kind"],
): AnalysisComparisonChange[] {
  const beforeById = new Map(before.map((item) => [item.id, item]));
  const afterById = new Map(after.map((item) => [item.id, item]));
  const changes: AnalysisComparisonChange[] = [];
  for (const item of after) {
    const previous = beforeById.get(item.id);
    if (!previous) { changes.push({ kind, id: item.id, label: item.label, changes: ["新增对象"] }); continue; }
    const changed = fields.filter(([field]) => !sameInputValue(previous[field], item[field])).map(([, label]) => label);
    if (changed.length) changes.push({ kind, id: item.id, label: item.label, changes: changed });
  }
  for (const item of before) if (!afterById.has(item.id)) changes.push({ kind, id: item.id, label: item.label, changes: ["对象已删除"] });
  return changes;
}

export function compareAnalysisResults(before: AnalysisResult, after: AnalysisResult): AnalysisComparison {
  const issues: string[] = [];
  try {
    requireAnalysisCapability(before.input.analysisCase?.method ?? "static", "resultComparison");
    requireAnalysisCapability(after.input.analysisCase?.method ?? "static", "resultComparison");
    if ((before.input.analysisCase?.method ?? "static") !== (after.input.analysisCase?.method ?? "static")) issues.push("分析方法不同，不能比较");
  } catch (error) { issues.push(error instanceof Error ? error.message : "不支持此结果比较"); }
  if (before.projectId !== after.projectId) issues.push("两份结果属于不同项目，不能比较");
  if (before.input.assumptions.units !== after.input.assumptions.units) issues.push("单位约定不同，不能比较");
  if (before.input.dofOrder.join(",") !== after.input.dofOrder.join(",")) issues.push("自由度顺序不同，不能比较");
  const beforeSource = before.input.analysisCase?.legacySourceId ?? getAnalysisSourceId(before.input);
  const afterSource = after.input.analysisCase?.legacySourceId ?? getAnalysisSourceId(after.input);
  if (beforeSource !== afterSource) issues.push(`来源工况或组合不同（${beforeSource} 与 ${afterSource}），不能比较`);
  if (before.input.combination || after.input.combination) {
    const left = before.input.combination?.definition;
    const right = after.input.combination?.definition;
    if (!sameInputValue(left, right)) issues.push("荷载组合定义不同，不能比较");
  }

  const beforeNodeIds = ids(before.input.nodes); const afterNodeIds = ids(after.input.nodes);
  const beforeMemberIds = ids(before.input.members); const afterMemberIds = ids(after.input.members);
  if ([...beforeNodeIds].some((id) => !afterNodeIds.has(id)) || [...afterNodeIds].some((id) => !beforeNodeIds.has(id))) issues.push("节点对象无法按稳定标识匹配，不能比较节点结果");
  if ([...beforeMemberIds].some((id) => !afterMemberIds.has(id)) || [...afterMemberIds].some((id) => !beforeMemberIds.has(id))) issues.push("杆件对象无法按稳定标识匹配，不能比较杆件内力");

  const changes: AnalysisComparisonChange[] = [
    ...compareCollection(before.input.nodes, after.input.nodes, [["position", "坐标"]], "node"),
    ...compareCollection(before.input.members, after.input.members, [["startNodeId", "起点"], ["endNodeId", "终点"], ["materialId", "材料引用"], ["sectionId", "截面引用"], ["rotationDegrees", "截面转角"]], "member"),
    ...compareCollection(before.input.materials, after.input.materials, [["name", "名称"], ["elasticModulusGPa", "弹性模量 E"], ["poissonRatio", "泊松比 ν"], ["densityKgM3", "密度 ρ"]], "material"),
    ...compareCollection(before.input.sections, after.input.sections, [["name", "名称"], ["geometry", "几何尺寸"], ["parameterBasis", "计算依据"], ["areaM2", "面积 A"], ["secondMomentYM4", "惯性矩 Iy"], ["secondMomentZM4", "惯性矩 Iz"], ["torsionalConstantM4", "扭转常数 J"]], "section"),
    ...compareCollection(before.input.supports, after.input.supports, [["nodeId", "约束节点"], ["restraints", "六自由度约束"]], "support"),
    ...compareCollection(before.input.nodalLoads, after.input.nodalLoads, [["nodeId", "加载节点"], ["force", "节点力"], ["moment", "节点力矩"], ["loadCaseId", "所属工况"]], "load"),
    ...compareCollection(before.input.uniformLoads ?? [], after.input.uniformLoads ?? [], [["memberId", "加载杆件"], ["intensity", "均布强度"], ["coordinateSystem", "坐标系"], ["loadCaseId", "所属工况"]], "uniform-load"),
  ];
  if (!sameInputValue(before.input.selfWeight, after.input.selfWeight)) changes.push({ kind: "self-weight", id: "self-weight", label: "结构自重", changes: ["自重参数"] });

  const beforeNodes = new Map(before.nodes.map((item) => [item.nodeId, item]));
  const afterNodes = new Map(after.nodes.map((item) => [item.nodeId, item]));
  const nodeLabels = new Map(after.input.nodes.map((item) => [String(item.id), item.label]));
  const nodes: NodeComparisonRow[] = [];
  for (const [id, left] of beforeNodes) {
    const right = afterNodes.get(id); if (!right) continue;
    nodes.push({ id, label: nodeLabels.get(String(id)) ?? id, before: left, after: right, displacementDelta: deltaVector(right.displacement, left.displacement), reactionDelta: deltaVector(right.reaction, left.reaction) });
  }
  const beforeMembers = new Map(before.members.map((item) => [item.memberId, item]));
  const afterMembers = new Map(after.members.map((item) => [item.memberId, item]));
  const memberLabels = new Map(after.input.members.map((item) => [String(item.id), item.label]));
  const members: MemberComparisonRow[] = [];
  for (const [id, left] of beforeMembers) {
    const right = afterMembers.get(id); if (!right) continue;
    members.push({ id, label: memberLabels.get(String(id)) ?? id, before: left, after: right, startDelta: deltaArray(right.localEndForces.start, left.localEndForces.start), endDelta: deltaArray(right.localEndForces.end, left.localEndForces.end) });
  }
  return { before, after, compatible: issues.length === 0, issues, changes, nodes, members };
}
