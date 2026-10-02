import { addNodalLoad, addSupport, selectLoadCase, selectLoadCombination, updateNodalLoad, updateSupport, type DofRestraints, type FrameProject, type LoadId, type NodeId, type SupportId, type Vector3 } from "../domain/project";
import { applyProjectTransaction } from "../domain/project-operations";
import { captureAiSnapshot, type AiToolResult } from "./ai-tools";

type Source = "user" | "suggestion";
export interface SupportProposal { id?: SupportId; nodeId: NodeId; restraints: DofRestraints; source: Source; }
export interface NodalLoadProposal { id?: LoadId; nodeId: NodeId; loadCaseId: string; force: Vector3; moment: Vector3; source: Source; }
export interface ConditionsProposal {
  id: string; version: number;
  supports?: SupportProposal[]; nodalLoads?: NodalLoadProposal[];
  analysisSourceId?: string;
}

function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("分析条件必须是对象");
  const result = value as Record<string, unknown>;
  const extra = Object.keys(result).find((key) => !allowed.includes(key));
  if (extra) throw new Error(`分析条件含未定义字段 ${extra}`);
  return result;
}
function vector(value: unknown): Vector3 {
  const v = object(value, ["x", "y", "z"]);
  if (![v.x, v.y, v.z].every((n) => typeof n === "number" && Number.isFinite(n))) throw new Error("力/力矩 XYZ 必须全部为有限数值");
  return { x: v.x as number, y: v.y as number, z: v.z as number };
}

/** Partial updates retain the other stage fields; no model commands run here. */
export function proposeConditions(input: unknown, previous?: ConditionsProposal): ConditionsProposal {
  const request = object(input, ["supports", "nodalLoads", "analysisSourceId"]);
  if (!Object.keys(request).length) throw new Error("至少提供支座或节点荷载；未知条件请省略");
  const next: ConditionsProposal = { ...structuredClone(previous ?? {}), id: previous?.id ?? `conditions_${crypto.randomUUID()}`, version: (previous?.version ?? 0) + 1 };
  if (request.analysisSourceId !== undefined) {
    if (typeof request.analysisSourceId !== "string" || !request.analysisSourceId.trim()) throw new Error("请指定确认后计算的现有工况或组合身份");
    next.analysisSourceId = request.analysisSourceId;
  }
  for (const key of ["supports", "nodalLoads"] as const) {
    const values = request[key];
    if (values === undefined) continue;
    if (!Array.isArray(values) || values.length > 100) throw new Error("每次条件阶段最多 100 个支座或节点荷载");
    const parsed = values.map((raw) => {
      const entry = object(raw, key === "supports" ? ["id", "nodeId", "restraints", "source"] : ["id", "nodeId", "loadCaseId", "force", "moment", "source"]);
      if (typeof entry.nodeId !== "string" || !entry.nodeId.trim() || entry.nodeId.length > 200
        || entry.id !== undefined && (typeof entry.id !== "string" || !entry.id.trim() || entry.id.length > 200)) throw new Error("请指定有效的稳定节点/条件身份");
      if (entry.source !== "user" && entry.source !== "suggestion") throw new Error("请标明用户提供或待确认建议");
      const common = { ...(entry.id === undefined ? {} : { id: entry.id }), nodeId: entry.nodeId as NodeId, source: entry.source as Source };
      if (key === "supports") {
        if (!Array.isArray(entry.restraints) || entry.restraints.length !== 6 || !entry.restraints.every((v) => typeof v === "boolean")) throw new Error("支座必须逐项指定 UX/UY/UZ/RX/RY/RZ 六个布尔约束");
        return { ...common, restraints: [...entry.restraints] as DofRestraints };
      }
      if (typeof entry.loadCaseId !== "string" || !entry.loadCaseId.trim()) throw new Error("节点荷载必须指定工况");
      return { ...common, loadCaseId: entry.loadCaseId, force: vector(entry.force), moment: vector(entry.moment) };
    });
    if (key === "supports") next.supports = parsed as SupportProposal[];
    else next.nodalLoads = parsed as NodalLoadProposal[];
  }
  return next;
}

export function conditionsIssues(project: { nodes: readonly { id: string }[]; supports: readonly { id: string; nodeId: string; label: string }[]; nodalLoads: readonly { id: string }[]; loadCases: readonly { id: string }[]; loadCombinations: readonly { id: string }[] }, proposal: ConditionsProposal): string[] {
  const issues: string[] = [];
  if (proposal.supports === undefined) issues.push("尚缺支座条件；明确无新增支座时填空列表");
  if (proposal.nodalLoads === undefined) issues.push("尚缺节点力/力矩；明确无新增节点荷载时填空列表");
  if (proposal.analysisSourceId && ![...project.loadCases, ...project.loadCombinations].some((source) => source.id === proposal.analysisSourceId)) issues.push(`计算来源 ${proposal.analysisSourceId} 已不存在`);
  const supportNodes = new Set<string>();
  const loadIds = new Set<string>();
  for (const entry of [...(proposal.supports ?? []), ...(proposal.nodalLoads ?? [])]) {
    if (!project.nodes.some((node) => node.id === entry.nodeId)) issues.push(`节点 ${entry.nodeId} 已不存在，请重新指定`);
    if ("restraints" in entry) {
      if (supportNodes.has(entry.nodeId)) issues.push(`节点 ${entry.nodeId} 在方案中重复设置支座`);
      supportNodes.add(entry.nodeId);
      const existing = project.supports.find((s) => s.nodeId === entry.nodeId && s.id !== entry.id);
      if (existing) issues.push(`节点已有 ${existing.label}，修改时须指定该支座身份`);
      if (entry.id && !project.supports.some((s) => s.id === entry.id)) issues.push(`支座 ${entry.id} 已不存在`);
    } else {
      if (!project.loadCases.some((c) => c.id === entry.loadCaseId)) issues.push(`工况 ${entry.loadCaseId} 已不存在`);
      if (entry.id && (!project.nodalLoads.some((l) => l.id === entry.id) || loadIds.has(entry.id))) issues.push(`荷载 ${entry.id} 不存在或重复修改`);
      if (entry.id) loadIds.add(entry.id);
    }
  }
  const supportIds = (proposal.supports ?? []).flatMap((s) => s.id ? [s.id] : []);
  if (new Set(supportIds).size !== supportIds.length) issues.push("同一支座不能重复修改");
  return issues;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function prepareConditionsConfirmation(project: FrameProject, proposal: ConditionsProposal) {
  return Object.freeze({ requestId: `confirm_${crypto.randomUUID()}`, baseProject: project,
    proposal: freeze(structuredClone(proposal)), context: captureAiSnapshot(project, []).context });
}
export type ConditionsConfirmation = ReturnType<typeof prepareConditionsConfirmation>;

export class ConditionsStageConfirmation {
  private applied = new Map<string, AiToolResult>();
  confirm(project: FrameProject, confirmation: ConditionsConfirmation): { project: FrameProject; result: AiToolResult } {
    const context = captureAiSnapshot(project, []).context;
    const failed = (message: string) => ({ project, result: { status: "failed" as const, message, context } });
    if (project.id !== confirmation.context.projectId) return failed("项目已切换，请重新准备分析条件");
    const key = `${project.id}:${confirmation.proposal.id}:${confirmation.proposal.version}`;
    const receipt = this.applied.get(key);
    if (receipt) return { project, result: { ...receipt, message: "该分析条件阶段已确认过，本次未重复应用" } };
    if (project !== confirmation.baseProject || project.revision !== confirmation.context.modelRevision) return failed("正式模型已变化，请更新条件预览并再次确认");
    try {
      const proposal = proposeConditions({ supports: confirmation.proposal.supports, nodalLoads: confirmation.proposal.nodalLoads, analysisSourceId: confirmation.proposal.analysisSourceId });
      const issues = conditionsIssues(project, proposal);
      if (issues.length) return failed(issues.join("；"));
      const next = applyProjectTransaction(project, (initial) => {
        let current = initial;
        for (const s of proposal.supports ?? []) current = s.id ? updateSupport(current, s.id, s.nodeId, s.restraints) : addSupport(current, s.nodeId, s.restraints);
        for (const l of proposal.nodalLoads ?? []) current = l.id ? updateNodalLoad(current, l.id, l.nodeId, l.force, l.moment, l.loadCaseId) : addNodalLoad(current, l.nodeId, l.force, l.moment, l.loadCaseId);
        const sourceId = proposal.analysisSourceId;
        if (sourceId && sourceId !== (current.activeLoadCombinationId ?? current.activeLoadCaseId)) current = current.loadCases.some((source) => source.id === sourceId) ? selectLoadCase(current, sourceId) : selectLoadCombination(current, sourceId);
        return current;
      });
      const result: AiToolResult = { status: "applied", message: "分析条件阶段已应用，可整组撤销和重做", context: captureAiSnapshot(next, []).context,
        data: { requestId: confirmation.requestId, proposalId: confirmation.proposal.id, proposalVersion: confirmation.proposal.version,
          baseRevision: project.revision, appliedRevision: next.revision, units: next.units, analysisSourceId: next.activeLoadCombinationId ?? next.activeLoadCaseId, supports: next.supports, nodalLoads: next.nodalLoads } };
      this.applied.set(key, result);
      return { project: next, result };
    } catch (error) { return failed(error instanceof Error ? error.message : "条件应用失败，原模型保留"); }
  }
}
