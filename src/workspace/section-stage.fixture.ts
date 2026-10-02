import { solveFrame } from "../domain/analysis";
import { addMaterial, addMember, addNode, addNodalLoad, addSection, addSupport, attachAnalysisResult, createProject, updateSelfWeight } from "../domain/project";
export function columns() {
  let p = createProject("T26 选柱对比");
  for (const x of [0, 3]) {
    p = addNode(p, { x, y: 0, z: 0 }); p = addNode(p, { x, y: 0, z: 4 });
  }
  p = addMaterial(p, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  p = addSection(p, { name: "原截面", areaM2: 0.01, secondMomentYM4: 0.0001, secondMomentZM4: 0.0001, torsionalConstantM4: 0.0001 });
  p = addSection(p, { name: "加大截面", areaM2: 0.02, secondMomentYM4: 0.0002, secondMomentZM4: 0.0002, torsionalConstantM4: 0.0002 });
  for (const i of [0, 2]) {
    p = addMember(p, { startNodeId: p.nodes[i].id, endNodeId: p.nodes[i + 1].id, materialId: p.materials[0].id, sectionId: p.sections[0].id, rotationDegrees: 0 });
    p = addSupport(p, p.nodes[i].id, [true, true, true, true, true, true]);
    p = addNodalLoad(p, p.nodes[i + 1].id, { x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  }
  p = updateSelfWeight(p, { enabled: true, loadCaseId: "LC1", gravity: { x: 0, y: 0, z: -10 } });
  return attachAnalysisResult(p, solveFrame(p));
}
export const call = (name: string, input: unknown, id = "t26") => ({ id, type: "function" as const, function: { name, arguments: JSON.stringify(input) } });
