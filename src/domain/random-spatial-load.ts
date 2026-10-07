import type { AnalysisResult } from "./analysis";
import type { Vector3 } from "./project";
import type { RandomAction } from "./random-response";

/** Exact integral of the frozen EB displacement over every calculation element,
 * including independent end rotations at releases. Never uses display samples. */
export function randomActionShape(modal: AnalysisResult, modeIndex: number, action: RandomAction): Vector3 {
  const record = modal.modal!, mode = record.modes[modeIndex];
  if (action.kind === "base-translation") {
    // -phi^T M r: exact consistent EB rigid-translation load, including
    // constrained endpoint coupling, structural/line mass and point masses.
    const participation = { x: 0, y: 0, z: 0 };
    for (const member of modal.input.members) {
      const mass = record.sources.find((s) => s.memberId === member.id)!;
      const shape = randomActionShape(modal, modeIndex, { kind: "member-uniform", memberId: member.id, direction: action.direction, scalePerM: 1 });
      const lineMass = (mass.densityKgM3 * modal.input.sections.find((s) => s.id === member.sectionId)!.areaM2 + (member.additionalLineMassKgM ?? 0)) / 1000;
      for (const axis of ["x", "y", "z"] as const) participation[axis] -= lineMass * shape[axis];
    }
    for (const node of modal.input.nodes) {
      const shape = mode.nodes.find((n) => n.nodeId === node.id)!.translation;
      for (const axis of ["x", "y", "z"] as const) participation[axis] -= (node.additionalMassKg ?? 0) / 1000 * shape[axis];
    }
    if (!Object.values(participation).every(Number.isFinite)) throw new Error("基底质量参与超出有限数值范围");
    return participation;
  }
  if (action.kind === "node") return mode.nodes.find((n) => n.nodeId === action.nodeId)!.translation;
  const input = modal.input, level = input.meshPlan!.levels.find((l) => l.divisions === record.selectedDivisions)!;
  const values = new Map(record.eigenproblem.coordinates.map((c, i) => [`${c.kind}:${c.id}:${c.dof}`, record.eigenproblem.vectors[modeIndex][i]]));
  const frame = input.meshPlan!.frames[action.memberId], axes = [frame.localX, frame.localY, frame.localZ];
  const integral = { x: 0, y: 0, z: 0 };
  for (const element of level.elements.filter((e) => e.memberId === action.memberId)) {
    const global = [element.startNodeId, element.endNodeId].flatMap((id) => input.dofOrder.map((dof) => values.get(`node:${id}:${dof}`) ?? 0));
    const local = Array.from({ length: 12 }, (_, i) => {
      const offset = Math.floor(i / 3) * 3, axis = axes[i % 3];
      return axis.x * global[offset] + axis.y * global[offset + 1] + axis.z * global[offset + 2];
    });
    for (const [index, dof] of [[4, "start.my"], [5, "start.mz"], [10, "end.my"], [11, "end.mz"]] as const) {
      const released = values.get(`release:${element.elementId}:${dof}`);
      if (released !== undefined) local[index] = released;
    }
    const l = element.end - element.start;
    const xyz = [l / 2 * (local[0] + local[6]), l / 2 * (local[1] + local[7]) + l * l / 12 * (local[5] - local[11]),
      l / 2 * (local[2] + local[8]) - l * l / 12 * (local[4] - local[10])];
    for (const key of ["x", "y", "z"] as const) integral[key] += axes.reduce((sum, axis, i) => sum + axis[key] * xyz[i], 0);
  }
  if (!Object.values(integral).every(Number.isFinite)) throw new Error("随机空间作用或响应超出有限数值范围");
  return integral;
}
