import type { FrameMember, FrameNode } from "./project";
import { calculateMemberGeometry } from "./member-geometry";

/** Zero removes an explicit mass. Only isotropic translational inertia is supported. */
export function validateAdditionalMass(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("附加质量必须是非负有限数值；仅支持各向同性平移质量");
  return value;
}

export function additionalMassSources(input: { nodes: FrameNode[]; members: FrameMember[] }) {
  input.nodes.forEach((n) => validateAdditionalMass(n.additionalMassKg ?? 0));
  input.members.forEach((m) => validateAdditionalMass(m.additionalLineMassKgM ?? 0));
  const points = input.nodes.filter((n) => (n.additionalMassKg ?? 0) > 0).map((n) => ({ kind: "point" as const, nodeId: n.id, massKg: validateAdditionalMass(n.additionalMassKg) }));
  const lines = input.members.filter((m) => (m.additionalLineMassKgM ?? 0) > 0).map((m) => {
    const lengthM = calculateMemberGeometry(input.nodes.find((n) => n.id === m.startNodeId)!.position, input.nodes.find((n) => n.id === m.endNodeId)!.position, m.rotationDegrees).length;
    const massPerLengthKgM = validateAdditionalMass(m.additionalLineMassKgM), massKg = massPerLengthKgM * lengthM;
    if (!Number.isFinite(massKg)) throw new Error("附加线质量总量超出有限数值范围");
    return { kind: "line" as const, memberId: m.id, massPerLengthKgM, lengthM, massKg };
  });
  const sources = [...points, ...lines], totalMassKg = sources.reduce((sum, s) => sum + s.massKg, 0);
  if (!Number.isFinite(totalMassKg)) throw new Error("附加质量总量超出有限数值范围");
  return { sources, totalMassKg };
}
