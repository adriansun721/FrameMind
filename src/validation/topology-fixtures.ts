import { addMaterial, addMember, addNode, addNodalLoad, addSection, addSupport, addUniformLoad, createProject, updateSelfWeight } from "../domain/project";

/** Fixed independent reference: E=200 GPa, I=J=1e-4 m4, A=.01 m2. */
export function topologyFixture(withUniformLoads = false) {
  let project = createProject("T2-20 显式工程拓扑");
  project = addMaterial(project, { name: "Steel", elasticModulusGPa: 200, poissonRatio: .3, densityKgM3: 7850 });
  project = addSection(project, { name: "Reference", areaM2: .01, secondMomentYM4: .0001, secondMomentZM4: .0001, torsionalConstantM4: .0001 });
  for (const position of [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 0, y: -2, z: 0 }, { x: 0, y: 2, z: 0 }]) project = addNode(project, position);
  for (const start of [0, 2]) {
    project = addMember(project, { startNodeId: project.nodes[start].id, endNodeId: project.nodes[start + 1].id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 17.5 });
    project = addSupport(project, project.nodes[start].id, [true, true, true, true, true, true]);
  }
  project = addNodalLoad(project, project.nodes[1].id, { x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: 0 });
  if (withUniformLoads) {
    for (const coordinateSystem of ["global", "local"] as const) project = addUniformLoad(project, { kind: "uniform", memberId: project.members[0].id, coordinateSystem, loadCaseId: "LC1", intensity: { x: 0, y: -2, z: -3 } });
    project = updateSelfWeight(project, { enabled: true, loadCaseId: "LC1", gravity: { x: 0, y: 0, z: -9.81 } });
  }
  return project;
}
