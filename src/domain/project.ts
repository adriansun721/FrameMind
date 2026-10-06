import { validateSecondOrderSettings, type SecondOrderSettings } from "./second-order";
import { validateBucklingSettings, type BucklingSettings } from "./buckling";
import { validateAdditionalMass } from "./additional-mass";
import { validateModalDampingBinding, type ModalDampingBinding } from "./modal-damping";
import { validateModalSettings, type ModalSettings } from "./modal";
import { validateMeshPolicy, type MeshPolicy } from "./analysis-mesh";
import { validateMemberEndReleases, type MemberEndReleases } from "./member-releases";
import { validateSectionDimensions, validateSectionGeometry, sectionMechanicalProperties, sectionParameterBasis, type SectionGeometry } from "./section-geometry";
import { validateCatalogSectionBasis, type CatalogSectionBasis } from "./catalog-section";
import type { UnitPresetId } from "./units";
import { calculateMemberGeometry } from "./member-geometry";
import type { AnalysisResult } from "./analysis";
import { requireAnalysisCapability, type AnalysisMethod } from "./analysis-capabilities";
import type { ConfirmedOperation, PersistedTaskState } from "../workspace/task-persistence";

export const PROJECT_FORMAT = "framemind-project" as const;
export const PROJECT_FORMAT_VERSION = 2 as const;

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
export interface FrameNode { id: NodeId; label: string; position: Vector3; additionalMassKg?: number; }
export interface MaterialProperties { name: string; elasticModulusGPa: number; poissonRatio: number; densityKgM3: number; }
export interface CatalogSource { publisher: string; title: string; edition: string; url: string; accessedOn: string; units: string; }
export interface ResourceProvenance { kind: "catalog" | "custom"; catalogId?: string; source?: CatalogSource; derivedFrom?: { catalogId: string; source: CatalogSource; } }
export interface FrameMaterial extends MaterialProperties { id: MaterialId; label: string; provenance: ResourceProvenance; }
export interface SectionProperties { name: string; areaM2: number; secondMomentYM4: number; secondMomentZM4: number; torsionalConstantM4: number; geometry?: SectionGeometry; parameterBasis?: ReturnType<typeof sectionParameterBasis>; catalogBasis?: CatalogSectionBasis; }
export type SectionInput = SectionProperties | { name: string; geometry: SectionGeometry };
export interface FrameSection extends SectionProperties { id: SectionId; label: string; provenance: ResourceProvenance; }
export interface MemberProperties { startNodeId: NodeId; endNodeId: NodeId; materialId: MaterialId; sectionId: SectionId; rotationDegrees: number; endReleases?: MemberEndReleases; additionalLineMassKgM?: number; }
export interface FrameMember extends MemberProperties { id: MemberId; label: string; }
export type DofRestraints = [boolean, boolean, boolean, boolean, boolean, boolean];
export interface FrameSupport { id: SupportId; label: string; nodeId: NodeId; restraints: DofRestraints; }
export interface FrameNodalLoad { id: LoadId; label: string; nodeId: NodeId; loadCaseId: string; force: Vector3; moment: Vector3; }
export const DEFAULT_LOAD_CASE = "LC1";
export interface FrameLoadCase { id: string; name: string; description: string; }
export interface LoadCombinationTerm { loadCaseId: string; factor: number; }
export interface FrameLoadCombination { id: string; name: string; terms: LoadCombinationTerm[]; }
export interface FrameAnalysisCase {
  id: string;
  name: string;
  method: AnalysisMethod;
  loadSourceId: string;
  settings: { solver: "native-static" | "native-modal" | "native-buckling" | "native-second-order"; mesh?: MeshPolicy; modal?: ModalSettings; buckling?: BucklingSettings; secondOrder?: SecondOrderSettings };
  legacySourceId?: string;
  damping?: ModalDampingBinding;
}
export const DEFAULT_LOAD_CASES: readonly FrameLoadCase[] = [{ id: DEFAULT_LOAD_CASE, name: "默认工况", description: "" }];
export function getAnalysisLoadCaseId(input: { loadCase?: FrameLoadCase }): string {
  return input.loadCase?.id ?? DEFAULT_LOAD_CASE;
}
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
  displayUnitPreset?: UnitPresetId;
  nodes: FrameNode[];
  materials: FrameMaterial[];
  sections: FrameSection[];
  members: FrameMember[];
  supports: FrameSupport[];
  nodalLoads: FrameNodalLoad[];
  uniformLoads: FrameUniformLoad[];
  selfWeight: FrameSelfWeight;
  loadCases: FrameLoadCase[];
  activeLoadCaseId: string;
  nextLoadCaseNumber: number;
  loadCombinations: FrameLoadCombination[];
  activeLoadCombinationId?: string;
  nextLoadCombinationNumber: number;
  analysisCases: FrameAnalysisCase[];
  activeAnalysisCaseId?: string;
  nextAnalysisCaseNumber: number;
  analysisResults: AnalysisResult[];
  latestAnalysis?: AnalysisResult;
  taskState?: PersistedTaskState;
  confirmedOperations?: ConfirmedOperation[];
  migration?: { fromVersion: 1; missing: string[] };
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
  return { name, elasticModulusGPa: material.elasticModulusGPa, poissonRatio: material.poissonRatio, densityKgM3: material.densityKgM3 };
}

export function validateSection(label: string, section: SectionInput): SectionProperties {
  const name = cleanName(section.name, `截面 ${label} 的名称不能为空`);
  const archived = (section as Partial<SectionProperties>).catalogBasis;
  const geometry = section.geometry === undefined ? undefined : archived === undefined ? validateSectionGeometry(section.geometry) : validateSectionDimensions(section.geometry);
  const catalogBasis = archived === undefined ? undefined : validateCatalogSectionBasis(archived, geometry, section as Partial<SectionProperties>);
  const derived = geometry && !catalogBasis ? sectionMechanicalProperties(geometry) : undefined;
  const keys = ["areaM2", "secondMomentYM4", "secondMomentZM4", "torsionalConstantM4"] as const;
  const parameterNames = { areaM2: "面积", secondMomentYM4: " Iy ", secondMomentZM4: " Iz ", torsionalConstantM4: "扭转常数 J " };
  for (const key of keys) {
    const supplied = (section as Partial<SectionProperties>)[key];
    if (supplied !== undefined && derived && (!Number.isFinite(supplied) || Math.abs(supplied - derived[key]) > Math.abs(derived[key]) * 1e-9)) throw new Error(`截面 ${label} 的 ${key} 与几何尺寸不一致`);
    assertPositive(derived?.[key] ?? supplied!, `截面 ${label} 的${parameterNames[key]}必须为正有限数值`);
  }
  const values = derived ?? section as SectionProperties;
  return { name, areaM2: values.areaM2, secondMomentYM4: values.secondMomentYM4, secondMomentZM4: values.secondMomentZM4, torsionalConstantM4: values.torsionalConstantM4,
    ...(geometry ? { geometry, ...(catalogBasis ? { catalogBasis } : { parameterBasis: sectionParameterBasis(geometry.shape) }) } : {}) };
}

function requireNode(project: FrameProject, id: NodeId, label: string, role: "起点" | "终点"): FrameNode {
  const node = project.nodes.find((item) => item.id === id);
  if (!node) throw new Error(`杆件 ${label} 引用了不存在的${role}节点 ${id}`);
  return node;
}

export function validateMember(project: FrameProject, label: string, member: MemberProperties): MemberProperties {
  if (member.additionalLineMassKgM !== undefined) validateAdditionalMass(member.additionalLineMassKgM);
  const start = requireNode(project, member.startNodeId, label, "起点");
  const end = requireNode(project, member.endNodeId, label, "终点");
  if (!project.materials.some((item) => item.id === member.materialId)) throw new Error(`杆件 ${label} 引用了不存在的材料 ${member.materialId}`);
  if (!project.sections.some((item) => item.id === member.sectionId)) throw new Error(`杆件 ${label} 引用了不存在的截面 ${member.sectionId}`);
  if (!Number.isFinite(member.rotationDegrees)) throw new Error(`杆件 ${label} 的截面转角必须是有限数值`);
  try {
    calculateMemberGeometry(start.position, end.position, member.rotationDegrees);
  } catch (error) {
    throw new Error(`杆件 ${label} 的两个节点不能位于同一位置；${error instanceof Error ? error.message : "几何无效"}`);
  }
  return { ...member, ...(member.endReleases !== undefined ? { endReleases: validateMemberEndReleases(member.endReleases) } : {}) };
}

export function createProject(name = "未命名项目"): FrameProject {
  const now = new Date().toISOString();
  return {
    format: PROJECT_FORMAT, formatVersion: PROJECT_FORMAT_VERSION,
    id: `project_${createIdentity()}` as ProjectId, name: name.trim() || "未命名项目",
    createdAt: now, updatedAt: now, revision: 0,
    units: { length: "m", force: "kN", moment: "kN·m" },
    nodes: [], materials: [], sections: [], members: [], supports: [], nodalLoads: [], uniformLoads: [], selfWeight: { ...DEFAULT_SELF_WEIGHT, gravity: { ...DEFAULT_SELF_WEIGHT.gravity } },
    loadCases: DEFAULT_LOAD_CASES.map((item) => ({ ...item })), activeLoadCaseId: DEFAULT_LOAD_CASE, nextLoadCaseNumber: 2, analysisResults: [],
    loadCombinations: [], nextLoadCombinationNumber: 1,
    analysisCases: [], nextAnalysisCaseNumber: 1,
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
  return updateNodes(project, [{ id, position }]);
}

export function setNodeMass(project: FrameProject, id: NodeId, massKg: number): FrameProject {
  const value = validateAdditionalMass(massKg);
  if (!project.nodes.some((n) => n.id === id)) throw new Error(`节点 ${id} 不存在`);
  return { ...project, nodes: project.nodes.map((n) => n.id === id ? { ...n, additionalMassKg: value } : n), ...nextRevision(project) };
}

/** Validate the final geometry together, allowing endpoint swaps and rigid translations. */
export function updateNodes(project: FrameProject, updates: readonly { id: NodeId; position: Partial<Vector3> }[]): FrameProject {
  if (!updates.length) return project;
  const positions = new Map<NodeId, Vector3>();
  for (const { id, position } of updates) {
    const node = project.nodes.find((item) => item.id === id);
    if (!node) throw new Error(`节点 ${id} 不存在`);
    const next = { ...(positions.get(id) ?? node.position), ...position };
    assertFiniteVector(next); positions.set(id, next);
  }
  const nodes = project.nodes.map((node) => positions.has(node.id) ? { ...node, position: { ...positions.get(node.id)! } } : node);
  for (const member of project.members.filter((item) => positions.has(item.startNodeId) || positions.has(item.endNodeId))) {
    const start = nodes.find((node) => node.id === member.startNodeId)!;
    const end = nodes.find((node) => node.id === member.endNodeId)!;
    try { calculateMemberGeometry(start.position, end.position, member.rotationDegrees); }
    catch (error) { throw new Error(`节点修改会使杆件 ${member.label} 变为零长度或无效几何；${error instanceof Error ? error.message : "几何无效"}`); }
  }
  return { ...project, nodes, ...nextRevision(project) };
}

export function addMaterial(project: FrameProject, input: MaterialProperties, provenance: ResourceProvenance = { kind: "custom" }): FrameProject {
  assertCounter(project.nextMaterialNumber); const number = project.nextMaterialNumber;
  const material: FrameMaterial = { id: `material_${String(number).padStart(4, "0")}` as MaterialId, label: `M${number}`, ...validateMaterial(`M${number}`, input), provenance };
  return { ...project, materials: [...project.materials, material], nextMaterialNumber: number + 1, ...nextRevision(project) };
}

export function addCatalogMaterial(project: FrameProject, input: MaterialProperties, provenance: ResourceProvenance): FrameProject {
  if (provenance.kind !== "catalog" || !provenance.catalogId || !provenance.source) throw new Error("库材料缺少可追溯来源");
  return addMaterial(project, input, provenance);
}

export function updateMaterial(project: FrameProject, id: MaterialId, input: MaterialProperties): FrameProject {
  const current = project.materials.find((item) => item.id === id); if (!current) throw new Error(`材料 ${id} 不存在`);
  const properties = validateMaterial(current.label, input);
  const provenance = current.provenance.kind === "catalog" && current.provenance.catalogId && current.provenance.source
    ? { kind: "custom" as const, derivedFrom: { catalogId: current.provenance.catalogId, source: current.provenance.source } }
    : current.provenance;
  return { ...project, materials: project.materials.map((item) => item.id === id ? { ...item, ...properties, provenance } : item), ...nextRevision(project) };
}

export function addSection(project: FrameProject, input: SectionInput, provenance: ResourceProvenance = { kind: "custom" }): FrameProject {
  assertCounter(project.nextSectionNumber); const number = project.nextSectionNumber;
  const properties = validateSection(`S${number}`, input);
  if (properties.catalogBasis) provenance = { kind: "catalog", catalogId: properties.catalogBasis.catalogId, source: properties.catalogBasis.source };
  const section: FrameSection = { id: `section_${String(number).padStart(4, "0")}` as SectionId, label: `S${number}`, ...properties, provenance };
  return { ...project, sections: [...project.sections, section], nextSectionNumber: number + 1, ...nextRevision(project) };
}

export function addCatalogSection(project: FrameProject, input: SectionInput, provenance: ResourceProvenance): FrameProject {
  if (provenance.kind !== "catalog" || !provenance.catalogId || !provenance.source) throw new Error("库截面缺少可追溯来源");
  return addSection(project, input, provenance);
}

export function updateSection(project: FrameProject, id: SectionId, input: SectionInput): FrameProject {
  const current = project.sections.find((item) => item.id === id); if (!current) throw new Error(`截面 ${id} 不存在`);
  const properties = validateSection(current.label, input);
  const provenance = properties.catalogBasis ? { kind: "catalog" as const, catalogId: properties.catalogBasis.catalogId, source: properties.catalogBasis.source }
    : current.provenance.kind === "catalog" && current.provenance.catalogId && current.provenance.source
    ? { kind: "custom" as const, derivedFrom: { catalogId: current.provenance.catalogId, source: current.provenance.source } }
    : current.provenance;
  return { ...project, sections: project.sections.map((item) => item.id === id ? { ...item, geometry: undefined, parameterBasis: undefined, catalogBasis: undefined, ...properties, provenance } : item), ...nextRevision(project) };
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
    ...(changes.additionalLineMassKgM !== undefined || current.additionalLineMassKgM !== undefined ? { additionalLineMassKgM: changes.additionalLineMassKgM ?? current.additionalLineMassKgM } : {}),
    ...(changes.endReleases !== undefined || current.endReleases !== undefined ? { endReleases: changes.endReleases ?? current.endReleases } : {}),
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
  if (typeof input.loadCaseId !== "string" || !/^LC[1-9]\d*$/.test(input.loadCaseId)) throw new Error("荷载所属工况无效");
  if (!input.intensity || Object.keys(input.intensity).some((key) => !["x", "y", "z"].includes(key))) throw new Error("均布荷载必须是三个有限的力分量（kN/m）");
  if (![input.intensity.x, input.intensity.y, input.intensity.z].every(Number.isFinite)) throw new Error("均布荷载分量必须是有限数值（kN/m）");
  return { kind: "uniform", memberId: input.memberId, coordinateSystem: input.coordinateSystem, loadCaseId: input.loadCaseId, intensity: { ...input.intensity } };
}

export function validateSelfWeight(input: SelfWeightProperties): SelfWeightProperties {
  if (!input || typeof input.enabled !== "boolean") throw new Error("自重启用状态无效");
  if (typeof input.loadCaseId !== "string" || !/^LC[1-9]\d*$/.test(input.loadCaseId)) throw new Error("自重所属工况无效");
  if (!input.gravity || ![input.gravity.x, input.gravity.y, input.gravity.z].every(Number.isFinite)) throw new Error("重力加速度必须是有限数值（m/s²）");
  if (input.enabled && Math.hypot(input.gravity.x, input.gravity.y, input.gravity.z) <= 0) throw new Error("启用自重时重力加速度不能为零");
  return { enabled: input.enabled, loadCaseId: input.loadCaseId, gravity: { ...input.gravity } };
}

export const DEFAULT_SELF_WEIGHT: FrameSelfWeight = Object.freeze({ enabled: false, loadCaseId: DEFAULT_LOAD_CASE, gravity: Object.freeze({ x: 0, y: 0, z: -9.81 }) });

export function updateSelfWeight(project: FrameProject, input: SelfWeightProperties): FrameProject {
  requireLoadCase(project, input.loadCaseId);
  return { ...project, selfWeight: validateSelfWeight(input), ...nextRevision(project) };
}

export function addUniformLoad(project: FrameProject, input: UniformLoadProperties): FrameProject {
  requireLoadCase(project, input.loadCaseId);
  const properties = validateUniformLoad(input);
  if (!project.members.some((member) => member.id === properties.memberId)) throw new Error("均布荷载引用了不存在的杆件");
  assertCounter(project.nextUniformLoadNumber);
  const number = project.nextUniformLoadNumber;
  const load: FrameUniformLoad = { id: `uniform_load_${String(number).padStart(4, "0")}` as LoadId, label: `Q${number}`, ...properties };
  return { ...project, uniformLoads: [...project.uniformLoads, load], nextUniformLoadNumber: number + 1, ...nextRevision(project) };
}

export function updateUniformLoad(project: FrameProject, id: LoadId, input: UniformLoadProperties): FrameProject {
  requireLoadCase(project, input.loadCaseId);
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

export function addNodalLoad(project: FrameProject, nodeId: NodeId, force: Vector3, moment: Vector3, loadCaseId = project.activeLoadCaseId): FrameProject {
  requireLoadCase(project, loadCaseId);
  requireProjectNode(project, nodeId, "节点荷载"); assertFiniteVector(force); assertFiniteVector(moment); assertCounter(project.nextLoadNumber);
  const number = project.nextLoadNumber;
  const load: FrameNodalLoad = { id: `load_${String(number).padStart(4, "0")}` as LoadId, label: `L${number}`, nodeId, loadCaseId, force: { ...force }, moment: { ...moment } };
  return { ...project, nodalLoads: [...project.nodalLoads, load], nextLoadNumber: number + 1, ...nextRevision(project) };
}

export function updateNodalLoad(project: FrameProject, id: LoadId, nodeId: NodeId, force: Vector3, moment: Vector3, loadCaseId?: string): FrameProject {
  const current = project.nodalLoads.find((load) => load.id === id); if (!current) throw new Error(`节点荷载 ${id} 不存在`);
  requireLoadCase(project, loadCaseId ?? current.loadCaseId);
  requireProjectNode(project, nodeId, current.label); assertFiniteVector(force); assertFiniteVector(moment);
  return { ...project, nodalLoads: project.nodalLoads.map((load) => load.id === id ? { ...load, nodeId, loadCaseId: loadCaseId ?? current.loadCaseId, force: { ...force }, moment: { ...moment } } : load), ...nextRevision(project) };
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
  const sourceId = getAnalysisSourceId(result.input);
  if (result.input.analysisCase) requireAnalysisCase(project, sourceId);
  else if (result.input.combination) requireLoadCombination(project, sourceId);
  else requireLoadCase(project, sourceId);
  // Keep every completed run so a later model revision can be compared with its predecessor.
  // Replaying the same run id replaces only that immutable record.
  const analysisResults = [...project.analysisResults.filter((item) => item.id !== result.id), result];
  return { ...project, latestAnalysis: result, analysisResults, ...nextRevision(project) };
}

export function getAnalysisSourceId(input: AnalysisResult["input"]): string {
  return input.analysisCase?.id ?? input.combination?.definition.id ?? getAnalysisLoadCaseId(input);
}

export function validateLoadCombination(project: Pick<FrameProject, "loadCases">, input: FrameLoadCombination): FrameLoadCombination {
  if (!input || typeof input.id !== "string" || !/^CB[1-9]\d*$/.test(input.id) || !Number.isSafeInteger(Number(input.id.slice(2)))) throw new Error("组合标识无效");
  if (typeof input.name !== "string" || !input.name.trim()) throw new Error("组合名称不能为空");
  if (!Array.isArray(input.terms) || !input.terms.length) throw new Error("组合至少需要一个工况");
  const ids = new Set<string>();
  const terms = input.terms.map((term) => {
    if (!term || typeof term.loadCaseId !== "string" || typeof term.factor !== "number" || !Number.isFinite(term.factor)) throw new Error("组合系数必须为有限数值（无量纲）");
    requireLoadCase(project, term.loadCaseId);
    if (ids.has(term.loadCaseId)) throw new Error("组合不能重复引用同一工况");
    ids.add(term.loadCaseId);
    return { loadCaseId: term.loadCaseId, factor: term.factor };
  });
  return { id: input.id, name: input.name.trim(), terms };
}

export function requireLoadCombination(project: Pick<FrameProject, "loadCombinations">, id: string): FrameLoadCombination {
  const item = project.loadCombinations.find((item) => item.id === id);
  if (!item) throw new Error(`组合 ${id} 不存在`);
  return item;
}

export function addLoadCombination(project: FrameProject, name: string, terms: LoadCombinationTerm[]): FrameProject {
  assertCounter(project.nextLoadCombinationNumber);
  const item = validateLoadCombination(project, { id: `CB${project.nextLoadCombinationNumber}`, name, terms });
  return { ...project, loadCombinations: [...project.loadCombinations, item], nextLoadCombinationNumber: project.nextLoadCombinationNumber + 1, ...nextRevision(project) };
}

export function updateLoadCombination(project: FrameProject, id: string, name: string, terms: LoadCombinationTerm[]): FrameProject {
  requireLoadCombination(project, id);
  const item = validateLoadCombination(project, { id, name, terms });
  return { ...project, loadCombinations: project.loadCombinations.map((current) => current.id === id ? item : current), ...nextRevision(project) };
}

export function selectLoadCombination(project: FrameProject, id: string): FrameProject {
  requireLoadCombination(project, id);
  return { ...project, activeLoadCombinationId: id, activeAnalysisCaseId: undefined };
}

export function deleteLoadCombination(project: FrameProject, id: string): FrameProject {
  requireLoadCombination(project, id);
  return { ...project, loadCombinations: project.loadCombinations.filter((item) => item.id !== id), activeLoadCombinationId: project.activeLoadCombinationId === id ? undefined : project.activeLoadCombinationId,
    analysisCases: project.analysisCases.filter((item) => item.loadSourceId !== id),
    activeAnalysisCaseId: project.analysisCases.find((item) => item.id === project.activeAnalysisCaseId)?.loadSourceId === id ? undefined : project.activeAnalysisCaseId,
    ...nextRevision(project) };
}

export function requireLoadCase(project: Pick<FrameProject, "loadCases">, id: string): FrameLoadCase {
  const item = project.loadCases.find((item) => item.id === id);
  if (!item) throw new Error(`工况 ${id} 不存在`);
  return item;
}

export function addLoadCase(project: FrameProject, name: string, description = ""): FrameProject {
  assertCounter(project.nextLoadCaseNumber);
  const id = `LC${project.nextLoadCaseNumber}`;
  const item = { id, name: cleanName(name, "工况名称不能为空"), description: description.trim() };
  return { ...project, loadCases: [...project.loadCases, item], nextLoadCaseNumber: project.nextLoadCaseNumber + 1, ...nextRevision(project) };
}

export function updateLoadCase(project: FrameProject, id: string, name: string, description: string): FrameProject {
  requireLoadCase(project, id);
  const item = { id, name: cleanName(name, "工况名称不能为空"), description: description.trim() };
  return { ...project, loadCases: project.loadCases.map((current) => current.id === id ? item : current), ...nextRevision(project) };
}

export function selectLoadCase(project: FrameProject, id: string): FrameProject {
  requireLoadCase(project, id);
  return { ...project, activeLoadCaseId: id, activeLoadCombinationId: undefined, activeAnalysisCaseId: undefined };
}

function analysisCaseUsesLoadCase(project: FrameProject, item: FrameAnalysisCase, id: string): boolean {
  if (item.method === "buckling") return [...item.settings.buckling!.fixed, ...item.settings.buckling!.reference].some((t) => t.loadCaseId === id);
  return item.loadSourceId === id || project.loadCombinations.some((c) => c.id === item.loadSourceId && c.terms.some((t) => t.loadCaseId === id));
}

export function getLoadCaseReferences(project: FrameProject, id: string): { loads: number; results: number; combinations: number; analyses: number } {
  return { loads: project.nodalLoads.filter((load) => load.loadCaseId === id).length + project.uniformLoads.filter((load) => load.loadCaseId === id).length + Number(project.selfWeight.enabled && project.selfWeight.loadCaseId === id), results: project.analysisResults.filter((result) => result.input.bucklingLoads ? [...result.input.analysisCase!.settings.buckling!.fixed, ...result.input.analysisCase!.settings.buckling!.reference].some((t) => t.loadCaseId === id) : !result.input.combination && getAnalysisLoadCaseId(result.input) === id || result.input.combination?.definition.terms.some((term) => term.loadCaseId === id)).length,
    combinations: project.loadCombinations.filter((item) => item.terms.some((term) => term.loadCaseId === id)).length,
    analyses: project.analysisCases.filter((item) => analysisCaseUsesLoadCase(project, item, id)).length };
}

export function deleteLoadCase(project: FrameProject, id: string, removeReferences = false): FrameProject {
  requireLoadCase(project, id);
  if (project.loadCases.length === 1) throw new Error("至少保留一个荷载工况");
  const refs = getLoadCaseReferences(project, id);
  if ((refs.loads || refs.results || refs.combinations || refs.analyses) && !removeReferences) throw new Error(`工况 ${id} 仍被 ${refs.loads} 条荷载、${refs.results} 份结果、${refs.combinations} 个组合引用，请先处理引用`);
  const loadCases = project.loadCases.filter((item) => item.id !== id);
  const activeLoadCaseId = project.activeLoadCaseId === id ? loadCases[0].id : project.activeLoadCaseId;
  const selfWeight = project.selfWeight.loadCaseId === id ? { ...project.selfWeight, enabled: false, loadCaseId: loadCases[0].id } : project.selfWeight;
  const removedIds = new Set(project.loadCombinations.filter((item) => item.terms.some((term) => term.loadCaseId === id)).map((item) => item.id));
  removedIds.add(id);
  const analysisCases = project.analysisCases.filter((item) => !analysisCaseUsesLoadCase(project, item, id));
  return { ...project, loadCases, activeLoadCaseId, selfWeight,
    analysisCases,
    activeAnalysisCaseId: analysisCases.some((item) => item.id === project.activeAnalysisCaseId) ? project.activeAnalysisCaseId : undefined,
    loadCombinations: project.loadCombinations.filter((item) => !removedIds.has(item.id)), activeLoadCombinationId: project.activeLoadCombinationId && removedIds.has(project.activeLoadCombinationId) ? undefined : project.activeLoadCombinationId,
    nodalLoads: project.nodalLoads.filter((load) => load.loadCaseId !== id), uniformLoads: project.uniformLoads.filter((load) => load.loadCaseId !== id), ...nextRevision(project) };
}

export function validateAnalysisCase(project: Pick<FrameProject, "loadCases" | "loadCombinations">, value: FrameAnalysisCase): FrameAnalysisCase {
  if (!value || typeof value.id !== "string" || !/^AC[1-9]\d*$/.test(value.id) || !Number.isSafeInteger(Number(value.id.slice(2)))) throw new Error("分析工况标识无效");
  requireAnalysisCapability(value.method);
  if (typeof value.name !== "string" || !value.name.trim()) throw new Error("分析工况名称不能为空");
  if (value.method === "second-order") {
    if (!value.settings || value.settings.solver !== "native-second-order" || Object.keys(value.settings).sort().join() !== "secondOrder,solver" || value.damping !== undefined || value.legacySourceId !== undefined) throw new Error("二阶须使用独立加载与求解设置");
    if (!project.loadCombinations.some((c) => c.id === value.loadSourceId)) requireLoadCase(project, value.loadSourceId);
    return { id: value.id, name: value.name.trim(), method: value.method, loadSourceId: value.loadSourceId, settings: { solver: "native-second-order", secondOrder: validateSecondOrderSettings(value.settings.secondOrder) } };
  }
  if (value.method === "buckling") {
    if (value.loadSourceId !== "buckling" || value.legacySourceId !== undefined || value.damping !== undefined || !value.settings || value.settings.solver !== "native-buckling" || Object.keys(value.settings).sort().join() !== "buckling,solver") throw new Error("屈曲须独立指定固定／参考荷载与求解设置");
    return { id: value.id, name: value.name.trim(), method: "buckling", loadSourceId: "buckling", settings: { solver: "native-buckling", buckling: validateBucklingSettings(project, value.settings.buckling) } };
  }
  if (value.method === "modal") {
    if (value.loadSourceId !== "structure" || value.legacySourceId !== undefined || !value.settings || value.settings.solver !== "native-modal" || Object.keys(value.settings).some((key) => !["solver", "modal"].includes(key))) throw new Error("模态仅使用结构质量，不接受荷载来源或静力设置");
    return { id: value.id, name: value.name.trim(), method: "modal", loadSourceId: "structure", settings: { solver: "native-modal", modal: validateModalSettings(value.settings.modal) }, ...(value.damping === undefined ? {} : { damping: validateModalDampingBinding(value.damping) }) };
  }
  if (!value.settings || value.settings.solver !== "native-static" || Object.keys(value.settings).some((key) => !["solver", "mesh"].includes(key))) throw new Error("分析工况数值设置不受支持");
  if (value.damping !== undefined) throw new Error("静力工况不接受模态阻尼");
  if (project.loadCombinations.some((item) => item.id === value.loadSourceId)) requireAnalysisCapability(value.method, "loadCombination");
  else requireLoadCase(project, value.loadSourceId);
  if (value.legacySourceId !== undefined && value.legacySourceId !== value.loadSourceId) throw new Error("旧分析工况映射无效");
  const mesh = value.settings.mesh === undefined ? undefined : validateMeshPolicy(value.settings.mesh);
  return { id: value.id, name: value.name.trim(), method: value.method, loadSourceId: value.loadSourceId, settings: { solver: "native-static", ...(mesh ? { mesh } : {}) }, ...(value.legacySourceId ? { legacySourceId: value.legacySourceId } : {}) };
}

export function addAnalysisCase(project: FrameProject, properties: Omit<FrameAnalysisCase, "id" | "legacySourceId">): FrameProject {
  assertCounter(project.nextAnalysisCaseNumber);
  const item = validateAnalysisCase(project, { ...properties, id: `AC${project.nextAnalysisCaseNumber}` });
  return { ...project, analysisCases: [...project.analysisCases, item], nextAnalysisCaseNumber: project.nextAnalysisCaseNumber + 1, ...nextRevision(project) };
}

export function updateAnalysisCase(project: FrameProject, id: string, properties: Omit<FrameAnalysisCase, "id" | "legacySourceId">): FrameProject {
  const previous = requireAnalysisCase(project, id);
  const item = validateAnalysisCase(project, { ...properties, id, ...(properties.method === "modal" && previous.damping && properties.damping === undefined ? { damping: previous.damping } : {}), ...(previous.loadSourceId === properties.loadSourceId && previous.legacySourceId ? { legacySourceId: previous.legacySourceId } : {}) });
  const next = { ...project, analysisCases: project.analysisCases.map((c) => c.id === id ? item : c), ...nextRevision(project) };
  return project.activeAnalysisCaseId === id ? selectAnalysisCase(next, id) : next;
}

export function requireAnalysisCase(project: Pick<FrameProject, "analysisCases">, id: string): FrameAnalysisCase {
  const item = project.analysisCases.find((c) => c.id === id);
  if (!item) throw new Error(`分析工况 ${id} 不存在`);
  return item;
}

export function selectAnalysisCase(project: FrameProject, id: string): FrameProject {
  const item = requireAnalysisCase(project, id);
  if (item.method === "modal" || item.method === "buckling") return { ...project, activeAnalysisCaseId: id, activeLoadCombinationId: undefined };
  const selected = project.loadCombinations.some((c) => c.id === item.loadSourceId) ? selectLoadCombination(project, item.loadSourceId) : selectLoadCase(project, item.loadSourceId);
  return { ...selected, activeAnalysisCaseId: id };
}

export function selectAnalysisSource(project: FrameProject, id: string): FrameProject {
  if (project.analysisCases.some((c) => c.id === id)) return selectAnalysisCase(project, id);
  return project.loadCombinations.some((c) => c.id === id) ? selectLoadCombination(project, id) : selectLoadCase(project, id);
}

export function deleteAnalysisCase(project: FrameProject, id: string): FrameProject {
  requireAnalysisCase(project, id);
  return { ...project, analysisCases: project.analysisCases.filter((c) => c.id !== id), activeAnalysisCaseId: project.activeAnalysisCaseId === id ? undefined : project.activeAnalysisCaseId, ...nextRevision(project) };
}
