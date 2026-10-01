import { calculateMemberGeometry, type MemberGeometry } from "./member-geometry";
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

function solveLinearSystem(matrix: Matrix, vector: number[]): number[] {
  const size = vector.length; const a = matrix.map((row, index) => [...row, vector[index]]);
  let scale = 0; for (const row of matrix) for (const value of row) scale = Math.max(scale, Math.abs(value));
  const tolerance = Math.max(scale, 1) * 1e-12;
  for (let pivot = 0; pivot < size; pivot += 1) {
    let selected = pivot;
    for (let row = pivot + 1; row < size; row += 1) if (Math.abs(a[row][pivot]) > Math.abs(a[selected][pivot])) selected = row;
    if (Math.abs(a[selected][pivot]) <= tolerance) throw new Error("结构约束不足或刚度矩阵奇异，无法完成求解");
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
  return result;
}

function snapshot(project: FrameProject): AnalysisInputSnapshot {
  return {
    projectId: project.id, projectRevision: project.revision, dofOrder: [...ANALYSIS_DOF_ORDER],
    assumptions: { theory: "3d-euler-bernoulli-frame", shearDeformation: "neglected", rigidJoints: true, units: "m-kN-kN·m", localAxis: "member-geometry" },
    nodes: project.nodes.map((node) => ({ ...node, position: { ...node.position } })),
    members: project.members.map((member) => ({ ...member })), materials: project.materials.map((material) => ({ ...material })), sections: project.sections.map((section) => ({ ...section })),
    supports: project.supports.map((support) => ({ ...support, restraints: [...support.restraints] as DofRestraints })),
    nodalLoads: project.nodalLoads.map((load) => ({ ...load, force: { ...load.force }, moment: { ...load.moment } })),
  };
}

function requireAnalysisInput(project: FrameProject): void {
  if (project.nodes.length === 0) throw new Error("模型没有节点");
  if (project.members.length === 0) throw new Error("模型没有杆件");
  if (project.members.length !== 1) throw new Error("T03 当前仅支持单根空间杆件；多杆整体求解将在 T04 验证");
  for (const member of project.members) {
    if (!project.nodes.some((node) => node.id === member.startNodeId) || !project.nodes.some((node) => node.id === member.endNodeId)) throw new Error(`杆件 ${member.label} 的节点引用无效`);
    if (!project.materials.some((material) => material.id === member.materialId)) throw new Error(`杆件 ${member.label} 的材料引用无效`);
    if (!project.sections.some((section) => section.id === member.sectionId)) throw new Error(`杆件 ${member.label} 的截面引用无效`);
  }
  for (const support of project.supports) if (!project.nodes.some((node) => node.id === support.nodeId)) throw new Error(`支座 ${support.label} 的节点引用无效`);
  for (const load of project.nodalLoads) if (!project.nodes.some((node) => node.id === load.nodeId)) throw new Error(`节点荷载 ${load.label} 的节点引用无效`);
  if (!project.supports.some((support) => support.restraints.some(Boolean))) throw new Error("请至少设置一个受约束自由度");
}

export function solveFrame(project: FrameProject): AnalysisResult {
  requireAnalysisInput(project);
  const nodeIndex = new Map(project.nodes.map((node, index) => [node.id, index])); const size = project.nodes.length * 6;
  const stiffness = zeroMatrix(size, size); const force = zeros(size);
  const memberData: Array<{ member: FrameMember; geometry: MemberGeometry; local: Matrix; transform: Matrix; global: Matrix }> = [];
  for (const member of project.members) {
    const start = project.nodes.find((node) => node.id === member.startNodeId)!; const end = project.nodes.find((node) => node.id === member.endNodeId)!;
    const material = project.materials.find((item) => item.id === member.materialId)!; const section = project.sections.find((item) => item.id === member.sectionId)!;
    const geometry = calculateMemberGeometry(start.position, end.position, member.rotationDegrees); const local = localStiffness(geometry.length, material, section); const transform = transformation(geometry); const global = matrixMultiply(matrixMultiply(transpose(transform), local), transform);
    const startOffset = nodeIndex.get(start.id)! * 6; const endOffset = nodeIndex.get(end.id)! * 6;
    for (let row = 0; row < 12; row += 1) for (let column = 0; column < 12; column += 1) {
      const globalRow = (row < 6 ? startOffset : endOffset) + row % 6; const globalColumn = (column < 6 ? startOffset : endOffset) + column % 6;
      stiffness[globalRow][globalColumn] += global[row][column];
    }
    memberData.push({ member, geometry, local, transform, global });
  }
  for (const load of project.nodalLoads) {
    const offset = nodeIndex.get(load.nodeId)! * 6; force[offset] += load.force.x; force[offset + 1] += load.force.y; force[offset + 2] += load.force.z; force[offset + 3] += load.moment.x; force[offset + 4] += load.moment.y; force[offset + 5] += load.moment.z;
  }
  const constrained = new Set<number>();
  for (const support of project.supports) { const offset = nodeIndex.get(support.nodeId)! * 6; support.restraints.forEach((restrained, index) => { if (restrained) constrained.add(offset + index); }); }
  if (constrained.size === 0) throw new Error("请至少设置一个受约束自由度");
  const constrainedStiffness = stiffness.map((row, rowIndex) => row.map((value, columnIndex) => constrained.has(rowIndex) || constrained.has(columnIndex) ? (rowIndex === columnIndex ? 1 : 0) : value));
  const constrainedForce = force.map((value, index) => constrained.has(index) ? 0 : value);
  const displacement = solveLinearSystem(constrainedStiffness, constrainedForce);
  const residual = zeros(size); for (let row = 0; row < size; row += 1) { let value = -force[row]; for (let column = 0; column < size; column += 1) value += stiffness[row][column] * displacement[column]; residual[row] = value; }
  if (![...displacement, ...residual].every(Number.isFinite)) throw new Error("求解结果包含非有限数值，分析未完成");
  const nodes: NodeAnalysisResult[] = project.nodes.map((node, index) => ({ nodeId: node.id, displacement: { x: displacement[index * 6], y: displacement[index * 6 + 1], z: displacement[index * 6 + 2] }, rotation: { x: displacement[index * 6 + 3], y: displacement[index * 6 + 4], z: displacement[index * 6 + 5] }, reaction: { x: residual[index * 6], y: residual[index * 6 + 1], z: residual[index * 6 + 2] }, reactionMoment: { x: residual[index * 6 + 3], y: residual[index * 6 + 4], z: residual[index * 6 + 5] } }));
  const members: MemberAnalysisResult[] = memberData.map(({ member, geometry, local, transform }) => {
    const startIndex = nodeIndex.get(member.startNodeId)! * 6; const endIndex = nodeIndex.get(member.endNodeId)! * 6; const globalDisplacement = [...displacement.slice(startIndex, startIndex + 6), ...displacement.slice(endIndex, endIndex + 6)]; const localDisplacement = transform.map((row) => row.reduce((sum, value, index) => sum + value * globalDisplacement[index], 0)); const localForce = local.map((row) => row.reduce((sum, value, index) => sum + value * localDisplacement[index], 0));
    if (![...localDisplacement, ...localForce].every(Number.isFinite)) throw new Error("杆件结果包含非有限数值，分析未完成");
    return { memberId: member.id, length: geometry.length, localAxes: { x: { ...geometry.localX }, y: { ...geometry.localY }, z: { ...geometry.localZ } }, localEndForces: { start: localForce.slice(0, 6) as MemberAnalysisResult["localEndForces"]["start"], end: localForce.slice(6, 12) as MemberAnalysisResult["localEndForces"]["end"] } };
  });
  return { id: `analysis_${globalThis.crypto.randomUUID()}`, projectId: project.id, projectRevision: project.revision, createdAt: new Date().toISOString(), status: "complete", input: snapshot(project), nodes, members };
}
