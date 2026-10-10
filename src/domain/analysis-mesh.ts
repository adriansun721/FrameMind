import { calculateMemberGeometry, type MemberGeometry } from "./member-geometry";
import type { AnalysisInputSnapshot, AnalysisResult } from "./analysis";
import type { FrameNode, FrameMember, FrameUniformLoad } from "./project";

export interface MeshPolicy {
  maxDivisions: number;
  maxEquations: number;
  relativeTolerance: number;
  displacementTolerance: number;
  forceTolerance: number;
}
export const DEFAULT_MESH_POLICY: Readonly<MeshPolicy> = Object.freeze({
  maxDivisions: 8, maxEquations: 12000, relativeTolerance: 1e-6,
  displacementTolerance: 1e-12, forceTolerance: 1e-8,
});
export interface MeshLevel {
  divisions: number;
  nodes: Array<{ nodeId: string; memberId: string; position: number; fraction: number }>;
  elements: Array<{ elementId: string; memberId: string; startNodeId: string; endNodeId: string; start: number; end: number }>;
}
export interface MeshPlan { policy: MeshPolicy; frames: Record<string, MemberGeometry>; levels: MeshLevel[] }
export interface MeshError { displacement: number; reaction: number; sectionForce: number }
export interface MeshRun { divisions: number; result: AnalysisResult; error?: MeshError }
export interface DiscretizationRecord {
  status: "converged" | "budget-exhausted";
  reason: "tolerance" | "max-divisions" | "equation-budget";
  selectedDivisions: number;
  counts: { engineeringNodes: number; engineeringMembers: number; calculationNodes: number; calculationElements: number; totalDofs: number; constrainedDofs: number; releaseGaugeDofs: number; equations: number };
  runs: MeshRun[];
}

export function validateMeshPolicy(value: unknown): MeshPolicy {
  const p = value as MeshPolicy;
  if (!p || Object.keys(p).sort().join() !== Object.keys(DEFAULT_MESH_POLICY).sort().join()
    || ![1, 2, 4, 8, 16].includes(p.maxDivisions) || !Number.isSafeInteger(p.maxEquations) || p.maxEquations < 1 || p.maxEquations > 2147483647
    || ![p.relativeTolerance, p.displacementTolerance, p.forceTolerance].every((v) => Number.isFinite(v) && v > 0)
    || p.relativeTolerance > 1e-2 || p.displacementTolerance > 1e-6 || p.forceTolerance > 1e-3) throw new Error("内部细分精度或计算预算无效");
  return { ...p };
}

/** Every candidate mapping is frozen before dispatch; no new engineering identities are allocated. */
export function createMeshPlan(input: AnalysisInputSnapshot, policy: MeshPolicy = { ...DEFAULT_MESH_POLICY }): MeshPlan {
  const p = validateMeshPolicy(policy), levels: MeshLevel[] = [], frames: MeshPlan["frames"] = {};
  const ids = new Set([...input.nodes, ...input.members, ...(input.uniformLoads ?? []), ...(input.combination?.cases.flatMap((c) => c.uniformLoads) ?? [])].map((o) => o.id as string));
  const reserve = (id: string) => { if (ids.has(id)) throw new Error("内部计算身份与工程对象冲突"); ids.add(id); return id; };
  for (let divisions = 1; divisions <= p.maxDivisions; divisions *= 2) {
    const nodes: MeshLevel["nodes"] = [], elements: MeshLevel["elements"] = [];
    for (const [memberIndex, member] of input.members.entries()) {
      const a = input.nodes.find((n) => n.id === member.startNodeId), b = input.nodes.find((n) => n.id === member.endNodeId);
      if (!a || !b) throw new Error("细分杆件缺少工程端点");
      const geometry = calculateMemberGeometry(a.position, b.position, member.rotationDegrees), length = geometry.length;
      frames[member.id] = geometry;
      const endpoints = [member.startNodeId as string];
      for (let i = 1; i < divisions; i++) {
        const nodeId = reserve(`__mesh_${divisions}_n_${memberIndex}_${i}`);
        nodes.push({ nodeId, memberId: member.id, position: length * i / divisions, fraction: i / divisions }); endpoints.push(nodeId);
      }
      endpoints.push(member.endNodeId);
      for (let i = 0; i < divisions; i++) elements.push({ elementId: reserve(`__mesh_${divisions}_e_${memberIndex}_${i}`), memberId: member.id, startNodeId: endpoints[i], endNodeId: endpoints[i + 1], start: length * i / divisions, end: length * (i + 1) / divisions });
    }
    levels.push({ divisions, nodes, elements });
  }
  return { policy: p, frames, levels };
}

/** Material, section, orientation and distributed-load coordinates are inherited unchanged. */
export function meshCalculationInput(input: AnalysisInputSnapshot, level: MeshLevel): AnalysisInputSnapshot {
  const frames = input.meshPlan!.frames;
  const calculationFrames = Object.fromEntries(level.elements.map((entry) => [entry.elementId, { ...structuredClone(frames[entry.memberId]), length: entry.end - entry.start }]));
  const nodes = [...structuredClone(input.nodes), ...level.nodes.map((entry): FrameNode => {
    const member = input.members.find((m) => m.id === entry.memberId)!;
    const a = input.nodes.find((n) => n.id === member.startNodeId)!.position, b = input.nodes.find((n) => n.id === member.endNodeId)!.position;
    return { id: entry.nodeId as FrameNode["id"], label: entry.nodeId, position: { x: a.x + (b.x - a.x) * entry.fraction, y: a.y + (b.y - a.y) * entry.fraction, z: a.z + (b.z - a.z) * entry.fraction } };
  })];
  const members = level.elements.map((entry): FrameMember => {
    const original = input.members.find((m) => m.id === entry.memberId)!;
    const rigid = { my: false, mz: false };
    return { ...structuredClone(original), id: entry.elementId as FrameMember["id"], label: entry.elementId, startNodeId: entry.startNodeId as FrameNode["id"], endNodeId: entry.endNodeId as FrameNode["id"],
      ...(original.endReleases ? { endReleases: { start: entry.startNodeId === original.startNodeId ? { ...original.endReleases.start } : { ...rigid }, end: entry.endNodeId === original.endNodeId ? { ...original.endReleases.end } : { ...rigid } } } : {}) };
  });
  const loads = (originals: FrameUniformLoad[]) => originals.flatMap((load, index) => level.elements.filter((e) => e.memberId === load.memberId).map((e, i) => ({ ...structuredClone(load), id: `__mesh_${level.divisions}_q_${index}_${i}` as FrameUniformLoad["id"], label: `__mesh_q_${index}_${i}`, memberId: e.elementId as FrameMember["id"] })));
  const { meshPlan: _plan, ...base } = structuredClone(input);
  const effective = loads(input.uniformLoads ?? []).map((load, i) => input.combination ? { ...load, id: `uniform_load_${String(i + 1).padStart(4, "0")}` as FrameUniformLoad["id"], label: `Q${i + 1}` } : load);
  return { ...base, calculationFrames, solver: { implementation: "framemind-native/3", algorithm: "sparse-ldlt", constraints: "free-dof-elimination", relativePivotTolerance: 1e-12 }, nodes, members, uniformLoads: effective,
    ...(input.combination ? { combination: { definition: structuredClone(input.combination.definition), cases: input.combination.cases.map((c) => ({ ...structuredClone(c), uniformLoads: loads(c.uniformLoads) })) } } : {}) };
}

export function selectedMeshLevel(result: AnalysisResult): MeshLevel | undefined {
  return result.input.meshPlan?.levels.find((l) => l.divisions === (result.secondOrder?.selectedDivisions ?? result.discretization?.selectedDivisions));
}
