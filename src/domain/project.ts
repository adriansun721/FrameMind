import { calculateMemberGeometry } from "./member-geometry";
import type { AnalysisResult } from "./analysis";

export const PROJECT_FORMAT = "framemind-project" as const;
export const PROJECT_FORMAT_VERSION = 1 as const;

declare const projectIdBrand: unique symbol;
declare const nodeIdBrand: unique symbol;
declare const materialIdBrand: unique symbol;
declare const sectionIdBrand: unique symbol;
declare const memberIdBrand: unique symbol;
declare const supportIdBrand: unique symbol;
declare const loadIdBrand: unique symbol;
export type ProjectId = string & { readonly [projectIdBrand]: true };
export type NodeId = string & { readonly [nodeIdBrand]: true };
export type MaterialId = string & { readonly [materialIdBrand]: true };
export type SectionId = string & { readonly [sectionIdBrand]: true };
export type MemberId = string & { readonly [memberIdBrand]: true };
export type SupportId = string & { readonly [supportIdBrand]: true };
export type LoadId = string & { readonly [loadIdBrand]: true };

export interface Vector3 { x: number; y: number; z: number; }
export interface FrameNode { id: NodeId; label: string; position: Vector3; }
export interface MaterialProperties { name: string; elasticModulusGPa: number; poissonRatio: number; densityKgM3: number; }
export interface FrameMaterial extends MaterialProperties { id: MaterialId; label: string; }
export interface SectionProperties { name: string; areaM2: number; secondMomentYM4: number; secondMomentZM4: number; torsionalConstantM4: number; }
export interface FrameSection extends SectionProperties { id: SectionId; label: string; }
export interface MemberProperties { startNodeId: NodeId; endNodeId: NodeId; materialId: MaterialId; sectionId: SectionId; rotationDegrees: number; }
export interface FrameMember extends MemberProperties { id: MemberId; label: string; }
export type DofRestraints = [boolean, boolean, boolean, boolean, boolean, boolean];
export interface FrameSupport { id: SupportId; label: string; nodeId: NodeId; restraints: DofRestraints; }
export interface FrameNodalLoad { id: LoadId; label: string; nodeId: NodeId; force: Vector3; moment: Vector3; }
export const DEFAULT_LOAD_CASE = "LC1";
export interface UniformLoadProperties {
  kind: "uniform";
  memberId: MemberId;
  coordinateSystem: "global" | "local";
  loadCaseId: string;
  intensity: Vector3;
}
export interface FrameUniformLoad extends UniformLoadProperties { id: LoadId; label: string; }
export interface SelfWeightProperties {
  enabled: boolean;
  loadCaseId: string;
  /** Gravitational acceleration in the global frame (m/s^2). */
  gravity: Vector3;
}
export type FrameSelfWeight = SelfWeightProperties;

export interface FrameProject {
  format: typeof PROJECT_FORMAT;
  formatVersion: typeof PROJECT_FORMAT_VERSION;
  id: ProjectId;
  name: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  units: { length: "m"; force: "kN"; moment: "kN·m"; };
  nodes: FrameNode[];
  materials: FrameMaterial[];
  sections: FrameSection[];
  members: FrameMember[];
  supports: FrameSupport[];
  nodalLoads: FrameNodalLoad[];
  uniformLoads: FrameUniformLoad[];
  selfWeight: FrameSelfWeight;
  latestAnalysis?: AnalysisResult;
  nextNodeNumber: number;
  nextMaterialNumber: number;
  nextSectionNumber: number;
  nextMemberNumber: number;
  nextSupportNumber: number;
  nextLoadNumber: number;
  nextUniformLoadNumber: number;
}

function createIdentity(): string { return globalThis.crypto.randomUUID(); }

function nextRevision(project: FrameProject): Pick<FrameProject, "revision" | "updatedAt"> {
  if (!Number.isSafeInteger(project.revision) || project.revision < 0 || project.revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error("项目编号状态无法安全递增");
  }
  return { revision: project.revision + 1, updatedAt: new Date().toISOString() };
}

function assertCounter(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) throw new Error("项目编号状态无法安全递增");
}

function assertFiniteVector(position: Vector3): void {
  if (![position.x, position.y, position.z].every(Number.isFinite)) throw new Error("坐标必须是有限数值");
}

function assertRestraints(restraints: DofRestraints): void {
  if (!Array.isArray(restraints) || restraints.length !== 6 || !restraints.every((item) => typeof item === "boolean")) {
    throw new Error("支座约束必须包含六个自由度");
  }
}

function assertPositive(value: number, message: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(message);
}

function cleanName(value: string, message: string): string {
  const name = value.trim();
  if (!name) throw new Error(message);
  return name;
}

export function validateMaterial(label: string, material: MaterialProperties): MaterialProperties {
  const name = cleanName(material.name, `材料 ${label} 的名称不能为空`);
  assertPositive(material.elasticModulusGPa, `材料 ${label} 的弹性模量必须为正有限数值`);
  if (!Number.isFinite(material.poissonRatio) || material.poissonRatio <= -1 || material.poissonRatio >= 0.5) {
    throw new Error(`材料 ${label} 的泊松比必须大于 -1 且小于 0.5`);
  }
  assertPositive(material.densityKgM3, `材料 ${label} 的密度必须为正有限数值`);
  return { ...material, name };
}

export function validateSection(label: string, section: SectionProperties): SectionProperties {
  const name = cleanName(section.name, `截面 ${label} 的名称不能为空`);
  assertPositive(section.areaM2, `截面 ${label} 的面积必须为正有限数值`);
  assertPositive(section.secondMomentYM4, `截面 ${label} 的 Iy 必须为正有限数值`);
  assertPositive(section.secondMomentZM4, `截面 ${label} 的 Iz 必须为正有限数值`);
  assertPositive(section.torsionalConstantM4, `截面 ${label} 的扭转常数 J 必须为正有限数值`);
  return { ...section, name };
}

function requireNode(project: FrameProject, id: NodeId, label: string, role: "起点" | "终点"): FrameNode {
  const node = project.nodes.find((item) => item.id === id);
  if (!node) throw new Error(`杆件 ${label} 引用了不存在的${role}节点 ${id}`);
  return node;
}

export function validateMember(project: FrameProject, label: string, member: MemberProperties): MemberProperties {
  const start = requireNode(project, member.startNodeId, label, "起点");
  const end = requireNode(project, member.endNodeId, label, "终点");
  if (!project.materials.some((item) => item.id === member.materialId)) throw new Error(`杆件 ${label} 引用了不存在的材料 ${member.materialId}`);
  if (!project.sections.some((item) => item.id === member.sectionId)) throw new Error(`杆件 ${label} 引用了不存在的截面 ${member.sectionId}`);
  if (!Number.isFinite(member.rotationDegrees)) throw new Error(`杆件 ${label} 的截面转角必须是有限数值`);
  try {
    calculateMemberGeometry(start.position, end.position, member.rotationDegrees);
  } catch {
    throw new Error(`杆件 ${label} 的两个节点不能位于同一位置`);
  }
  return { ...member };
}

export function createProject(name = "未命名项目"): FrameProject {
  const now = new Date().toISOString();
  return {
    format: PROJECT_FORMAT, formatVersion: PROJECT_FORMAT_VERSION,
    id: `project_${createIdentity()}` as ProjectId, name: name.trim() || "未命名项目",
    createdAt: now, updatedAt: now, revision: 0,
    units: { length: "m", force: "kN", moment: "kN·m" },
    nodes: [], materials: [], sections: [], members: [], supports: [], nodalLoads: [], uniformLoads: [], selfWeight: { ...DEFAULT_SELF_WEIGHT, gravity: { ...DEFAULT_SELF_WEIGHT.gravity } },
    nextNodeNumber: 1, nextMaterialNumber: 1, nextSectionNumber: 1, nextMemberNumber: 1, nextSupportNumber: 1, nextLoadNumber: 1, nextUniformLoadNumber: 1,
  };
}

export function addNode(project: FrameProject, position: Vector3): FrameProject {
  assertFiniteVector(position); assertCounter(project.nextNodeNumber);
  const number = project.nextNodeNumber;
  const node: FrameNode = { id: `node_${String(number).padStart(4, "0")}` as NodeId, label: `N${number}`, position: { ...position } };
  return { ...project, nodes: [...project.nodes, node], nextNodeNumber: number + 1, ...nextRevision(project) };
}

export function updateNode(project: FrameProject, id: NodeId, position: Vector3): FrameProject {
  assertFiniteVector(position);
  if (!project.nodes.some((node) => node.id === id)) throw new Error(`节点 ${id} 不存在`);
  const nodes = project.nodes.map((node) => node.id === id ? { ...node, position: { ...position } } : node);
  for (const member of project.members.filter((item) => item.startNodeId === id || item.endNodeId === id)) {
    const start = nodes.find((node) => node.id === member.startNodeId)!;
    const end = nodes.find((node) => node.id === member.endNodeId)!;
    try { calculateMemberGeometry(start.position, end.position, member.rotationDegrees); }
    catch { throw new Error(`节点修改会使杆件 ${member.label} 变为零长度`); }
  }
  return { ...project, nodes, ...nextRevision(project) };
}

export function addMaterial(project: FrameProject, input: MaterialProperties): FrameProject {
  assertCounter(project.nextMaterialNumber); const number = project.nextMaterialNumber;
  const material: FrameMaterial = { id: `material_${String(number).padStart(4, "0")}` as MaterialId, label: `M${number}`, ...validateMaterial(`M${number}`, input) };
  return { ...project, materials: [...project.materials, material], nextMaterialNumber: number + 1, ...nextRevision(project) };
}

export function updateMaterial(project: FrameProject, id: MaterialId, input: MaterialProperties): FrameProject {
  const current = project.materials.find((item) => item.id === id); if (!current) throw new Error(`材料 ${id} 不存在`);
  const properties = validateMaterial(current.label, input);
  return { ...project, materials: project.materials.map((item) => item.id === id ? { ...item, ...properties } : item), ...nextRevision(project) };
}

export function addSection(project: FrameProject, input: SectionProperties): FrameProject {
  assertCounter(project.nextSectionNumber); const number = project.nextSectionNumber;
  const section: FrameSection = { id: `section_${String(number).padStart(4, "0")}` as SectionId, label: `S${number}`, ...validateSection(`S${number}`, input) };
  return { ...project, sections: [...project.sections, section], nextSectionNumber: number + 1, ...nextRevision(project) };
}

export function updateSection(project: FrameProject, id: SectionId, input: SectionProperties): FrameProject {
  const current = project.sections.find((item) => item.id === id); if (!current) throw new Error(`截面 ${id} 不存在`);
  const properties = validateSection(current.label, input);
  return { ...project, sections: project.sections.map((item) => item.id === id ? { ...item, ...properties } : item), ...nextRevision(project) };
}

export function addMember(project: FrameProject, input: MemberProperties): FrameProject {
  assertCounter(project.nextMemberNumber); const number = project.nextMemberNumber; const label = `M${number}`;
  const member: FrameMember = { id: `member_${String(number).padStart(4, "0")}` as MemberId, label, ...validateMember(project, label, input) };
  return { ...project, members: [...project.members, member], nextMemberNumber: number + 1, ...nextRevision(project) };
}

export function updateMember(project: FrameProject, id: MemberId, changes: Partial<MemberProperties>): FrameProject {
  const current = project.members.find((item) => item.id === id); if (!current) throw new Error(`杆件 ${id} 不存在`);
  const input = validateMember(project, current.label, {
    startNodeId: changes.startNodeId ?? current.startNodeId, endNodeId: changes.endNodeId ?? current.endNodeId,
    materialId: changes.materialId ?? current.materialId, sectionId: changes.sectionId ?? current.sectionId,
    rotationDegrees: changes.rotationDegrees ?? current.rotationDegrees,
  });
  return { ...project, members: project.members.map((item) => item.id === id ? { ...item, ...input } : item), ...nextRevision(project) };
}

export function deleteMember(project: FrameProject, id: MemberId): FrameProject {
  if (!project.members.some((member) => member.id === id)) throw new Error(`杆件 ${id} 不存在`);
  return { ...project, members: project.members.filter((member) => member.id !== id), uniformLoads: project.uniformLoads.filter((load) => load.memberId !== id), ...nextRevision(project) };
}

export function validateUniformLoad(input: UniformLoadProperties): UniformLoadProperties {
  const allowed = new Set(["id", "label", "kind", "memberId", "coordinateSystem", "loadCaseId", "intensity"]);
  if (!input || input.kind !== "uniform" || Object.keys(input).some((key) => !allowed.has(key))) throw new Error("仅支持整根杆件均布力，不支持中间集中、分段或非均匀荷载");
  if (input.coordinateSystem !== "global" && input.coordinateSystem !== "local") throw new Error("均布荷载坐标系必须为 global 或 local");
  if (input.loadCaseId !== DEFAULT_LOAD_CASE) throw new Error("当前仅支持工况 LC1");
  if (!input.intensity || Object.keys(input.intensity).some((key) => !["x", "y", "z"].includes(key))) throw new Error("均布荷载必须是三个有限的力分量（kN/m）");
  if (![input.intensity.x, input.intensity.y, input.intensity.z].every(Number.isFinite)) throw new Error("均布荷载分量必须是有限数值（kN/m）");
  return { kind: "uniform", memberId: input.memberId, coordinateSystem: input.coordinateSystem, loadCaseId: input.loadCaseId, intensity: { ...input.intensity } };
}

export function validateSelfWeight(input: SelfWeightProperties): SelfWeightProperties {
  if (!input || typeof input.enabled !== "boolean") throw new Error("自重启用状态无效");
  if (input.loadCaseId !== DEFAULT_LOAD_CASE) throw new Error("当前自重仅支持工况 LC1");
  if (!input.gravity || ![input.gravity.x, input.gravity.y, input.gravity.z].every(Number.isFinite)) throw new Error("重力加速度必须是有限数值（m/s²）");
  if (input.enabled && Math.hypot(input.gravity.x, input.gravity.y, input.gravity.z) <= 0) throw new Error("启用自重时重力加速度不能为零");
  return { enabled: input.enabled, loadCaseId: input.loadCaseId, gravity: { ...input.gravity } };
}

export const DEFAULT_SELF_WEIGHT: FrameSelfWeight = Object.freeze({ enabled: false, loadCaseId: DEFAULT_LOAD_CASE, gravity: Object.freeze({ x: 0, y: 0, z: -9.81 }) });

export function updateSelfWeight(project: FrameProject, input: SelfWeightProperties): FrameProject {
  return { ...project, selfWeight: validateSelfWeight(input), ...nextRevision(project) };
}

export function addUniformLoad(project: FrameProject, input: UniformLoadProperties): FrameProject {
  const properties = validateUniformLoad(input);
  if (!project.members.some((member) => member.id === properties.memberId)) throw new Error("均布荷载引用了不存在的杆件");
  assertCounter(project.nextUniformLoadNumber);
  const number = project.nextUniformLoadNumber;
  const load: FrameUniformLoad = { id: `uniform_load_${String(number).padStart(4, "0")}` as LoadId, label: `Q${number}`, ...properties };
  return { ...project, uniformLoads: [...project.uniformLoads, load], nextUniformLoadNumber: number + 1, ...nextRevision(project) };
}

export function updateUniformLoad(project: FrameProject, id: LoadId, input: UniformLoadProperties): FrameProject {
  const current = project.uniformLoads.find((load) => load.id === id);
  if (!current) throw new Error(`均布荷载 ${id} 不存在`);
  const properties = validateUniformLoad(input);
  if (!project.members.some((member) => member.id === properties.memberId)) throw new Error("均布荷载引用了不存在的杆件");
  return { ...project, uniformLoads: project.uniformLoads.map((load) => load.id === id ? { ...current, ...properties } : load), ...nextRevision(project) };
}

export function deleteUniformLoad(project: FrameProject, id: LoadId): FrameProject {
  if (!project.uniformLoads.some((load) => load.id === id)) throw new Error(`均布荷载 ${id} 不存在`);
  return { ...project, uniformLoads: project.uniformLoads.filter((load) => load.id !== id), ...nextRevision(project) };
}

function requireProjectNode(project: FrameProject, nodeId: NodeId, label: string): void {
  if (!project.nodes.some((node) => node.id === nodeId)) throw new Error(`${label} 引用了不存在的节点 ${nodeId}`);
}

export function addSupport(project: FrameProject, nodeId: NodeId, restraints: DofRestraints): FrameProject {
  requireProjectNode(project, nodeId, "支座"); assertRestraints(restraints); assertCounter(project.nextSupportNumber);
  const number = project.nextSupportNumber;
  const support: FrameSupport = { id: `support_${String(number).padStart(4, "0")}` as SupportId, label: `B${number}`, nodeId, restraints: [...restraints] as DofRestraints };
  return { ...project, supports: [...project.supports, support], nextSupportNumber: number + 1, ...nextRevision(project) };
}

export function updateSupport(project: FrameProject, id: SupportId, nodeId: NodeId, restraints: DofRestraints): FrameProject {
  const current = project.supports.find((support) => support.id === id); if (!current) throw new Error(`支座 ${id} 不存在`);
  requireProjectNode(project, nodeId, current.label); assertRestraints(restraints);
  return { ...project, supports: project.supports.map((support) => support.id === id ? { ...support, nodeId, restraints: [...restraints] as DofRestraints } : support), ...nextRevision(project) };
}

export function addNodalLoad(project: FrameProject, nodeId: NodeId, force: Vector3, moment: Vector3): FrameProject {
  requireProjectNode(project, nodeId, "节点荷载"); assertFiniteVector(force); assertFiniteVector(moment); assertCounter(project.nextLoadNumber);
  const number = project.nextLoadNumber;
  const load: FrameNodalLoad = { id: `load_${String(number).padStart(4, "0")}` as LoadId, label: `L${number}`, nodeId, force: { ...force }, moment: { ...moment } };
  return { ...project, nodalLoads: [...project.nodalLoads, load], nextLoadNumber: number + 1, ...nextRevision(project) };
}

export function updateNodalLoad(project: FrameProject, id: LoadId, nodeId: NodeId, force: Vector3, moment: Vector3): FrameProject {
  const current = project.nodalLoads.find((load) => load.id === id); if (!current) throw new Error(`节点荷载 ${id} 不存在`);
  requireProjectNode(project, nodeId, current.label); assertFiniteVector(force); assertFiniteVector(moment);
  return { ...project, nodalLoads: project.nodalLoads.map((load) => load.id === id ? { ...load, nodeId, force: { ...force }, moment: { ...moment } } : load), ...nextRevision(project) };
}

export function deleteMaterial(project: FrameProject, id: MaterialId): FrameProject {
  if (!project.materials.some((material) => material.id === id)) throw new Error(`材料 ${id} 不存在`);
  const dependent = project.members.filter((member) => member.materialId === id);
  if (dependent.length > 0) throw new Error(`材料仍被 ${dependent.map((member) => member.label).join("、")} 引用，请先处理杆件`);
  return { ...project, materials: project.materials.filter((material) => material.id !== id), ...nextRevision(project) };
}

export function deleteSection(project: FrameProject, id: SectionId): FrameProject {
  if (!project.sections.some((section) => section.id === id)) throw new Error(`截面 ${id} 不存在`);
  const dependent = project.members.filter((member) => member.sectionId === id);
  if (dependent.length > 0) throw new Error(`截面仍被 ${dependent.map((member) => member.label).join("、")} 引用，请先处理杆件`);
  return { ...project, sections: project.sections.filter((section) => section.id !== id), ...nextRevision(project) };
}

export function deleteSupport(project: FrameProject, id: SupportId): FrameProject {
  if (!project.supports.some((support) => support.id === id)) throw new Error(`支座 ${id} 不存在`);
  return { ...project, supports: project.supports.filter((support) => support.id !== id), ...nextRevision(project) };
}

export function deleteNodalLoad(project: FrameProject, id: LoadId): FrameProject {
  if (!project.nodalLoads.some((load) => load.id === id)) throw new Error(`节点荷载 ${id} 不存在`);
  return { ...project, nodalLoads: project.nodalLoads.filter((load) => load.id !== id), ...nextRevision(project) };
}

export function attachAnalysisResult(project: FrameProject, result: AnalysisResult): FrameProject {
  if (result.projectId !== project.id || result.projectRevision !== project.revision) throw new Error("分析结果不属于当前模型版本");
  return { ...project, latestAnalysis: result, ...nextRevision(project) };
}
