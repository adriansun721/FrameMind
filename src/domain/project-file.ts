import {
  PROJECT_FORMAT,
  PROJECT_FORMAT_VERSION,
  validateMaterial,
  validateMember,
  validateSection,
  validateUniformLoad,
  type FrameUniformLoad,
  type FrameMaterial,
  type FrameMember,
  type FrameNode,
  type FrameProject,
  type FrameSection,
  type FrameSupport,
  type FrameNodalLoad,
  type MaterialId,
  type MemberId,
  type NodeId,
  type ProjectId,
  type SectionId,
  type SupportId,
  type LoadId,
  type DofRestraints,
} from "./project";
import { freezeAnalysisInput, type AnalysisResult } from "./analysis";

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

function decodeSupport(value: unknown): FrameSupport {
  if (!isRecord(value)) throw new Error("项目包含无效支座");
  const id = requireString(value.id, "支座缺少稳定标识");
  const label = requireString(value.label, `支座 ${id} 缺少编号`);
  assertNumberedIdentity("支座", id, label, "support", "B");
  if (!Array.isArray(value.restraints) || value.restraints.length !== 6 || !value.restraints.every((item) => typeof item === "boolean")) throw new Error(`支座 ${label} 的约束无效`);
  return { id: id as SupportId, label, nodeId: requireString(value.nodeId, `支座 ${label} 缺少节点`) as NodeId, restraints: [...value.restraints] as DofRestraints };
}

function decodeNodalLoad(value: unknown): FrameNodalLoad {
  if (!isRecord(value)) throw new Error("项目包含无效节点荷载");
  const id = requireString(value.id, "节点荷载缺少稳定标识");
  const label = requireString(value.label, `节点荷载 ${id} 缺少编号`);
  assertNumberedIdentity("节点荷载", id, label, "load", "L");
  const nodeId = requireString(value.nodeId, `节点荷载 ${label} 缺少节点`) as NodeId;
  const decodeVector = (input: unknown, name: string) => {
    if (!isRecord(input) || ![input.x, input.y, input.z].every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))) throw new Error(`节点荷载 ${label} 的${name}无效`);
    return { x: input.x as number, y: input.y as number, z: input.z as number };
  };
  return { id: id as LoadId, label, nodeId, force: decodeVector(value.force, "力"), moment: decodeVector(value.moment, "力矩") };
}

function decodeUniformLoad(value: unknown): FrameUniformLoad {
  if (!isRecord(value)) throw new Error("项目包含无效均布荷载");
  const id = requireString(value.id, "均布荷载缺少稳定标识");
  const label = requireString(value.label, `均布荷载 ${id} 缺少编号`);
  assertNumberedIdentity("均布荷载", id, label, "uniform_load", "Q");
  // Validate the entire object so unsupported distributions cannot be silently discarded.
  const properties = validateUniformLoad(value as unknown as FrameUniformLoad);
  return { id: id as LoadId, label, ...properties, memberId: requireString(value.memberId, "均布荷载缺少杆件") as MemberId };
}

function decodeAnalysisResult(value: unknown): AnalysisResult {
  if (!isRecord(value) || value.status !== "complete") throw new Error("项目包含无效分析结果");
  const id = requireString(value.id, "分析结果缺少稳定标识"); const projectId = requireString(value.projectId, "分析结果缺少项目标识"); const createdAt = requireString(value.createdAt, "分析结果缺少创建时间");
  const projectRevision = requireFinite(value.projectRevision, "分析结果版本无效");
  if (!Number.isSafeInteger(projectRevision) || projectRevision < 0 || !Array.isArray(value.nodes) || !Array.isArray(value.members) || !isRecord(value.input)) throw new Error("项目包含无效分析结果");
  const input = value.input;
  if (input.solver !== undefined && (!isRecord(input.solver) || typeof input.solver.implementation !== "string" || input.solver.implementation.length === 0 || input.solver.algorithm !== "partial-pivot-gaussian" || input.solver.constraints !== "free-dof-elimination" || typeof input.solver.relativePivotTolerance !== "number" || !Number.isFinite(input.solver.relativePivotTolerance) || input.solver.relativePivotTolerance <= 0 || input.solver.relativePivotTolerance >= 1)) throw new Error("分析结果求解器配置无效");
  if (input.projectId !== projectId || input.projectRevision !== projectRevision || !Array.isArray(input.nodes) || !Array.isArray(input.members) || !Array.isArray(input.materials) || !Array.isArray(input.sections) || !Array.isArray(input.supports) || !Array.isArray(input.nodalLoads) || !Array.isArray(input.dofOrder) || input.dofOrder.join(",") !== "ux,uy,uz,rx,ry,rz" || !isRecord(input.assumptions) || input.assumptions.theory !== "3d-euler-bernoulli-frame" || input.assumptions.shearDeformation !== "neglected" || input.assumptions.rigidJoints !== true || input.assumptions.units !== "m-kN-kN·m" || input.assumptions.localAxis !== "member-geometry") throw new Error("分析结果输入来源无效");
  const inputNodes = input.nodes.map(decodeNode); const inputMaterials = input.materials.map(decodeMaterial); const inputSections = input.sections.map(decodeSection); const inputMembers = input.members.map(decodeMember); const inputSupports = input.supports.map(decodeSupport); const inputLoads = input.nodalLoads.map(decodeNodalLoad);
  assertUnique(inputNodes, "分析输入节点"); assertUnique(inputMaterials, "分析输入材料"); assertUnique(inputSections, "分析输入截面"); assertUnique(inputMembers, "分析输入杆件"); assertUnique(inputSupports, "分析输入支座"); assertUnique(inputLoads, "分析输入节点荷载");
  assertUniqueLabels(inputNodes, "分析输入节点"); assertUniqueLabels(inputMaterials, "分析输入材料"); assertUniqueLabels(inputSections, "分析输入截面"); assertUniqueLabels(inputMembers, "分析输入杆件"); assertUniqueLabels(inputSupports, "分析输入支座"); assertUniqueLabels(inputLoads, "分析输入节点荷载");
  const inputNodeIds = new Set(inputNodes.map((node) => node.id)); const inputMaterialIds = new Set(inputMaterials.map((material) => material.id)); const inputSectionIds = new Set(inputSections.map((section) => section.id));
  const inputUniformLoads = decodeOptionalArray(input.uniformLoads, "分析输入均布荷载", decodeUniformLoad);
  assertUnique(inputUniformLoads, "分析输入均布荷载"); assertUniqueLabels(inputUniformLoads, "分析输入均布荷载");
  for (const load of inputUniformLoads) if (!inputMembers.some((member) => member.id === load.memberId)) throw new Error("分析结果均布荷载引用无效");
  for (const member of inputMembers) if (!inputNodeIds.has(member.startNodeId) || !inputNodeIds.has(member.endNodeId) || !inputMaterialIds.has(member.materialId) || !inputSectionIds.has(member.sectionId)) throw new Error("分析结果杆件引用无效");
  for (const support of inputSupports) if (!inputNodeIds.has(support.nodeId)) throw new Error("分析结果支座引用无效");
  for (const load of inputLoads) if (!inputNodeIds.has(load.nodeId)) throw new Error("分析结果节点荷载引用无效");
  const finiteVector = (vector: unknown, label: string) => {
    if (!isRecord(vector) || ![vector.x, vector.y, vector.z].every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))) throw new Error(`分析结果${label}无效`);
    return { x: vector.x as number, y: vector.y as number, z: vector.z as number };
  };
  const nodes = value.nodes.map((node) => {
    if (!isRecord(node)) throw new Error("分析结果节点无效");
    return { nodeId: requireString(node.nodeId, "分析结果节点缺少标识"), displacement: finiteVector(node.displacement, "位移"), rotation: finiteVector(node.rotation, "转角"), reaction: finiteVector(node.reaction, "反力"), reactionMoment: finiteVector(node.reactionMoment, "反力矩") };
  });
  const members = value.members.map((member) => {
    if (!isRecord(member) || !isRecord(member.localEndForces)) throw new Error("分析结果杆件无效");
    const localAxes = member.localAxes;
    if (!isRecord(localAxes)) throw new Error("分析结果杆件局部轴无效");
    const endForces = member.localEndForces;
    const forceVector = (input: unknown, label: string) => { if (!Array.isArray(input) || input.length !== 6 || !input.every((item) => typeof item === "number" && Number.isFinite(item))) throw new Error(`分析结果${label}无效`); return [...input] as [number, number, number, number, number, number]; };
    const length = requireFinite(member.length, "分析结果杆件长度无效"); if (length <= 0) throw new Error("分析结果杆件长度无效");
    return { memberId: requireString(member.memberId, "分析结果杆件缺少标识"), length, localAxes: { x: finiteVector(localAxes.x, "局部轴"), y: finiteVector(localAxes.y, "局部轴"), z: finiteVector(localAxes.z, "局部轴") }, localEndForces: { start: forceVector(endForces.start, "杆端内力"), end: forceVector(endForces.end, "杆端内力") } };
  });
  const nodeResultIds = new Set(inputNodes.map((node) => String(node.id))); const memberResultIds = new Set(inputMembers.map((member) => String(member.id)));
  const resultNodeIds = new Set(nodes.map((node) => node.nodeId)); const resultMemberIds = new Set(members.map((member) => member.memberId));
  if (nodes.length !== inputNodes.length || members.length !== inputMembers.length || resultNodeIds.size !== nodes.length || resultMemberIds.size !== members.length || nodes.some((node) => !nodeResultIds.has(node.nodeId)) || members.some((member) => !memberResultIds.has(member.memberId))) throw new Error("分析结果对象引用无效");
  return { id, projectId, projectRevision, createdAt, status: "complete", input: freezeAnalysisInput({ ...input, nodes: inputNodes, materials: inputMaterials, sections: inputSections, members: inputMembers, supports: inputSupports, nodalLoads: inputLoads, uniformLoads: inputUniformLoads } as AnalysisResult["input"]), nodes, members };
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
  const supports = decodeOptionalArray(value.supports, "支座", decodeSupport);
  const nodalLoads = decodeOptionalArray(value.nodalLoads, "节点荷载", decodeNodalLoad);
  const uniformLoads = decodeOptionalArray(value.uniformLoads, "均布荷载", decodeUniformLoad);
  assertUnique(uniformLoads, "均布荷载"); assertUniqueLabels(uniformLoads, "均布荷载");
  assertUnique(nodes, "节点"); assertUnique(materials, "材料"); assertUnique(sections, "截面"); assertUnique(members, "杆件"); assertUnique(supports, "支座"); assertUnique(nodalLoads, "节点荷载");
  assertUniqueLabels(nodes, "节点"); assertUniqueLabels(materials, "材料"); assertUniqueLabels(sections, "截面"); assertUniqueLabels(members, "杆件"); assertUniqueLabels(supports, "支座"); assertUniqueLabels(nodalLoads, "节点荷载");
  if (!isRecord(value.units) || value.units.length !== "m" || value.units.force !== "kN" || value.units.moment !== "kN·m") {
    throw new Error("项目单位约定无效");
  }
  if (typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error("项目版本信息无效");
  const nextNodeNumber = decodeCounter(value.nextNodeNumber, 1, "节点", highestNumber(nodes, /^node_(\d+)$/, /^N(\d+)$/), false);
  const nextMaterialNumber = decodeCounter(value.nextMaterialNumber, 1, "材料", highestNumber(materials, /^material_(\d+)$/, /^M(\d+)$/), true);
  const nextSectionNumber = decodeCounter(value.nextSectionNumber, 1, "截面", highestNumber(sections, /^section_(\d+)$/, /^S(\d+)$/), true);
  const nextMemberNumber = decodeCounter(value.nextMemberNumber, 1, "杆件", highestNumber(members, /^member_(\d+)$/, /^M(\d+)$/), true);
  const nextSupportNumber = decodeCounter(value.nextSupportNumber, 1, "支座", highestNumber(supports, /^support_(\d+)$/, /^B(\d+)$/), true);
  const nextLoadNumber = decodeCounter(value.nextLoadNumber, 1, "节点荷载", highestNumber(nodalLoads, /^load_(\d+)$/, /^L(\d+)$/), true);
  const latestAnalysis = value.latestAnalysis === undefined ? undefined : decodeAnalysisResult(value.latestAnalysis);
  const nextUniformLoadNumber = decodeCounter(value.nextUniformLoadNumber, 1, "均布荷载", highestNumber(uniformLoads, /^uniform_load_(\d+)$/, /^Q(\d+)$/), true);
  const project: FrameProject = {
    format: PROJECT_FORMAT, formatVersion: PROJECT_FORMAT_VERSION,
    id: requireString(value.id, "项目缺少稳定标识") as ProjectId,
    name: requireString(value.name, "项目缺少名称"),
    createdAt: requireString(value.createdAt, "项目缺少创建时间"), updatedAt: requireString(value.updatedAt, "项目缺少更新时间"),
    revision: value.revision, units: { length: "m", force: "kN", moment: "kN·m" },
    nodes, materials, sections, members, supports, nodalLoads, uniformLoads,
    latestAnalysis,
    nextNodeNumber, nextMaterialNumber, nextSectionNumber, nextMemberNumber, nextSupportNumber, nextLoadNumber, nextUniformLoadNumber,
  };
  for (const member of members) validateMember(project, member.label, member);
  for (const load of uniformLoads) if (!members.some((member) => member.id === load.memberId)) throw new Error(`均布荷载 ${load.label} 引用了不存在的杆件 ${load.memberId}`);
  for (const support of supports) if (!nodes.some((node) => node.id === support.nodeId)) throw new Error(`支座 ${support.label} 引用了不存在的节点 ${support.nodeId}`);
  for (const load of nodalLoads) if (!nodes.some((node) => node.id === load.nodeId)) throw new Error(`节点荷载 ${load.label} 引用了不存在的节点 ${load.nodeId}`);
  if (latestAnalysis && latestAnalysis.projectId !== project.id) throw new Error("分析结果项目标识与文件不一致");
  if (latestAnalysis && latestAnalysis.projectRevision >= project.revision) throw new Error("分析结果版本必须早于当前项目版本");
  return project;
}
