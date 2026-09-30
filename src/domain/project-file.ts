import {
  PROJECT_FORMAT,
  PROJECT_FORMAT_VERSION,
  validateMaterial,
  validateMember,
  validateSection,
  type FrameMaterial,
  type FrameMember,
  type FrameNode,
  type FrameProject,
  type FrameSection,
  type MaterialId,
  type MemberId,
  type NodeId,
  type ProjectId,
  type SectionId,
} from "./project";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(message);
  return value;
}

function requireFinite(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(message);
  return value;
}

function assertNumberedIdentity(name: string, id: string, label: string, idPrefix: string, labelPrefix: string): void {
  const idMatch = new RegExp(`^${idPrefix}_(\\d+)$`).exec(id);
  if (!idMatch) throw new Error(`${name} ${label} 的稳定标识格式无效`);
  const labelMatch = new RegExp(`^${labelPrefix}([1-9]\\d*)$`).exec(label);
  if (!labelMatch) throw new Error(`${name}显示编号 ${label} 格式无效`);
  const number = Number(idMatch[1]);
  if (!Number.isSafeInteger(number) || number < 1 || id !== `${idPrefix}_${String(number).padStart(4, "0")}`) {
    throw new Error(`${name} ${label} 的稳定标识格式无效`);
  }
  if (label !== `${labelPrefix}${number}`) throw new Error(`${name} ${label} 的稳定标识与显示编号不一致`);
}

function decodeNode(value: unknown): FrameNode {
  if (!isRecord(value)) throw new Error("项目包含无效节点");
  const id = requireString(value.id, "节点缺少稳定标识");
  const label = requireString(value.label, `节点 ${id} 缺少编号`);
  assertNumberedIdentity("节点", id, label, "node", "N");
  const position = value.position;
  if (!isRecord(position) || ![position.x, position.y, position.z].every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))) {
    throw new Error(`节点 ${id} 的坐标无效`);
  }
  return { id: id as NodeId, label, position: { x: position.x as number, y: position.y as number, z: position.z as number } };
}

function decodeMaterial(value: unknown): FrameMaterial {
  if (!isRecord(value)) throw new Error("项目包含无效材料");
  const id = requireString(value.id, "材料缺少稳定标识");
  const label = requireString(value.label, `材料 ${id} 缺少编号`);
  assertNumberedIdentity("材料", id, label, "material", "M");
  return {
    id: id as MaterialId,
    label,
    ...validateMaterial(label, {
      name: requireString(value.name, `材料 ${label} 的名称不能为空`),
      elasticModulusGPa: requireFinite(value.elasticModulusGPa, `材料 ${label} 的弹性模量必须为正有限数值`),
      poissonRatio: requireFinite(value.poissonRatio, `材料 ${label} 的泊松比必须大于 -1 且小于 0.5`),
      densityKgM3: requireFinite(value.densityKgM3, `材料 ${label} 的密度必须为正有限数值`),
    }),
  };
}

function decodeSection(value: unknown): FrameSection {
  if (!isRecord(value)) throw new Error("项目包含无效截面");
  const id = requireString(value.id, "截面缺少稳定标识");
  const label = requireString(value.label, `截面 ${id} 缺少编号`);
  assertNumberedIdentity("截面", id, label, "section", "S");
  return {
    id: id as SectionId,
    label,
    ...validateSection(label, {
      name: requireString(value.name, `截面 ${label} 的名称不能为空`),
      areaM2: requireFinite(value.areaM2, `截面 ${label} 的面积必须为正有限数值`),
      secondMomentYM4: requireFinite(value.secondMomentYM4, `截面 ${label} 的 Iy 必须为正有限数值`),
      secondMomentZM4: requireFinite(value.secondMomentZM4, `截面 ${label} 的 Iz 必须为正有限数值`),
      torsionalConstantM4: requireFinite(value.torsionalConstantM4, `截面 ${label} 的扭转常数 J 必须为正有限数值`),
    }),
  };
}

function decodeMember(value: unknown): FrameMember {
  if (!isRecord(value)) throw new Error("项目包含无效杆件");
  const id = requireString(value.id, "杆件缺少稳定标识");
  const label = requireString(value.label, `杆件 ${id} 缺少编号`);
  assertNumberedIdentity("杆件", id, label, "member", "M");
  return {
    id: id as MemberId,
    label,
    startNodeId: requireString(value.startNodeId, `杆件 ${label} 缺少起点节点`) as NodeId,
    endNodeId: requireString(value.endNodeId, `杆件 ${label} 缺少终点节点`) as NodeId,
    materialId: requireString(value.materialId, `杆件 ${label} 缺少材料`) as MaterialId,
    sectionId: requireString(value.sectionId, `杆件 ${label} 缺少截面`) as SectionId,
    rotationDegrees: requireFinite(value.rotationDegrees, `杆件 ${label} 的截面转角必须是有限数值`),
  };
}

function decodeOptionalArray<T>(value: unknown, name: string, decoder: (item: unknown) => T): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`项目${name}列表无效`);
  return value.map(decoder);
}

function assertUnique<T extends { id: string }>(items: T[], name: string): void {
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error(`项目包含重复的${name}标识`);
}

function assertUniqueLabels<T extends { label: string }>(items: T[], name: string): void {
  if (new Set(items.map((item) => item.label)).size !== items.length) throw new Error(`项目包含重复的${name}显示编号`);
}

function highestNumber(items: Array<{ id: string; label: string }>, idPattern: RegExp, labelPattern: RegExp): number {
  return items.reduce((highest, item) => {
    const idMatch = idPattern.exec(item.id); const labelMatch = labelPattern.exec(item.label);
    return Math.max(highest, idMatch ? Number(idMatch[1]) : 0, labelMatch ? Number(labelMatch[1]) : 0);
  }, 0);
}

function decodeCounter(value: unknown, fallback: number, label: string, highest: number, optional: boolean): number {
  if (value === undefined && !optional) throw new Error("项目版本信息无效");
  const counter = value === undefined ? fallback : value;
  if (typeof counter !== "number" || !Number.isSafeInteger(counter) || counter < 1) throw new Error("项目版本信息无效");
  if (counter <= highest) throw new Error(`下一${label}编号与已有${label}冲突`);
  return counter;
}

export function encodeProject(project: FrameProject): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

export function decodeProject(source: string): FrameProject {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error("文件不是有效的 FrameMind 项目"); }
  if (!isRecord(value) || value.format !== PROJECT_FORMAT) throw new Error("文件不是有效的 FrameMind 项目");
  if (value.formatVersion !== PROJECT_FORMAT_VERSION) {
    throw new Error(`项目版本 ${String(value.formatVersion)} 暂不受支持（当前支持版本 ${PROJECT_FORMAT_VERSION}）`);
  }
  if (!Array.isArray(value.nodes)) throw new Error("项目节点列表无效");
  const nodes = value.nodes.map(decodeNode);
  const materials = decodeOptionalArray(value.materials, "材料", decodeMaterial);
  const sections = decodeOptionalArray(value.sections, "截面", decodeSection);
  const members = decodeOptionalArray(value.members, "杆件", decodeMember);
  assertUnique(nodes, "节点"); assertUnique(materials, "材料"); assertUnique(sections, "截面"); assertUnique(members, "杆件");
  assertUniqueLabels(nodes, "节点"); assertUniqueLabels(materials, "材料"); assertUniqueLabels(sections, "截面"); assertUniqueLabels(members, "杆件");
  if (!isRecord(value.units) || value.units.length !== "m" || value.units.force !== "kN" || value.units.moment !== "kN·m") {
    throw new Error("项目单位约定无效");
  }
  if (typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error("项目版本信息无效");
  const nextNodeNumber = decodeCounter(value.nextNodeNumber, 1, "节点", highestNumber(nodes, /^node_(\d+)$/, /^N(\d+)$/), false);
  const nextMaterialNumber = decodeCounter(value.nextMaterialNumber, 1, "材料", highestNumber(materials, /^material_(\d+)$/, /^M(\d+)$/), true);
  const nextSectionNumber = decodeCounter(value.nextSectionNumber, 1, "截面", highestNumber(sections, /^section_(\d+)$/, /^S(\d+)$/), true);
  const nextMemberNumber = decodeCounter(value.nextMemberNumber, 1, "杆件", highestNumber(members, /^member_(\d+)$/, /^M(\d+)$/), true);
  const project: FrameProject = {
    format: PROJECT_FORMAT, formatVersion: PROJECT_FORMAT_VERSION,
    id: requireString(value.id, "项目缺少稳定标识") as ProjectId,
    name: requireString(value.name, "项目缺少名称"),
    createdAt: requireString(value.createdAt, "项目缺少创建时间"), updatedAt: requireString(value.updatedAt, "项目缺少更新时间"),
    revision: value.revision, units: { length: "m", force: "kN", moment: "kN·m" },
    nodes, materials, sections, members,
    nextNodeNumber, nextMaterialNumber, nextSectionNumber, nextMemberNumber,
  };
  for (const member of members) validateMember(project, member.label, member);
  return project;
}
