import { addLoadCase, addLoadCombination, addMaterial, addMember, addNodalLoad, addNode, addSection, addSupport, addUniformLoad, createProject, selectLoadCombination, updateSelfWeight, type ProjectId } from "../domain/project";

export const PERFORMANCE_MODELS = [
  { id: "S", x: 3, y: 4, storeys: 2, members: 58, solveLimitMs: 10_000 },
  { id: "M", x: 7, y: 7, storeys: 3, members: 399, solveLimitMs: 20_000 },
  { id: "L", x: 10, y: 10, storeys: 4, members: 1120, solveLimitMs: 30_000 },
] as const;

/** Fixed engineering assumptions registered in ADR-0033 before measurement. */
export function createPerformanceModel(spec: typeof PERFORMANCE_MODELS[number]) {
  let project = createProject(`T32-${spec.id}-${spec.members}杆`);
  project = { ...project, id: `project_T32_${spec.id}` as ProjectId, createdAt: "2026-10-02T00:00:00.000Z" };
  project = addMaterial(project, { name: "测量钢材", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  project = addSection(project, { name: "测量截面", areaM2: .02, secondMomentYM4: .0002, secondMomentZM4: .0003, torsionalConstantM4: .0001 });
  project = addLoadCase(project, "顶层水平荷载");
  const index = (x: number, y: number, z: number) => z * spec.x * spec.y + y * spec.x + x;
  for (let z = 0; z <= spec.storeys; z++) for (let y = 0; y < spec.y; y++) for (let x = 0; x < spec.x; x++) {
    project = addNode(project, { x: x * 5, y: y * 5, z: z * 3 });
    const node = project.nodes.at(-1)!;
    if (z === 0) project = addSupport(project, node.id, [true, true, true, true, true, true]);
    else project = addNodalLoad(project, node.id, { x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: 0 }, "LC1");
    if (z === spec.storeys) project = addNodalLoad(project, node.id, { x: 2, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }, "LC2");
  }
  const member = (a: number, b: number, beam: boolean) => {
    project = addMember(project, { startNodeId: project.nodes[a].id, endNodeId: project.nodes[b].id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
    if (beam) project = addUniformLoad(project, { kind: "uniform", memberId: project.members.at(-1)!.id, coordinateSystem: "global", loadCaseId: "LC1", intensity: { x: 0, y: 0, z: -2 } });
  };
  for (let z = 1; z <= spec.storeys; z++) for (let y = 0; y < spec.y; y++) for (let x = 0; x < spec.x; x++) {
    member(index(x, y, z - 1), index(x, y, z), false);
    if (x > 0) member(index(x - 1, y, z), index(x, y, z), true);
    if (y > 0) member(index(x, y - 1, z), index(x, y, z), true);
  }
  project = updateSelfWeight(project, { enabled: true, loadCaseId: "LC1", gravity: { x: 0, y: 0, z: -9.81 } });
  project = addLoadCombination(project, "固定性能组合", [{ loadCaseId: "LC1", factor: 1.2 }, { loadCaseId: "LC2", factor: 1.4 }]);
  return { ...selectLoadCombination(project, "CB1"), updatedAt: "2026-10-02T00:00:00.000Z" };
}
