import type { AnalysisInputSnapshot } from "./analysis";
import type { MeshLevel } from "./analysis-mesh";
import type { ModalRecord, ModalShape } from "./modal";

/** Check captured engineering shapes against the actual calculation coordinates.
 * No eigensolver or static response reconstruction runs in the renderer. */
export function validateModalShapeMapping(input: AnalysisInputSnapshot, level: MeshLevel, problem: ModalRecord["eigenproblem"], modes: ModalShape[]): void {
  const fail = () => { throw new Error("振型分量与冻结计算坐标不一致"); };
  const near = (a: number, b: number) => Number.isFinite(a) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  const restrained = new Set(input.supports.flatMap((s) => input.dofOrder.filter((_, i) => s.restraints[i]).map((d) => `node:${s.nodeId}:${d}`)));
  const releaseCoordinates = level.elements.flatMap((e) => {
    const m = input.members.find((m) => m.id === e.memberId)!;
    return (["start", "end"] as const).flatMap((end) => {
      if (end === "start" ? e.startNodeId !== m.startNodeId : e.endNodeId !== m.endNodeId) return [];
      return (["my", "mz"] as const).filter((d) => m.endReleases?.[end][d]).map((d) => `release:${e.elementId}:${end}.${d}`);
    });
  });
  const keys = problem.coordinates.map((c) => `${c.kind}:${c.id}:${c.dof}`);
  if (keys.some((k) => restrained.has(k)) || !releaseCoordinates.every((k) => keys.includes(k)) || keys.filter((k) => k.startsWith("release:")).length !== releaseCoordinates.length) fail();
  // A valid null-rotation record may remove a disconnected rotation only.
  // All other unconstrained calculation coordinates must occur exactly once.
  if (!Array.isArray(problem.releaseNullRotations)) fail();
  const calculationNodeIds = [...input.nodes.map((n) => n.id as string), ...level.nodes.map((n) => n.nodeId)];
  const gauges = new Set<string>();
  for (const record of problem.releaseNullRotations) {
    const node = calculationNodeIds.indexOf(record.nodeId), d = record.direction;
    if (node < 0 || !Number.isSafeInteger(record.gaugeDof) || record.gaugeDof < node * 6 + 3 || record.gaugeDof > node * 6 + 5
      || !d || ![d.x, d.y, d.z].every(Number.isFinite) || Math.abs(Math.hypot(d.x, d.y, d.z) - 1) > 1e-9) fail();
    const direction = [d.x, d.y, d.z], key = `node:${record.nodeId}:${input.dofOrder[record.gaugeDof % 6]}`;
    if (gauges.has(key) || restrained.has(key) || Math.abs(direction[record.gaugeDof % 6 - 3]) < 1e-9) fail();
    for (let axis = 0; axis < 3; axis++) if ((restrained.has(`node:${record.nodeId}:${input.dofOrder[3 + axis]}`) || gauges.has(`node:${record.nodeId}:${input.dofOrder[3 + axis]}`)) && Math.abs(direction[axis]) > 1e-9) fail();
    for (const element of level.elements.filter((e) => e.startNodeId === record.nodeId || e.endNodeId === record.nodeId)) {
      const member = input.members.find((m) => m.id === element.memberId)!, frame = input.meshPlan!.frames[element.memberId];
      const end = element.startNodeId === record.nodeId && record.nodeId === member.startNodeId ? member.endReleases?.start
        : element.endNodeId === record.nodeId && record.nodeId === member.endNodeId ? member.endReleases?.end : undefined;
      const dot = (axis: typeof d) => axis.x * d.x + axis.y * d.y + axis.z * d.z;
      if (Math.abs(dot(frame.localX)) > 1e-9 || !end?.my && Math.abs(dot(frame.localY)) > 1e-9 || !end?.mz && Math.abs(dot(frame.localZ)) > 1e-9) fail();
    }
    gauges.add(key);
  }
  const expectedKeys = calculationNodeIds.flatMap((id) => input.dofOrder.map((dof) => `node:${id}:${dof}`)).filter((key) => !restrained.has(key) && !gauges.has(key)).concat(releaseCoordinates);
  if (keys.length !== expectedKeys.length || keys.some((key, i) => key !== expectedKeys[i])) fail();
  for (const [modeIndex, mode] of modes.entries()) {
    const coordinates = new Map(keys.map((key, i) => [key, problem.vectors[modeIndex][i]]));
    const nodeValues = (nodeId: string) => input.dofOrder.map((dof) => coordinates.get(`node:${nodeId}:${dof}`) ?? 0);
    for (const n of mode.nodes) {
      const values = nodeValues(n.nodeId);
      if ([n.translation.x, n.translation.y, n.translation.z, n.rotation.x, n.rotation.y, n.rotation.z].some((x, i) => !near(x, values[i]))) fail();
    }
    for (const member of mode.members) {
      const elements = level.elements.filter((e) => e.memberId === member.memberId), frame = input.meshPlan!.frames[member.memberId];
      const axes = [frame.localX, frame.localY, frame.localZ];
      for (const [station, sample] of member.samples.entries()) {
        const scaled = station * level.divisions, segment = Math.min(level.divisions - 1, Math.floor(scaled / 16)), t = (scaled - segment * 16) / 16;
        const element = elements[segment], length = element.end - element.start;
        const global = [...nodeValues(element.startNodeId), ...nodeValues(element.endNodeId)];
        const local = Array.from({ length: 12 }, (_, i) => {
          const block = Math.floor(i / 3), axis = axes[i % 3], offset = block * 3;
          return axis.x * global[offset] + axis.y * global[offset + 1] + axis.z * global[offset + 2];
        });
        for (const [index, dof] of [[4, "start.my"], [5, "start.mz"], [10, "end.my"], [11, "end.mz"]] as const) {
          const value = coordinates.get(`release:${element.elementId}:${dof}`); if (value !== undefined) local[index] = value;
        }
        const h0 = 1 - 3 * t * t + 2 * t * t * t, h1 = length * (t - 2 * t * t + t * t * t), h2 = 3 * t * t - 2 * t * t * t, h3 = length * (-t * t + t * t * t);
        const xyz = [(1 - t) * local[0] + t * local[6], h0 * local[1] + h1 * local[5] + h2 * local[7] + h3 * local[11], h0 * local[2] - h1 * local[4] + h2 * local[8] - h3 * local[10]];
        for (const key of ["x", "y", "z"] as const) if (!near(sample.translation[key], axes.reduce((sum, axis, i) => sum + axis[key] * xyz[i], 0))) fail();
      }
    }
  }
}
