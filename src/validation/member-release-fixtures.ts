import { sectionCantilever } from "./section-fixtures";
import { addMember, addNode, addSupport, addUniformLoad, updateMember, updateNode } from "../domain/project";

export function releasedBeam() {
  let p = sectionCantilever();
  p = updateNode(p, p.nodes[1].id, { x: 4, y: 0, z: 0 });
  p = { ...p, name: "T2-25 固定－铰接梁", nodalLoads: [] };
  p = addSupport(p, p.nodes[1].id, [true, true, true, true, true, true]);
  p = updateMember(p, p.members[0].id, { endReleases: { start: { my: false, mz: false }, end: { my: true, mz: false } } });
  return addUniformLoad(p, { kind: "uniform", memberId: p.members[0].id, loadCaseId: "LC1", coordinateSystem: "local", intensity: { x: 0, y: 0, z: -2 } });
}

export function releasedPortal() {
  let p = releasedBeam();
  p = { ...p, supports: [], uniformLoads: [] };
  p = updateNode(p, p.nodes[0].id, { x: 0, y: 0, z: 3 });
  p = updateNode(p, p.nodes[1].id, { x: 4, y: 0, z: 3 });
  p = addNode(p, { x: 0, y: 0, z: 0 }); p = addNode(p, { x: 4, y: 0, z: 0 });
  p = updateMember(p, p.members[0].id, { endReleases: { start: { my: true, mz: true }, end: { my: true, mz: true } } });
  for (const [base, top] of [[2, 0], [3, 1]]) {
    p = addMember(p, { startNodeId: p.nodes[base].id, endNodeId: p.nodes[top].id, materialId: p.materials[0].id, sectionId: p.sections[0].id, rotationDegrees: 0 });
    p = addSupport(p, p.nodes[base].id, [true, true, true, true, true, true]);
  }
  return addUniformLoad(p, { kind: "uniform", memberId: p.members[0].id, loadCaseId: "LC1", coordinateSystem: "global", intensity: { x: 0, y: 0, z: -2 } });
}
