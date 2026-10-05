import { decodeAnalysisRun } from "./analysis-service-contract";
import {
  validateAnalysisCase,
  selectAnalysisCase,
  type FrameAnalysisCase,
  PROJECT_FORMAT,
  PROJECT_FORMAT_VERSION,
  validateMaterial,
  validateMember,
  validateSection,
  validateSelfWeight,
  DEFAULT_SELF_WEIGHT,
  DEFAULT_LOAD_CASE,
  DEFAULT_LOAD_CASES,
  getAnalysisLoadCaseId,
  validateLoadCombination,
  requireLoadCombination,
  type FrameLoadCombination,
  requireLoadCase,
  type FrameLoadCase,
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
  type FrameSelfWeight,
  type ResourceProvenance,
  type CatalogSource,
} from "./project";
import { ANALYSIS_DOF_ORDER, NATIVE_ANALYSIS_SOLVER, NATIVE_STATIC_SOLVER, isNativeSolver, sameInputValue, freezeAnalysisInput, validateCombinationInput, type AnalysisInputSnapshot, type AnalysisProcessSnapshot, type AnalysisResult, type CombinationCaseInput } from "./analysis";
import { decodeTaskState, decodeConfirmedOperations } from "../workspace/task-persistence";
import { redactPersistence } from "../../electron/persistence-redaction";

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

function decodeCatalogSource(value: unknown, label: string): CatalogSource {
  if (!isRecord(value)) throw new Error(`${label}来源信息无效`);
  return {
    publisher: requireString(value.publisher, `${label}来源缺少发布者`),
    title: requireString(value.title, `${label}来源缺少标题`),
    edition: requireString(value.edition, `${label}来源缺少版本`),
    url: requireString(value.url, `${label}来源缺少链接`),
    accessedOn: requireString(value.accessedOn, `${label}来源缺少核对日期`),
    units: requireString(value.units, `${label}来源缺少单位说明`),
  };
}

function decodeProvenance(value: unknown, label: string): ResourceProvenance {
  if (value === undefined) return { kind: "custom" };
  if (!isRecord(value) || (value.kind !== "catalog" && value.kind !== "custom")) throw new Error(`${label}来源类型无效`);
  const catalogId = value.catalogId === undefined ? undefined : requireString(value.catalogId, `${label}库编号无效`);
  const source = value.source === undefined ? undefined : decodeCatalogSource(value.source, label);
  if (value.kind === "catalog" && (!catalogId || !source)) throw new Error(`${label}库来源必须包含库编号与来源`);
  let derivedFrom: ResourceProvenance["derivedFrom"];
  if (value.derivedFrom !== undefined) {
    if (!isRecord(value.derivedFrom)) throw new Error(`${label}派生来源无效`);
    derivedFrom = { catalogId: requireString(value.derivedFrom.catalogId, `${label}派生库编号无效`), source: decodeCatalogSource(value.derivedFrom.source, label) };
  }
  return { kind: value.kind, ...(catalogId ? { catalogId } : {}), ...(source ? { source } : {}), ...(derivedFrom ? { derivedFrom } : {}) };
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
    provenance: decodeProvenance(value.provenance, `材料 ${label}`),
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
    provenance: decodeProvenance(value.provenance, `截面 ${label}`),
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
  return { id: id as LoadId, label, nodeId, loadCaseId: value.loadCaseId === undefined ? DEFAULT_LOAD_CASE : requireString(value.loadCaseId, "节点荷载缺少所属工况"), force: decodeVector(value.force, "力"), moment: decodeVector(value.moment, "力矩") };
}

function decodeLoadCase(value: unknown): FrameLoadCase {
  if (!isRecord(value)) throw new Error("项目包含无效工况");
  const id = requireString(value.id, "工况缺少稳定标识");
  if (!/^LC[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id.slice(2)))) throw new Error("工况标识无效");
  const name = requireString(value.name, "工况名称不能为空").trim();
  if (!name || typeof value.description !== "string") throw new Error("工况名称或说明无效");
  return { id, name, description: value.description };
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

function decodeSelfWeight(value: unknown, fallback = DEFAULT_SELF_WEIGHT): FrameSelfWeight {
  if (value === undefined) return { ...fallback, gravity: { ...fallback.gravity } };
  if (!isRecord(value)) throw new Error("项目包含无效自重设置");
  const gravity = value.gravity;
  if (!isRecord(gravity)) throw new Error("自重缺少重力加速度");
  if (typeof value.enabled !== "boolean") throw new Error("自重启用状态无效");
  return validateSelfWeight({ enabled: value.enabled, loadCaseId: requireString(value.loadCaseId, "自重缺少所属工况"), gravity: { x: requireFinite(gravity.x, "重力加速度 X 无效"), y: requireFinite(gravity.y, "重力加速度 Y 无效"), z: requireFinite(gravity.z, "重力加速度 Z 无效") } });
}

function isSolverAlgorithm(value: unknown): value is "partial-pivot-gaussian" | "sparse-ldlt" {
  return value === "partial-pivot-gaussian" || value === "sparse-ldlt";
}

function decodeAnalysisInput(input: Record<string, unknown>, projectId: string, projectRevision: number): AnalysisInputSnapshot {
  if (input.solver !== undefined && (!isRecord(input.solver) || typeof input.solver.implementation !== "string" || input.solver.implementation.length === 0 || !isSolverAlgorithm(input.solver.algorithm) || input.solver.constraints !== "free-dof-elimination" || typeof input.solver.relativePivotTolerance !== "number" || !Number.isFinite(input.solver.relativePivotTolerance) || input.solver.relativePivotTolerance <= 0 || input.solver.relativePivotTolerance >= 1)) throw new Error("分析结果求解器配置无效");
  if (input.projectId !== projectId || input.projectRevision !== projectRevision || !Array.isArray(input.nodes) || !Array.isArray(input.members) || !Array.isArray(input.materials) || !Array.isArray(input.sections) || !Array.isArray(input.supports) || !Array.isArray(input.nodalLoads) || !Array.isArray(input.dofOrder) || input.dofOrder.join(",") !== "ux,uy,uz,rx,ry,rz" || !isRecord(input.assumptions) || input.assumptions.theory !== "3d-euler-bernoulli-frame" || input.assumptions.shearDeformation !== "neglected" || input.assumptions.rigidJoints !== true || input.assumptions.units !== "m-kN-kN·m" || input.assumptions.localAxis !== "member-geometry") throw new Error("分析结果输入来源无效");
  const inputNodes = input.nodes.map(decodeNode); const inputMaterials = input.materials.map(decodeMaterial); const inputSections = input.sections.map(decodeSection); const inputMembers = input.members.map(decodeMember); const inputSupports = input.supports.map(decodeSupport); const inputLoads = input.nodalLoads.map(decodeNodalLoad);
  assertUnique(inputNodes, "分析输入节点"); assertUnique(inputMaterials, "分析输入材料"); assertUnique(inputSections, "分析输入截面"); assertUnique(inputMembers, "分析输入杆件"); assertUnique(inputSupports, "分析输入支座"); assertUnique(inputLoads, "分析输入节点荷载");
  assertUniqueLabels(inputNodes, "分析输入节点"); assertUniqueLabels(inputMaterials, "分析输入材料"); assertUniqueLabels(inputSections, "分析输入截面"); assertUniqueLabels(inputMembers, "分析输入杆件"); assertUniqueLabels(inputSupports, "分析输入支座"); assertUniqueLabels(inputLoads, "分析输入节点荷载");
  const inputNodeIds = new Set(inputNodes.map((node) => node.id)); const inputMaterialIds = new Set(inputMaterials.map((material) => material.id)); const inputSectionIds = new Set(inputSections.map((section) => section.id));
  const inputUniformLoads = decodeOptionalArray(input.uniformLoads, "分析输入均布荷载", decodeUniformLoad);
  const inputSelfWeight = decodeSelfWeight(input.selfWeight);
  const loadCase = input.loadCase === undefined ? undefined : decodeLoadCase(input.loadCase);
  const loadCaseId = getAnalysisLoadCaseId({ loadCase });
  if ([...inputLoads, ...inputUniformLoads].some((load) => load.loadCaseId !== loadCaseId) || inputSelfWeight.loadCaseId !== loadCaseId) throw new Error("分析结果荷载与来源工况不一致");
  assertUnique(inputUniformLoads, "分析输入均布荷载"); assertUniqueLabels(inputUniformLoads, "分析输入均布荷载");
  for (const load of inputUniformLoads) if (!inputMembers.some((member) => member.id === load.memberId)) throw new Error("分析结果均布荷载引用无效");
  for (const member of inputMembers) if (!inputNodeIds.has(member.startNodeId) || !inputNodeIds.has(member.endNodeId) || !inputMaterialIds.has(member.materialId) || !inputSectionIds.has(member.sectionId)) throw new Error("分析结果杆件引用无效");
  for (const support of inputSupports) if (!inputNodeIds.has(support.nodeId)) throw new Error("分析结果支座引用无效");
  for (const load of inputLoads) if (!inputNodeIds.has(load.nodeId)) throw new Error("分析结果节点荷载引用无效");
  let combination: AnalysisInputSnapshot["combination"];
  if (input.combination !== undefined) {
    if (!isRecord(input.combination) || !Array.isArray(input.combination.cases)) throw new Error("组合来源无效");
    const cases: CombinationCaseInput[] = input.combination.cases.map((source) => {
      if (!isRecord(source) || Object.keys(source).some((key) => !["loadCase", "nodalLoads", "uniformLoads", "selfWeight"].includes(key)) || !Array.isArray(source.nodalLoads) || !Array.isArray(source.uniformLoads) || !isRecord(source.selfWeight)) throw new Error("组合工况必须共享同一结构基础，且完整记录原始荷载");
      return { loadCase: decodeLoadCase(source.loadCase), nodalLoads: source.nodalLoads.map(decodeNodalLoad), uniformLoads: source.uniformLoads.map(decodeUniformLoad), selfWeight: decodeSelfWeight(source.selfWeight) };
    });
    combination = { definition: decodeLoadCombination(input.combination.definition, cases.map((source) => source.loadCase)), cases };
  }
  const analysisCase = input.analysisCase === undefined ? undefined : decodeAnalysisCase(input.analysisCase, { loadCases: loadCase ? [loadCase] : [], loadCombinations: combination ? [combination.definition] : [] });
  if (analysisCase && analysisCase.loadSourceId !== (combination?.definition.id ?? loadCase?.id)) throw new Error("分析工况与冻结荷载来源不一致");
  const decoded = { ...input, analysisCase, loadCase, nodes: inputNodes, materials: inputMaterials, sections: inputSections, members: inputMembers, supports: inputSupports, nodalLoads: inputLoads, uniformLoads: inputUniformLoads, selfWeight: inputSelfWeight, combination } as AnalysisInputSnapshot;
  validateCombinationInput(decoded);
  return freezeAnalysisInput(decoded);
}

function decodeAnalysisCase(value: unknown, project: Pick<FrameProject, "loadCases" | "loadCombinations">): FrameAnalysisCase {
  if (!isRecord(value) || Object.keys(value).some((key) => !["id", "name", "method", "loadSourceId", "settings", "legacySourceId"].includes(key))) throw new Error("分析工况定义无效");
  return validateAnalysisCase(project, value as unknown as FrameAnalysisCase);
}

function decodeLoadCombination(value: unknown, loadCases: FrameLoadCase[]): FrameLoadCombination {
  if (!isRecord(value)) throw new Error("组合定义无效");
  return validateLoadCombination({ loadCases }, value as unknown as FrameLoadCombination);
}

function decodeAnalysisProcess(value: unknown, input: AnalysisInputSnapshot): AnalysisProcessSnapshot | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isRecord(value.solver) || !isSolverAlgorithm(value.solver.algorithm) || value.solver.constraints !== "free-dof-elimination") throw new Error("分析整体过程配置无效");
  const solver = value.solver;
  if (typeof solver.implementation !== "string" || solver.implementation.length === 0 || typeof solver.relativePivotTolerance !== "number" || !Number.isFinite(solver.relativePivotTolerance) || solver.relativePivotTolerance <= 0 || solver.relativePivotTolerance >= 1) throw new Error("分析整体过程求解器配置无效");
  if (!Array.isArray(value.dofOrder) || value.dofOrder.join(",") !== ANALYSIS_DOF_ORDER.join(",") || !Array.isArray(value.dofs) || value.dofs.length !== input.nodes.length * 6) throw new Error("分析整体过程自由度记录无效");
  const inputNodeIds = new Set(input.nodes.map((node) => node.id));
  const dofs = value.dofs.map((item, index) => {
    if (!isRecord(item) || typeof item.nodeId !== "string" || !ANALYSIS_DOF_ORDER.includes(item.dof as typeof ANALYSIS_DOF_ORDER[number]) || item.globalIndex !== index || typeof item.restrained !== "boolean") throw new Error("分析整体过程自由度映射无效");
    const nodeId = item.nodeId as typeof input.nodes[number]["id"];
    if (!inputNodeIds.has(nodeId)) throw new Error("分析整体过程自由度映射无效");
    return { nodeId, dof: item.dof as typeof ANALYSIS_DOF_ORDER[number], globalIndex: index, restrained: item.restrained };
  });
  const matrix = (matrixValue: unknown, label: string, size: number): number[][] | null => {
    if (matrixValue === null) return null;
    if (!Array.isArray(matrixValue) || matrixValue.length !== size || matrixValue.some((row) => !Array.isArray(row) || row.length !== size || !row.every((entry) => typeof entry === "number" && Number.isFinite(entry)))) throw new Error(`${label}矩阵无效`);
    return matrixValue.map((row) => [...row] as number[]);
  };
  if (!Array.isArray(value.members) || !Array.isArray(value.loadVector) || !value.loadVector.every((entry) => typeof entry === "number" && Number.isFinite(entry)) || value.loadVector.length !== input.nodes.length * 6 || !Array.isArray(value.constrainedDofs) || !Array.isArray(value.freeDofs) || typeof value.matrixLimit !== "number" || !Number.isSafeInteger(value.matrixLimit) || value.matrixLimit <= 0) throw new Error("分析整体过程组装记录无效");
  const loadVector = value.loadVector as number[];
  const matrixLimit = value.matrixLimit as number;
  const memberIds = new Set(input.members.map((member) => member.id));
  const members = value.members.map((item) => {
    if (!isRecord(item) || typeof item.memberId !== "string" || !Array.isArray(item.globalDofIndices) || item.globalDofIndices.length !== 12 || !item.globalDofIndices.every((index) => Number.isSafeInteger(index) && index >= 0 && index < input.nodes.length * 6) || !Array.isArray(item.dofs) || item.dofs.length !== 12 || !Array.isArray(item.equivalentGlobalForces) || item.equivalentGlobalForces.length !== 12 || !item.equivalentGlobalForces.every((entry) => typeof entry === "number" && Number.isFinite(entry))) throw new Error("分析整体过程杆件组装记录无效");
    const memberId = item.memberId as typeof input.members[number]["id"];
    if (!memberIds.has(memberId)) throw new Error("分析整体过程杆件组装记录无效");
    const memberDofs = item.dofs.map((dof) => {
      if (!isRecord(dof) || typeof dof.nodeId !== "string" || !ANALYSIS_DOF_ORDER.includes(dof.dof as typeof ANALYSIS_DOF_ORDER[number]) || !Number.isSafeInteger(dof.globalIndex) || typeof dof.restrained !== "boolean") throw new Error("分析整体过程杆件自由度映射无效");
      const nodeId = dof.nodeId as typeof input.nodes[number]["id"]; const globalIndex = dof.globalIndex as number;
      if (!inputNodeIds.has(nodeId)) throw new Error("分析整体过程杆件自由度映射无效");
      return { nodeId, dof: dof.dof as typeof ANALYSIS_DOF_ORDER[number], globalIndex, restrained: dof.restrained };
    });
    const globalStiffness = matrix(item.globalStiffness, "分析整体过程单元刚度", 12);
    if (!globalStiffness) throw new Error("分析整体过程单元刚度矩阵无效");
    return { memberId, dofs: memberDofs, globalDofIndices: [...item.globalDofIndices] as number[], globalStiffness, equivalentGlobalForces: [...item.equivalentGlobalForces] as number[] };
  });
  const indices = (items: unknown[], label: string) => { if (!items.every((index) => Number.isSafeInteger(index) && (index as number) >= 0 && (index as number) < input.nodes.length * 6)) throw new Error(`${label}索引无效`); return [...items] as number[]; };
  const constrainedDofs = indices(value.constrainedDofs, "分析整体过程约束自由度"); const freeDofs = indices(value.freeDofs, "分析整体过程自由自由度");
  return { solver: { implementation: solver.implementation, algorithm: solver.algorithm as "partial-pivot-gaussian" | "sparse-ldlt", constraints: "free-dof-elimination", relativePivotTolerance: solver.relativePivotTolerance }, dofOrder: [...ANALYSIS_DOF_ORDER], dofs, members, loadVector: [...loadVector], constrainedDofs, freeDofs, assembledStiffness: matrix(value.assembledStiffness, "分析整体过程整体刚度", input.nodes.length * 6), reducedStiffness: matrix(value.reducedStiffness, "分析整体过程约束后刚度", freeDofs.length), matrixLimit };
}

export function decodeAnalysisResult(value: unknown): AnalysisResult {
  if (!isRecord(value) || value.status !== "complete") throw new Error("项目包含无效分析结果");
  const id = requireString(value.id, "分析结果缺少稳定标识"); const projectId = requireString(value.projectId, "分析结果缺少项目标识"); const createdAt = requireString(value.createdAt, "分析结果缺少创建时间");
  const projectRevision = requireFinite(value.projectRevision, "分析结果版本无效");
  if (!Number.isSafeInteger(projectRevision) || projectRevision < 0 || !Array.isArray(value.nodes) || !Array.isArray(value.members) || !isRecord(value.input)) throw new Error("项目包含无效分析结果");
  const input = decodeAnalysisInput(value.input, projectId, projectRevision);
  const inputNodes = input.nodes; const inputMembers = input.members;
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
    let nativeResponses;
    if (member.nativeResponses !== undefined) {
      if (!isNativeSolver(input.solver) || !Array.isArray(member.nativeResponses) || member.nativeResponses.length !== 17) throw new Error("原生沿杆结果无效");
      nativeResponses = member.nativeResponses.map((sample, index) => {
        if (!isRecord(sample) || typeof sample.position !== "number" || !Number.isFinite(sample.position) || Math.abs(sample.position - length * index / 16) > 1e-12 * length) throw new Error("原生沿杆位置无效");
        return { position: sample.position, forces: forceVector(sample.forces, "沿杆内力"), localDisplacement: finiteVector(sample.localDisplacement, "沿杆局部位移"), globalDisplacement: finiteVector(sample.globalDisplacement, "沿杆总体位移") };
      });
    }
    return { memberId: requireString(member.memberId, "分析结果杆件缺少标识"), length, localAxes: { x: finiteVector(localAxes.x, "局部轴"), y: finiteVector(localAxes.y, "局部轴"), z: finiteVector(localAxes.z, "局部轴") }, localEndForces: { start: forceVector(endForces.start, "杆端内力"), end: forceVector(endForces.end, "杆端内力") }, ...(nativeResponses ? { nativeResponses } : {}) };
  });
  const nodeResultIds = new Set(inputNodes.map((node) => String(node.id))); const memberResultIds = new Set(inputMembers.map((member) => String(member.id)));
  const resultNodeIds = new Set(nodes.map((node) => node.nodeId)); const resultMemberIds = new Set(members.map((member) => member.memberId));
  if (nodes.length !== inputNodes.length || members.length !== inputMembers.length || resultNodeIds.size !== nodes.length || resultMemberIds.size !== members.length || nodes.some((node) => !nodeResultIds.has(node.nodeId)) || members.some((member) => !memberResultIds.has(member.memberId))) throw new Error("分析结果对象引用无效");
  const process = decodeAnalysisProcess(value.process, input), service = decodeAnalysisRun(value.service, input, id);
  if (input.solver?.implementation === NATIVE_ANALYSIS_SOLVER.implementation || input.solver?.implementation === NATIVE_STATIC_SOLVER.implementation) {
    const legacy = input.solver.implementation === NATIVE_ANALYSIS_SOLVER.implementation;
    if (!isNativeSolver(input.solver) || legacy && (inputNodes.length !== 2 || inputMembers.length !== 1 || input.uniformLoads?.length || input.selfWeight?.enabled)
      || !service || !process || !sameInputValue(process.solver, input.solver)
      || process.matrixLimit !== 72 || inputNodes.length * 6 <= 72 && !process.assembledStiffness
      || process.freeDofs.length <= 72 && !process.reducedStiffness || process.members.length !== inputMembers.length
      || members.some((member) => !member.nativeResponses)) throw new Error("原生分析缺少完整实际过程或恢复记录");
    const expectedDofs = inputNodes.flatMap((node, nodeIndex) => ANALYSIS_DOF_ORDER.map((dof, index) => ({
      nodeId: node.id, dof, globalIndex: nodeIndex * 6 + index,
      restrained: input.supports.some((support) => support.nodeId === node.id && support.restraints[index]),
    })));
    const expectedFree = expectedDofs.filter((dof) => !dof.restrained).map((dof) => dof.globalIndex);
    const expectedConstrained = expectedDofs.filter((dof) => dof.restrained).map((dof) => dof.globalIndex);
    if (legacy && !expectedFree.length || !sameInputValue(process.dofs, expectedDofs) || !sameInputValue(process.freeDofs, expectedFree)
      || !sameInputValue(process.constrainedDofs, expectedConstrained)) throw new Error("原生分析自由度分区或对象映射不完整");
    for (const [index, member] of inputMembers.entries()) {
      const contribution = process.members[index];
      const expectedIndices = [member.startNodeId, member.endNodeId].flatMap((nodeId) => ANALYSIS_DOF_ORDER.map((_, dof) => inputNodes.findIndex((node) => node.id === nodeId) * 6 + dof));
      if (contribution.memberId !== member.id || !sameInputValue(contribution.globalDofIndices, expectedIndices)
        || !sameInputValue(contribution.dofs, expectedIndices.map((dof) => expectedDofs[dof]))) throw new Error("原生分析自由度分区或对象映射不完整");
    }
  }
  return { id, projectId, projectRevision, createdAt, status: "complete", input, nodes, members, process, service };
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
  // Compact JSON avoids repeating indentation across every captured 12×12 matrix.
  // The schema and legacy latestAnalysis field remain compatible.
  return `${JSON.stringify(redactPersistence(project))}\n`;
}

export function decodeProject(source: string): FrameProject {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error("文件不是有效的 FrameMind 项目"); }
  if (!isRecord(value) || value.format !== PROJECT_FORMAT) throw new Error("文件不是有效的 FrameMind 项目");
  if (value.formatVersion !== 1 && value.formatVersion !== PROJECT_FORMAT_VERSION) {
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
  const selfWeight = decodeSelfWeight(value.selfWeight);
  const loadCases = value.loadCases === undefined ? DEFAULT_LOAD_CASES.map((item) => ({ ...item })) : decodeOptionalArray(value.loadCases, "工况", decodeLoadCase);
  assertUnique(loadCases, "工况");
  if (!loadCases.length) throw new Error("至少保留一个荷载工况");
  const activeLoadCaseId = value.activeLoadCaseId === undefined ? DEFAULT_LOAD_CASE : requireString(value.activeLoadCaseId, "当前工况无效");
  const highestLoadCaseNumber = Math.max(...loadCases.map((item) => Number(item.id.slice(2))));
  const nextLoadCaseNumber = decodeCounter(value.nextLoadCaseNumber, highestLoadCaseNumber + 1, "工况", highestLoadCaseNumber, true);
  const loadCombinations = decodeOptionalArray(value.loadCombinations, "组合", (item) => decodeLoadCombination(item, loadCases));
  assertUnique(loadCombinations, "组合");
  const highestCombinationNumber = loadCombinations.reduce((highest, item) => Math.max(highest, Number(item.id.slice(2))), 0);
  const nextLoadCombinationNumber = decodeCounter(value.nextLoadCombinationNumber, highestCombinationNumber + 1, "组合", highestCombinationNumber, true);
  const activeLoadCombinationId = value.activeLoadCombinationId === undefined ? undefined : requireString(value.activeLoadCombinationId, "当前组合无效");
  const analysisCases = value.analysisCases === undefined
    ? [...loadCases, ...loadCombinations].map((source, index): FrameAnalysisCase => ({ id: `AC${index + 1}`, name: source.name, method: "static", loadSourceId: source.id, settings: { solver: "native-static" }, legacySourceId: source.id }))
    : decodeOptionalArray(value.analysisCases, "分析工况", (item) => decodeAnalysisCase(item, { loadCases, loadCombinations }));
  assertUnique(analysisCases, "分析工况");
  const highestAnalysisNumber = analysisCases.reduce((n, c) => Math.max(n, Number(c.id.slice(2))), 0);
  const nextAnalysisCaseNumber = decodeCounter(value.nextAnalysisCaseNumber, highestAnalysisNumber + 1, "分析工况", highestAnalysisNumber, true);
  const activeAnalysisCaseId = value.activeAnalysisCaseId === undefined ? undefined : requireString(value.activeAnalysisCaseId, "当前分析工况无效");
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
  const analysisResults = value.analysisResults === undefined ? (latestAnalysis ? [latestAnalysis] : []) : decodeOptionalArray(value.analysisResults, "工况结果", decodeAnalysisResult);
  if (new Set(analysisResults.map((result) => result.id)).size !== analysisResults.length) throw new Error("分析结果稳定标识重复");
  const nextUniformLoadNumber = decodeCounter(value.nextUniformLoadNumber, 1, "均布荷载", highestNumber(uniformLoads, /^uniform_load_(\d+)$/, /^Q(\d+)$/), true);
  const project: FrameProject = {
    format: PROJECT_FORMAT, formatVersion: PROJECT_FORMAT_VERSION,
    id: requireString(value.id, "项目缺少稳定标识") as ProjectId,
    name: requireString(value.name, "项目缺少名称"),
    createdAt: requireString(value.createdAt, "项目缺少创建时间"), updatedAt: requireString(value.updatedAt, "项目缺少更新时间"),
    revision: value.revision, units: { length: "m", force: "kN", moment: "kN·m" },
    nodes, materials, sections, members, supports, nodalLoads, uniformLoads, selfWeight, loadCases, activeLoadCaseId, nextLoadCaseNumber, analysisResults,
    loadCombinations, nextLoadCombinationNumber, activeLoadCombinationId, analysisCases, nextAnalysisCaseNumber, activeAnalysisCaseId,
    latestAnalysis,
    nextNodeNumber, nextMaterialNumber, nextSectionNumber, nextMemberNumber, nextSupportNumber, nextLoadNumber, nextUniformLoadNumber,
  };
  if (activeAnalysisCaseId) {
    const selected = selectAnalysisCase(project, activeAnalysisCaseId);
    if (selected.activeLoadCaseId !== activeLoadCaseId || selected.activeLoadCombinationId !== activeLoadCombinationId) throw new Error("当前分析工况与荷载来源不一致");
  }
  requireLoadCase(project, activeLoadCaseId);
  if (activeLoadCombinationId) requireLoadCombination(project, activeLoadCombinationId);
  requireLoadCase(project, selfWeight.loadCaseId);
  for (const load of [...nodalLoads, ...uniformLoads]) requireLoadCase(project, load.loadCaseId);
  for (const result of analysisResults) {
    if (result.projectId !== project.id || result.projectRevision >= project.revision) throw new Error("工况结果项目标识或版本无效");
  }
  // Historical definitions are validated against their own frozen inputs;
  // deleting a live source cannot erase or invalidate the project file history.
  for (const member of members) validateMember(project, member.label, member);
  for (const load of uniformLoads) if (!members.some((member) => member.id === load.memberId)) throw new Error(`均布荷载 ${load.label} 引用了不存在的杆件 ${load.memberId}`);
  for (const support of supports) if (!nodes.some((node) => node.id === support.nodeId)) throw new Error(`支座 ${support.label} 引用了不存在的节点 ${support.nodeId}`);
  for (const load of nodalLoads) if (!nodes.some((node) => node.id === load.nodeId)) throw new Error(`节点荷载 ${load.label} 引用了不存在的节点 ${load.nodeId}`);
  if (latestAnalysis && latestAnalysis.projectId !== project.id) throw new Error("分析结果项目标识与文件不一致");
  if (latestAnalysis && latestAnalysis.projectRevision >= project.revision) throw new Error("分析结果版本必须早于当前项目版本");
  project.confirmedOperations = decodeConfirmedOperations(value.confirmedOperations, project.id);
  project.taskState = decodeTaskState(value.taskState, project, decodeProject, decodeAnalysisInput);
  if (value.formatVersion === 1) project.migration = { fromVersion: 1, missing: ["task-state", "confirmation-receipts", "section-geometry"] };
  else if (isRecord(value.migration) && value.migration.fromVersion === 1 && Array.isArray(value.migration.missing) && value.migration.missing.every((item) => typeof item === "string")) project.migration = { fromVersion: 1, missing: value.migration.missing };
  return project;
}
