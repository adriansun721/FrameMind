import type { FrameProject } from "../domain/project";
import { calculateMemberGeometry } from "../domain/member-geometry";
import { buildFramePreview, proposeFrame, type FrameProposal } from "./frame-proposal";
import { conditionsIssues, proposeConditions, type ConditionsProposal } from "./analysis-conditions";
import { loadStageReferences } from "./load-stage";
import { getActiveAnalysisResult, isAnalysisResultCurrent, type AnalysisResult } from "../domain/analysis";
import { readResult, readResults, type ResultReference } from "./ai-results";
import { proposeSectionChange, type SectionChangeProposal } from "./section-stage";
import { readComparison, readComparisonResult, type AiAnalysisPair, type AnalysisPairIds, type ComparisonReference } from "./ai-comparison";
import { MODEL_EDIT_TOOLS, modelEditToolInput, proposeModelEdits, type ModelEditProposal } from "./model-edits";
import { buildTaskDraftPreview, proposeTask, type TaskDraft } from "./task-draft";

export interface AiObjectRef { kind: "node" | "member"; id: string; }
export interface AiSelectedObject extends AiObjectRef { label: string; exists: boolean; }
export interface AiAnalysisContext {
  id?: string;
  inputRevision?: number;
  createdAt?: string;
  status: 'absent' | 'incomplete' | 'complete';
  current: boolean;
  source?: { id: string; name: string; kind: 'case' | 'combination' };
}
export interface AiContext {
  projectId: string;
  projectName: string;
  modelRevision: number;
  selection: readonly AiSelectedObject[];
  goal?: string;
  analysisId?: string;
  analysis?: AiAnalysisContext;
  comparison?: AnalysisPairIds;
}
export type AiStatus = "completed" | "applied" | "missing-input" | "awaiting-confirmation" | "failed" | "cancelled";
export interface AiReceipt {
  call: { id?: string; name?: string; initiated: boolean; completed: boolean; status: AiStatus };
  object: { kind: "project"; id: string; name: string };
  objects: readonly AiObjectRef[];
  input: { projectId: string; modelRevision: number; analysisId?: string; analysisInputRevision?: number };
  state: { project: "current"; model: "applied"; analysis: "absent" | "incomplete" | "current" | "expired" };
}
export interface AiToolResult { status: AiStatus; message: string; context: AiContext; receipt?: AiReceipt; data?: unknown; reference?: ResultReference; comparisonReference?: ComparisonReference; proposal?: FrameProposal | null; conditions?: ConditionsProposal | null; taskDraft?: TaskDraft | null; sectionChange?: SectionChangeProposal | null; modelEdits?: ModelEditProposal | null; analysisRequested?: boolean; }
type ReadonlyTree<T> = T extends string | number | boolean | null | undefined ? T
  : T extends object ? { readonly [K in keyof T]: ReadonlyTree<T[K]> } : T;
type AiModel = Pick<FrameProject, "units" | "nodes" | "members" | "materials" | "sections" | "supports"
  | "nodalLoads" | "uniformLoads" | "selfWeight" | "loadCases" | "loadCombinations"
  | "activeLoadCaseId" | "activeLoadCombinationId">;
export interface AiSnapshot { readonly context: AiContext; readonly snapshotKey: string; readonly model: ReadonlyTree<AiModel>; readonly editProject: FrameProject; readonly analysis?: AnalysisResult; readonly analysisCurrent: boolean; readonly comparison?: AiAnalysisPair; }

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach((child) => freeze(child));
    Object.freeze(value);
  }
  return value;
}

export function captureAiSnapshot(project: FrameProject, selection: readonly AiObjectRef[], analysis = getActiveAnalysisResult(project), comparisonIds?: AnalysisPairIds): AiSnapshot {
  if (analysis && (analysis.projectId !== project.id || analysis.input.projectId !== project.id)) throw new Error("分析结果不属于当前项目");
  const model: AiModel = {
    units: project.units, nodes: project.nodes, members: project.members, materials: project.materials,
    sections: project.sections, supports: project.supports, nodalLoads: project.nodalLoads,
    uniformLoads: project.uniformLoads, selfWeight: project.selfWeight, loadCases: project.loadCases,
    loadCombinations: project.loadCombinations, activeLoadCaseId: project.activeLoadCaseId,
    activeLoadCombinationId: project.activeLoadCombinationId,
  };
  const before = project.analysisResults.find((item) => item.id === comparisonIds?.beforeId);
  const after = project.analysisResults.find((item) => item.id === comparisonIds?.afterId);
  const resultSnapshot = (result: AnalysisResult) => structuredClone({ ...result, process: undefined });
  const analysisComplete = Boolean(analysis && analysis.status === "complete" && analysis.nodes.length === analysis.input.nodes.length && analysis.members.length === analysis.input.members.length);
  const analysisCurrent = analysisComplete && analysis ? isAnalysisResultCurrent(project, analysis) : false;
  const analysisContext: AiAnalysisContext = analysis ? {
    id: analysis.id, inputRevision: analysis.input.projectRevision, createdAt: analysis.createdAt, status: analysisComplete ? "complete" : "incomplete",
    current: analysisCurrent,
    source: analysis.input.combination ? { id: analysis.input.combination.definition.id, name: analysis.input.combination.definition.name, kind: "combination" } :
      { id: analysis.input.loadCase?.id ?? "LC1", name: analysis.input.loadCase?.name ?? "旧版工况", kind: "case" },
  } : { status: "absent", current: false };
  return freeze({
    context: {
      projectId: project.id, projectName: project.name, modelRevision: project.revision,
      ...(analysis ? { analysisId: analysis.id, analysis: analysisContext } : {}),
      comparison: comparisonIds,
      selection: selection.map(({ kind, id }) => {
        const object = (kind === "node" ? project.nodes : project.members).find((item) => item.id === id);
        return { kind, id, label: object?.label ?? id, exists: Boolean(object) };
      }),
    },
    // The task boundary must invalidate when its target context changes even if
    // the underlying project revision is unchanged (for example, a new selection
    // or comparison pair while the user is browsing the model).
    snapshotKey: JSON.stringify({
      projectId: project.id,
      revision: project.revision,
      model,
      analysisId: analysis?.id,
      analysisComplete,
      analysisCurrent,
      comparison: comparisonIds,
    }),
    model: structuredClone(model),
    editProject: structuredClone({ ...project, analysisResults: [], latestAnalysis: undefined }),
    analysis: analysis ? resultSnapshot(analysis) : undefined,
    comparison: before && after ? { before: resultSnapshot(before), after: resultSnapshot(after), beforeCurrent: isAnalysisResultCurrent(project, before), afterCurrent: isAnalysisResultCurrent(project, after) } : undefined,
    analysisCurrent,
  }) as AiSnapshot;
}

interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string }; }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("工具参数必须是 JSON 对象");
  return value as Record<string, unknown>;
}

function exactFields(input: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`工具参数含未定义字段 ${unknown}`);
}

const collections = ["summary", "nodes", "members", "materials", "sections", "supports", "loads", "load-cases"];
const queryFields: Record<string, readonly string[]> = {
  nodes: ["id", "label", "position.x", "position.y", "position.z"],
  members: ["id", "label", "startNodeId", "endNodeId", "materialId", "sectionId", "rotationDegrees"],
  materials: ["id", "label", "name", "elasticModulusGPa", "poissonRatio", "densityKgM3"],
  sections: ["id", "label", "name", "areaM2", "secondMomentYM4", "secondMomentZM4", "torsionalConstantM4"],
  supports: ["id", "label", "nodeId"],
  loads: ["id", "label", "kind", "nodeId", "memberId", "loadCaseId"],
  "load-cases": ["id", "name", "description"],
};
interface CollectionQuery { field: string; equals?: string | number | boolean; min?: number; max?: number; }
const mutationTools = new Set(["create_node", "create_nodes", "update_node", "update_nodes", "delete_node", "delete_nodes",
  "create_member", "create_members", "update_member", "update_members", "delete_member", "delete_members",
  "set_material", "set_section", "set_support", "set_load", "apply_model_changes"]);

function validateCall(value: unknown): ToolCall {
  const call = record(value);
  exactFields(call, ["id", "type", "function"]);
  if (typeof call.id !== "string" || !call.id.trim() || call.id.length > 200 || call.type !== "function") throw new Error("工具调用身份或类型无效");
  const fn = record(call.function);
  exactFields(fn, ["name", "arguments"]);
  if (typeof fn.name !== "string" || !fn.name.trim() || typeof fn.arguments !== "string" || fn.arguments.length > 32_000) throw new Error("工具名称或参数格式无效");
  return { id: call.id, type: "function", function: { name: fn.name, arguments: fn.arguments } };
}

function validateCollectionQuery(collection: string, fields: unknown, query: unknown): void {
  if (fields !== undefined && (!Array.isArray(fields) || fields.length < 1 || fields.length > 12 || fields.some((field) => typeof field !== "string" || !queryFields[collection]?.includes(field)))) {
    throw new Error("fields 必须是该集合支持的字段列表");
  }
  if (query === undefined) return;
  const value = record(query);
  exactFields(value, ["field", "equals", "min", "max"]);
  if (typeof value.field !== "string" || !queryFields[collection]?.includes(value.field)) throw new Error("query.field 不是该集合的可查询字段");
  if (Array.isArray(fields) && !fields.includes(value.field)) throw new Error("fields 必须包含 query.field，避免筛选字段从回执中消失");
  const hasEquals = value.equals !== undefined;
  const hasRange = value.min !== undefined || value.max !== undefined;
  if ((hasEquals && hasRange) || !hasEquals && !hasRange) throw new Error("query 必须提供 equals 或 min/max");
  if (hasEquals && !["string", "number", "boolean"].includes(typeof value.equals)) throw new Error("query.equals 类型无效");
  for (const key of ["min", "max"] as const) if (value[key] !== undefined && (typeof value[key] !== "number" || !Number.isFinite(value[key]))) throw new Error(`query.${key} 必须是有限数值`);
  if (typeof value.min === "number" && typeof value.max === "number" && value.min > value.max) throw new Error("query.min 不能大于 query.max");
}

function readPath(value: unknown, path: string): unknown {
  if (value && typeof value === "object" && Object.hasOwn(value, path)) return (value as Record<string, unknown>)[path];
  return path.split(".").reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, value);
}

function filterCollection(items: readonly unknown[], fields: unknown, query: unknown): readonly unknown[] {
  const projected = items.map((item) => {
    if (!Array.isArray(fields)) return item;
    return Object.fromEntries(fields.map((field) => [field, readPath(item, field)]));
  });
  if (!query) return projected;
  const condition = query as CollectionQuery;
  return projected.filter((item) => {
    const actual = readPath(item, condition.field);
    if (condition.equals !== undefined) return actual === condition.equals;
    return typeof actual === "number" && (condition.min === undefined || actual >= condition.min) && (condition.max === undefined || actual <= condition.max);
  });
}

function buildReceipt(snapshot: AiSnapshot, value: unknown, result: AiToolResult): AiReceipt {
  let call: { id?: string; name?: string } = {};
  let initiated = false;
  let input: Record<string, unknown> = {};
  try {
    const parsed = validateCall(value); call = { id: parsed.id, name: parsed.function.name }; input = record(JSON.parse(parsed.function.arguments)); initiated = true;
  } catch { /* The failed result still carries the real snapshot identity. */ }
  const objects = Array.isArray(input.objects) ? input.objects.filter((item): item is AiObjectRef => Boolean(item && typeof item === "object" && (item as AiObjectRef).kind && typeof (item as AiObjectRef).id === "string"))
    : input.id && (input.kind === "node" || input.kind === "member") ? [{ kind: input.kind, id: input.id } as AiObjectRef] : snapshot.context.selection;
  return { call: { ...call, initiated, completed: true, status: result.status }, object: { kind: "project", id: snapshot.context.projectId, name: snapshot.context.projectName }, objects,
    input: { projectId: snapshot.context.projectId, modelRevision: snapshot.context.modelRevision, analysisId: snapshot.analysis?.id, analysisInputRevision: snapshot.analysis?.input.projectRevision },
    state: { project: "current", model: "applied", analysis: snapshot.context.analysis?.status === "incomplete" ? "incomplete" : snapshot.analysis ? snapshot.analysisCurrent ? "current" : "expired" : "absent" } };
}

function validateInput(name: string, input: Record<string, unknown>): void {
  if (name === "read_selection") exactFields(input, []);
  else if (name === "read_model") {
    exactFields(input, ["collection", "offset", "limit", "fields", "query"]);
    if (typeof input.collection !== "string" || !collections.includes(input.collection)) throw new Error("请选择有效的模型数据集合");
    if (input.offset !== undefined && (typeof input.offset !== "number" || !Number.isSafeInteger(input.offset) || input.offset < 0)) throw new Error("offset 必须是非负整数");
    if (input.limit !== undefined && (typeof input.limit !== "number" || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100)) throw new Error("limit 必须是 1 至 100 的整数");
    validateCollectionQuery(input.collection, input.fields, input.query);
  } else if (name === "read_objects") {
    exactFields(input, ["objects"]);
    if (!Array.isArray(input.objects) || input.objects.length < 1 || input.objects.length > 100) throw new Error("objects 必须包含 1 至 100 个对象引用");
    for (const value of input.objects) {
      const ref = record(value);
      exactFields(ref, ["kind", "id"]);
      if ((ref.kind !== "node" && ref.kind !== "member") || typeof ref.id !== "string" || !ref.id.trim() || ref.id.length > 200) throw new Error("对象引用必须包含有效节点或杆件身份");
    }
  } else throw new Error(`未定义工具 ${name}；仅允许读取模型、选择或对象`);
}

function executeAiToolInternal(snapshot: AiSnapshot, value: unknown, previousProposal?: FrameProposal, previousConditions?: ConditionsProposal, previousSectionChange?: SectionChangeProposal, previousModelEdits?: ModelEditProposal, previousTaskDraft?: TaskDraft): AiToolResult {
  let call: ToolCall;
  let input: Record<string, unknown>;
  try {
    call = validateCall(value);
    input = record(JSON.parse(call.function.arguments));
    if (call.function.name === "discard_task_draft") {
      exactFields(input, []);
      return { status: "completed", message: "完整任务草案已拒绝，正式模型保留", context: snapshot.context, taskDraft: null };
    }
    if (call.function.name === "propose_task") {
      const taskDraft = proposeTask(snapshot, input, previousTaskDraft);
      const preview = buildTaskDraftPreview(snapshot, taskDraft);
      return { status: preview.status, message: preview.issues.length ? "完整任务草案需要集中补齐或澄清" : "完整任务草案已准备，尚未应用", context: snapshot.context,
        taskDraft, data: { goal: taskDraft.goal, taskId: taskDraft.id, version: taskDraft.version, baseRevision: taskDraft.baseRevision,
          issues: preview.issues, missing: preview.missing, changes: preview.changes, objectRefs: preview.objectRefs, analysis: preview.analysis,
          frame: preview.frame ? { counts: { nodes: preview.frame.nodes.length, members: preview.frame.members.length }, parameters: taskDraft.frame?.parameters } : undefined,
          conditions: preview.conditions ? { supports: preview.conditions.supports, nodalLoads: preview.conditions.nodalLoads, uniformLoads: preview.conditions.uniformLoads, selfWeight: preview.conditions.selfWeight, loadStageSummary: preview.conditions.loadStageSummary } : undefined } };
    }
    if (call.function.name === "discard_model_edits") {
      exactFields(input, []);
      return { status: "completed", message: "基础编辑草案已拒绝，正式模型保留", context: snapshot.context, modelEdits: null };
    }
    if (call.function.name === "propose_model_edits" || MODEL_EDIT_TOOLS.has(call.function.name) || call.function.name === "apply_model_changes") {
      try {
        const args = MODEL_EDIT_TOOLS.has(call.function.name) ? modelEditToolInput(call.function.name, input) : input;
        const modelEdits = proposeModelEdits(snapshot.editProject, args, previousModelEdits);
        return { status: "awaiting-confirmation", message: "基础编辑草案已准备，尚未修改正式模型", context: snapshot.context, modelEdits,
          data: { units: snapshot.model.units, ...modelEdits.preview } };
      } catch (error) {
        if (call.function.name !== "propose_model_edits") return { status: "awaiting-confirmation", message: "模型修改尚未确认，本阶段只读；请使用手动编辑或完整基础编辑草案", context: snapshot.context };
        throw error;
      }
    }
    if (call.function.name === "read_comparison" || call.function.name === "read_comparison_result") {
      if (!snapshot.comparison) return { status: "missing-input", message: "请先选择两次确定的成功分析作为前后对比", context: snapshot.context };
      if (call.function.name === "read_comparison") return { status: "completed", message: "已读取两次确定分析的对比及来源", context: snapshot.context, data: readComparison(snapshot.comparison, input) };
      const comparisonReference = readComparisonResult(snapshot.comparison, input, call.id);
      return { status: "completed", message: "已核对前后数值及差值，可定位同一对比表", context: snapshot.context, comparisonReference, data: comparisonReference };
    }
    if (call.function.name === "discard_section_change") {
      exactFields(input, []);
      return { status: "completed", message: "截面方案已拒绝，正式模型及结果保留", context: snapshot.context, sectionChange: null };
    }
    if (call.function.name === "propose_section_change") {
      let sectionChange: SectionChangeProposal;
      try { sectionChange = proposeSectionChange(snapshot, input, previousSectionChange); }
      catch (error) { return { status: "missing-input", message: error instanceof Error ? error.message : "请重新选择柱和截面", context: snapshot.context }; }
      return { status: "awaiting-confirmation", message: "选柱截面修改预览已准备，正式模型及结果尚未改变", context: snapshot.context, sectionChange,
        data: { memberIds: sectionChange.memberIds, before: snapshot.model.members.filter((member) => sectionChange.memberIds.includes(member.id)).map((member) => ({ member, section: snapshot.model.sections.find((section) => section.id === member.sectionId) })), after: sectionChange.section, source: sectionChange.source,
          scope: "仅重新指定选中柱的截面；共享截面及其他杆件不变。启用自重时，重算会使用新面积重新生成自重。" } };
    }
    if (call.function.name === "read_results" || call.function.name === "read_result") {
      if (!snapshot.analysis) return { status: "missing-input", message: "当前所选工况或组合无成功结果，请先运行本地计算", context: snapshot.context };
      if (snapshot.context.analysis?.status !== "complete") return { status: "missing-input", message: "分析尚未完成，不能解释未完成的数值；请等待本地计算结束", context: snapshot.context };
      if (input.analysisId !== undefined && input.analysisId !== snapshot.analysis.id) throw new Error("分析身份与当前所选结果不一致，请重新读取结果上下文");
      if (call.function.name === "read_results") return { status: "completed", message: snapshot.analysisCurrent ? "已读取所选分析的真实结果" : "已读取历史输入结果，当前模型需重新计算",
        context: snapshot.context, data: readResults(snapshot.analysis, snapshot.analysisCurrent, input) };
      const reference = readResult(snapshot.analysis, snapshot.analysisCurrent, input, call.id);
      return { status: "completed", message: "已核对实际结果项，可用引用标记定位", context: snapshot.context, reference,
        data: { ...reference, assumptions: snapshot.analysis.input.assumptions, solver: snapshot.analysis.input.solver } };
    }
    if (call.function.name === "request_analysis") {
      exactFields(input, []);
      return { status: "completed", message: "已准备本地分析请求，等待应用核对用户请求及未确认阶段；本工具尚未计算", context: snapshot.context, analysisRequested: true };
    }
    if (call.function.name === "discard_analysis_conditions") {
      exactFields(input, []);
      return { status: "completed", message: "分析条件方案已拒绝，已确认模型保留", context: snapshot.context, conditions: null };
    }
    if (call.function.name === "propose_analysis_conditions") {
      const conditions = proposeConditions(input, previousConditions);
      if (input.analysisSourceId === undefined && !previousConditions?.analysisSourceId) {
        const { references } = loadStageReferences(snapshot.model, conditions);
        const cases = new Set([...(conditions.nodalLoads ?? []).map((load) => load.loadCaseId),
          ...(conditions.uniformLoads ?? []).map((load) => load.loadCaseId), ...(conditions.selfWeight?.enabled ? [conditions.selfWeight.loadCaseId] : [])].map((id) => references.get(id) ?? id));
        // A single proposed load case is the natural continuation source, even if it is not currently active.
        conditions.analysisSourceId = cases.size === 1 ? [...cases][0] : snapshot.model.activeLoadCombinationId ?? snapshot.model.activeLoadCaseId;
      }
      const issues = conditionsIssues(snapshot.model, conditions);
      return { status: issues.length ? "missing-input" : "awaiting-confirmation", message: issues.length ? "分析条件草稿需要补齐或修正" : "分析条件预览已准备，尚未应用",
        context: snapshot.context, conditions, data: { units: snapshot.model.units, issues, analysisSourceId: conditions.analysisSourceId, supports: conditions.supports, nodalLoads: conditions.nodalLoads,
          uniformLoads: conditions.uniformLoads, selfWeight: conditions.selfWeight, loadCases: conditions.loadCases, loadCombinations: conditions.loadCombinations,
          combinationBasis: "用户自定义 · 无量纲系数 · 线弹性" } };
    }
    if (call.function.name === "discard_frame_proposal") {
      exactFields(input, []);
      return { status: "completed", message: "建模方案已拒绝，正式模型保持可用", context: snapshot.context, proposal: null };
    }
    if (call.function.name === "propose_frame") {
      const proposal = proposeFrame(input, previousProposal);
      const preview = buildFramePreview(snapshot, proposal);
      return { status: preview.status, message: preview.issues.length ? "方案草稿需要补齐或澄清参数" : "三维方案已生成，尚未应用", context: snapshot.context, proposal,
        data: { issues: preview.issues, counts: { nodes: preview.nodes.length, members: preview.members.length }, parameters: proposal.parameters } };
    }
    if (mutationTools.has(call.function.name)) {
      if (Object.keys(input).some((key) => ["script", "code", "command"].includes(key))) throw new Error("不允许执行脚本或命令");
      return { status: "awaiting-confirmation", message: "模型修改尚未确认，本阶段只读；请使用手动编辑", context: snapshot.context };
    }
    validateInput(call.function.name, input);
  } catch (error) {
    return { status: "failed", message: error instanceof Error ? error.message : "工具请求无效", context: snapshot.context };
  }
  if (call.function.name === "read_selection" || call.function.name === "read_objects") {
    const refs: readonly AiObjectRef[] = call.function.name === "read_selection" ? snapshot.context.selection : input.objects as AiObjectRef[];
    if (!refs.length) return { status: "missing-input", message: "请先选择需要读取的节点或杆件", context: snapshot.context };
    const missing = refs.filter((ref) => !(ref.kind === "node" ? snapshot.model.nodes : snapshot.model.members).some((item) => item.id === ref.id));
    if (missing.length) return { status: "missing-input", message: "引用对象已不存在，请重新选择对象", context: snapshot.context,
      data: { missing: missing.map(({ kind, id }) => ({ kind, id })) } };
    const objects = refs.map((ref) => {
      if (ref.kind === "node") {
        return { kind: ref.kind, ...snapshot.model.nodes.find((item) => item.id === ref.id)! };
      }
      const member = snapshot.model.members.find((item) => item.id === ref.id)!;
      const startNode = snapshot.model.nodes.find((item) => item.id === member.startNodeId)!;
      const endNode = snapshot.model.nodes.find((item) => item.id === member.endNodeId)!;
      return { kind: ref.kind, ...member, startNode, endNode,
        material: snapshot.model.materials.find((item) => item.id === member.materialId),
        section: snapshot.model.sections.find((item) => item.id === member.sectionId),
        geometry: calculateMemberGeometry(startNode.position, endNode.position, member.rotationDegrees) };
    });
    return { status: "completed", message: "已读取对象及其已应用参数", context: snapshot.context, data: { units: snapshot.model.units, objects } };
  }
  const model = snapshot.model;
  const modelCollections: Record<string, readonly unknown[]> = {
    nodes: model.nodes, members: model.members, materials: model.materials, sections: model.sections,
    supports: model.supports, loads: [...model.nodalLoads.map((load) => ({ kind: "nodal", ...load })), ...model.uniformLoads],
    "load-cases": model.loadCases,
  };
  if (input.collection === "summary") {
    return { status: "completed", message: "已读取已应用模型摘要", context: snapshot.context,
      data: { project: { id: snapshot.context.projectId, name: snapshot.context.projectName, revision: snapshot.context.modelRevision }, goal: snapshot.context.goal,
        analysis: snapshot.context.analysis ?? { status: "absent", current: false }, counts: { nodes: model.nodes.length, members: model.members.length, materials: model.materials.length,
        sections: model.sections.length, supports: model.supports.length, loads: model.nodalLoads.length + model.uniformLoads.length,
        loadCases: model.loadCases.length, loadCombinations: model.loadCombinations.length },
        units: model.units, activeLoadCaseId: model.activeLoadCaseId, activeLoadCombinationId: model.activeLoadCombinationId,
        selfWeight: model.selfWeight } };
  }
  const items = modelCollections[input.collection as string];
  const offset = input.offset as number | undefined ?? 0;
  const limit = input.limit as number | undefined ?? 50;
  const filtered = filterCollection(items, input.fields, input.query);
  const pageItems = filtered.slice(offset, offset + limit);
  const extra = input.collection === "loads" ? { selfWeight: model.selfWeight }
    : input.collection === "load-cases" ? { combinations: model.loadCombinations,
      activeLoadCaseId: model.activeLoadCaseId, activeLoadCombinationId: model.activeLoadCombinationId } : {};
  return { status: "completed", message: "已读取已应用模型", context: snapshot.context,
    data: { units: model.units, collection: input.collection, total: filtered.length, items: pageItems, offset, limit,
      page: { empty: pageItems.length === 0, hasMore: offset + pageItems.length < filtered.length, nextOffset: offset + pageItems.length }, query: input.query, fields: input.fields, ...extra } };
}

export function executeAiTool(snapshot: AiSnapshot, value: unknown, previousProposal?: FrameProposal, previousConditions?: ConditionsProposal, previousSectionChange?: SectionChangeProposal, previousModelEdits?: ModelEditProposal, previousTaskDraft?: TaskDraft): AiToolResult {
  const result = executeAiToolInternal(snapshot, value, previousProposal, previousConditions, previousSectionChange, previousModelEdits, previousTaskDraft);
  return { ...result, receipt: buildReceipt(snapshot, value, result) };
}
