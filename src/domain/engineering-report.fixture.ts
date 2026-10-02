import { solveFrame } from "./analysis";
import { addLoadCase, addLoadCombination, addMaterial, addMember, addNodalLoad, addNode, addSection, addSupport, addUniformLoad, attachAnalysisResult, createProject, selectLoadCombination, updateSelfWeight } from "./project";

/** E=200 GPa, A=.01 m², L=4 m; 10 kN axial load gives ux=.00002 m. */
export function reportFixture(combination = false) {
  let project = createProject("悬臂杆工程计算书基线");
  project = addNode(project, { x: 0, y: 0, z: 0 });
  project = addNode(project, { x: 4, y: 0, z: 0 });
  project = addMaterial(project, { name: "参考钢材", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  project = addSection(project, { name: "参考截面", areaM2: 0.01, secondMomentYM4: 0.0002, secondMomentZM4: 0.0001, torsionalConstantM4: 0.00015 });
  project = addMember(project, { startNodeId: project.nodes[0].id, endNodeId: project.nodes[1].id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
  project = addSupport(project, project.nodes[0].id, [true, true, true, true, true, true]);
  project = addNodalLoad(project, project.nodes[1].id, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  if (combination) {
    project = updateSelfWeight(project, { enabled: true, loadCaseId: "LC1", gravity: { x: 0, y: 0, z: -9.81 } });
    project = addLoadCase(project, "横向荷载");
    project = addUniformLoad(project, { kind: "uniform", memberId: project.members[0].id, coordinateSystem: "global", loadCaseId: "LC2", intensity: { x: 0, y: -3, z: 0 } });
    project = addLoadCombination(project, "恒载与反向横载", [{ loadCaseId: "LC1", factor: 1.5 }, { loadCaseId: "LC2", factor: -0.5 }]);
    project = selectLoadCombination(project, "CB1");
  }
  return attachAnalysisResult(project, solveFrame(project));
}

/** Three independent cantilevers sharing one fixed base, aligned with X/Y/Z. */
export function reportAppendixFixture() {
  let project = reportFixture();
  for (const direction of [{ x: 0, y: 4, z: 0 }, { x: 0, y: 0, z: 4 }]) {
    project = addNode(project, direction);
    const end = project.nodes.at(-1)!;
    project = addMember(project, { startNodeId: project.nodes[0].id, endNodeId: end.id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
    project = addNodalLoad(project, end.id, { x: 0, y: direction.y ? 10 : 0, z: direction.z ? 10 : 0 }, { x: 0, y: 0, z: 0 });
  }
  return attachAnalysisResult(project, solveFrame(project));
}
