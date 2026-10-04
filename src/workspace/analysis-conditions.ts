import { addNodalLoad, addSupport, selectLoadCase, selectLoadCombination, updateNodalLoad, updateSupport, type DofRestraints, type FrameProject, type LoadId, type NodeId, type SupportId, type Vector3 } from "../domain/project";
import { applyProjectTransaction } from "../domain/project-operations";
import { captureAiSnapshot, type AiToolResult } from "./ai-tools";
import { conditionObject as object, conditionSource as source, conditionVector as vector, type ConditionSource as Source } from "./condition-input";
import { applyLoadStage, LOAD_STAGE_FIELDS, loadStageIssues, loadStageReferences, parseLoadStage, type LoadStage } from "./load-stage";
import type { FramePreview } from "./frame-proposal";
import { savedOperation, recordOperation, sameProjectInput } from "./task-persistence";

export interface SupportProposal { id?: SupportId; nodeId: NodeId; restraints: DofRestraints; source: Source; }
export interface NodalLoadProposal { id?: LoadId; nodeId: NodeId; loadCaseId: string; force: Vector3; moment: Vector3; source: Source; }
export interface ConditionsProposal extends LoadStage {
  id: string; version: number;
  supports?: SupportProposal[]; nodalLoads?: NodalLoadProposal[];
  analysisSourceId?: string;
}

/** Partial updates retain the other stage fields; no model commands run here. */
export function proposeConditions(input: unknown, previous?: ConditionsProposal): ConditionsProposal {
  const request = object(input, ["supports", "nodalLoads", "analysisSourceId", ...LOAD_STAGE_FIELDS]);
  if (!Object.keys(request).length) throw new Error("至少提供支座或节点荷载；未知条件请省略");
  const next: ConditionsProposal = { ...structuredClone(previous ?? {}), ...parseLoadStage(request), id: previous?.id ?? `conditions_${crypto.randomUUID()}`, version: (previous?.version ?? 0) + 1 };
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
      const entrySource = source(entry.source);
      const common = { ...(entry.id === undefined ? {} : { id: entry.id }), nodeId: entry.nodeId as NodeId, source: entrySource as Source };
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

export function conditionsIssues(project: Parameters<typeof loadStageIssues>[0] & { nodes: readonly { id: string }[]; supports: readonly { id: string; nodeId: string; label: string }[]; nodalLoads: readonly { id: string }[] }, proposal: ConditionsProposal): string[] {
  const issues: string[] = [];
  if (proposal.supports === undefined) issues.push("尚缺支座条件；明确无新增支座时填空列表");
  if (proposal.nodalLoads === undefined) issues.push("尚缺节点力/力矩；明确无新增节点荷载时填空列表");
  const { references } = loadStageReferences(project, proposal);
  const resolve = (ref: string) => references.get(ref) ?? ref;
  const caseIds = [...project.loadCases.map((c) => c.id), ...(proposal.loadCases ?? []).map((c) => resolve(c.ref))];
  const sourceIds = [...caseIds, ...project.loadCombinations.map((c) => c.id), ...(proposal.loadCombinations ?? []).map((c) => resolve(c.ref))];
  if (proposal.analysisSourceId && !sourceIds.includes(resolve(proposal.analysisSourceId))) issues.push(`计算来源 ${proposal.analysisSourceId} 已不存在`);
  const supportNodes = new Set<string>();
  const loadIds = new Set<string>();
  for (const entry of [...(proposal.supports ?? []), ...(proposal.nodalLoads ?? [])]) {
    if (entry.source === "unknown") issues.push("支座或节点荷载来源未知，请补充或确认");
    if (!project.nodes.some((node) => node.id === entry.nodeId)) issues.push(`节点 ${entry.nodeId} 已不存在，请重新指定`);
    if ("restraints" in entry) {
      if (supportNodes.has(entry.nodeId)) issues.push(`节点 ${entry.nodeId} 在方案中重复设置支座`);
      supportNodes.add(entry.nodeId);
      const existing = project.supports.find((s) => s.nodeId === entry.nodeId && s.id !== entry.id);
      if (existing) issues.push(`节点已有 ${existing.label}，修改时须指定该支座身份`);
      if (entry.id && !project.supports.some((s) => s.id === entry.id)) issues.push(`支座 ${entry.id} 已不存在`);
    } else {
      if (!caseIds.includes(resolve(entry.loadCaseId))) issues.push(`工况 ${entry.loadCaseId} 已不存在`);
      if (entry.id && (!project.nodalLoads.some((l) => l.id === entry.id) || loadIds.has(entry.id))) issues.push(`荷载 ${entry.id} 不存在或重复修改`);
      if (entry.id) loadIds.add(entry.id);
    }
  }
  const supportIds = (proposal.supports ?? []).flatMap((s) => s.id ? [s.id] : []);
  if (new Set(supportIds).size !== supportIds.length) issues.push("同一支座不能重复修改");
  return [...issues, ...loadStageIssues(project, proposal)];
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export function buildConditionsPreview(project: FrameProject, proposal: ConditionsProposal): FramePreview {
  const issues = conditionsIssues(project, proposal);
  const caseLabel = (id: string) => (proposal.loadCases ?? []).find((c) => c.ref === id || c.id === id)?.name ?? project.loadCases.find((c) => c.id === id)?.name ?? id;
  const uniformLoads: NonNullable<FramePreview["uniformLoads"]> = (proposal.uniformLoads ?? []).map((l, i) => ({ ...l, kind: "uniform", id: l.id ?? `preview_uniform_${i}` as LoadId, label: `待确认均布 ${i + 1} · ${caseLabel(l.loadCaseId)}` }));
  const hasLoads = LOAD_STAGE_FIELDS.some((key) => proposal[key] !== undefined);
  return { status: issues.length ? "missing-input" : "awaiting-confirmation", issues, nodes: [], members: [], materials: [], sections: [], conditionNodes: project.nodes,
    supports: (proposal.supports ?? []).map((s, i) => ({ ...s, id: s.id ?? `preview_support_${i}` as SupportId, label: `待确认支座 ${i + 1}` })),
    nodalLoads: (proposal.nodalLoads ?? []).map((l, i) => ({ ...l, id: l.id ?? `preview_load_${i}` as LoadId, label: `待确认荷载 ${i + 1} · ${caseLabel(l.loadCaseId)}` })),
    uniformLoads, selfWeight: proposal.selfWeight && { ...proposal.selfWeight, caseLabel: caseLabel(proposal.selfWeight.loadCaseId) },
    loadStageSummary: hasLoads ? `${proposal.uniformLoads?.length ?? 0} 均布 / 自重${proposal.selfWeight ? proposal.selfWeight.enabled ? "启用" : "关闭" : "保留"} / ${proposal.loadCases?.length ?? 0} 工况 / ${proposal.loadCombinations?.length ?? 0} 用户自定义组合 · 原始荷载` : undefined };
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
    const receipt = savedOperation(project, key) ?? this.applied.get(key);
    if (receipt) return { project, result: { ...receipt, message: "该分析条件阶段已确认过，本次未重复应用" } };
    if (!sameProjectInput(project, confirmation.baseProject) || project.revision !== confirmation.context.modelRevision) return failed("正式模型已变化，请更新条件预览并再次确认");
    try {
      const { id: _id, version: _version, ...input } = confirmation.proposal;
      const proposal = proposeConditions(input);
      const issues = conditionsIssues(project, proposal);
      if (issues.length) return failed(issues.join("；"));
      let references: Record<string, string> = {};
      const next = applyProjectTransaction(project, (initial) => {
        const applied = applyLoadStage(initial, proposal);
        let current = applied.project;
        references = applied.references;
        for (const s of proposal.supports ?? []) current = s.id ? updateSupport(current, s.id, s.nodeId, s.restraints) : addSupport(current, s.nodeId, s.restraints);
        for (const l of proposal.nodalLoads ?? []) {
          const caseId = references[l.loadCaseId] ?? l.loadCaseId;
          current = l.id ? updateNodalLoad(current, l.id, l.nodeId, l.force, l.moment, caseId) : addNodalLoad(current, l.nodeId, l.force, l.moment, caseId);
        }
        const sourceId = proposal.analysisSourceId && (references[proposal.analysisSourceId] ?? proposal.analysisSourceId);
        if (sourceId && sourceId !== (current.activeLoadCombinationId ?? current.activeLoadCaseId)) current = current.loadCases.some((source) => source.id === sourceId) ? selectLoadCase(current, sourceId) : selectLoadCombination(current, sourceId);
        return current;
      });
      const result: AiToolResult = { status: "applied", message: "分析条件阶段已应用，可整组撤销和重做", context: captureAiSnapshot(next, []).context,
        data: { requestId: confirmation.requestId, proposalId: confirmation.proposal.id, proposalVersion: confirmation.proposal.version,
          baseRevision: project.revision, appliedRevision: next.revision, units: next.units, analysisSourceId: next.activeLoadCombinationId ?? next.activeLoadCaseId, references, supports: next.supports, nodalLoads: next.nodalLoads,
          uniformLoads: next.uniformLoads, selfWeight: next.selfWeight, loadCases: next.loadCases, loadCombinations: next.loadCombinations, combinationBasis: "用户自定义 · 无量纲系数 · 线弹性" } };
      this.applied.set(key, result);
      return { project: recordOperation(next, key, result), result };
    } catch (error) { return failed(error instanceof Error ? error.message : "条件应用失败，原模型保留"); }
  }
}
