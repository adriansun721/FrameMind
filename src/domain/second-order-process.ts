import { getFrozenMemberCoefficients, getMemberAnalysisRecord, type AnalysisResult, type MemberResponseSample } from "./analysis";
import { initialStressGeometric, hermiteSlope } from "./initial-stress";
import type { SecondOrderCalculation } from "./second-order";

export const secondOrderNear = (a: unknown, b: unknown): boolean => {
  if (typeof b === "number") return typeof a === "number" && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 + Math.abs(b) * 1e-9;
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((x, i) => secondOrderNear(a[i], x));
  if (b && typeof b === "object") return Boolean(a && typeof a === "object" && Object.keys(b).every((key) => secondOrderNear((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])));
  return a === b;
};
const product = (matrix: number[][], vector: number[]) => matrix.map((row) => row.reduce((sum, x, i) => sum + x * vector[i], 0));
type CoordinateMap = Array<Array<[number, number]>>;
export function secondOrderSystem(calculation: SecondOrderCalculation) {
  const linear = calculation.linearRun, input = linear.input, coordinates = calculation.coordinates;
  const keys = new Map(coordinates.map((c, i) => [`${c.kind}:${c.id}:${c.dof}`, i]));
  const force = Array<number>(coordinates.length).fill(0), diagonal = [...force];
  for (const load of input.nodalLoads) {
    const values = [load.force.x, load.force.y, load.force.z, load.moment.x, load.moment.y, load.moment.z];
    input.dofOrder.forEach((dof, i) => { const index = keys.get(`node:${load.nodeId}:${dof}`); if (index !== undefined) force[index] += values[i]; });
  }
  const elements = input.members.map((member, index) => {
    const coefficients = getFrozenMemberCoefficients(input, member.id), record = getMemberAnalysisRecord(linear, member.id);
    const geometry = input.calculationFrames![member.id], axes = [geometry.localX, geometry.localY, geometry.localZ];
    const map: CoordinateMap = Array.from({ length: 12 }, (_, local) => {
      const end = local < 6 ? "start" : "end", dof = local % 6, nodeId = end === "start" ? member.startNodeId : member.endNodeId;
      const release = dof === 4 ? member.endReleases?.[end].my : dof === 5 ? member.endReleases?.[end].mz : false;
      if (release) return [[keys.get(`release:${member.id}:${end}.${dof === 4 ? "my" : "mz"}`)!, 1]];
      return (["x", "y", "z"] as const).flatMap((key, axis) => {
        const column = keys.get(`node:${nodeId}:${input.dofOrder[(dof >= 3 ? 3 : 0) + axis]}`);
        return column === undefined || axes[dof % 3][key] === 0 ? [] : [[column, axes[dof % 3][key]] as [number, number]];
      });
    });
    const start = -record.localEndForces.start[0], end = record.localEndForces.end[0];
    const k = coefficients.originalLocalStiffness, g = initialStressGeometric(geometry.length, start, end), equivalent = coefficients.originalEquivalentLocalForces;
    for (let r = 0; r < 12; r++) for (const [row, a] of map[r]) {
      force[row] += a * equivalent[r];
      for (let c = 0; c < 12; c++) for (const [column, b] of map[c]) if (row === column) diagonal[row] += a * k[r][c] * b;
    }
    const localVector = (q: number[]) => map.map((row) => row.reduce((sum, [column, x]) => sum + x * q[column], 0));
    return { member, index, geometry, axes, map, k, g, equivalent, start, end, localVector };
  });
  const multiply = (q: number[], alpha: number) => {
    const output = Array<number>(coordinates.length).fill(0);
    for (const e of elements) {
      const v = e.localVector(q), kv = product(e.k, v), gv = product(e.g, v);
      e.map.forEach((row, i) => { for (const [column, x] of row) output[column] += x * (kv[i] + alpha * gv[i]); });
    }
    return output;
  };
  const matrices = () => {
    const result = [0, 1].map(() => Array.from({ length: coordinates.length }, () => Array<number>(coordinates.length).fill(0)));
    for (const e of elements) for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) for (const [row, a] of e.map[r]) for (const [column, b] of e.map[c]) {
      result[0][row][column] += a * e.k[r][c] * b; result[1][row][column] += a * e.g[r][c] * b;
    }
    return result;
  };
  return { input, force, diagonal, elements, multiply, matrices };
}
export function secondOrderElementSample(e: ReturnType<typeof secondOrderSystem>["elements"][number], v: number[], ends: number[], position: number): Omit<MemberResponseSample, "analysisId" | "memberId"> {
  const l = e.geometry.length, t = position / l;
  if (!Number.isFinite(position) || position < 0 || position > l) throw new Error("二阶沿杆位置超出范围");
  const h0 = 1 - 3 * t * t + 2 * t * t * t, h1 = l * (t - 2 * t * t + t * t * t), h2 = 3 * t * t - 2 * t * t * t, h3 = l * (-t * t + t * t * t);
  const local = [(1 - t) * v[0] + t * v[6] + e.equivalent[0] * 2 / l * position * (l - position) / (2 * e.k[0][0] * l), h0 * v[1] + h1 * v[5] + h2 * v[7] + h3 * v[11], h0 * v[2] - h1 * v[4] + h2 * v[8] - h3 * v[10]];
  let iy = 0, iz = 0;
  for (const point of [.5 - Math.sqrt(3) / 6, .5 + Math.sqrt(3) / 6]) {
    const r = t * point, n = e.start * (1 - r) + e.end * r, s = hermiteSlope(l, r);
    iy += position * .5 * n * (s[0] * v[1] + s[1] * v[5] + s[2] * v[7] + s[3] * v[11]);
    iz += position * .5 * n * (s[0] * v[2] - s[1] * v[4] + s[2] * v[8] - s[3] * v[10]);
  }
  const intensity = e.equivalent.slice(0, 3).map((x) => x * 2 / l), forces = ends.slice(0, 6).map((x) => -x);
  for (let i = 0; i < 3; i++) forces[i] -= intensity[i] * position;
  forces[4] += -ends[2] * position - intensity[2] * position ** 2 / 2 - iz;
  forces[5] += ends[1] * position + intensity[1] * position ** 2 / 2 + iy;
  const global = (["x", "y", "z"] as const).map((key) => e.axes.reduce((sum, axis, i) => sum + axis[key] * local[i], 0));
  return { position, forces: forces as MemberResponseSample["forces"], localDisplacement: { x: local[0], y: local[1], z: local[2] }, globalDisplacement: { x: global[0], y: global[1], z: global[2] } };
}
export function recoverSecondOrderCalculation(calculation: SecondOrderCalculation) {
  const system = secondOrderSystem(calculation), { input } = system, q = calculation.vector;
  const values = input.nodes.flatMap((node) => input.dofOrder.map((dof) => q[calculation.coordinates.findIndex((c) => c.kind === "node" && c.id === node.id && c.dof === dof)] ?? 0));
  const reactions = Array<number>(values.length).fill(0);
  for (const load of input.nodalLoads) { const n = input.nodes.findIndex((node) => node.id === load.nodeId) * 6; [load.force.x, load.force.y, load.force.z, load.moment.x, load.moment.y, load.moment.z].forEach((x, i) => { reactions[n + i] -= x; }); }
  const localDisplacements: number[][] = [];
  const members = system.elements.map((e) => {
    const v = e.localVector(q), kv = product(e.k, v), gv = product(e.g, v), ends = kv.map((x, i) => x + gv[i] - e.equivalent[i]);
    localDisplacements.push(v);
    const indices = [e.member.startNodeId, e.member.endNodeId].flatMap((id) => input.dofOrder.map((_, i) => input.nodes.findIndex((n) => n.id === id) * 6 + i));
    for (let block = 0; block < 4; block++) for (const [axis, key] of (["x", "y", "z"] as const).entries()) reactions[indices[block * 3 + axis]] += e.axes.reduce((sum, a, i) => sum + a[key] * ends[block * 3 + i], 0);
    return { memberId: e.member.id, length: e.geometry.length, localAxes: { x: e.axes[0], y: e.axes[1], z: e.axes[2] }, localEndForces: { start: ends.slice(0, 6) as AnalysisResult["members"][number]["localEndForces"]["start"], end: ends.slice(6) as AnalysisResult["members"][number]["localEndForces"]["end"] }, nativeResponses: Array.from({ length: 17 }, (_, i) => secondOrderElementSample(e, v, ends, e.geometry.length * i / 16)) };
  });
  const vector3 = (array: number[], offset: number) => ({ x: array[offset], y: array[offset + 1], z: array[offset + 2] });
  const nodes = input.nodes.map((node, i) => ({ nodeId: node.id, displacement: vector3(values, i * 6), rotation: vector3(values, i * 6 + 3), reaction: vector3(reactions, i * 6), reactionMoment: vector3(reactions, i * 6 + 3) }));
  return { nodes, members, localDisplacements, system };
}
export function secondOrderResponsesAt(result: AnalysisResult, memberId: string, positions: number[]): MemberResponseSample[] {
  const record = result.secondOrder!, calculation = record.runs.at(-1)!.calculation;
  const level = result.input.meshPlan!.levels.find((l) => l.divisions === record.selectedDivisions)!, mappings = level.elements.filter((e) => e.memberId === memberId);
  const system = secondOrderSystem(calculation);
  return positions.map((position) => {
    if (!Number.isFinite(position) || position < 0 || position > mappings.at(-1)!.end) throw new Error("二阶沿杆位置超出工程杆长");
    const mapping = mappings.find((m) => position <= m.end) ?? mappings.at(-1)!;
    const e = system.elements.find((e) => e.member.id === mapping.elementId)!, member = calculation.members[e.index];
    return { ...secondOrderElementSample(e, calculation.localDisplacements[e.index], [...member.localEndForces.start, ...member.localEndForces.end], Math.max(0, Math.min(e.geometry.length, position - mapping.start))), analysisId: result.id, memberId, position };
  });
}
