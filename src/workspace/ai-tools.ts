import type { FrameProject } from "../domain/project";
import { calculateMemberGeometry } from "../domain/member-geometry";
import { buildFramePreview, proposeFrame, type FrameProposal } from "./frame-proposal";
import { conditionsIssues, proposeConditions, type ConditionsProposal } from "./analysis-conditions";
import { loadStageReferences } from "./load-stage";

export interface AiObjectRef { kind: "node" | "member"; id: string; }
export interface AiSelectedObject extends AiObjectRef { label: string; exists: boolean; }
export interface AiContext {
  projectId: string;
  projectName: string;
  modelRevision: number;
  selection: readonly AiSelectedObject[];
}
export type AiStatus = "completed" | "applied" | "missing-input" | "awaiting-confirmation" | "failed" | "cancelled";
export interface AiToolResult { status: AiStatus; message: string; context: AiContext; data?: unknown; proposal?: FrameProposal | null; conditions?: ConditionsProposal | null; analysisRequested?: boolean; }
type ReadonlyTree<T> = T extends string | number | boolean | null | undefined ? T
  : T extends object ? { readonly [K in keyof T]: ReadonlyTree<T[K]> } : T;
type AiModel = Pick<FrameProject, "units" | "nodes" | "members" | "materials" | "sections" | "supports"
  | "nodalLoads" | "uniformLoads" | "selfWeight" | "loadCases" | "loadCombinations"
  | "activeLoadCaseId" | "activeLoadCombinationId">;
export interface AiSnapshot { readonly context: AiContext; readonly model: ReadonlyTree<AiModel>; }

function freeze<T>(value: T): ReadonlyTree<T> {
  if (value && typeof value === "object") {
    Object.values(value).forEach((child) => freeze(child));
    Object.freeze(value);
  }
  return value as ReadonlyTree<T>;
}

export function captureAiSnapshot(project: FrameProject, selection: readonly AiObjectRef[]): AiSnapshot {
  const model: AiModel = {
    units: project.units, nodes: project.nodes, members: project.members, materials: project.materials,
    sections: project.sections, supports: project.supports, nodalLoads: project.nodalLoads,
    uniformLoads: project.uniformLoads, selfWeight: project.selfWeight, loadCases: project.loadCases,
    loadCombinations: project.loadCombinations, activeLoadCaseId: project.activeLoadCaseId,
    activeLoadCombinationId: project.activeLoadCombinationId,
  };
  return freeze({
    context: {
      projectId: project.id, projectName: project.name, modelRevision: project.revision,
      selection: selection.map(({ kind, id }) => {
        const object = (kind === "node" ? project.nodes : project.members).find((item) => item.id === id);
        return { kind, id, label: object?.label ?? id, exists: Boolean(object) };
      }),
    },
    model: structuredClone(model),
  });
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

function validateInput(name: string, input: Record<string, unknown>): void {
  if (name === "read_selection") exactFields(input, []);
  else if (name === "read_model") {
    exactFields(input, ["collection", "offset", "limit"]);
    if (typeof input.collection !== "string" || !collections.includes(input.collection)) throw new Error("请选择有效的模型数据集合");
    if (input.offset !== undefined && (typeof input.offset !== "number" || !Number.isSafeInteger(input.offset) || input.offset < 0)) throw new Error("offset 必须是非负整数");
    if (input.limit !== undefined && (typeof input.limit !== "number" || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100)) throw new Error("limit 必须是 1 至 100 的整数");
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

export function executeAiTool(snapshot: AiSnapshot, value: unknown, previousProposal?: FrameProposal, previousConditions?: ConditionsProposal): AiToolResult {
  let call: ToolCall;
  let input: Record<string, unknown>;
  try {
    call = validateCall(value);
    input = record(JSON.parse(call.function.arguments));
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
      data: { counts: { nodes: model.nodes.length, members: model.members.length, materials: model.materials.length,
        sections: model.sections.length, supports: model.supports.length, loads: model.nodalLoads.length + model.uniformLoads.length,
        loadCases: model.loadCases.length, loadCombinations: model.loadCombinations.length },
        units: model.units, activeLoadCaseId: model.activeLoadCaseId, activeLoadCombinationId: model.activeLoadCombinationId,
        selfWeight: model.selfWeight } };
  }
  const items = modelCollections[input.collection as string];
  const offset = input.offset as number | undefined ?? 0;
  const limit = input.limit as number | undefined ?? 50;
  const extra = input.collection === "loads" ? { selfWeight: model.selfWeight }
    : input.collection === "load-cases" ? { combinations: model.loadCombinations,
      activeLoadCaseId: model.activeLoadCaseId, activeLoadCombinationId: model.activeLoadCombinationId } : {};
  return { status: "completed", message: "已读取已应用模型", context: snapshot.context,
    data: { units: model.units, collection: input.collection, total: items.length, items: items.slice(offset, offset + limit), offset, limit, ...extra } };
}
