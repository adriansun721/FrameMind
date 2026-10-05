import { addMaterial, addMember, addNodalLoad, addNode, addSection, addSupport, createProject, type FrameProject, type Vector3 } from "../domain/project";

function model(name: string, positions: Vector3[]): FrameProject {
  let project = createProject(name);
  project = addMaterial(project, { name: "Steel", elasticModulusGPa: 200, poissonRatio: .3, densityKgM3: 7850 });
  project = addSection(project, { name: "Reference", areaM2: .01, secondMomentYM4: .0001, secondMomentZM4: .0001, torsionalConstantM4: .0001 });
  for (const position of positions) project = addNode(project, position);
  for (let i = 0; i < positions.length; i += 2) {
    project = addMember(project, { startNodeId: project.nodes[i].id, endNodeId: project.nodes[i + 1].id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 17.5 });
    project = addSupport(project, project.nodes[i].id, [true, true, true, true, true, true]);
  }
  return project;
}

export function freeGeometryFixtures() {
  let diagonal = model("T2-18 negative off-grid diagonal", [{ x: -123.125, y: -51.25, z: -.5 }, { x: -120.125, y: -51.25, z: 3.5 }]);
  diagonal = addNodalLoad(diagonal, diagonal.nodes[1].id, { x: 6, y: 0, z: 8 }, { x: 0, y: 0, z: 0 });
  let close = model("T2-18 large coordinates small spacing", [{ x: 1e9 + .125, y: -1e9 - .25, z: 1e9 + .5 }, { x: 1e9 + .1251220703125, y: -1e9 - .25, z: 1e9 + .5 }]);
  close = addSupport(close, close.nodes[1].id, [false, true, true, true, true, true]);
  close = addNodalLoad(close, close.nodes[1].id, { x: 8, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  let crossing = model("T2-18 crossing without connection", [{ x: -2, y: -2, z: .5 }, { x: 2, y: 2, z: .5 }, { x: -2, y: 2, z: .5 }, { x: 2, y: -2, z: .5 }]);
  crossing = addNodalLoad(crossing, crossing.nodes[1].id, { x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: 0 });
  // Independent axial PL/EA and cantilever PL^3/(3EI) values, canonical m/kN.
  return [
    { id: "diagonal", project: diagonal, expectedTip: { x: .000015, y: 0, z: .000020 } },
    { id: "large-close", project: close, expectedTip: { x: 4.8828125e-10, y: 0, z: 0 } },
    { id: "crossing", project: crossing, expectedTip: { x: 0, y: 0, z: -.03016988933062603 } },
  ];
}
