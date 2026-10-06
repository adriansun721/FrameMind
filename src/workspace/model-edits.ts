import { validateMemberEndReleases } from "../domain/member-releases";
import { validatePsdInput } from "../domain/psd";
import { validateAdditionalMass } from "../domain/additional-mass";
import { validateModalDampingInput } from "../domain/modal-damping";
import { validateSection, type SectionInput } from "../domain/project";
import { getSectionCatalogEntry } from "../domain/resource-library";
import type { FrameProject, MaterialId, MemberId, NodeId, SectionId, Vector3 } from "../domain/project";
import { applyProjectEdits, type ProjectEditOperation, type ProjectEditReceipt } from "../domain/project-operations";
import { prepareDrawnMemberEdits, type DrawingPoint } from "../domain/work-plane";
import { captureAiSnapshot, type AiToolResult } from "./ai-tools";
import { savedOperation, recordOperation, sameProjectInput } from "./task-persistence";

export interface ModelEditProposal {
  id: string;
  version: number;
  projectId: string;
  baseRevision: number;
  operations: ProjectEditOperation[];
  preview: ProjectEditReceipt;
}

interface ModelEditReadback {
  projectId: string;
  modelRevision: number;
  objects: { kind: ProjectEditReceipt["changes"][number]["kind"]; id: string; exists: boolean; object?: unknown }[];
}

function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("编辑参数必须是 JSON 对象");
  const input = value as Record<string, unknown>;
  const extra = Object.keys(input).find((key) => !fields.includes(key));
  if (extra) throw new Error(`编辑参数含未定义字段 ${extra}`);
  return input;
}
function identity(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new Error("编辑必须引用稳定对象身份");
  return value;
}
function vector(value: unknown, partial: boolean): Partial<Vector3> {
  const input = object(value, ["x", "y", "z"]);
  if (!Object.keys(input).length || (!partial && Object.keys(input).length !== 3)
    || Object.values(input).some((component) => typeof component !== "number" || !Number.isFinite(component))) throw new Error("坐标必须是有限数值，创建节点需提供 XYZ");
  return { ...input };
}
function memberProperties(value: unknown, partial: boolean) {
  const fields = ["startNodeId", "endNodeId", "materialId", "sectionId", "rotationDegrees", "endReleases", "additionalLineMassKgM"];
  const input = object(value, fields);
  if (!Object.keys(input).length || (!partial && fields.slice(0, 5).some((key) => input[key] === undefined))) throw new Error("杆件参数不完整");
  for (const key of fields.slice(0, 4)) if (input[key] !== undefined) identity(input[key]);
  if (input.rotationDegrees !== undefined && (typeof input.rotationDegrees !== "number" || !Number.isFinite(input.rotationDegrees))) throw new Error("截面转角必须是有限数值（度）");
  if (input.endReleases !== undefined) validateMemberEndReleases(input.endReleases);
  if (input.additionalLineMassKgM !== undefined) validateAdditionalMass(input.additionalLineMassKgM);
  return input as Partial<{ startNodeId: NodeId; endNodeId: NodeId; materialId: MaterialId; sectionId: SectionId; rotationDegrees: number; endReleases: import("../domain/member-releases").MemberEndReleases }>;
}

export function parseProjectEditOperations(value: unknown): ProjectEditOperation[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new Error("operations 必须包含 1 至 100 项基础编辑");
  return value.map((value) => {
    const input = object(value, ["type", "id", "analysisId", "position", "properties", "changes", "memberIds", "rotationDegrees", "nodeId", "nodeIds", "targetNodeId", "tolerance", "resolution", "massKg"]);
    switch (input.type) {
      case "create_psd_spectrum": case "update_psd_spectrum": {
        object(input, input.type === "create_psd_spectrum" ? ["type", "properties"] : ["type", "id", "properties"]);
        return { type: input.type, ...(input.type === "update_psd_spectrum" ? { id: identity(input.id) } : {}), properties: validatePsdInput(input.properties) } as ProjectEditOperation;
      }
      case "delete_psd_spectrum": object(input, ["type", "id"]); return { type: input.type, id: identity(input.id) };
      case "set_modal_damping": {
        object(input, ["type", "id", "analysisId", "properties"]);
        return { type: input.type, id: identity(input.id), analysisId: identity(input.analysisId), properties: validateModalDampingInput(input.properties) };
      }
      case "create_section": case "update_section": {
        object(input, input.type === "create_section" ? ["type", "properties"] : ["type", "id", "properties"]);
        let properties = object(input.properties, ["name", "catalogId", "geometry", "catalogBasis", "parameterBasis", "areaM2", "secondMomentYM4", "secondMomentZM4", "torsionalConstantM4"]);
        if (properties.catalogId !== undefined) {
          object(properties, ["name", "catalogId"]);
          const entry = getSectionCatalogEntry(identity(properties.catalogId));
          if (!entry) throw new Error("标准截面目录条目不存在");
          properties = { ...entry, name: properties.name };
        }
        if (typeof properties.name !== "string") throw new Error("Section name required");
        const validated = validateSection("draft", properties as unknown as SectionInput);
        return { type: input.type, ...(input.type === "update_section" ? { id: identity(input.id) as SectionId } : {}), properties: validated } as ProjectEditOperation;
      }
      case "duplicate_section": object(input, ["type", "id"]); return { type: input.type, id: identity(input.id) as SectionId };
      case "assign_section": {
        object(input, ["type", "id", "memberIds", "rotationDegrees"]);
        if (!Array.isArray(input.memberIds) || !input.memberIds.length || input.memberIds.length > 100 || (input.rotationDegrees !== undefined && (typeof input.rotationDegrees !== "number" || !Number.isFinite(input.rotationDegrees)))) throw new Error("Invalid section assignment targets or angle");
        return { type: input.type, id: identity(input.id) as SectionId, memberIds: input.memberIds.map((id) => identity(id) as MemberId),
          ...(input.rotationDegrees !== undefined ? { rotationDegrees: input.rotationDegrees as number } : {}) };
      }
      case "merge_nodes": {
        object(input, ["type", "nodeIds", "targetNodeId", "tolerance", "resolution"]);
        const ids = (value: unknown) => { if (!Array.isArray(value)) throw new Error("冲突处理必须明确提供身份数组"); return value.map(identity); };
        const resolution = object(input.resolution, ["keepSupportIds", "keepNodalLoadIds", "keepMemberIds", "removeUniformLoadIds", "acceptGeometryChange"]);
        if (typeof input.tolerance !== "number" || typeof resolution.acceptGeometryChange !== "boolean") throw new Error("必须明确容差和几何变化确认");
        return { type: "merge_nodes", nodeIds: ids(input.nodeIds) as NodeId[], targetNodeId: identity(input.targetNodeId) as NodeId, tolerance: input.tolerance,
          resolution: { keepSupportIds: ids(resolution.keepSupportIds), keepNodalLoadIds: ids(resolution.keepNodalLoadIds), keepMemberIds: ids(resolution.keepMemberIds) as MemberId[], removeUniformLoadIds: ids(resolution.removeUniformLoadIds), acceptGeometryChange: resolution.acceptGeometryChange } };
      }
      case "split_member": case "connect_members": {
        object(input, ["type", "memberIds", "position", "nodeId"]);
        if (!Array.isArray(input.memberIds)) throw new Error("memberIds 必须是正式杆件身份数组");
        return { type: input.type, memberIds: input.memberIds.map((id) => identity(id) as MemberId), position: vector(input.position, false) as Vector3,
          ...(input.nodeId !== undefined ? { nodeId: identity(input.nodeId) as NodeId } : {}) };
      }
      case "create_node": object(input, ["type", "position"]); return { type: input.type, position: vector(input.position, false) as Vector3 };
      case "set_node_mass": object(input, ["type", "id", "massKg"]); return { type: input.type, id: identity(input.id) as NodeId, massKg: validateAdditionalMass(input.massKg) };
      case "update_node": object(input, ["type", "id", "position"]); return { type: input.type, id: identity(input.id) as NodeId, position: vector(input.position, true) };
      case "create_member": object(input, ["type", "properties"]); return { type: input.type, properties: memberProperties(input.properties, false) as Extract<ProjectEditOperation, { type: "create_member" }>["properties"] };
      case "update_member": object(input, ["type", "id", "changes"]); return { type: input.type, id: identity(input.id) as MemberId, changes: memberProperties(input.changes, true) };
      case "duplicate_node": case "delete_node": object(input, ["type", "id"]); return { type: input.type, id: identity(input.id) as NodeId };
      case "duplicate_member": case "delete_member": object(input, ["type", "id"]); return { type: input.type, id: identity(input.id) as MemberId };
      case "create_analysis_case": case "update_analysis_case": {
        object(input, input.type === "create_analysis_case" ? ["type", "properties"] : ["type", "id", "properties"]);
        const properties = object(input.properties, ["name", "method", "loadSourceId", "settings"]);
        object(properties.settings, ["solver", "mesh", "modal", "buckling", "secondOrder"]);
        return { type: input.type, ...(input.type === "update_analysis_case" ? { id: identity(input.id) } : {}), properties } as Extract<ProjectEditOperation, { type: "create_analysis_case" | "update_analysis_case" }>;
      }
      case "delete_analysis_case": object(input, ["type", "id"]); return { type: input.type, id: identity(input.id) };
      default: throw new Error(`未定义基础编辑 ${String(input.type)}`);
    }
  });
}

export function proposeModelEdits(project: FrameProject, input: unknown, previous?: ModelEditProposal): ModelEditProposal {
  const args = object(input, ["operations"]);
  const operations = parseProjectEditOperations(args.operations);
  const { receipt } = applyProjectEdits(project, operations);
  return { id: previous?.id ?? `edits_${crypto.randomUUID()}`, version: (previous?.version ?? 0) + 1,
    projectId: project.id, baseRevision: project.revision, operations, preview: receipt };
}

export const MODEL_EDIT_TOOLS = new Set(["set_node_mass", "merge_nodes", "split_member", "connect_members", "draw_member", "create_node", "create_nodes", "update_node", "update_nodes", "duplicate_node", "duplicate_nodes", "delete_node", "delete_nodes",
  "create_member", "create_members", "update_member", "update_members", "duplicate_member", "duplicate_members", "delete_member", "delete_members"]);

/** Legacy singular/plural calls become the same reviewed draft as the canonical batch tool. */
export function modelEditToolInput(name: string, input: Record<string, unknown>, project?: FrameProject): unknown {
  if (name === "set_node_mass") {
    object(input, ["id", "massKg"]);
    return { operations: [{ type: name, ...input }] };
  }
  if (name === "merge_nodes") {
    object(input, ["nodeIds", "targetNodeId", "tolerance", "resolution"]);
    return { operations: [{ type: name, ...input }] };
  }
  if (name === "split_member" || name === "connect_members") {
    object(input, ["memberIds", "position", "nodeId"]);
    return { operations: [{ type: name, ...input }] };
  }
  if (name === "draw_member") {
    if (!project) throw new Error("绘杆草案需要当前工程");
    object(input, ["start", "end", "materialId", "sectionId", "rotationDegrees"]);
    const point = (value: unknown): DrawingPoint => {
      const input = object(value, ["position", "nodeId"]);
      return { position: vector(input.position, false) as Vector3, ...(input.nodeId !== undefined ? { nodeId: identity(input.nodeId) as NodeId } : {}) };
    };
    const rotationDegrees = input.rotationDegrees ?? 0;
    if (typeof rotationDegrees !== "number" || !Number.isFinite(rotationDegrees)) throw new Error("截面转角必须是有限数值（度）");
    return { operations: prepareDrawnMemberEdits(project, { start: point(input.start), end: point(input.end),
      materialId: identity(input.materialId) as MaterialId, sectionId: identity(input.sectionId) as SectionId, rotationDegrees }) };
  }
  if (name.endsWith("s")) {
    const singular = name.slice(0, -1);
    const field = name.startsWith("create_") ? name.endsWith("nodes") ? "nodes" : "members" : name.startsWith("update_") ? "updates" : "ids";
    object(input, [field]);
    if (!Array.isArray(input[field])) throw new Error(`${field} 必须是数组`);
    return { operations: input[field].map((entry) => (field === "ids" ? { type: singular, id: entry }
      : (modelEditToolInput(singular, object(entry, singular === "create_node" ? ["position", "x", "y", "z"] : singular === "update_node" ? ["id", "position", "x", "y", "z"] : singular === "create_member" ? ["properties", "startNodeId", "endNodeId", "materialId", "sectionId", "rotationDegrees", "endReleases", "additionalLineMassKgM"] : ["id", "changes"])) as { operations: unknown[] }).operations[0])) };
  }
  const node = name.endsWith("node");
  if (name.startsWith("create_") || name.startsWith("update_")) {
    const property = node ? "position" : name.startsWith("create_") ? "properties" : "changes";
    const flatFields = node ? ["x", "y", "z"] : name.startsWith("create_") ? ["startNodeId", "endNodeId", "materialId", "sectionId", "rotationDegrees", "endReleases", "additionalLineMassKgM"] : [];
    object(input, [...(name.startsWith("update_") ? ["id"] : []), property, ...flatFields]);
    if (input[property] !== undefined && flatFields.some((key) => input[key] !== undefined)) throw new Error("不能混用嵌套和直接参数");
    const properties = input[property] ?? Object.fromEntries(flatFields.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
    return { operations: [{ type: name, ...(name.startsWith("update_") ? { id: input.id } : {}), [property]: properties }] };
  }
  object(input, ["id"]);
  return { operations: [{ type: name, id: input.id }] };
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function prepareModelEditConfirmation(project: FrameProject, proposal: ModelEditProposal) {
  return Object.freeze({ requestId: `confirm_${crypto.randomUUID()}`, baseProject: project, proposal: freeze(structuredClone(proposal)) });
}
export type PreparedModelEditConfirmation = ReturnType<typeof prepareModelEditConfirmation>;

function reviewedEngineeringReceipt(receipt: ProjectEditReceipt) {
  // Task references are live metadata, not conflict choices or engineering input.
  // Confirming/saving the draft itself can add a task reference without changing its intent.
  return { ...receipt, ...(receipt.nodeMerges ? { nodeMerges: receipt.nodeMerges.map(({ taskReferences: _references, ...impact }) => impact) } : {}) };
}

export class ModelEditConfirmation {
  private applied = new Map<string, AiToolResult>();

  confirm(project: FrameProject, confirmation: PreparedModelEditConfirmation): { project: FrameProject; result: AiToolResult } {
    const context = captureAiSnapshot(project, []).context;
    const failed = (message: string) => ({ project, result: { status: "failed" as const, message, context } });
    const draft = confirmation.proposal;
    if (project.id !== draft.projectId) return failed("项目已切换，请重新准备编辑草案");
    const key = `${draft.projectId}:${draft.id}:${draft.version}`;
    const previous = savedOperation(project, key) ?? this.applied.get(key);
    if (previous) return { project, result: { ...previous, message: "该编辑已确认过，本次未重复应用" } };
    if (!sameProjectInput(project, confirmation.baseProject) || project.revision !== draft.baseRevision) return failed("正式模型已变化，请重新生成编辑草案并确认");
    try {
      const outcome = applyProjectEdits(project, parseProjectEditOperations(draft.operations));
      if (JSON.stringify(reviewedEngineeringReceipt(outcome.receipt)) !== JSON.stringify(reviewedEngineeringReceipt(draft.preview))) return failed("草案内容与预览不一致，请重新核对");
      const snapshot = captureAiSnapshot(outcome.project, []);
      const collections = {
        section: outcome.project.sections,
        node: outcome.project.nodes,
        member: outcome.project.members,
        support: outcome.project.supports,
        "nodal-load": outcome.project.nodalLoads,
        "uniform-load": outcome.project.uniformLoads,
        "analysis-case": outcome.project.analysisCases,
        "psd-spectrum": outcome.project.psdSpectra,
      } as const;
      const readback: ModelEditReadback = {
        projectId: snapshot.context.projectId,
        modelRevision: snapshot.context.modelRevision,
        objects: outcome.receipt.changes.map(({ kind, id }) => {
          const object = collections[kind].find((item) => item.id === id);
          return { kind, id, exists: Boolean(object), ...(object ? { object } : {}) };
        }),
      };
      const result: AiToolResult = { status: "applied", message: "基础编辑已应用，可整组撤销和重做", context: snapshot.context,
        data: { requestId: confirmation.requestId, proposalId: draft.id, proposalVersion: draft.version, ...outcome.receipt, readback } };
      this.applied.set(key, result);
      return { project: recordOperation(outcome.project, key, result), result };
    } catch (error) { return failed(error instanceof Error ? error.message : "基础编辑失败，正式模型保留"); }
  }
}
