import { describe, expect, it } from "vitest";
import { addMaterial, addMember, addNode, addSection, addNodalLoad, addSupport, addUniformLoad, createProject, type NodeId } from "../domain/project";
import { applyProjectEdits, batchUpdateMembers, batchUpdateNodes, deleteNodes, duplicateMembers, duplicateNodes } from "../domain/project-operations";
import { ProjectHistory } from "../domain/project-history";
import { decodeProject, encodeProject } from "../domain/project-file";
import { captureAiSnapshot, executeAiTool } from "./ai-tools";
import { ModelEditConfirmation, prepareModelEditConfirmation } from "./model-edits";

function frame() {
  let project = addNode(addNode(createProject("T2-02"), { x: 0, y: 0, z: 0 }), { x: 4, y: 0, z: 0 });
  project = addMaterial(project, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  project = addSection(project, { name: "Box", areaM2: 0.01, secondMomentYM4: 0.0001, secondMomentZM4: 0.0001, torsionalConstantM4: 0.0001 });
  return addMember(project, { startNodeId: project.nodes[0].id, endNodeId: project.nodes[1].id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
}
const call = (name: string, input: unknown) => ({ id: "edit-call", type: "function", function: { name, arguments: JSON.stringify(input) } });

describe("T2-02 shared manual and tool editing", () => {
  it("prepares an isolated node/member batch then confirms the same formal objects as manual editing", () => {
    const project = frame();
    const before = structuredClone(project);
    const result = executeAiTool(captureAiSnapshot(project, []), call("propose_model_edits", { operations: [
      { type: "update_node", id: project.nodes[0].id, position: { x: -1, y: 0, z: 0 } },
      { type: "update_member", id: project.members[0].id, changes: { rotationDegrees: 45 } },
    ] }));
    expect(result.status).toBe("awaiting-confirmation");
    expect(project).toEqual(before);
    const applied = new ModelEditConfirmation().confirm(project, prepareModelEditConfirmation(project, result.modelEdits!));
    const manual = batchUpdateMembers(batchUpdateNodes(project, [{ id: project.nodes[0].id, position: { x: -1, y: 0, z: 0 } }]), [{ id: project.members[0].id, changes: { rotationDegrees: 45 } }]);
    expect(applied.result.status).toBe("applied");
    expect(applied.project.nodes).toEqual(manual.nodes);
    expect(applied.project.members).toEqual(manual.members);
    expect(applied.project.revision).toBe(project.revision + 1);
    expect(applied.result.data).toMatchObject({ baseRevision: project.revision, appliedRevision: project.revision + 1, changes: [
      { kind: "node", id: "node_0001", before: { position: { x: 0, y: 0, z: 0 } }, after: { position: { x: -1, y: 0, z: 0 } } },
      { kind: "member", id: "member_0001", before: { rotationDegrees: 0 }, after: { rotationDegrees: 45 } },
    ], readback: { projectId: project.id, modelRevision: project.revision + 1, objects: [
      { kind: "node", id: "node_0001", exists: true, object: { position: { x: -1, y: 0, z: 0 } } },
      { kind: "member", id: "member_0001", exists: true, object: { rotationDegrees: 45 } },
    ] } });
  });

  it("creates and copies with the manual counters, then deletes the same dependents and undoes the whole batch", () => {
    let project = frame();
    project = addSupport(project, project.nodes[0].id, [true, true, true, true, true, true]);
    project = addNodalLoad(project, project.nodes[0].id, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 0 });
    project = addUniformLoad(project, { kind: "uniform", memberId: project.members[0].id, loadCaseId: "LC1", coordinateSystem: "global", intensity: { x: 0, y: 0, z: -2 } });
    const snapshot = captureAiSnapshot(project, []);
    const draft = executeAiTool(snapshot, call("propose_model_edits", { operations: [
      { type: "create_node", position: { x: -0.5, y: 2, z: 3 } },
      { type: "create_member", properties: project.members[0] },
    ] }));
    expect(draft.status).toBe("failed");
    const { id: _id, label: _label, ...properties } = project.members[0];
    const created = executeAiTool(snapshot, call("propose_model_edits", { operations: [
      { type: "create_node", position: { x: -0.5, y: 2, z: 3 } }, { type: "create_member", properties },
    ] }));
    const stage = new ModelEditConfirmation();
    const confirmation = prepareModelEditConfirmation(project, created.modelEdits!);
    const outcome = stage.confirm(project, confirmation);
    expect(outcome.project.nodes.at(-1)).toMatchObject({ id: "node_0003", label: "N3", position: { x: -0.5, y: 2, z: 3 } });
    expect(outcome.project.members.at(-1)).toMatchObject({ id: "member_0002", label: "M2", ...properties });
    expect(outcome.result.data).toMatchObject({ created: [{ operationIndex: 0, kind: "node", id: "node_0003" }, { operationIndex: 1, kind: "member", id: "member_0002" }] });
    expect(decodeProject(encodeProject(outcome.project)).nodes).toEqual(outcome.project.nodes);
    expect(stage.confirm(outcome.project, confirmation).project).toBe(outcome.project);
    expect(stage.confirm(project, confirmation).project).toBe(project);
    for (const [name, input, manual] of [
      ["duplicate_nodes", { ids: [project.nodes[0].id] }, duplicateNodes(project, [project.nodes[0].id])],
      ["duplicate_members", { ids: [project.members[0].id] }, duplicateMembers(project, [project.members[0].id])],
      ["delete_nodes", { ids: [project.nodes[0].id] }, deleteNodes(project, [project.nodes[0].id])],
    ] as const) {
      const prepared = executeAiTool(snapshot, call(name, input)).modelEdits!;
      const applied = new ModelEditConfirmation().confirm(project, prepareModelEditConfirmation(project, prepared));
      for (const collection of ["nodes", "members", "supports", "nodalLoads", "uniformLoads"] as const) expect(applied.project[collection]).toEqual(manual[collection]);
      if (name === "delete_nodes") expect(prepared.preview.changes.map(({ kind, id }) => [kind, id])).toEqual([
        ["node", "node_0001"], ["member", "member_0001"], ["support", "support_0001"], ["nodal-load", "load_0001"], ["uniform-load", "uniform_load_0001"],
      ]);
      const history = new ProjectHistory();
      history.record(project, applied.project);
      const restored = history.undo(applied.project)!;
      expect(restored).toMatchObject(project);
      expect(history.redo(restored)).toEqual(applied.project);
    }
  });

  it("rejects a failed middle operation without consuming IDs, and preserves all unconfirmed or rejected edits", () => {
    const project = frame();
    const before = structuredClone(project);
    const snapshot = captureAiSnapshot(project, []);
    const invalid = [
      { operations: [{ type: "create_node", position: { x: 9, y: 0, z: 0 } }, { type: "update_member", id: "member_0001", changes: { endNodeId: "missing" } }] },
      { operations: [{ type: "update_node", id: "node_0001", position: { x: 4 } }] },
      { operations: [{ type: "update_node", id: "N1", position: { x: 2 } }] },
      { operations: [{ type: "create_node", position: { x: "2", y: 0, z: 0 } }] },
      { operations: [{ type: "delete_node", id: "node_0001", code: "eval()" }] },
      { operations: [] }, { operations: [{ type: "execute_script", command: "eval()" }] },
    ];
    for (const input of invalid) expect(executeAiTool(snapshot, call("propose_model_edits", input)).status).toBe("failed");
    expect(() => applyProjectEdits(project, [{ type: "create_node", position: { x: 9, y: 0, z: 0 } }, { type: "update_node", id: "missing" as NodeId, position: { x: 1 } }])).toThrow("不存在");
    expect(executeAiTool(snapshot, call("discard_model_edits", {}))).toMatchObject({ status: "completed", modelEdits: null });
    expect(project).toEqual(before);
    const draft = executeAiTool(snapshot, call("update_node", { id: "node_0001", x: -2 })).modelEdits!;
    const confirmation = prepareModelEditConfirmation(project, draft);
    draft.operations[0] = { type: "delete_node", id: project.nodes[0].id };
    const stage = new ModelEditConfirmation();
    const edited = batchUpdateNodes(project, [{ id: project.nodes[1].id, position: { x: 5, y: 0, z: 0 } }]);
    expect(stage.confirm(edited, confirmation)).toMatchObject({ project: edited, result: { status: "failed" } });
    expect(stage.confirm(createProject(), confirmation).result.status).toBe("failed");
    expect(stage.confirm(project, confirmation).project.nodes[0].position.x).toBe(-2);
  });

  it("accepts the singular and plural public tool forms without a separate tool-only model", () => {
    const project = frame();
    const snapshot = captureAiSnapshot(project, []);
    expect(executeAiTool(snapshot, call("create_nodes", { nodes: [{ position: { x: 8, y: 0, z: 0 } }, { position: { x: 9, y: 0, z: 0 } }] }))).toMatchObject({ status: "awaiting-confirmation", modelEdits: { operations: [{ type: "create_node" }, { type: "create_node" }] } });
    expect(executeAiTool(snapshot, call("update_node", { id: project.nodes[0].id, position: { x: -4, y: 1, z: 0 } })).modelEdits?.operations).toEqual([{ type: "update_node", id: project.nodes[0].id, position: { x: -4, y: 1, z: 0 } }]);
    expect(executeAiTool(snapshot, call("update_nodes", { updates: [{ id: project.nodes[0].id, position: { x: 1, y: 0, z: 0 } }, { id: project.nodes[1].id, position: { x: 5, y: 0, z: 0 } }] })).status).toBe("awaiting-confirmation");
    expect(executeAiTool(snapshot, call("duplicate_nodes", { ids: [project.nodes[0].id] })).status).toBe("awaiting-confirmation");
    expect(executeAiTool(snapshot, call("delete_members", { ids: [project.members[0].id] })).status).toBe("awaiting-confirmation");
    expect(executeAiTool(snapshot, call("update_node", { id: project.nodes[0].id, x: 3 })).status).toBe("awaiting-confirmation");
  });
});
