import { describe, expect, it } from "vitest";
import { addMember, addMaterial, addNode, addSection, createProject, deleteMaterial, deleteSection } from "./project";
import { applyProjectTransaction, batchUpdateNodes, deleteNode, duplicateMember, duplicateNode } from "./project-operations";
import { ProjectHistory } from "./project-history";

function frame() {
  let project = createProject("T08");
  project = addNode(project, { x: 0, y: 0, z: 0 });
  project = addNode(project, { x: 2, y: 0, z: 0 });
  project = addMaterial(project, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  project = addSection(project, { name: "Box", areaM2: 0.01, secondMomentYM4: 0.0001, secondMomentZM4: 0.0001, torsionalConstantM4: 0.0001 });
  return addMember(project, { startNodeId: project.nodes[0].id, endNodeId: project.nodes[1].id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
}

describe("T08 grouped project operations", () => {
  it("commits a valid batch as one revision and rolls back every failed batch", () => {
    const project = frame();
    const updated = batchUpdateNodes(project, [
      { id: project.nodes[0].id, position: { x: 1, y: 0, z: 0 } },
      { id: project.nodes[1].id, position: { x: 3, y: 0, z: 0 } },
    ]);
    expect(updated.revision).toBe(project.revision + 1);
    expect(updated.nodes.map((node) => node.position.x)).toEqual([1, 3]);
    expect(() => batchUpdateNodes(project, [
      { id: project.nodes[0].id, position: { x: 1, y: 0, z: 0 } },
      { id: project.nodes[1].id, position: { x: 1, y: 0, z: 0 } },
    ])).toThrow("零长度");
    expect(project.nodes.map((node) => node.position.x)).toEqual([0, 2]);
  });

  it("duplicates with new identities and preserves topology and references", () => {
    const project = frame();
    const copiedNode = duplicateNode(project, project.nodes[0].id);
    expect(copiedNode.nodes.map((node) => node.id)).toEqual(["node_0001", "node_0002", "node_0003"]);
    const copiedMember = duplicateMember(project, project.members[0].id);
    expect(copiedMember.members).toHaveLength(2);
    expect(copiedMember.members[1]).toMatchObject({ startNodeId: "node_0001", endNodeId: "node_0002", materialId: "material_0001", sectionId: "section_0001" });
    expect(copiedMember.members[1].id).not.toBe(project.members[0].id);
  });

  it("cascades node dependents and never leaves dangling references", () => {
    let project = frame();
    project = applyProjectTransaction(project, [
      (current) => ({ ...current, supports: [{ id: "support_0001" as never, label: "B1", nodeId: current.nodes[0].id, restraints: [true, true, true, true, true, true] }] }),
      (current) => ({ ...current, nodalLoads: [{ id: "load_0001" as never, label: "L1", nodeId: current.nodes[0].id, force: { x: 1, y: 0, z: 0 }, moment: { x: 0, y: 0, z: 0 } }] }),
    ]);
    const deleted = deleteNode(project, project.nodes[0].id);
    expect(deleted.nodes).toHaveLength(1);
    expect(deleted.members).toHaveLength(0);
    expect(deleted.supports).toHaveLength(0);
    expect(deleted.nodalLoads).toHaveLength(0);
  });

  it("rejects deleting referenced resources instead of leaving dangling members", () => {
    const project = frame();
    expect(() => deleteMaterial(project, project.materials[0].id)).toThrow("仍被 M1 引用");
    expect(() => deleteSection(project, project.sections[0].id)).toThrow("仍被 M1 引用");
  });
});

describe("project history", () => {
  it("undoes and redoes whole changes and clears redo after a new branch", () => {
    const history = new ProjectHistory();
    const initial = frame();
    const changed = batchUpdateNodes(initial, [{ id: initial.nodes[0].id, position: { x: 1, y: 0, z: 0 } }]);
    const branched = batchUpdateNodes(initial, [{ id: initial.nodes[0].id, position: { x: 5, y: 0, z: 0 } }]);
    history.record(initial, changed);
    expect(history.undo(changed)).toBe(initial);
    expect(history.redo(initial)).toBe(changed);
    expect(history.undo(changed)).toBe(initial);
    history.record(initial, branched);
    expect(history.redo(initial)).toBeNull();
    expect(history.canUndo).toBe(true);
  });
});
