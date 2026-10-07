import { calculateMemberGeometry } from "./member-geometry";
import type { SecondOrderIteration } from "./second-order";
import type { MeshError } from "./analysis-mesh";
import type { AnalysisDof } from "./analysis";
import type { FrameProject, LoadId, MaterialId, MemberId, NodeId, ProjectId, SectionId, SupportId } from "./project";
import { DEFAULT_LOAD_CASE, validateSelfWeight, validateUniformLoad } from "./project";

export type AnalysisStage = "model-check" | "assembly" | "solve" | "recovery";
export const ANALYSIS_STAGE_LABELS: Record<AnalysisStage, string> = {
  "model-check": "模型检查", assembly: "刚度组装", solve: "方程求解", recovery: "结果恢复",
};
export const ANALYSIS_FIELD_LABELS: Record<string, string> = {
  modal: "模态提取与方程预算", buckling: "屈曲提取与方程预算", maxEquations: "计算方程预算",
  random: "随机节点力与响应设置", frequencyPoints: "随机频率网格与预算", integration: "PSD 积分与加密预算", modeCount: "随机响应模态截断与参与方向",
  "native-core": "原生计算资源与协议",
  id: "对象身份", "position.x": "X 坐标", "position.y": "Y 坐标", "position.z": "Z 坐标",
  elasticModulusGPa: "弹性模量 E", densityKgM3: "密度", poissonRatio: "泊松比",
  areaM2: "面积 A", secondMomentYM4: "惯性矩 Iy", secondMomentZM4: "惯性矩 Iz", torsionalConstantM4: "扭转常数 J",
  startNodeId: "起点节点", endNodeId: "终点节点", nodeId: "所属节点", materialId: "材料", sectionId: "截面", rotationDegrees: "截面转角",
  endReleases: "局部杆端弯矩释放", restraints: "约束自由度", connectivity: "连接关系", stiffness: "刚度", reaction: "反力", localEndForces: "杆端内力", "force/moment": "力与力矩", intensity: "均布力（kN/m）", memberId: "加载杆件", selfWeight: "自重设置",
  "force.x": "FX", "force.y": "FY", "force.z": "FZ", "moment.x": "MX", "moment.y": "MY", "moment.z": "MZ",
};

export type AnalysisTarget =
  | { kind: "node"; id: NodeId }
  | { kind: "member"; id: MemberId }
  | { kind: "material"; id: MaterialId }
  | { kind: "section"; id: SectionId }
  | { kind: "support"; id: SupportId }
  | { kind: "load"; id: LoadId }
  | { kind: "uniform-load"; id: LoadId }
  | { kind: "load-combination"; id: string }
  | { kind: "self-weight"; id: ProjectId | string };

export interface AnalysisDiagnostic {
  randomConvergence?: { status: "failed"; pointBudget: number; refinementBudget: number; attemptedPoints: number; runs: import("./random-response").RandomConvergenceRun[]; detail: Record<string, number> };
  iterations?: SecondOrderIteration[];
  convergence?: Array<{ divisions: number; iterations: SecondOrderIteration[]; error?: MeshError }>;
  position?: number;
  code: string;
  message: string;
  target?: AnalysisTarget;
  field?: string;
  dof?: AnalysisDof;
  evidence?: { pivotMagnitude: number; threshold: number; matrixScale: number; globalDofIndex: number };
}

export class AnalysisFailure extends Error {
  constructor(public readonly stage: AnalysisStage, public readonly diagnostics: AnalysisDiagnostic[]) {
    super(`${ANALYSIS_STAGE_LABELS[stage]}失败：${diagnostics[0]?.message ?? "分析未完成"}`);
    this.name = "AnalysisFailure";
  }
}

export function checkAnalysisInput(input: Pick<FrameProject, "nodes" | "members" | "materials" | "sections" | "supports" | "nodalLoads"> & Partial<Pick<FrameProject, "uniformLoads" | "selfWeight" | "loadCases" | "activeLoadCaseId">> & { loadCase?: { id: string } }): AnalysisDiagnostic[] {
  const issues: AnalysisDiagnostic[] = [];
  const issue = (code: string, message: string, target?: AnalysisTarget, field?: string) => issues.push({ code, message, target, field });
  const caseIds = new Set(input.loadCases?.map((item) => item.id) ?? [input.loadCase?.id ?? DEFAULT_LOAD_CASE]);
  if (input.loadCases && (!input.loadCases.length || caseIds.size !== input.loadCases.length || input.loadCases.some((item) => !/^LC[1-9]\d*$/.test(item.id) || !item.name.trim() || typeof item.description !== "string") || !caseIds.has(input.activeLoadCaseId ?? DEFAULT_LOAD_CASE))) issue("invalid-load-case", "工况列表或当前工况无效");
  for (const load of [...input.nodalLoads, ...(input.uniformLoads ?? [])]) {
    if (!caseIds.has(load.loadCaseId)) issue("invalid-load-case", `${load.label} 引用了不存在的工况 ${load.loadCaseId}`, { kind: "kind" in load ? "uniform-load" : "load", id: load.id }, "loadCaseId");
  }
  if (input.selfWeight && !caseIds.has(input.selfWeight.loadCaseId)) issue("invalid-load-case", "自重引用了不存在的工况", { kind: "self-weight", id: "self-weight" }, "selfWeight");
  const positive = (value: number, target: AnalysisTarget, field: string, label: string) => {
    if (!Number.isFinite(value) || value <= 0) issue("invalid-parameter", `${label}必须为正有限数值`, target, field);
  };
  if (input.nodes.length === 0) issue("missing-nodes", "模型没有节点");
  if (input.members.length === 0) issue("missing-members", "模型没有杆件");
  const groups = [
    { kind: "node", items: input.nodes }, { kind: "member", items: input.members },
    { kind: "material", items: input.materials }, { kind: "section", items: input.sections },
    { kind: "support", items: input.supports }, { kind: "load", items: input.nodalLoads },
    { kind: "uniform-load", items: input.uniformLoads ?? [] },
  ] as const;
  for (const { kind, items } of groups) {
    const seen = new Set<string>();
    for (const item of items) {
      if (!item.id || seen.has(item.id)) issue("invalid-identity", `${item.label} 的身份缺失或重复`, { kind, id: item.id } as AnalysisTarget, "id");
      seen.add(item.id);
    }
  }
  for (const node of input.nodes) for (const axis of ["x", "y", "z"] as const) {
    if (!Number.isFinite(node.position?.[axis])) issue("invalid-coordinate", `${node.label} 的 ${axis.toUpperCase()} 坐标必须是有限数值`, { kind: "node", id: node.id }, `position.${axis}`);
  }
  for (const material of input.materials) {
    const target = { kind: "material", id: material.id } as const;
    positive(material.elasticModulusGPa, target, "elasticModulusGPa", `${material.label} 的弹性模量 E`);
    positive(material.densityKgM3, target, "densityKgM3", `${material.label} 的密度`);
    if (!Number.isFinite(material.poissonRatio) || material.poissonRatio <= -1 || material.poissonRatio >= 0.5) issue("invalid-parameter", `${material.label} 的泊松比必须大于 -1 且小于 0.5`, target, "poissonRatio");
  }
  for (const section of input.sections) {
    const target = { kind: "section", id: section.id } as const;
    positive(section.areaM2, target, "areaM2", `${section.label} 的面积 A`);
    positive(section.secondMomentYM4, target, "secondMomentYM4", `${section.label} 的惯性矩 Iy`);
    positive(section.secondMomentZM4, target, "secondMomentZM4", `${section.label} 的惯性矩 Iz`);
    positive(section.torsionalConstantM4, target, "torsionalConstantM4", `${section.label} 的扭转常数 J`);
  }
  const adjacency = new Map(input.nodes.map((node) => [node.id, new Set<NodeId>()]));
  for (const member of input.members) {
    const target = { kind: "member", id: member.id } as const;
    const start = input.nodes.find((node) => node.id === member.startNodeId);
    const end = input.nodes.find((node) => node.id === member.endNodeId);
    if (!start) issue("invalid-reference", `${member.label} 的起点节点引用无效`, target, "startNodeId");
    if (!end) issue("invalid-reference", `${member.label} 的终点节点引用无效`, target, "endNodeId");
    if (!input.materials.some((item) => item.id === member.materialId)) issue("invalid-reference", `${member.label} 的材料引用无效`, target, "materialId");
    if (!input.sections.some((item) => item.id === member.sectionId)) issue("invalid-reference", `${member.label} 的截面引用无效`, target, "sectionId");
    if (!Number.isFinite(member.rotationDegrees)) issue("invalid-parameter", `${member.label} 的截面转角必须是有限数值`, target, "rotationDegrees");
    if (start && end) {
      adjacency.get(start.id)!.add(end.id); adjacency.get(end.id)!.add(start.id);
      if ((["x", "y", "z"] as const).every((axis) => Number.isFinite(start.position?.[axis]) && Number.isFinite(end.position?.[axis])) && Number.isFinite(member.rotationDegrees)) {
        try { calculateMemberGeometry(start.position, end.position, member.rotationDegrees); }
        catch { issue("invalid-geometry", `${member.label} 的杆长无效（零长度或超出有限数值范围）`, target, "endNodeId"); }
      }
    }
  }
  const restrainedNodes = new Set<NodeId>();
  for (const support of input.supports) {
    const target = { kind: "support", id: support.id } as const;
    if (!adjacency.has(support.nodeId)) issue("invalid-reference", `${support.label} 的节点引用无效`, target, "nodeId");
    if (!Array.isArray(support.restraints) || support.restraints.length !== 6 || !support.restraints.every((value) => typeof value === "boolean")) {
      issue("invalid-restraints", `${support.label} 的支座约束必须包含六个布尔自由度`, target, "restraints");
    } else if (support.restraints.some(Boolean)) {
      if (adjacency.has(support.nodeId)) restrainedNodes.add(support.nodeId);
    } else issue("empty-restraints", `${support.label} 没有受约束自由度`, target, "restraints");
  }
  for (const load of input.nodalLoads) {
    const target = { kind: "load", id: load.id } as const;
    if (!adjacency.has(load.nodeId)) issue("invalid-reference", `${load.label} 的节点引用无效`, target, "nodeId");
    for (const vector of ["force", "moment"] as const) for (const axis of ["x", "y", "z"] as const) {
      if (!Number.isFinite(load[vector]?.[axis])) issue("invalid-load", `${load.label} 的 ${vector === "force" ? "力" : "力矩"} ${axis.toUpperCase()} 必须是有限数值`, target, `${vector}.${axis}`);
    }
  }
  for (const load of input.uniformLoads ?? []) {
    const target = { kind: "uniform-load", id: load.id } as const;
    if (!input.members.some((member) => member.id === load.memberId)) issue("invalid-reference", `${load.label} 的杆件引用无效`, target, "memberId");
    try { validateUniformLoad(load); }
    catch (error) { issue("invalid-load", `${load.label}：${error instanceof Error ? error.message : "均布荷载无效"}`, target, "intensity"); }
  }
  if (input.selfWeight !== undefined) {
    try { validateSelfWeight(input.selfWeight); }
    catch (error) {
      const id = "id" in input && typeof input.id === "string" ? input.id : "projectId" in input && typeof input.projectId === "string" ? input.projectId : "self-weight";
      issue("invalid-self-weight", error instanceof Error ? error.message : "自重设置无效", { kind: "self-weight", id }, "selfWeight");
    }
  }
  if (restrainedNodes.size === 0) issue("missing-restraints", "请至少设置一个受约束自由度");
  // Only unrestrained components are rejected; separately supported frames are valid.
  const visited = new Set<NodeId>();
  for (const node of input.nodes) {
    if (visited.has(node.id)) continue;
    const component: NodeId[] = []; const pending = [node.id];
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id); component.push(id);
      for (const neighbor of adjacency.get(id) ?? []) if (!visited.has(neighbor)) pending.push(neighbor);
    }
    if (component.length === 1 && adjacency.get(node.id)?.size === 0) issue("isolated-node", `${node.label} 未连接任何杆件`, { kind: "node", id: node.id }, "connectivity");
    else if (!component.some((id) => restrainedNodes.has(id))) issue("unrestrained-component", `${node.label} 所在的断开部分（${component.length} 个节点）没有受约束自由度`, { kind: "node", id: node.id }, "restraints");
  }
  return issues;
}
