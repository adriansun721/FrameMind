import { addAnalysisCase, addLoadCase, addMaterial, addMember, addNodalLoad, addNode, addSection, addSupport, addUniformLoad, createProject, selectAnalysisCase, updateSelfWeight, type ProjectId } from "../domain/project";
import { DEFAULT_SECOND_ORDER_SETTINGS } from "../domain/second-order";
import { DEFAULT_BUCKLING_SETTINGS } from "../domain/buckling";
import { DEFAULT_MODAL_SETTINGS } from "../domain/modal";
import { DEFAULT_MESH_POLICY } from "../domain/analysis-mesh";

/** Fixed before formal measurement in T2-42 protocol v1. No artificial restraints. */
export const PLAN2_PERFORMANCE_MODELS = [
  { id: "target", width: 10, floors: 9, diagonals: 480, nodes: 1000, members: 3000 },
  { id: "larger", width: 12, floors: 9, diagonals: 720, nodes: 1440, members: 4392 },
] as const;

export function createPlan2PerformanceModel(spec: typeof PLAN2_PERFORMANCE_MODELS[number]) {
  let p = createProject(`T2-42-${spec.id}`);
  p = { ...p, id: `project_T242_${spec.id}` as ProjectId, createdAt: "2026-10-07T00:00:00.000Z" };
  p = addMaterial(p, { name: "Registered E200 steel", elasticModulusGPa: 200, poissonRatio: .3, densityKgM3: 7850 });
  p = addSection(p, { name: "RHS 200x400x10", geometry: { shape: "rectangular-tube", width: .2, height: .4, thickness: .01 } });
  p = addLoadCase(p, "Fixed gravity pattern");
  const index = (x: number, y: number, z: number) => z * spec.width ** 2 + y * spec.width + x;
  for (let z = 0; z <= spec.floors; z++) for (let y = 0; y < spec.width; y++) for (let x = 0; x < spec.width; x++) {
    p = addNode(p, { x: x * 5, y: y * 5, z: z * 3 });
    const node = p.nodes.at(-1)!;
    if (z === 0) p = addSupport(p, node.id, [true, true, true, true, true, true]);
    else p = addNodalLoad(p, node.id, { x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: 0 }, "LC2");
    if (z === spec.floors) p = addNodalLoad(p, node.id, { x: 1, y: .5, z: -10 }, { x: 0, y: 0, z: 0 }, "LC1");
  }
  const member = (a: number, b: number, beam = false) => {
    p = addMember(p, { startNodeId: p.nodes[a].id, endNodeId: p.nodes[b].id, materialId: p.materials[0].id, sectionId: p.sections[0].id, rotationDegrees: 0 });
    if (beam) p = addUniformLoad(p, { kind: "uniform", memberId: p.members.at(-1)!.id, coordinateSystem: "global", loadCaseId: "LC2", intensity: { x: 0, y: 0, z: -2 } });
  };
  for (let z = 1; z <= spec.floors; z++) {
    let diagonals = Math.floor(spec.diagonals / spec.floors) + (z <= spec.diagonals % spec.floors ? 1 : 0);
    for (let y = 0; y < spec.width; y++) for (let x = 0; x < spec.width; x++) {
      member(index(x, y, z - 1), index(x, y, z));
      if (x) member(index(x - 1, y, z), index(x, y, z), true);
      if (y) member(index(x, y - 1, z), index(x, y, z), true);
      if (diagonals && x && y) { member(index(x - 1, y - 1, z), index(x, y, z)); diagonals--; }
    }
  }
  p = updateSelfWeight(p, { enabled: true, loadCaseId: "LC2", gravity: { x: 0, y: 0, z: -9.81 } });
  p = addAnalysisCase(p, { name: "Target static", method: "static", loadSourceId: "LC1", settings: { solver: "native-static", mesh: { ...DEFAULT_MESH_POLICY, maxDivisions: 2 } } });
  p = addAnalysisCase(p, { name: "Target second-order", method: "second-order", loadSourceId: "LC1", settings: { solver: "native-second-order", secondOrder: { ...DEFAULT_SECOND_ORDER_SETTINGS, maxDivisions: 2, maxEquations: 1200 } } });
  p = addAnalysisCase(p, { name: "Target buckling", method: "buckling", loadSourceId: "buckling", settings: { solver: "native-buckling", buckling: { ...structuredClone(DEFAULT_BUCKLING_SETTINGS), fixed: [{ loadCaseId: "LC2", factor: 1 }], reference: [{ loadCaseId: "LC1", factor: 1 }], maxDivisions: 2, maxEquations: 1200 } } });
  p = addAnalysisCase(p, { name: "Target modal", method: "modal", loadSourceId: "structure", settings: { solver: "native-modal", modal: { ...DEFAULT_MODAL_SETTINGS, maxDivisions: 2, maxEquations: 1200 } } });
  if (p.nodes.length !== spec.nodes || p.members.length !== spec.members) throw new Error("Registered performance topology differs from protocol");
  return { ...selectAnalysisCase(p, "AC1"), updatedAt: "2026-10-07T00:00:00.000Z" };
}
