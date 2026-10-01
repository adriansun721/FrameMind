import { calculateMemberGeometry, type MemberGeometry } from "./member-geometry";
import { AnalysisFailure, checkAnalysisInput } from "./analysis-diagnostics";
import type {
  DofRestraints,
  FrameMaterial,
  FrameMember,
  FrameNodalLoad,
  FrameNode,
  FrameProject,
  FrameSection,
  FrameSupport,
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
  implementation: "framemind-frame/2", algorithm: "partial-pivot-gaussian", constraints: "free-dof-elimination", relativePivotTolerance: 1e-12,
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
  nodes: FrameNode[];
  members: FrameMember[];
  materials: FrameMaterial[];
  sections: FrameSection[];
  supports: FrameSupport[];
  nodalLoads: FrameNodalLoad[];
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
}

type Matrix = number[][];

interface MemberMatrices {
  member: FrameMember;
  geometry: MemberGeometry;
  local: Matrix;
  transform: Matrix;
  global: Matrix;
}

export interface MemberAnalysisRecord {
  analysisId: string;
  projectRevision: number;
  origin: "reconstructed-from-frozen-input";
  solver: AnalysisSolverConfig;
  memberId: string;
  dofs: Array<{ nodeId: string; dof: AnalysisDof; globalIndex: number }>;
  geometry: MemberGeometry;
  localStiffness: Matrix;
  transformation: Matrix;
  globalStiffness: Matrix;
  globalDisplacement: number[];
  localDisplacement: number[];
  localEndForces: MemberAnalysisResult["localEndForces"];
}

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

export function captureAnalysisInput(project: FrameProject): AnalysisInputSnapshot {
  return freezeAnalysisInput({
    projectId: project.id, projectRevision: project.revision, dofOrder: [...ANALYSIS_DOF_ORDER],
    solver: { ...ANALYSIS_SOLVER },
    assumptions: { theory: "3d-euler-bernoulli-frame", shearDeformation: "neglected", rigidJoints: true, units: "m-kN-kN·m", localAxis: "member-geometry" },
    nodes: project.nodes.map((node) => ({ ...node, position: { ...node.position } })),
    members: project.members.map((member) => ({ ...member })), materials: project.materials.map((material) => ({ ...material })), sections: project.sections.map((section) => ({ ...section })),
    supports: project.supports.map((support) => ({ ...support, restraints: [...support.restraints] as DofRestraints })),
    nodalLoads: project.nodalLoads.map((load) => ({ ...load, force: { ...load.force }, moment: { ...load.moment } })),
  });
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
  return { member, geometry, local, transform, global: matrixMultiply(matrixMultiply(transpose(transform), local), transform) };
}

function requireCurrentSolver(solver: AnalysisSolverConfig | undefined): void {
  if (!solver || solver.implementation !== ANALYSIS_SOLVER.implementation || solver.algorithm !== ANALYSIS_SOLVER.algorithm || solver.constraints !== ANALYSIS_SOLVER.constraints || solver.relativePivotTolerance !== ANALYSIS_SOLVER.relativePivotTolerance) throw new Error("该分析的求解器版本或配置不支持数值过程重建");
}

export function getMemberAnalysisRecord(result: AnalysisResult, memberId: string): MemberAnalysisRecord {
  requireCurrentSolver(result.input.solver);
  const input = result.input; const member = input.members.find((item) => item.id === memberId);
  if (!member) throw new Error(`本次分析没有杆件 ${memberId}`);
  const { geometry, local, transform, global } = memberMatrices(input, member);
  const dofs = [member.startNodeId, member.endNodeId].flatMap((nodeId) => ANALYSIS_DOF_ORDER.map((dof, index) => ({ nodeId, dof, globalIndex: input.nodes.findIndex((node) => node.id === nodeId) * 6 + index })));
  const globalDisplacement = [member.startNodeId, member.endNodeId].flatMap((nodeId) => {
    const node = result.nodes.find((item) => item.nodeId === nodeId);
    if (!node) throw new Error(`分析结果缺少节点 ${nodeId}`);
    return [node.displacement.x, node.displacement.y, node.displacement.z, node.rotation.x, node.rotation.y, node.rotation.z];
  });
  const stored = result.members.find((item) => item.memberId === memberId);
  if (!stored) throw new Error(`分析结果缺少杆件 ${memberId}`);
  return { analysisId: result.id, projectRevision: result.projectRevision, origin: "reconstructed-from-frozen-input", solver: { ...result.input.solver! }, memberId, dofs, geometry,
    localStiffness: local, transformation: transform, globalStiffness: global, globalDisplacement,
    localDisplacement: transform.map((row) => row.reduce((sum, value, index) => sum + value * globalDisplacement[index], 0)),
    localEndForces: { start: [...stored.localEndForces.start], end: [...stored.localEndForces.end] },
  };
}

export function solveFrame(source: FrameProject | AnalysisInputSnapshot): AnalysisResult {
  if ("projectId" in source && source.solver) {
    try { requireCurrentSolver(source.solver); }
    catch (error) { throw new AnalysisFailure("model-check", [{ code: "unsupported-solver", message: error instanceof Error ? error.message : "求解配置不支持" }]); }
  }
  requireAnalysisInput(source);
  const input = "projectId" in source ? freezeAnalysisInput({ ...structuredClone(source), solver: { ...ANALYSIS_SOLVER } }) : captureAnalysisInput(source);
  const project = input;
  const nodeIndex = new Map(project.nodes.map((node, index) => [node.id, index])); const size = project.nodes.length * 6;
  const stiffness = zeroMatrix(size, size); const force = zeros(size);
  const memberData: MemberMatrices[] = [];
  for (const member of project.members) {
    const start = project.nodes.find((node) => node.id === member.startNodeId)!; const end = project.nodes.find((node) => node.id === member.endNodeId)!;
    const data = memberMatrices(input, member); const { global } = data;
    if (![...data.local.flat(), ...data.transform.flat(), ...global.flat()].every(Number.isFinite)) throw new AnalysisFailure("assembly", [{ code: "non-finite-stiffness", message: `${member.label} 的单元刚度或转换包含非有限数值，请核查杆长、材料及截面参数量级`, target: { kind: "member", id: member.id }, field: "stiffness" }]);
    const startOffset = nodeIndex.get(start.id)! * 6; const endOffset = nodeIndex.get(end.id)! * 6;
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
  const freeDisplacement = solveLinearSystem(freeDofs.map((row) => freeDofs.map((column) => stiffness[row][column])), freeDofs.map((index) => force[index]), freeDofs, project.nodes);
  const displacement = zeros(size);
  freeDofs.forEach((dof, index) => { displacement[dof] = freeDisplacement[index]; });
  const residual = zeros(size); for (let row = 0; row < size; row += 1) { let value = -force[row]; for (let column = 0; column < size; column += 1) value += stiffness[row][column] * displacement[column]; residual[row] = value; }
  for (let index = 0; index < size; index += 1) if (!Number.isFinite(residual[index])) throw new AnalysisFailure("recovery", [{ code: "non-finite-reaction", message: "反力恢复包含非有限数值，分析未完成", target: { kind: "node", id: project.nodes[Math.floor(index / 6)].id }, dof: ANALYSIS_DOF_ORDER[index % 6], field: "reaction" }]);
  const nodes: NodeAnalysisResult[] = project.nodes.map((node, index) => ({ nodeId: node.id, displacement: { x: displacement[index * 6], y: displacement[index * 6 + 1], z: displacement[index * 6 + 2] }, rotation: { x: displacement[index * 6 + 3], y: displacement[index * 6 + 4], z: displacement[index * 6 + 5] }, reaction: { x: residual[index * 6], y: residual[index * 6 + 1], z: residual[index * 6 + 2] }, reactionMoment: { x: residual[index * 6 + 3], y: residual[index * 6 + 4], z: residual[index * 6 + 5] } }));
  const members: MemberAnalysisResult[] = memberData.map(({ member, geometry, local, transform }) => {
    const startIndex = nodeIndex.get(member.startNodeId)! * 6; const endIndex = nodeIndex.get(member.endNodeId)! * 6; const globalDisplacement = [...displacement.slice(startIndex, startIndex + 6), ...displacement.slice(endIndex, endIndex + 6)]; const localDisplacement = transform.map((row) => row.reduce((sum, value, index) => sum + value * globalDisplacement[index], 0)); const localForce = local.map((row) => row.reduce((sum, value, index) => sum + value * localDisplacement[index], 0));
    if (![...localDisplacement, ...localForce].every(Number.isFinite)) throw new AnalysisFailure("recovery", [{ code: "non-finite-member-result", message: `${member.label} 的杆件结果包含非有限数值，分析未完成`, target: { kind: "member", id: member.id }, field: "localEndForces" }]);
    return { memberId: member.id, length: geometry.length, localAxes: { x: { ...geometry.localX }, y: { ...geometry.localY }, z: { ...geometry.localZ } }, localEndForces: { start: localForce.slice(0, 6) as MemberAnalysisResult["localEndForces"]["start"], end: localForce.slice(6, 12) as MemberAnalysisResult["localEndForces"]["end"] } };
  });
  return { id: `analysis_${globalThis.crypto.randomUUID()}`, projectId: input.projectId, projectRevision: input.projectRevision, createdAt: new Date().toISOString(), status: "complete", input, nodes, members };
}
