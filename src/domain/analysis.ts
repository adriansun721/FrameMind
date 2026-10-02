import { calculateMemberGeometry, type MemberGeometry } from "./member-geometry";
import { AnalysisFailure, checkAnalysisInput, type AnalysisStage } from "./analysis-diagnostics";
import { memberUniformIntensity, uniformEquivalentForces } from "./uniform-loads";
import { getAnalysisLoadCaseId, getAnalysisSourceId, requireLoadCase, requireLoadCombination, validateLoadCombination } from "./project";
import type {
  DofRestraints,
  FrameMaterial,
  FrameMember,
  FrameNodalLoad,
  FrameUniformLoad,
  FrameNode,
  FrameProject,
  FrameSection,
  FrameSupport,
  FrameSelfWeight,
  FrameLoadCase,
  FrameLoadCombination,
  Vector3,
} from "./project";

export const ANALYSIS_DOF_ORDER = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
export type AnalysisDof = typeof ANALYSIS_DOF_ORDER[number];

export interface AnalysisSolverConfig {
  implementation: string;
  algorithm: "partial-pivot-gaussian";
  constraints: "free-dof-elimination";
  relativePivotTolerance: number;
}

export const ANALYSIS_SOLVER: Readonly<AnalysisSolverConfig> = Object.freeze({
  implementation: "framemind-frame/3", algorithm: "partial-pivot-gaussian", constraints: "free-dof-elimination", relativePivotTolerance: 1e-12,
});

export interface AnalysisAssumptions {
  theory: "3d-euler-bernoulli-frame";
  shearDeformation: "neglected";
  rigidJoints: true;
  units: "m-kN-kN·m";
  localAxis: "member-geometry";
}

export interface AnalysisInputSnapshot {
  projectId: string;
  projectRevision: number;
  dofOrder: readonly AnalysisDof[];
  assumptions: AnalysisAssumptions;
  solver?: AnalysisSolverConfig;
  loadCase?: FrameLoadCase;
  nodes: FrameNode[];
  members: FrameMember[];
  materials: FrameMaterial[];
  sections: FrameSection[];
  supports: FrameSupport[];
  nodalLoads: FrameNodalLoad[];
  uniformLoads?: FrameUniformLoad[];
  selfWeight?: FrameSelfWeight;
  combination?: { definition: FrameLoadCombination; cases: CombinationCaseInput[] };
}

export interface CombinationCaseInput {
  loadCase: FrameLoadCase;
  nodalLoads: FrameNodalLoad[];
  uniformLoads: FrameUniformLoad[];
  selfWeight: FrameSelfWeight;
}

export interface NodeAnalysisResult {
  nodeId: string;
  displacement: Vector3;
  rotation: Vector3;
  reaction: Vector3;
  reactionMoment: Vector3;
}

export interface MemberAnalysisResult {
  memberId: string;
  length: number;
  localAxes: { x: Vector3; y: Vector3; z: Vector3 };
  localEndForces: { start: [number, number, number, number, number, number]; end: [number, number, number, number, number, number] };
}

export interface AnalysisResult {
  id: string;
  projectId: string;
  projectRevision: number;
  createdAt: string;
  status: "complete";
  input: AnalysisInputSnapshot;
  nodes: NodeAnalysisResult[];
  members: MemberAnalysisResult[];
  /** Compact process data captured by the run; older files may omit it. */
  process?: AnalysisProcessSnapshot;
}

type Matrix = number[][];

interface MemberMatrices {
  member: FrameMember;
  geometry: MemberGeometry;
  local: Matrix;
  transform: Matrix;
  global: Matrix;
  uniformIntensity: Vector3;
  intensity: Vector3;
  selfWeightIntensity: Vector3;
  equivalentLocalForces: number[];
  equivalentGlobalForces: number[];
}

export interface MemberAnalysisRecord {
  analysisId: string;
  sourceAnalysisId: string;
  projectRevision: number;
  origin: "reconstructed-from-frozen-input" | "supplemental-reconstruction";
  solver: AnalysisSolverConfig;
  memberId: string;
  dofs: Array<{ nodeId: string; dof: AnalysisDof; globalIndex: number }>;
  geometry: MemberGeometry;
  localStiffness: Matrix;
  transformation: Matrix;
  globalStiffness: Matrix;
  globalDisplacement: number[];
  localDisplacement: number[];
  equivalentLocalForces: number[];
  equivalentGlobalForces: number[];
  localEndForces: MemberAnalysisResult["localEndForces"];
  uniformIntensity: Vector3;
  selfWeightIntensity: Vector3;
  totalIntensity: Vector3;
}

export interface AnalysisProcessDof {
  nodeId: string;
  dof: AnalysisDof;
  globalIndex: number;
  restrained: boolean;
}

export interface AnalysisAssemblyMemberRecord {
  memberId: string;
  dofs: AnalysisProcessDof[];
  globalDofIndices: number[];
  globalStiffness: Matrix;
  equivalentGlobalForces: number[];
}

export interface AnalysisProcessReference {
  section: string;
  topic: string;
  formula: string;
  printedPage: number;
  pdfPage: number | null;
}

export interface AnalysisProcessDifference {
  topic: string;
  implementation: string;
  textbook: string;
  reason: string;
  validation: string;
}

export interface AnalysisProcessBasis {
  title: string;
  authors: string;
  publisher: string;
  year: number;
  references: AnalysisProcessReference[];
  differences: AnalysisProcessDifference[];
}

export interface AnalysisProcessSnapshot {
  solver: AnalysisSolverConfig;
  dofOrder: readonly AnalysisDof[];
  dofs: AnalysisProcessDof[];
  members: AnalysisAssemblyMemberRecord[];
  loadVector: number[];
  constrainedDofs: number[];
  freeDofs: number[];
  assembledStiffness: Matrix | null;
  reducedStiffness: Matrix | null;
  matrixLimit: number;
}

export interface OverallAnalysisProcessRecord extends AnalysisProcessSnapshot {
  analysisId: string;
  sourceAnalysisId: string;
  projectRevision: number;
  origin: "captured-from-run" | "reconstructed-from-frozen-input" | "supplemental-reconstruction";
  basis: AnalysisProcessBasis;
}

/**
 * The page numbers are the printed pages in the scanned book. PDF page numbers
 * are kept separately because the scan has front matter and does not use the
 * book's printed numbering.
 */
export const ANALYSIS_PROCESS_BASIS: AnalysisProcessBasis = Object.freeze({
  title: "计算结构力学",
  authors: "阎军、杨春秋",
  publisher: "科学出版社",
  year: 2014,
  references: [
    { section: "第 5 章", topic: "空间刚架直接刚度法流程", formula: "K · u = F", printedPage: 117, pdfPage: 126 },
    { section: "5.2", topic: "局部与总体坐标转换", formula: "u_local = T · u_global", printedPage: 118, pdfPage: 127 },
    { section: "5.3", topic: "空间刚架单元刚度与六分量向量", formula: "EA/l；12EJ/l³；6EJ/l²；4EJ/l；2EJ/l；GJ/l", printedPage: 122, pdfPage: 131 },
    { section: "5.4—5.5", topic: "端部自由度对号与整体刚度阵集合", formula: "K_global = Tᵀ · K_local · T；K = Σ kᵢ", printedPage: 127, pdfPage: 136 },
    { section: "5.6", topic: "荷载向量形成", formula: "F = F_node + F_equivalent", printedPage: 129, pdfPage: 138 },
    { section: "附录 IV", topic: "程序组织线索", formula: "整体组装与方程求解步骤", printedPage: 180, pdfPage: 189 },
  ],
  differences: [
    {
      topic: "坐标转换矩阵方向",
      implementation: "局部轴作为 T 的行向量，使用 u_local = T · u_global；K_global = Tᵀ · K_local · T。",
      textbook: "5.2 节以总体到局部的转置记法展开 [T]。",
      reason: "矩阵存储约定采用局部轴行向量，避免把同一正交转换的转置误认为不同理论。",
      validation: "T17 斜向杆件转换矩阵与局部/总体刚度数值对照通过。",
    },
    {
      topic: "约束处理",
      implementation: "按支座自由度从整体方程中消除约束列和行，仅对自由自由度子系统进行部分主元高斯消元。",
      textbook: "教材给出自由度对号、总刚度阵集合和约束处理的流程线索。",
      reason: "首版支座是零位移约束；自由度消元保留真实刚度尺度，避免引入人为单位对角线。",
      validation: "T04 约束尺度回归和整体平衡测试通过，受限自由度位移保持为零。",
    },
  ],
});

const zeroMatrix = (rows: number, columns: number): Matrix => Array.from({ length: rows }, () => Array(columns).fill(0));
const zeros = (length: number) => Array(length).fill(0) as number[];

function matrixMultiply(left: Matrix, right: Matrix): Matrix {
  const result = zeroMatrix(left.length, right[0]?.length ?? 0);
  for (let row = 0; row < left.length; row += 1) for (let column = 0; column < (right[0]?.length ?? 0); column += 1) {
    let value = 0;
    for (let index = 0; index < right.length; index += 1) value += left[row][index] * right[index][column];
    result[row][column] = value;
  }
  return result;
}

function transpose(matrix: Matrix): Matrix {
  return matrix[0]?.map((_, column) => matrix.map((row) => row[column])) ?? [];
}

function localStiffness(length: number, material: FrameMaterial, section: FrameSection): Matrix {
  const e = material.elasticModulusGPa * 1e6;
  const g = e / (2 * (1 + material.poissonRatio));
  const ea = e * section.areaM2 / length;
  const gj = g * section.torsionalConstantM4 / length;
  const eiy = e * section.secondMomentYM4;
  const eiz = e * section.secondMomentZM4;
  const a = 12 * eiz / (length ** 3); const b = 6 * eiz / (length ** 2); const c = 4 * eiz / length; const d = 2 * eiz / length;
  const p = 12 * eiy / (length ** 3); const q = 6 * eiy / (length ** 2); const r = 4 * eiy / length; const s = 2 * eiy / length;
  const k = zeroMatrix(12, 12);
  const set = (i: number, j: number, value: number) => { k[i][j] = value; };
  set(0, 0, ea); set(0, 6, -ea); set(6, 0, -ea); set(6, 6, ea);
  set(3, 3, gj); set(3, 9, -gj); set(9, 3, -gj); set(9, 9, gj);
  set(1, 1, a); set(1, 5, b); set(1, 7, -a); set(1, 11, b);
  set(5, 1, b); set(5, 5, c); set(5, 7, -b); set(5, 11, d);
  set(7, 1, -a); set(7, 5, -b); set(7, 7, a); set(7, 11, -b);
  set(11, 1, b); set(11, 5, d); set(11, 7, -b); set(11, 11, c);
  set(2, 2, p); set(2, 4, -q); set(2, 8, -p); set(2, 10, -q);
  set(4, 2, -q); set(4, 4, r); set(4, 8, q); set(4, 10, s);
  set(8, 2, -p); set(8, 4, q); set(8, 8, p); set(8, 10, q);
  set(10, 2, -q); set(10, 4, s); set(10, 8, q); set(10, 10, r);
  return k;
}

function transformation(geometry: MemberGeometry): Matrix {
  const t = zeroMatrix(12, 12);
  const axes = [geometry.localX, geometry.localY, geometry.localZ];
  for (let block = 0; block < 2; block += 1) {
    const offset = block * 6;
    for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) {
      t[offset + row][offset + column] = axes[row][["x", "y", "z"][column] as keyof Vector3];
      t[offset + 3 + row][offset + 3 + column] = t[offset + row][offset + column];
    }
  }
  return t;
}

function solveLinearSystem(matrix: Matrix, vector: number[], freeDofs: number[], nodes: FrameNode[]): number[] {
  const size = vector.length; const a = matrix.map((row, index) => [...row, vector[index]]);
  let scale = 0; for (const row of matrix) for (const value of row) scale = Math.max(scale, Math.abs(value));
  const tolerance = scale * ANALYSIS_SOLVER.relativePivotTolerance;
  for (let pivot = 0; pivot < size; pivot += 1) {
    let selected = pivot;
    for (let row = pivot + 1; row < size; row += 1) if (Math.abs(a[row][pivot]) > Math.abs(a[selected][pivot])) selected = row;
    const pivotMagnitude = Math.abs(a[selected][pivot]);
    const globalDofIndex = freeDofs[pivot]; const node = nodes[Math.floor(globalDofIndex / 6)]; const dof = ANALYSIS_DOF_ORDER[globalDofIndex % 6];
    if (!Number.isFinite(pivotMagnitude)) throw new AnalysisFailure("solve", [{ code: "non-finite-system", message: "消元过程中出现非有限数值，请核查参数量级与数值条件", target: { kind: "node", id: node.id }, dof }]);
    if (pivotMagnitude <= tolerance) throw new AnalysisFailure("solve", [{
      code: "singular-system", message: `约化刚度矩阵在 ${node.label} · ${dof.toUpperCase()} 对应列的主元不超过阈值。可能存在约束不足、机构或数值病态；该自由度是检查线索，不能据此确定唯一原因。`,
      target: { kind: "node", id: node.id }, dof, field: "restraints", evidence: { pivotMagnitude, threshold: tolerance, matrixScale: scale, globalDofIndex },
    }]);
    [a[pivot], a[selected]] = [a[selected], a[pivot]];
    for (let row = pivot + 1; row < size; row += 1) {
      const factor = a[row][pivot] / a[pivot][pivot]; if (factor === 0) continue;
      for (let column = pivot; column <= size; column += 1) a[row][column] -= factor * a[pivot][column];
    }
  }
  const result = zeros(size);
  for (let row = size - 1; row >= 0; row -= 1) {
    let value = a[row][size]; for (let column = row + 1; column < size; column += 1) value -= a[row][column] * result[column];
    result[row] = value / a[row][row];
  }
  if (!result.every(Number.isFinite)) throw new AnalysisFailure("solve", [{ code: "non-finite-displacement", message: "回代位移包含非有限数值，请核查参数量级与数值条件" }]);
  return result;
}

export function freezeAnalysisInput(input: AnalysisInputSnapshot): AnalysisInputSnapshot {
  const freeze = (value: object): void => {
    for (const child of Object.values(value)) if (typeof child === "object" && child !== null) freeze(child);
    Object.freeze(value);
  };
  freeze(input);
  return input;
}

export function captureAnalysisInput(project: FrameProject, loadCaseId?: string): AnalysisInputSnapshot {
  if (loadCaseId === undefined && project.activeLoadCombinationId) {
    const definition = requireLoadCombination(project, project.activeLoadCombinationId);
    validateLoadCombination(project, definition);
    const inputs = definition.terms.map((term) => captureAnalysisInput(project, term.loadCaseId));
    return buildCombinationInput(inputs[0], definition, inputs.map((input) => ({ loadCase: input.loadCase!, nodalLoads: input.nodalLoads, uniformLoads: input.uniformLoads ?? [], selfWeight: input.selfWeight! })));
  }
  loadCaseId ??= project.activeLoadCaseId;
  const loadCase = requireLoadCase(project, loadCaseId);
  return freezeAnalysisInput({
    projectId: project.id, projectRevision: project.revision, dofOrder: [...ANALYSIS_DOF_ORDER],
    solver: { ...ANALYSIS_SOLVER },
    loadCase: { ...loadCase },
    assumptions: { theory: "3d-euler-bernoulli-frame", shearDeformation: "neglected", rigidJoints: true, units: "m-kN-kN·m", localAxis: "member-geometry" },
    nodes: project.nodes.map((node) => ({ ...node, position: { ...node.position } })),
    members: project.members.map((member) => ({ ...member })), materials: project.materials.map((material) => ({ ...material })), sections: project.sections.map((section) => ({ ...section })),
    supports: project.supports.map((support) => ({ ...support, restraints: [...support.restraints] as DofRestraints })),
    nodalLoads: project.nodalLoads.filter((load) => load.loadCaseId === loadCaseId).map((load) => ({ ...load, force: { ...load.force }, moment: { ...load.moment } })),
    uniformLoads: project.uniformLoads.filter((load) => load.loadCaseId === loadCaseId).map((load) => ({ ...load, intensity: { ...load.intensity } })),
    selfWeight: project.selfWeight?.loadCaseId === loadCaseId ? { ...project.selfWeight, gravity: { ...project.selfWeight.gravity } } : { enabled: false, loadCaseId, gravity: { x: 0, y: 0, z: -9.81 } },
  });
}

/** All constituent loads use the one structural basis supplied here. No historic results are combined. */
export function buildCombinationInput(base: AnalysisInputSnapshot, definition: FrameLoadCombination, cases: CombinationCaseInput[]): AnalysisInputSnapshot {
  const validated = validateLoadCombination({ loadCases: cases.map((item) => item.loadCase) }, definition);
  if (cases.length !== validated.terms.length || new Set(cases.map((item) => item.loadCase.id)).size !== cases.length) throw new Error("组合工况来源不完整或重复");
  const loadCase = cases[0].loadCase;
  const nodalLoads: FrameNodalLoad[] = []; const uniformLoads: FrameUniformLoad[] = [];
  let gravity = { x: 0, y: 0, z: 0 };
  const scale = (v: Vector3, factor: number): Vector3 => {
    const value = { x: v.x * factor, y: v.y * factor, z: v.z * factor };
    if (!Object.values(value).every(Number.isFinite)) throw new Error("组合加权荷载超出有限数值范围");
    return value;
  };
  for (const term of validated.terms) {
    const source = cases.find((item) => item.loadCase.id === term.loadCaseId)!;
    if ([...source.nodalLoads, ...source.uniformLoads].some((load) => load.loadCaseId !== term.loadCaseId) || source.selfWeight.loadCaseId !== term.loadCaseId) throw new Error("组合工况荷载来源不一致");
    for (const load of source.nodalLoads) {
      const number = nodalLoads.length + 1;
      nodalLoads.push({ ...load, id: `load_${String(number).padStart(4, "0")}` as FrameNodalLoad["id"], label: `L${number}`, loadCaseId: loadCase.id, force: scale(load.force, term.factor), moment: scale(load.moment, term.factor) });
    }
    for (const load of source.uniformLoads) {
      const number = uniformLoads.length + 1;
      uniformLoads.push({ ...load, id: `uniform_load_${String(number).padStart(4, "0")}` as FrameUniformLoad["id"], label: `Q${number}`, loadCaseId: loadCase.id, intensity: scale(load.intensity, term.factor) });
    }
    if (source.selfWeight.enabled) {
      const g = scale(source.selfWeight.gravity, term.factor);
      gravity = { x: gravity.x + g.x, y: gravity.y + g.y, z: gravity.z + g.z };
      if (!Object.values(gravity).every(Number.isFinite)) throw new Error("组合自重超出有限数值范围");
    }
  }
  return freezeAnalysisInput(structuredClone({ ...base, loadCase, nodalLoads, uniformLoads,
    selfWeight: { enabled: Math.hypot(gravity.x, gravity.y, gravity.z) > 0, loadCaseId: loadCase.id, gravity }, combination: { definition: validated, cases } }));
}

export function validateCombinationInput(input: AnalysisInputSnapshot): void {
  if (!input.combination) return;
  if (!Array.isArray(input.combination.cases) || input.combination.cases.some((source) => Object.keys(source).some((key) => !["loadCase", "nodalLoads", "uniformLoads", "selfWeight"].includes(key)))) throw new Error("组合工况必须共享同一结构基础");
  if (input.assumptions.theory !== "3d-euler-bernoulli-frame" || input.assumptions.shearDeformation !== "neglected" || input.assumptions.rigidJoints !== true || input.assumptions.units !== "m-kN-kN·m" || input.assumptions.localAxis !== "member-geometry" || input.dofOrder.join(",") !== ANALYSIS_DOF_ORDER.join(",")) throw new Error("组合仅支持已验证的线弹性假设与单位约定");
  const rebuilt = buildCombinationInput(input, input.combination.definition, input.combination.cases);
  if (!sameInputValue(input, rebuilt)) throw new Error("组合有效荷载与工况、系数或单位依据不一致");
  for (const source of input.combination.cases) {
    requireAnalysisInput({ ...input, combination: undefined, ...source });
  }
}

export function getLoadCaseResult(project: FrameProject, id = project.activeLoadCaseId): AnalysisResult | undefined {
  const result = getAnalysisResultForSource(project, id);
  return result?.input.combination ? undefined : result;
}

export function getAnalysisResultForSource(project: FrameProject, id: string): AnalysisResult | undefined {
  // Results are append-only by run. The last matching record is the active result
  // for a source while earlier records remain available for comparison.
  return [...project.analysisResults].reverse().find((result) => getAnalysisSourceId(result.input) === id);
}

export function getActiveAnalysisResult(project: FrameProject): AnalysisResult | undefined {
  return getAnalysisResultForSource(project, project.activeLoadCombinationId ?? project.activeLoadCaseId);
}

export function sameInputValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameInputValue(value, right[index]));
  const leftEntries = Object.entries(left).filter(([, value]) => value !== undefined);
  const rightEntries = Object.entries(right).filter(([, value]) => value !== undefined);
  return leftEntries.length === rightEntries.length && leftEntries.every(([key, value]) => Object.hasOwn(right, key) && sameInputValue(value, (right as Record<string, unknown>)[key]));
}

export function isAnalysisResultCurrent(project: FrameProject, result: AnalysisResult): boolean {
  if (result.input.combination) {
    if (result.projectId !== project.id || !project.loadCombinations.some((item) => item.id === result.input.combination!.definition.id)) return false;
    try {
      const current = captureAnalysisInput({ ...project, activeLoadCombinationId: result.input.combination.definition.id });
      return sameInputValue({ ...current, projectRevision: 0 }, { ...result.input, projectRevision: 0 });
    } catch { return false; }
  }
  const id = getAnalysisLoadCaseId(result.input);
  if (result.projectId !== project.id || !project.loadCases.some((item) => item.id === id)) return false;
  if (!result.input.loadCase) return result.projectRevision === project.revision - 1;
  return sameInputValue({ ...captureAnalysisInput(project, id), projectRevision: 0 }, { ...result.input, projectRevision: 0 });
}

function requireAnalysisInput(project: FrameProject | AnalysisInputSnapshot): void {
  const diagnostics = checkAnalysisInput(project);
  if (diagnostics.length) throw new AnalysisFailure("model-check", diagnostics);
}

function memberMatrices(input: AnalysisInputSnapshot, member: FrameMember): MemberMatrices {
  const start = input.nodes.find((node) => node.id === member.startNodeId)!; const end = input.nodes.find((node) => node.id === member.endNodeId)!;
  const material = input.materials.find((item) => item.id === member.materialId)!; const section = input.sections.find((item) => item.id === member.sectionId)!;
  const geometry = calculateMemberGeometry(start.position, end.position, member.rotationDegrees);
  const local = localStiffness(geometry.length, material, section); const transform = transformation(geometry);
  const uniformIntensity = memberUniformIntensity(input.uniformLoads ?? [], member.id, geometry);
  const selfWeightIntensity = getMemberSelfWeightIntensity(input, member, geometry);
  const intensity = { x: uniformIntensity.x + selfWeightIntensity.x, y: uniformIntensity.y + selfWeightIntensity.y, z: uniformIntensity.z + selfWeightIntensity.z };
  const equivalentLocalForces = uniformEquivalentForces(intensity, geometry.length);
  const equivalentGlobalForces = transpose(transform).map((row) => row.reduce((sum, value, index) => sum + value * equivalentLocalForces[index], 0));
  return { member, geometry, local, transform, global: matrixMultiply(matrixMultiply(transpose(transform), local), transform), uniformIntensity, intensity, selfWeightIntensity, equivalentLocalForces, equivalentGlobalForces };
}

function getMemberSelfWeightIntensity(input: AnalysisInputSnapshot, member: FrameMember, geometry: MemberGeometry): Vector3 {
  if (!input.selfWeight?.enabled) return { x: 0, y: 0, z: 0 };
  const material = input.materials.find((item) => item.id === member.materialId)!;
  const section = input.sections.find((item) => item.id === member.sectionId)!;
  const scale = material.densityKgM3 * section.areaM2 / 1000;
  const global = { x: scale * input.selfWeight.gravity.x, y: scale * input.selfWeight.gravity.y, z: scale * input.selfWeight.gravity.z };
  return {
    x: global.x * geometry.localX.x + global.y * geometry.localX.y + global.z * geometry.localX.z,
    y: global.x * geometry.localY.x + global.y * geometry.localY.y + global.z * geometry.localY.z,
    z: global.x * geometry.localZ.x + global.y * geometry.localZ.y + global.z * geometry.localZ.z,
  };
}

export interface SelfWeightMemberSummary {
  memberId: string;
  length: number;
  massKg: number;
  weightKN: number;
  globalForce: Vector3;
}

export interface SelfWeightSummary {
  enabled: boolean;
  loadCaseId: string;
  totalMassKg: number;
  totalWeightKN: number;
  totalForce: Vector3;
  members: SelfWeightMemberSummary[];
}

export function getSelfWeightSummary(source: FrameProject | AnalysisInputSnapshot): SelfWeightSummary {
  const selfWeight = source.selfWeight;
  if (!selfWeight?.enabled) return { enabled: false, loadCaseId: selfWeight?.loadCaseId ?? "LC1", totalMassKg: 0, totalWeightKN: 0, totalForce: { x: 0, y: 0, z: 0 }, members: [] };
  const members: SelfWeightMemberSummary[] = [];
  for (const member of source.members) {
    const start = source.nodes.find((node) => node.id === member.startNodeId)!;
    const end = source.nodes.find((node) => node.id === member.endNodeId)!;
    const material = source.materials.find((item) => item.id === member.materialId)!;
    const section = source.sections.find((item) => item.id === member.sectionId)!;
    const length = calculateMemberGeometry(start.position, end.position, member.rotationDegrees).length;
    const massKg = material.densityKgM3 * section.areaM2 * length;
    const gravityMagnitude = Math.hypot(selfWeight.gravity.x, selfWeight.gravity.y, selfWeight.gravity.z);
    members.push({ memberId: member.id, length, massKg, weightKN: massKg * gravityMagnitude / 1000, globalForce: { x: massKg * selfWeight.gravity.x / 1000, y: massKg * selfWeight.gravity.y / 1000, z: massKg * selfWeight.gravity.z / 1000 } });
  }
  const totalMassKg = members.reduce((sum, item) => sum + item.massKg, 0);
  const totalWeightKN = members.reduce((sum, item) => sum + item.weightKN, 0);
  const totalForce = members.reduce((sum, item) => ({ x: sum.x + item.globalForce.x, y: sum.y + item.globalForce.y, z: sum.z + item.globalForce.z }), { x: 0, y: 0, z: 0 });
  return { enabled: true, loadCaseId: selfWeight.loadCaseId, totalMassKg, totalWeightKN, totalForce, members };
}

function requireCurrentSolver(solver: AnalysisSolverConfig | undefined): void {
  if (!solver || ![ANALYSIS_SOLVER.implementation, "framemind-frame/2"].includes(solver.implementation) || solver.algorithm !== ANALYSIS_SOLVER.algorithm || solver.constraints !== ANALYSIS_SOLVER.constraints || solver.relativePivotTolerance !== ANALYSIS_SOLVER.relativePivotTolerance) throw new Error("该分析的求解器版本或配置不支持数值过程重建");
}

function requireLoadRecoveryVersion(input: AnalysisInputSnapshot): void {
  requireCurrentSolver(input.solver);
  if ((input.uniformLoads?.length || input.selfWeight?.enabled) && input.solver?.implementation !== ANALYSIS_SOLVER.implementation) throw new Error("该分析的求解器版本不支持分布荷载恢复");
}

export interface MemberSectionForces {
  analysisId: string;
  memberId: string;
  position: number;
  forces: [number, number, number, number, number, number];
}

export interface MemberResponseSample {
  analysisId: string;
  memberId: string;
  position: number;
  forces: [number, number, number, number, number, number];
  localDisplacement: Vector3;
  globalDisplacement: Vector3;
}

const hermite = (coordinate: number, length: number) => {
  const t = coordinate / length;
  return {
    valueStart: 1 - 3 * t ** 2 + 2 * t ** 3,
    slopeStart: length * (t - 2 * t ** 2 + t ** 3),
    valueEnd: 3 * t ** 2 - 2 * t ** 3,
    slopeEnd: length * (-(t ** 2) + t ** 3),
  };
};

/** Returns the verified member recovery at uniformly spaced stations.
 * Translations use the Euler-Bernoulli cubic field stored by the frame model;
 * rotations and axial displacement are linearly interpolated for display.
 */
export function getMemberResponseSamples(result: AnalysisResult, memberId: string, stationCount = 17): MemberResponseSample[] {
  if (!Number.isInteger(stationCount) || stationCount < 2 || stationCount > 101) throw new Error("沿杆采样数量必须在 2 到 101 之间");
  const record = getMemberAnalysisRecord(result, memberId);
  const start = record.localDisplacement.slice(0, 6);
  const end = record.localDisplacement.slice(6, 12);
  const { geometry } = record;
  const axis = (localX: number, localY: number, localZ: number): Vector3 => ({
    x: geometry.localX.x * localX + geometry.localY.x * localY + geometry.localZ.x * localZ,
    y: geometry.localX.y * localX + geometry.localY.y * localY + geometry.localZ.y * localZ,
    z: geometry.localX.z * localX + geometry.localY.z * localY + geometry.localZ.z * localZ,
  });
  return Array.from({ length: stationCount }, (_, index) => {
    const position = geometry.length * index / (stationCount - 1);
    const shape = hermite(position, geometry.length);
    const localY = shape.valueStart * start[1] + shape.slopeStart * start[5] + shape.valueEnd * end[1] + shape.slopeEnd * end[5];
    const localZ = shape.valueStart * start[2] - shape.slopeStart * start[4] + shape.valueEnd * end[2] - shape.slopeEnd * end[4];
    const localX = start[0] + (end[0] - start[0]) * index / (stationCount - 1);
    const globalDisplacement = axis(localX, localY, localZ);
    return {
      analysisId: result.id,
      memberId,
      position,
      forces: sectionForces(record.localEndForces.start, record.totalIntensity, position),
      localDisplacement: { x: localX, y: localY, z: localZ },
      globalDisplacement,
    };
  });
}

/** Section actions on the positive local-x face; order: N, Vy, Vz, T, My, Mz. */
export function getMemberSectionForces(result: AnalysisResult, memberId: string, position: number): MemberSectionForces {
  requireLoadRecoveryVersion(result.input);
  const member = result.input.members.find((item) => item.id === memberId);
  const stored = result.members.find((item) => item.memberId === memberId);
  if (!member || !stored) throw new Error(`本次分析没有杆件 ${memberId}`);
  const start = result.input.nodes.find((node) => node.id === member.startNodeId)!;
  const end = result.input.nodes.find((node) => node.id === member.endNodeId)!;
  const geometry = calculateMemberGeometry(start.position, end.position, member.rotationDegrees);
  const uniform = memberUniformIntensity(result.input.uniformLoads ?? [], member.id, geometry);
  const selfWeight = getMemberSelfWeightIntensity(result.input, member, geometry);
  const q = { x: uniform.x + selfWeight.x, y: uniform.y + selfWeight.y, z: uniform.z + selfWeight.z };
  if (!Number.isFinite(position) || position < 0 || position > geometry.length) throw new Error("沿杆位置必须在起点 0 与杆长之间（m）");
  return { analysisId: result.id, memberId, position, forces: sectionForces(stored.localEndForces.start, q, position) };
}

function sectionForces(s: MemberAnalysisResult["localEndForces"]["start"], q: Vector3, x: number): MemberSectionForces["forces"] {
  const forces: MemberSectionForces["forces"] = [-s[0] - q.x * x, -s[1] - q.y * x, -s[2] - q.z * x, -s[3], -s[4] - s[2] * x - q.z * x ** 2 / 2, -s[5] + s[1] * x + q.y * x ** 2 / 2];
  if (!forces.every(Number.isFinite)) throw new Error("沿杆内力包含非有限数值");
  return forces;
}

export function getMemberAnalysisRecord(result: AnalysisResult, memberId: string): MemberAnalysisRecord {
  requireLoadRecoveryVersion(result.input);
  const input = result.input; const member = input.members.find((item) => item.id === memberId);
  if (!member) throw new Error(`本次分析没有杆件 ${memberId}`);
  const { geometry, local, transform, global, equivalentLocalForces, equivalentGlobalForces, uniformIntensity, intensity, selfWeightIntensity } = memberMatrices(input, member);
  const dofs = [member.startNodeId, member.endNodeId].flatMap((nodeId) => ANALYSIS_DOF_ORDER.map((dof, index) => ({ nodeId, dof, globalIndex: input.nodes.findIndex((node) => node.id === nodeId) * 6 + index })));
  const globalDisplacement = [member.startNodeId, member.endNodeId].flatMap((nodeId) => {
    const node = result.nodes.find((item) => item.nodeId === nodeId);
    if (!node) throw new Error(`分析结果缺少节点 ${nodeId}`);
    return [node.displacement.x, node.displacement.y, node.displacement.z, node.rotation.x, node.rotation.y, node.rotation.z];
  });
  const stored = result.members.find((item) => item.memberId === memberId);
  if (!stored) throw new Error(`分析结果缺少杆件 ${memberId}`);
  return { analysisId: result.id, sourceAnalysisId: result.id, projectRevision: result.projectRevision, origin: "reconstructed-from-frozen-input", solver: { ...result.input.solver! }, memberId, dofs, geometry,
    localStiffness: local, transformation: transform, globalStiffness: global, globalDisplacement,
    localDisplacement: transform.map((row) => row.reduce((sum, value, index) => sum + value * globalDisplacement[index], 0)),
    equivalentLocalForces,
    equivalentGlobalForces,
    uniformIntensity,
    selfWeightIntensity,
    totalIntensity: intensity,
    localEndForces: { start: [...stored.localEndForces.start], end: [...stored.localEndForces.end] },
  };
}

const PROCESS_MATRIX_LIMIT = 72;

function restrainedDofSet(input: AnalysisInputSnapshot): Set<number> {
  const nodeIndex = new Map(input.nodes.map((node, index) => [node.id, index]));
  const restrained = new Set<number>();
  for (const support of input.supports) {
    const offset = nodeIndex.get(support.nodeId);
    if (offset === undefined) continue;
    support.restraints.forEach((isRestrained, index) => { if (isRestrained) restrained.add(offset * 6 + index); });
  }
  return restrained;
}

function processDofList(input: AnalysisInputSnapshot, restrained: Set<number>): AnalysisProcessDof[] {
  return input.nodes.flatMap((node, nodeIndex) => ANALYSIS_DOF_ORDER.map((dof, dofIndex) => {
    const globalIndex = nodeIndex * 6 + dofIndex;
    return { nodeId: node.id, dof, globalIndex, restrained: restrained.has(globalIndex) };
  }));
}

function buildProcessSnapshot(input: AnalysisInputSnapshot, nodeIndex: Map<string, number>, memberData: MemberMatrices[], stiffness: Matrix | null, loadVector: number[], restrained: Set<number>, freeDofs: number[]): AnalysisProcessSnapshot {
  const size = input.nodes.length * 6;
  const members = memberData.map((data) => {
    const start = nodeIndex.get(data.member.startNodeId); const end = nodeIndex.get(data.member.endNodeId);
    if (start === undefined || end === undefined) throw new Error(`整体过程缺少 ${data.member.label} 的节点索引`);
    const globalDofIndices = [...Array.from({ length: 6 }, (_, index) => start * 6 + index), ...Array.from({ length: 6 }, (_, index) => end * 6 + index)];
    return { memberId: data.member.id, dofs: globalDofIndices.map((globalIndex) => ({ nodeId: input.nodes[Math.floor(globalIndex / 6)].id, dof: ANALYSIS_DOF_ORDER[globalIndex % 6], globalIndex, restrained: restrained.has(globalIndex) })), globalDofIndices, globalStiffness: data.global, equivalentGlobalForces: data.equivalentGlobalForces };
  });
  const boundedMatrix = (indices: number[]): Matrix | null => stiffness && indices.length <= PROCESS_MATRIX_LIMIT ? indices.map((row) => indices.map((column) => stiffness![row][column])) : null;
  const allIndices = Array.from({ length: size }, (_, index) => index);
  return { solver: { ...input.solver! }, dofOrder: [...ANALYSIS_DOF_ORDER], dofs: processDofList(input, restrained), members, loadVector: [...loadVector], constrainedDofs: [...restrained].sort((left, right) => left - right), freeDofs: [...freeDofs], assembledStiffness: boundedMatrix(allIndices), reducedStiffness: boundedMatrix(freeDofs), matrixLimit: PROCESS_MATRIX_LIMIT };
}

function reconstructProcessSnapshot(input: AnalysisInputSnapshot): AnalysisProcessSnapshot {
  const nodeIndex = new Map(input.nodes.map((node, index) => [node.id, index]));
  const size = input.nodes.length * 6;
  const stiffness = size <= PROCESS_MATRIX_LIMIT ? zeroMatrix(size, size) : null;
  const loadVector = zeros(size);
  const restrained = restrainedDofSet(input);
  const memberData = input.members.map((member) => memberMatrices(input, member));
  for (const data of memberData) {
    const start = nodeIndex.get(data.member.startNodeId); const end = nodeIndex.get(data.member.endNodeId);
    if (start === undefined || end === undefined) throw new Error(`整体过程缺少 ${data.member.label} 的节点索引`);
    const indices = [...Array.from({ length: 6 }, (_, index) => start * 6 + index), ...Array.from({ length: 6 }, (_, index) => end * 6 + index)];
    for (let row = 0; row < 12; row += 1) {
      loadVector[indices[row]] += data.equivalentGlobalForces[row];
      if (stiffness) for (let column = 0; column < 12; column += 1) stiffness[indices[row]][indices[column]] += data.global[row][column];
    }
  }
  for (const load of input.nodalLoads) {
    const node = nodeIndex.get(load.nodeId);
    if (node === undefined) throw new Error(`整体过程缺少荷载 ${load.label} 的节点索引`);
    [load.force.x, load.force.y, load.force.z, load.moment.x, load.moment.y, load.moment.z].forEach((value, index) => { loadVector[node * 6 + index] += value; });
  }
  const freeDofs = Array.from({ length: size }, (_, index) => index).filter((index) => !restrained.has(index));
  return buildProcessSnapshot(input, nodeIndex, memberData, stiffness, loadVector, restrained, freeDofs);
}

/** Uses the process captured by the run, falling back to frozen-input reconstruction for older files. */
export function getOverallAnalysisProcessRecord(result: AnalysisResult): OverallAnalysisProcessRecord {
  requireLoadRecoveryVersion(result.input);
  const snapshot = result.process ?? reconstructProcessSnapshot(result.input);
  return { analysisId: result.id, sourceAnalysisId: result.id, projectRevision: result.projectRevision, origin: result.process ? "captured-from-run" : "reconstructed-from-frozen-input", ...structuredClone(snapshot), basis: structuredClone(ANALYSIS_PROCESS_BASIS) };
}

/** Rebuilds the overall process for a legacy result without relabelling the original analysis. */
export function supplementOverallAnalysisProcessRecord(result: AnalysisResult): OverallAnalysisProcessRecord {
  const supplemental = solveFrame(createSupplementalAnalysisInput(result));
  const record = getOverallAnalysisProcessRecord(supplemental);
  return { ...record, sourceAnalysisId: result.id, origin: "supplemental-reconstruction" };
}

export function createSupplementalAnalysisInput(result: AnalysisResult): AnalysisInputSnapshot {
  const input = structuredClone(result.input);
  return freezeAnalysisInput({ ...input, solver: { ...ANALYSIS_SOLVER } });
}

/** Recomputes a member process for an older result that did not retain a supported solver configuration. */
export function supplementMemberAnalysisRecord(result: AnalysisResult, memberId: string): MemberAnalysisRecord {
  const supplemental = solveFrame(createSupplementalAnalysisInput(result));
  const record = getMemberAnalysisRecord(supplemental, memberId);
  return { ...record, sourceAnalysisId: result.id, origin: "supplemental-reconstruction" };
}

export function solveFrame(source: FrameProject | AnalysisInputSnapshot, onStage?: (stage: AnalysisStage) => void): AnalysisResult {
  onStage?.("model-check");
  if ("projectId" in source && source.solver) {
    try { requireLoadRecoveryVersion(source); }
    catch (error) { throw new AnalysisFailure("model-check", [{ code: "unsupported-solver", message: error instanceof Error ? error.message : "求解配置不支持" }]); }
  }
  requireAnalysisInput(source);
  const input = "projectId" in source ? freezeAnalysisInput({ ...structuredClone(source), solver: { ...ANALYSIS_SOLVER } }) : captureAnalysisInput(source);
  validateCombinationInput(input);
  requireAnalysisInput(input);
  const project = input;
  const nodeIndex = new Map(project.nodes.map((node, index) => [node.id, index])); const size = project.nodes.length * 6;
  const stiffness = zeroMatrix(size, size); const force = zeros(size);
  const memberData: MemberMatrices[] = [];
  onStage?.("assembly");
  for (const member of project.members) {
    const start = project.nodes.find((node) => node.id === member.startNodeId)!; const end = project.nodes.find((node) => node.id === member.endNodeId)!;
    const data = memberMatrices(input, member); const { global } = data;
    if (![...data.local.flat(), ...data.transform.flat(), ...global.flat()].every(Number.isFinite)) throw new AnalysisFailure("assembly", [{ code: "non-finite-stiffness", message: `${member.label} 的单元刚度或转换包含非有限数值，请核查杆长、材料及截面参数量级`, target: { kind: "member", id: member.id }, field: "stiffness" }]);
    const startOffset = nodeIndex.get(start.id)! * 6; const endOffset = nodeIndex.get(end.id)! * 6;
    for (let row = 0; row < 12; row += 1) {
      const index = (row < 6 ? startOffset : endOffset) + row % 6;
      force[index] += data.equivalentGlobalForces[row];
      if (!Number.isFinite(force[index])) throw new AnalysisFailure("assembly", [{ code: "non-finite-load", message: `${member.label} 的等效均布荷载超出有限数值范围`, target: { kind: "member", id: member.id }, field: "intensity" }]);
    }
    for (let row = 0; row < 12; row += 1) for (let column = 0; column < 12; column += 1) {
      const globalRow = (row < 6 ? startOffset : endOffset) + row % 6; const globalColumn = (column < 6 ? startOffset : endOffset) + column % 6;
      stiffness[globalRow][globalColumn] += global[row][column];
      if (!Number.isFinite(stiffness[globalRow][globalColumn])) throw new AnalysisFailure("assembly", [{ code: "non-finite-stiffness", message: `组装 ${member.label} 时整体刚度出现非有限数值`, target: { kind: "member", id: member.id }, field: "stiffness" }]);
    }
    memberData.push(data);
  }
  for (const load of project.nodalLoads) {
    const offset = nodeIndex.get(load.nodeId)! * 6; force[offset] += load.force.x; force[offset + 1] += load.force.y; force[offset + 2] += load.force.z; force[offset + 3] += load.moment.x; force[offset + 4] += load.moment.y; force[offset + 5] += load.moment.z;
    if (!force.slice(offset, offset + 6).every(Number.isFinite)) throw new AnalysisFailure("assembly", [{ code: "non-finite-load", message: `叠加 ${load.label} 时荷载向量出现非有限数值`, target: { kind: "load", id: load.id }, field: "force/moment" }]);
  }
  const constrained = new Set<number>();
  for (const support of project.supports) { const offset = nodeIndex.get(support.nodeId)! * 6; support.restraints.forEach((restrained, index) => { if (restrained) constrained.add(offset + index); }); }
  const freeDofs = Array.from({ length: size }, (_, index) => index).filter((index) => !constrained.has(index));
  onStage?.("solve");
  const freeDisplacement = solveLinearSystem(freeDofs.map((row) => freeDofs.map((column) => stiffness[row][column])), freeDofs.map((index) => force[index]), freeDofs, project.nodes);
  const displacement = zeros(size);
  freeDofs.forEach((dof, index) => { displacement[dof] = freeDisplacement[index]; });
  onStage?.("recovery");
  const residual = zeros(size); for (let row = 0; row < size; row += 1) { let value = -force[row]; for (let column = 0; column < size; column += 1) value += stiffness[row][column] * displacement[column]; residual[row] = value; }
  for (let index = 0; index < size; index += 1) if (!Number.isFinite(residual[index])) throw new AnalysisFailure("recovery", [{ code: "non-finite-reaction", message: "反力恢复包含非有限数值，分析未完成", target: { kind: "node", id: project.nodes[Math.floor(index / 6)].id }, dof: ANALYSIS_DOF_ORDER[index % 6], field: "reaction" }]);
  const nodes: NodeAnalysisResult[] = project.nodes.map((node, index) => ({ nodeId: node.id, displacement: { x: displacement[index * 6], y: displacement[index * 6 + 1], z: displacement[index * 6 + 2] }, rotation: { x: displacement[index * 6 + 3], y: displacement[index * 6 + 4], z: displacement[index * 6 + 5] }, reaction: { x: residual[index * 6], y: residual[index * 6 + 1], z: residual[index * 6 + 2] }, reactionMoment: { x: residual[index * 6 + 3], y: residual[index * 6 + 4], z: residual[index * 6 + 5] } }));
  const members: MemberAnalysisResult[] = memberData.map(({ member, geometry, local, transform, equivalentLocalForces }) => {
    const startIndex = nodeIndex.get(member.startNodeId)! * 6; const endIndex = nodeIndex.get(member.endNodeId)! * 6; const globalDisplacement = [...displacement.slice(startIndex, startIndex + 6), ...displacement.slice(endIndex, endIndex + 6)]; const localDisplacement = transform.map((row) => row.reduce((sum, value, index) => sum + value * globalDisplacement[index], 0)); const localForce = local.map((row) => row.reduce((sum, value, index) => sum + value * localDisplacement[index], 0));
    for (let index = 0; index < 12; index += 1) localForce[index] -= equivalentLocalForces[index];
    if (![...localDisplacement, ...localForce].every(Number.isFinite)) throw new AnalysisFailure("recovery", [{ code: "non-finite-member-result", message: `${member.label} 的杆件结果包含非有限数值，分析未完成`, target: { kind: "member", id: member.id }, field: "localEndForces" }]);
    return { memberId: member.id, length: geometry.length, localAxes: { x: { ...geometry.localX }, y: { ...geometry.localY }, z: { ...geometry.localZ } }, localEndForces: { start: localForce.slice(0, 6) as MemberAnalysisResult["localEndForces"]["start"], end: localForce.slice(6, 12) as MemberAnalysisResult["localEndForces"]["end"] } };
  });
  const id = `analysis_${globalThis.crypto.randomUUID()}`;
  const process = buildProcessSnapshot(input, nodeIndex, memberData, stiffness, force, constrained, freeDofs);
  return { id, projectId: input.projectId, projectRevision: input.projectRevision, createdAt: new Date().toISOString(), status: "complete", input, nodes, members, process };
}
