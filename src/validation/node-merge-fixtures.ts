import { addMaterial, addMember, addNode, addNodalLoad, addSection, addSupport, addUniformLoad, createProject, type NodeId } from "../domain/project";
import type { NodeMergeInput } from "../domain/node-merge";

export function nodeMergeFixture(conflicts = false) {
  let project = createProject("T2-21 近重合节点合并");
  project = addMaterial(project, { name: "Steel", elasticModulusGPa: 200, poissonRatio: .3, densityKgM3: 7850 });
  project = addSection(project, { name: "Reference", areaM2: .01, secondMomentYM4: 1e-4, secondMomentZM4: 1e-4, torsionalConstantM4: 1e-4 });
  for (const x of [0, 3, 3 + 2.5e-7]) project = addNode(project, { x, y: 0, z: 0 });
  const member = (startNodeId: NodeId, endNodeId: NodeId) => { project = addMember(project, { startNodeId, endNodeId, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 }); };
  member(project.nodes[0].id, project.nodes[1].id);
  project = addSupport(project, project.nodes[0].id, [true, true, true, true, true, true]);
  for (const [index, z] of [[1, -4], [2, -6]]) project = addNodalLoad(project, project.nodes[index].id, { x: 0, y: 0, z }, { x: 0, y: 0, z: 0 });
  if (conflicts) {
    member(project.nodes[0].id, project.nodes[2].id);
    member(project.nodes[1].id, project.nodes[2].id);
    project = addSupport(project, project.nodes[1].id, [true, false, false, false, false, false]);
    project = addSupport(project, project.nodes[2].id, [false, true, false, false, false, false]);
    for (const m of project.members.slice(1)) project = addUniformLoad(project, { kind: "uniform", memberId: m.id, coordinateSystem: "local", loadCaseId: "LC1", intensity: { x: 0, y: 0, z: -2 } });
  }
  return project;
}
export function nodeMergeInput(project: ReturnType<typeof nodeMergeFixture>): NodeMergeInput {
  return { nodeIds: project.nodes.slice(1).map((n) => n.id), targetNodeId: project.nodes[1].id, tolerance: 1e-6,
    resolution: { keepSupportIds: [], keepNodalLoadIds: project.nodalLoads.map((l) => l.id), keepMemberIds: [project.members[0].id], removeUniformLoadIds: project.uniformLoads.map((l) => l.id), acceptGeometryChange: true } };
}
