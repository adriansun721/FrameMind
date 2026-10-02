import type { FrameMaterial, FrameMember, FrameNode, FrameSection, FrameSupport, FrameNodalLoad, FrameUniformLoad, FrameSelfWeight, MaterialId, MemberId, NodeId, SectionId } from "../domain/project";
import { MATERIAL_CATALOG, SECTION_CATALOG } from "../domain/resource-library";
import type { AiSnapshot, AiStatus } from "./ai-tools";

export const FRAME_FIELDS = {
  storeys: "层数",
  xSpans: "X 向跨长 (m)", ySpans: "Y 向跨长 (m)", storeyHeights: "各层层高 (m)",
  origin: "原点 XYZ (m)", material: "钢材", columnSection: "柱截面", beamSection: "梁截面", rotationDegrees: "截面转角 (°)",
} as const;
export type FrameField = keyof typeof FRAME_FIELDS;
export type ParameterValue = number | number[] | string;
export interface FrameParameter { value: ParameterValue; source: "user" | "suggestion"; conflict?: ParameterValue; }
export interface FrameProposal {
  id: string;
  version: number;
  parameters: Partial<Record<FrameField, FrameParameter>>;
  changes: { field: FrameField; before?: ParameterValue; after: ParameterValue }[];
}
export interface FramePreview {
  status: AiStatus;
  issues: string[];
  nodes: FrameNode[];
  members: (FrameMember & { role: "column" | "beam" })[];
  materials: FrameMaterial[];
  sections: FrameSection[];
  conditionNodes?: FrameNode[];
  supports?: FrameSupport[];
  nodalLoads?: FrameNodalLoad[];
  uniformLoads?: FrameUniformLoad[];
  selfWeight?: FrameSelfWeight & { caseLabel: string };
  loadStageSummary?: string;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("方案参数必须是对象");
  return value as Record<string, unknown>;
}
function keys(input: Record<string, unknown>, allowed: readonly string[]) {
  for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new Error(`方案含未定义字段 ${key}`);
}
function validateValue(field: FrameField, value: unknown): asserts value is ParameterValue {
  if (["material", "columnSection", "beamSection"].includes(field)) {
    if (typeof value !== "string" || !value.trim() || value.length > 200) throw new Error(`${FRAME_FIELDS[field]}必须指定资源标识`);
  } else if (field === "storeys") {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 100) throw new Error("层数必须是 1 至 100 的整数");
  } else if (field === "rotationDegrees") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("截面转角必须为有限数值");
  } else {
    if (!Array.isArray(value) || !value.length || value.length > 100 || !value.every((item) => typeof item === "number" && Number.isFinite(item))) throw new Error(`${FRAME_FIELDS[field]}必须是有限数值数组（1 至 100 项）`);
    if (field === "origin" ? value.length !== 3 : value.some((item) => item <= 0)) throw new Error(field === "origin" ? "原点必须包含 XYZ 三个坐标" : `${FRAME_FIELDS[field]}必须全部大于零`);
  }
}

/** Merge a predefined tool request without touching the applied model. Conflicts remain visible until clarified. */
export function proposeFrame(input: unknown, previous?: FrameProposal): FrameProposal {
  const request = object(input); keys(request, ["parameters"]);
  const updates = object(request.parameters); keys(updates, Object.keys(FRAME_FIELDS));
  if (!Object.keys(updates).length) throw new Error("至少提供一个已知或建议参数");
  const parameters = structuredClone(previous?.parameters ?? {});
  const changes: FrameProposal["changes"] = [];
  for (const [name, raw] of Object.entries(updates)) {
    const field = name as FrameField;
    const update = object(raw); keys(update, ["value", "source", "replace"]);
    if (update.source !== "user" && update.source !== "suggestion") throw new Error(`${FRAME_FIELDS[field]}缺少用户提供/建议来源`);
    if (update.replace !== undefined && typeof update.replace !== "boolean") throw new Error("replace 必须是布尔值");
    validateValue(field, update.value);
    const current = parameters[field];
    const differs = current && JSON.stringify(current.value) !== JSON.stringify(update.value);
    if (current?.source === "user" && update.source === "suggestion" && !differs) continue;
    if (current?.conflict !== undefined && !update.replace && !differs) continue;
    if (differs && current.source === "user" && (!update.replace || update.source !== "user")) {
      parameters[field] = { ...current, conflict: structuredClone(update.value) };
    } else {
      parameters[field] = { value: structuredClone(update.value), source: update.source };
      if (differs || !current) changes.push({ field, before: current?.value, after: structuredClone(update.value) });
    }
  }
  return { id: previous?.id ?? `proposal_${crypto.randomUUID()}`, version: (previous?.version ?? 0) + 1, parameters, changes };
}

export function editFrameParameter(proposal: FrameProposal, field: FrameField, text: string): FrameProposal {
  if (!text.trim()) {
    const parameters = { ...proposal.parameters }; delete parameters[field];
    return { ...proposal, version: proposal.version + 1, parameters, changes: [] };
  }
  const value = ["material", "columnSection", "beamSection"].includes(field) ? text
    : ["rotationDegrees", "storeys"].includes(field) ? Number(text) : text.trim().split(/[,，\s]+/).map(Number);
  return proposeFrame({ parameters: { [field]: { value, source: "user", replace: true } } }, proposal);
}

export function frameResourceOptions(snapshot: AiSnapshot, field: FrameField): { value: string; label: string }[] {
  if (field === "material") return [
    ...snapshot.model.materials.map((item) => ({ value: item.id, label: `${item.label} · ${item.name}（项目）` })),
    ...MATERIAL_CATALOG.map((item) => ({ value: item.catalogId, label: item.displayName })),
  ];
  return [
    ...snapshot.model.sections.map((item) => ({ value: item.id, label: `${item.label} · ${item.name}（项目）` })),
    ...SECTION_CATALOG.map((item) => ({ value: item.catalogId, label: item.displayName })),
  ];
}

export function buildFramePreview(snapshot: AiSnapshot, proposal: FrameProposal): FramePreview {
  const preview: FramePreview = { status: "missing-input", issues: [], nodes: [], members: [], materials: [], sections: [] };
  const p = proposal.parameters;
  for (const field of Object.keys(FRAME_FIELDS) as FrameField[]) {
    if (!p[field]) preview.issues.push(`尚缺 ${FRAME_FIELDS[field]}`);
    else if (p[field]!.conflict !== undefined) preview.issues.push(`${FRAME_FIELDS[field]}待澄清：${JSON.stringify(p[field]!.value)} / ${JSON.stringify(p[field]!.conflict)}`);
  }
  if (preview.issues.length) return preview;
  if ((p.storeyHeights!.value as number[]).length !== p.storeys!.value) {
    preview.issues.push(`层数为 ${p.storeys!.value}，但提供了 ${(p.storeyHeights!.value as number[]).length} 个层高，请澄清`); return preview;
  }
  const materialRef = p.material!.value as string;
  const columnRef = p.columnSection!.value as string;
  const beamRef = p.beamSection!.value as string;
  const material = snapshot.model.materials.find((item) => item.id === materialRef) ?? MATERIAL_CATALOG.find((item) => item.catalogId === materialRef);
  const column = snapshot.model.sections.find((item) => item.id === columnRef) ?? SECTION_CATALOG.find((item) => item.catalogId === columnRef);
  const beam = snapshot.model.sections.find((item) => item.id === beamRef) ?? SECTION_CATALOG.find((item) => item.catalogId === beamRef);
  for (const [resource, label] of [[material, "钢材"], [column, "柱截面"], [beam, "梁截面"]]) if (!resource) preview.issues.push(`${label}资源不存在，请重新选择`);
  if (!material || !column || !beam) return preview;
  const accumulate = (values: number[], start: number) => values.reduce<number[]>((coordinates, value) => [...coordinates, coordinates[coordinates.length - 1] + value], [start]);
  const origin = p.origin!.value as number[];
  const xs = accumulate(p.xSpans!.value as number[], origin[0]);
  const ys = accumulate(p.ySpans!.value as number[], origin[1]);
  const zs = accumulate(p.storeyHeights!.value as number[], origin[2]);
  const nodeCount = xs.length * ys.length * zs.length;
  // Bound a single AI preview allocation, not the formal project's supported size.
  if (nodeCount > 20_000 || ![...xs, ...ys, ...zs].every(Number.isFinite)) {
    preview.issues.push("方案过大或坐标溢出，请缩小单次预览范围（最多 20,000 节点）"); return preview;
  }
  const prefix = proposal.id;
  const materialId = `${prefix}:material` as MaterialId;
  const columnId = `${prefix}:column-section` as SectionId;
  const beamId = `${prefix}:beam-section` as SectionId;
  const provenance = (ref: string, source?: import("../domain/project").CatalogSource) => source ? { kind: "catalog" as const, catalogId: ref, source } : { kind: "custom" as const };
  preview.materials = [{ ...material, id: materialId, label: "预览钢材", provenance: "provenance" in material ? structuredClone(material.provenance) : provenance(materialRef, material.source) }];
  preview.sections = [
    { ...column, id: columnId, label: "预览柱截面", provenance: "provenance" in column ? structuredClone(column.provenance) : provenance(columnRef, column.source) },
    { ...beam, id: beamId, label: "预览梁截面", provenance: "provenance" in beam ? structuredClone(beam.provenance) : provenance(beamRef, beam.source) },
  ];
  const nodeId = (i: number, j: number, k: number) => `${prefix}:node:${k}:${j}:${i}` as NodeId;
  const addMember = (a: NodeId, b: NodeId, role: "column" | "beam") => {
    const number = preview.members.length + 1;
    preview.members.push({ id: `${prefix}:member:${number}` as MemberId, label: `预览 M${number}`, startNodeId: a, endNodeId: b, materialId,
      sectionId: role === "column" ? columnId : beamId, rotationDegrees: p.rotationDegrees!.value as number, role });
  };
  for (let k = 0; k < zs.length; k++) for (let j = 0; j < ys.length; j++) for (let i = 0; i < xs.length; i++) {
    preview.nodes.push({ id: nodeId(i, j, k), label: `预览 N${preview.nodes.length + 1}`, position: { x: xs[i], y: ys[j], z: zs[k] } });
    if (k > 0) {
      addMember(nodeId(i, j, k - 1), nodeId(i, j, k), "column");
      if (i > 0) addMember(nodeId(i - 1, j, k), nodeId(i, j, k), "beam");
      if (j > 0) addMember(nodeId(i, j - 1, k), nodeId(i, j, k), "beam");
    }
  }
  // Reject coordinates which round to coincident grid lines at extreme magnitudes.
  if ([xs, ys, zs].some((axis) => new Set(axis).size !== axis.length)) {
    preview.nodes = []; preview.members = []; preview.issues.push("坐标精度使相邻轴线重合，请调整原点或尺寸"); return preview;
  }
  preview.status = "awaiting-confirmation";
  return preview;
}
