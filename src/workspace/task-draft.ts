import type { FrameProject, NodeId, MemberId } from "../domain/project";
import { MATERIAL_CATALOG, SECTION_CATALOG } from "../domain/resource-library";
import { buildFramePreview, proposeFrame, type FramePreview, type FrameProposal } from "./frame-proposal";
import { buildConditionsPreview, proposeConditions, type ConditionsProposal } from "./analysis-conditions";
import type { AiSnapshot, AiStatus } from "./ai-tools";
import type { TaskValueSource } from "./condition-input";
import { parseProjectEditOperations } from "./model-edits";
import { applyProjectEdits, type ProjectEditOperation, type ProjectEditReceipt } from "../domain/project-operations";

/** A value origin used by the whole-task review. Existing values are facts, while
 * user/suggestion values describe the proposed change that still needs review. */
export type { TaskValueSource } from "./condition-input";

export interface TaskAnalysisIntent {
  requested: boolean;
  sourceId?: string;
  source?: TaskValueSource;
}

export interface TaskDraft {
  id: string;
  version: number;
  projectId: string;
  baseRevision: number;
  goal?: string;
  frame?: FrameProposal;
  conditions?: ConditionsProposal;
  analysis?: TaskAnalysisIntent;
  edits?: { operations: ProjectEditOperation[]; source: TaskValueSource; sources?: TaskValueSource[] };
}

export interface TaskChange {
  category: "geometry" | "resource" | "support" | "load" | "analysis";
  label: string;
  before?: unknown;
  after?: unknown;
  source: TaskValueSource | "mixed";
  impact?: string;
  provenance?: { operationIndex: number; source: TaskValueSource; values: unknown }[];
}

export interface TaskDraftPreview {
  edits?: ProjectEditReceipt;
  status: AiStatus;
  issues: string[];
  missing: { category: TaskChange["category"]; label: string; reason: string }[];
  changes: TaskChange[];
  frame?: FramePreview;
  conditions?: FramePreview;
  objectRefs: { kind: "node" | "member"; id: string; label: string; category: "existing" | "new" }[];
  analysis?: TaskAnalysisIntent;
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) throw new Error(`完整任务草案含未定义字段 ${extra}`);
}

function text(value: unknown, label: string, max = 2_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label}必须是非空文本（最多 ${max} 字）`);
  return value.trim();
}

function source(value: unknown): TaskValueSource {
  if (value === undefined) return "unknown";
  if (!["existing", "user", "catalog", "suggestion", "assumption", "unknown"].includes(value as string)) throw new Error("任务草案值来源无效");
  return value as TaskValueSource;
}

export function taskEditSources(edits: NonNullable<TaskDraft["edits"]>): TaskValueSource[] {
  if (edits.sources !== undefined && (!Array.isArray(edits.sources) || edits.sources.length !== edits.operations.length)) throw new Error("逐项来源必须与工程操作一一对应");
  return edits.operations.map((_, index) => source(edits.sources?.[index] ?? edits.source));
}

function mergeAnalysis(previous: TaskAnalysisIntent | undefined, value: unknown): TaskAnalysisIntent | undefined {
  if (value === undefined) return previous;
  const input = record(value, "analysis 必须是对象");
  exact(input, ["requested", "sourceId", "source"]);
  if (typeof input.requested !== "boolean") throw new Error("analysis.requested 必须是布尔值");
  const next: TaskAnalysisIntent = { requested: input.requested, source: source(input.source) };
  if (input.sourceId !== undefined) next.sourceId = text(input.sourceId, "analysis.sourceId", 200);
  return next;
}

function normalizeConditionsInput(input: Record<string, unknown>): Record<string, unknown> {
  if (input.conditions !== undefined) return record(input.conditions, "conditions 必须是对象");
  const keys = ["supports", "nodalLoads", "uniformLoads", "selfWeight", "loadCases", "loadCombinations", "analysisSourceId"];
  const result: Record<string, unknown> = {};
  for (const key of keys) if (input[key] !== undefined) result[key] = input[key];
  return result;
}

function isDraftRef(id: string, kind: "node" | "member"): boolean {
  return id.startsWith("draft:") && id.includes(`:${kind}:`);
}

function replaceConditionRefs(conditions: ConditionsProposal, frame: FrameProposal | undefined): ConditionsProposal {
  if (!frame) return conditions;
  const nodePrefix = `${frame.id}:node:`;
  const memberPrefix = `${frame.id}:member:`;
  const map = (value: string, kind: "node" | "member") => {
    if (!isDraftRef(value, kind)) return value;
    const raw = value.replace(/^draft:/, "");
    if (kind === "node" && raw.startsWith(nodePrefix)) return raw;
    if (kind === "member" && raw.startsWith(memberPrefix)) return raw;
    if (value.startsWith("draft:node:")) return `${frame.id}:node:${value.slice("draft:node:".length)}`;
    if (value.startsWith("draft:member:")) return `${frame.id}:member:${value.slice("draft:member:".length)}`;
    return value;
  };
  return {
    ...conditions,
    supports: conditions.supports?.map((item) => ({ ...item, nodeId: map(item.nodeId, "node") as NodeId })),
    nodalLoads: conditions.nodalLoads?.map((item) => ({ ...item, nodeId: map(item.nodeId, "node") as NodeId })),
    uniformLoads: conditions.uniformLoads?.map((item) => ({ ...item, memberId: map(item.memberId, "member") as MemberId })),
  };
}

function draftProject(project: FrameProject, frame: FramePreview | undefined): FrameProject {
  if (!frame) return project;
  return {
    ...project,
    nodes: [...project.nodes, ...frame.nodes],
    members: [...project.members, ...frame.members.map(({ role: _role, ...member }) => member)],
    materials: [...project.materials, ...frame.materials.map((material) => ({ id: material.id, label: material.label, name: material.name, elasticModulusGPa: material.elasticModulusGPa, poissonRatio: material.poissonRatio, densityKgM3: material.densityKgM3, provenance: material.provenance }))],
    sections: [...project.sections, ...frame.sections.map((section) => ({ id: section.id, label: section.label, name: section.name, areaM2: section.areaM2, secondMomentYM4: section.secondMomentYM4, secondMomentZM4: section.secondMomentZM4, torsionalConstantM4: section.torsionalConstantM4, ...(section.geometry ? { geometry: section.geometry, parameterBasis: section.parameterBasis, ...(section.catalogBasis ? { catalogBasis: section.catalogBasis } : {}) } : {}), provenance: section.provenance }))],
    nextNodeNumber: project.nextNodeNumber + frame.nodes.length,
    nextMemberNumber: project.nextMemberNumber + frame.members.length,
    nextMaterialNumber: project.nextMaterialNumber + frame.materials.length,
    nextSectionNumber: project.nextSectionNumber + frame.sections.length,
  };
}

/** Resolve only explicit draft identities; never guess future formal IDs. */
export function taskObjectId(draft: TaskDraft, value: string, mapping: Record<string, string> = {}): string {
  const id = value.startsWith("draft:node:") || value.startsWith("draft:member:")
    ? `${draft.frame?.id}:${value.slice("draft:".length)}` : value.replace(/^draft:/, "");
  return mapping[id] ?? (value.startsWith("draft:") ? id : value);
}

export function taskEditOperations(draft: TaskDraft, mapping: Record<string, string> = {}): ProjectEditOperation[] {
  const resolve = (value: unknown, key = ""): unknown => {
    if (typeof value === "string") {
      return /(?:^id$|Id$|Ids$)/.test(key) ? taskObjectId(draft, value, mapping) : value;
    }
    if (Array.isArray(value)) return value.map((child) => resolve(child, key));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolve(child, key)]));
    return value;
  };
  return draft.edits ? parseProjectEditOperations(resolve(draft.edits.operations)) : [];
}

export function taskEngineeringPreview(snapshot: AiSnapshot, draft: TaskDraft) {
  const frame = draft.frame ? buildFramePreview(snapshot, draft.frame) : undefined;
  const initial = draftProject(snapshot.editProject, frame);
  const edited = draft.edits ? applyProjectEdits(initial, taskEditOperations(draft)) : undefined;
  return { frame, initial, project: edited?.project ?? initial, edits: edited?.receipt };
}

function parameterSource(snapshot: AiSnapshot, frame: FrameProposal, field: keyof FrameProposal["parameters"]): TaskValueSource {
  const parameter = frame.parameters[field];
  if (!parameter) return "unknown";
  if (parameter.source === "user" || parameter.source === "assumption" || parameter.source === "unknown") return parameter.source;
  const value = String(parameter.value);
  if (field === "material" && snapshot.model.materials.some((item) => item.id === value)) return "existing";
  if ((field === "columnSection" || field === "beamSection") && snapshot.model.sections.some((item) => item.id === value)) return "existing";
  if (field === "material" && MATERIAL_CATALOG.some((item) => item.catalogId === value)) return "catalog";
  if ((field === "columnSection" || field === "beamSection") && SECTION_CATALOG.some((item) => item.catalogId === value)) return "catalog";
  return parameter.source;
}

function changes(snapshot: AiSnapshot, frame: FrameProposal | undefined, conditions: ConditionsProposal | undefined, analysis: TaskAnalysisIntent | undefined): TaskChange[] {
  const project = snapshot.editProject;
  const result: TaskChange[] = [];
  if (frame) {
    for (const item of frame.changes) {
      const category = ["material", "columnSection", "beamSection"].includes(item.field) ? "resource" : "geometry";
      result.push({ category, label: item.field, before: item.before, after: item.after, source: parameterSource(snapshot, frame, item.field), impact: category === "geometry" ? "创建或更新节点与杆件引用" : "影响杆件刚度及自重参数" });
    }
    if (!frame.changes.length) result.push({ category: "geometry", label: "空间框架", after: "保留当前草案参数", source: "existing" });
  }
  if (conditions) {
    for (const item of conditions.supports ?? []) result.push({ category: "support", label: item.id ? `支座 ${item.id}` : `节点 ${item.nodeId} 新增支座`, before: item.id ? project.supports.find((v) => v.id === item.id)?.restraints : undefined, after: item.restraints, source: item.source, impact: "改变约束自由度并影响结构可解性" });
    for (const item of conditions.nodalLoads ?? []) result.push({ category: "load", label: item.id ? `节点荷载 ${item.id}` : `节点 ${item.nodeId} 新增荷载`, before: item.id ? project.nodalLoads.find((v) => v.id === item.id) : undefined, after: { force: item.force, moment: item.moment, loadCaseId: item.loadCaseId }, source: item.source, impact: "改变指定工况的外荷载" });
    for (const item of conditions.uniformLoads ?? []) result.push({ category: "load", label: item.id ? `均布荷载 ${item.id}` : `杆件 ${item.memberId} 新增均布荷载`, before: item.id ? project.uniformLoads.find((v) => v.id === item.id) : undefined, after: item, source: item.source, impact: "改变整根杆件沿程荷载" });
    if (conditions.selfWeight) result.push({ category: "load", label: "结构自重", before: project.selfWeight, after: conditions.selfWeight, source: conditions.selfWeight.source, impact: "按材料密度与截面面积生成全结构自重" });
    for (const item of conditions.loadCases ?? []) result.push({ category: "load", label: item.id ? `工况 ${item.id}` : `新增工况 ${item.ref}`, before: item.id ? project.loadCases.find((v) => v.id === item.id) : undefined, after: item, source: item.source, impact: "改变荷载归属及可选分析来源" });
    for (const item of conditions.loadCombinations ?? []) result.push({ category: "load", label: item.id ? `组合 ${item.id}` : `新增组合 ${item.ref}`, before: item.id ? project.loadCombinations.find((v) => v.id === item.id) : undefined, after: item, source: item.source, impact: "按用户系数组合原始工况" });
  }
  if (analysis?.requested) result.push({ category: "analysis", label: "确认后分析", after: analysis.sourceId ?? conditions?.analysisSourceId ?? project.activeAnalysisCaseId ?? project.activeLoadCombinationId ?? project.activeLoadCaseId, source: analysis.source ?? "user", impact: "确认并核对模型后继续本地分析" });
  return result;
}

export function buildTaskDraftPreview(snapshot: AiSnapshot, draft: TaskDraft): TaskDraftPreview {
  const engineering = taskEngineeringPreview(snapshot, draft);
  const frame = engineering.frame;
  const conditions = draft.conditions ? replaceConditionRefs(draft.conditions, draft.frame) : undefined;
  const conditionProject = engineering.project;
  const conditionPreview = conditions ? buildConditionsPreview(conditionProject, conditions) : undefined;
  const hasExistingLoad = snapshot.model.nodalLoads.length > 0 || snapshot.model.uniformLoads.length > 0 || snapshot.model.selfWeight.enabled
    || snapshot.model.loadCases.length > 1 || snapshot.model.loadCombinations.length > 0;
  const hasDraftLoad = conditions ? ["nodalLoads", "uniformLoads", "selfWeight", "loadCases", "loadCombinations"].some((key) => conditions[key as keyof ConditionsProposal] !== undefined) : false;
  const issues = [...(frame?.issues ?? []), ...(conditionPreview?.issues ?? []).filter((issue) => {
    if (issue.startsWith("尚缺支座条件") && snapshot.model.supports.length > 0) return false;
    if (issue.startsWith("尚缺节点力/力矩") && (hasExistingLoad || hasDraftLoad)) return false;
    return true;
  })];
  const missing: TaskDraftPreview["missing"] = [];
  if (!draft.conditions?.supports && snapshot.model.supports.length === 0) {
    missing.push({ category: "support", label: "支座条件", reason: "当前模型没有已应用支座，需明确新增支座或确认无支座" });
  }
  if (!draft.conditions?.nodalLoads && !hasExistingLoad && !hasDraftLoad) {
    missing.push({ category: "load", label: "节点力/力矩", reason: "当前模型没有已应用节点荷载，需明确荷载或确认无新增荷载" });
  }
  for (const issue of issues) {
    const category = /支座/.test(issue) ? "support" : /荷载|工况|自重|组合/.test(issue) ? "load" : /计算来源/.test(issue) ? "analysis" : frame ? "geometry" : "analysis";
    missing.push({ category, label: issue, reason: issue });
  }
  if (draft.analysis?.requested && !draft.analysis.sourceId && !draft.conditions?.analysisSourceId && !snapshot.model.activeLoadCombinationId && !snapshot.model.activeLoadCaseId) {
    missing.push({ category: "analysis", label: "确认后分析来源", reason: "未指定可计算的工况或组合" });
  }
  if (draft.analysis?.requested && draft.analysis.source === "unknown") {
    missing.push({ category: "analysis", label: "确认后分析来源", reason: "分析意图来源未知，请明确用户值、建议或假设" });
  }
  if (draft.frame) for (const [field, parameter] of Object.entries(draft.frame.parameters)) {
    if (parameter?.source === "unknown") missing.push({ category: ["material", "columnSection", "beamSection"].includes(field) ? "resource" : "geometry", label: field, reason: `${field} 的来源未知，请补充或确认` });
  }
  for (const [category, entries] of [["support", conditions?.supports], ["load", conditions?.nodalLoads], ["load", conditions?.uniformLoads], ["load", conditions?.loadCases], ["load", conditions?.loadCombinations]] as const) {
    if (entries?.some((entry) => entry.source === "unknown")) missing.push({ category, label: `${category} 条目`, reason: `${category} 条目的来源未知，请补充或确认` });
  }
  if (conditions?.selfWeight?.source === "unknown") missing.push({ category: "load", label: "结构自重", reason: "结构自重的来源未知，请补充或确认" });
  const objectRefs = [
    ...snapshot.model.nodes.map((item) => ({ kind: "node" as const, id: item.id, label: item.label, category: "existing" as const })),
    ...snapshot.model.members.map((item) => ({ kind: "member" as const, id: item.id, label: item.label, category: "existing" as const })),
    ...(frame?.nodes ?? []).map((item) => ({ kind: "node" as const, id: item.id, label: item.label, category: "new" as const })),
    ...(frame?.members ?? []).map((item) => ({ kind: "member" as const, id: item.id, label: item.label, category: "new" as const })),
  ];
  const allChanges = changes(snapshot, draft.frame, draft.conditions, draft.analysis);
  if (draft.edits) {
    const sources = taskEditSources(draft.edits);
    if (sources.includes("unknown")) missing.push({ category: "geometry", label: "工程操作来源", reason: "工程操作的来源未知，请补充或确认" });
    const labels = { material: "材料", section: "截面", node: "节点", member: "杆件", support: "支座", "nodal-load": "节点荷载", "uniform-load": "均布荷载", "load-case": "荷载工况", "load-combination": "荷载组合", "analysis-case": "分析工况", "psd-spectrum": "输入谱" };
    for (const change of engineering.edits!.changes) allChanges.push({ category: ["material", "section", "psd-spectrum"].includes(change.kind) ? "resource" : change.kind === "support" ? "support" : ["nodal-load", "uniform-load", "load-case", "load-combination"].includes(change.kind) ? "load" : change.kind === "analysis-case" ? "analysis" : "geometry", label: `${labels[change.kind]} ${change.id}`, before: change.before, after: change.after, source: new Set(sources).size === 1 ? sources[0] : "mixed", provenance: draft.edits.sources ? draft.edits.operations.map((operation, operationIndex) => {
      const { type: _type, ...values } = operation;
      return { operationIndex, source: sources[operationIndex], values };
    }) : undefined, impact: "与条件及分析意图一起确认；共享资源变化影响全部引用对象" });
  }
  if (draft.frame) {
    allChanges.push({ category: "resource", label: "材料来源", after: draft.frame.parameters.material?.value, source: parameterSource(snapshot, draft.frame, "material"), impact: "确认后复制到正式项目资源" });
    allChanges.push({ category: "resource", label: "柱/梁截面来源", after: { column: draft.frame.parameters.columnSection?.value, beam: draft.frame.parameters.beamSection?.value }, source: parameterSource(snapshot, draft.frame, "columnSection"), impact: "确认后绑定新杆件" });
  }
  return { status: missing.length ? "missing-input" : "awaiting-confirmation", issues, missing, changes: allChanges, frame, conditions: conditionPreview, objectRefs, analysis: draft.analysis, edits: engineering.edits };
}

/** Merge one natural-language task update. No project mutation occurs here. */
export function proposeTask(snapshot: AiSnapshot, input: unknown, previous?: TaskDraft): TaskDraft {
  const request = record(input, "完整任务草案必须是对象");
  exact(request, ["id", "goal", "frame", "parameters", "conditions", "supports", "nodalLoads", "uniformLoads", "selfWeight", "loadCases", "loadCombinations", "analysis", "analysisRequested", "edits"]);
  let edits = previous?.edits;
  if (request.edits !== undefined) {
    const input = record(request.edits, "工程操作必须是对象");
    exact(input, ["operations", "source", "sources"]);
    if (!["existing", "user", "catalog", "suggestion", "assumption", "unknown"].includes(String(input.source))) throw new Error("工程操作必须声明参数来源");
    edits = { operations: parseProjectEditOperations(input.operations), source: input.source as TaskValueSource, ...(input.sources !== undefined ? { sources: input.sources as TaskValueSource[] } : {}) };
    taskEditSources(edits);
  }
  const id = previous?.id ?? (typeof request.id === "string" && request.id.trim() ? text(request.id, "任务身份", 200) : `task_${crypto.randomUUID()}`);
  const frameInput = request.frame ?? (request.parameters === undefined ? undefined : { parameters: request.parameters });
  const frame = frameInput === undefined ? previous?.frame : proposeFrame(frameInput, previous?.frame);
  const conditionInput = normalizeConditionsInput(request);
  const hasConditionInput = Object.keys(conditionInput).length > 0;
  let conditions = previous?.conditions;
  if (hasConditionInput) conditions = proposeConditions(conditionInput, conditions);
  const analysisValue = request.analysis ?? (request.analysisRequested === undefined ? undefined : { requested: request.analysisRequested, source: "user" });
  const analysis = mergeAnalysis(previous?.analysis, analysisValue);
  if (analysis?.requested && !analysis.sourceId) analysis.sourceId = conditions?.analysisSourceId
    ?? (conditions?.loadCases?.length === 1 && !conditions.loadCombinations?.length ? conditions.loadCases[0].ref : undefined)
    ?? snapshot.model.activeAnalysisCaseId ?? snapshot.model.activeLoadCombinationId ?? snapshot.model.activeLoadCaseId;
  const goal = request.goal === undefined ? previous?.goal : text(request.goal, "任务目标");
  const next: TaskDraft = { id, version: (previous?.version ?? 0) + 1, projectId: snapshot.context.projectId, baseRevision: snapshot.context.modelRevision, ...(goal ? { goal } : {}), ...(frame ? { frame } : {}), ...(conditions ? { conditions } : {}), ...(analysis ? { analysis } : {}), ...(edits ? { edits } : {}) };
  // Validate the merged draft now so a tool reply can distinguish missing input
  // from a malformed request without ever changing the applied model.
  buildTaskDraftPreview(snapshot, next);
  return next;
}
