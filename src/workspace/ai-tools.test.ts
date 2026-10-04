import { describe, expect, it } from "vitest";
import { addMaterial, addMember, addNode, addSection, createProject, updateNode } from "../domain/project";
import { captureAiSnapshot, executeAiTool } from "./ai-tools";

function call(name: string, input: unknown) {
  return { id: "call_1", type: "function" as const, function: { name, arguments: JSON.stringify(input) } };
}

describe("read-only AI tools", () => {
  it("replays applied model reads with stable selected identities and an immutable revision", () => {
    const project = addNode(createProject("空间刚架"), { x: 1, y: 2, z: 3 });
    const node = project.nodes[0];
    const snapshot = captureAiSnapshot(project, [{ kind: "node", id: node.id }]);
    const edited = updateNode(project, node.id, { x: 10, y: 20, z: 30 });

    expect(snapshot.context).toEqual({ projectId: project.id, projectName: "空间刚架", modelRevision: 1,
      selection: [{ kind: "node", id: node.id, label: "N1", exists: true }] });
    expect(executeAiTool(snapshot, call("read_model", { collection: "nodes" }))).toMatchObject({
      status: "completed", context: snapshot.context,
      data: { collection: "nodes", total: 1, items: [{ id: node.id, label: "N1", position: { x: 1, y: 2, z: 3 } }] },
    });
    expect(edited.nodes[0].position.x).toBe(10);
    expect(Object.isFrozen(snapshot.model.nodes[0].position)).toBe(true);
    expect(snapshot.model).not.toHaveProperty("analysisResults");
    expect(snapshot.model).not.toHaveProperty("latestAnalysis");
    expect(snapshot.model).not.toHaveProperty("apiKey");
  });

  it("reads selected members by identity with their actual endpoints and material section", () => {
    let project = addNode(addNode(createProject(), { x: 0, y: 0, z: 0 }), { x: 0, y: 0, z: 3 });
    project = addMaterial(project, { name: "钢材", elasticModulusGPa: 206, poissonRatio: 0.3, densityKgM3: 7850 });
    project = addSection(project, { name: "自定义", areaM2: 0.01, secondMomentYM4: 0.0001, secondMomentZM4: 0.0002, torsionalConstantM4: 0.00003 });
    project = addMember(project, { startNodeId: project.nodes[0].id, endNodeId: project.nodes[1].id,
      materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 20 });
    const member = project.members[0];
    const snapshot = captureAiSnapshot(project, [{ kind: "member", id: member.id }]);

    expect(executeAiTool(snapshot, call("read_selection", {}))).toMatchObject({ status: "completed",
      data: { objects: [{ kind: "member", id: member.id, label: "M1", startNode: project.nodes[0],
        endNode: project.nodes[1], material: project.materials[0], section: project.sections[0] }] } });
    expect(executeAiTool(snapshot, call("read_objects", { objects: [{ kind: "node", id: project.nodes[1].id }] })))
      .toMatchObject({ status: "completed", data: { objects: [{ kind: "node", label: "N2", position: { x: 0, y: 0, z: 3 } }] } });
  });

  it("reads each actual model collection in bounded pages without exposing analysis history", () => {
    const project = addNode(addNode(createProject(), { x: 0, y: 0, z: 0 }), { x: 4, y: 0, z: 0 });
    const snapshot = captureAiSnapshot(project, []);
    expect(executeAiTool(snapshot, call("read_model", { collection: "nodes", offset: 1, limit: 1 })))
      .toMatchObject({ status: "completed", data: { total: 2, offset: 1, limit: 1, items: [{ label: "N2" }] } });
    expect(executeAiTool(snapshot, call("read_model", { collection: "summary" })))
      .toMatchObject({ status: "completed", data: { counts: { nodes: 2, members: 0, materials: 0, sections: 0, supports: 0, loads: 0, loadCases: 1, loadCombinations: 0 }, units: project.units } });
    for (const collection of ["members", "materials", "sections", "supports", "loads"]) {
      expect(executeAiTool(snapshot, call("read_model", { collection })))
        .toMatchObject({ status: "completed", data: { collection, items: [], total: 0 } });
    }
    expect(executeAiTool(snapshot, call("read_model", { collection: "loads" })))
      .toMatchObject({ data: { selfWeight: { enabled: false, loadCaseId: "LC1" } } });
    expect(executeAiTool(snapshot, call("read_model", { collection: "load-cases" })))
      .toMatchObject({ data: { items: [{ id: "LC1", name: "默认工况" }], activeLoadCaseId: "LC1", combinations: [] } });
  });

  it("reports absent or stale selection as missing input rather than fabricating objects", () => {
    const project = createProject();
    expect(executeAiTool(captureAiSnapshot(project, []), call("read_selection", {})))
      .toMatchObject({ status: "missing-input" });
    const stale = captureAiSnapshot(project, [{ kind: "member", id: "deleted_member" }]);
    expect(stale.context.selection[0]).toEqual({ kind: "member", id: "deleted_member", label: "deleted_member", exists: false });
    expect(executeAiTool(stale, call("read_selection", {}))).toMatchObject({ status: "missing-input" });
    expect(executeAiTool(stale, call("read_objects", { objects: [{ kind: "node", id: "missing_node" }] })))
      .toMatchObject({ status: "missing-input", data: { missing: [{ kind: "node", id: "missing_node" }] } });
  });

  it("changes the task fingerprint when selection or comparison context changes", () => {
    const project = addNode(addNode(createProject(), { x: 0, y: 0, z: 0 }), { x: 4, y: 0, z: 0 });
    const first = captureAiSnapshot(project, [{ kind: "node", id: project.nodes[0].id }]);
    const second = captureAiSnapshot(project, [{ kind: "node", id: project.nodes[1].id }]);
    const compared = captureAiSnapshot(project, first.context.selection.map(({ kind, id }) => ({ kind, id })), undefined, { beforeId: "analysis-before", afterId: "analysis-after" });

    expect(second.snapshotKey).not.toBe(first.snapshotKey);
    expect(compared.snapshotKey).not.toBe(first.snapshotKey);
  });

  it("returns bounded field/range pages, explicit empty-page semantics and a real state receipt", () => {
    const project = addNode(addNode(createProject("状态回归"), { x: 0, y: 0, z: 0 }), { x: 4, y: 0, z: 0 });
    const snapshot = captureAiSnapshot(project, []);
    const filtered = executeAiTool(snapshot, call("read_model", { collection: "nodes", fields: ["id", "position.x"], query: { field: "position.x", min: 1, max: 5 } }));
    expect(filtered).toMatchObject({ status: "completed", data: { total: 1, items: [{ id: project.nodes[1].id, "position.x": 4 }], page: { empty: false } } });
    expect(filtered.receipt).toMatchObject({ object: { id: project.id, name: "状态回归" }, input: { projectId: project.id, modelRevision: project.revision }, state: { project: "current", model: "applied", analysis: "absent" }, call: { initiated: true, completed: true, status: "completed" } });
    const empty = executeAiTool(snapshot, call("read_model", { collection: "nodes", offset: 20, limit: 5 }));
    expect(empty).toMatchObject({ status: "completed", data: { total: 2, items: [], page: { empty: true, hasMore: false, nextOffset: 20 } } });
    expect(executeAiTool(snapshot, call("read_model", { collection: "nodes", query: { field: "position.x" } })).status).toBe("failed");
    expect(executeAiTool(snapshot, call("read_model", { collection: "nodes", fields: ["id"], query: { field: "position.x", min: 0 } })).status).toBe("failed");
    expect(executeAiTool(snapshot, call("read_model", { collection: "nodes", fields: ["id"], query: { field: "position.x", min: 0 } })).receipt?.call).toMatchObject({ initiated: true, completed: true, status: "failed" });
    expect(executeAiTool(snapshot, { malformed: true }).receipt?.call).toMatchObject({ initiated: false, completed: true, status: "failed" });
  });

  it("rejects malformed, unbounded or unknown input while keeping mutation requests unapplied", () => {
    const project = addNode(createProject(), { x: 1, y: 2, z: 3 });
    const before = JSON.stringify(project);
    const snapshot = captureAiSnapshot(project, []);
    const invalid = [
      call("read_selection", { script: "return project" }), call("read_model", {}),
      call("read_model", { collection: "analysisResults" }), call("read_model", { collection: "nodes", offset: -1 }),
      call("read_model", { collection: "nodes", limit: 101 }), call("read_model", { collection: "nodes", limit: "5" }),
      call("read_model", { collection: "nodes", offset: 1.5 }), call("read_model", { collection: "nodes", mutate: true }),
      call("read_objects", { objects: [] }), call("read_objects", { objects: [{ kind: "section", id: "s1" }] }),
      call("read_objects", { objects: [{ kind: "node", id: "" }] }), call("read_objects", { objects: [{ kind: "node", id: "x", code: "eval()" }] }),
      call("read_objects", { objects: Array.from({ length: 101 }, () => ({ kind: "node", id: "n" })) }),
      call("unknown_tool", {}), call("execute_script", { code: "project.nodes=[]" }),
      { ...call("read_model", {}), function: { name: "read_model", arguments: "invalid json" } },
      call("read_model", null), call("read_model", []),
    ];
    for (const request of invalid) expect(executeAiTool(snapshot, request)).toMatchObject({ status: "failed" });
    expect(executeAiTool(snapshot, call("update_node", { id: project.nodes[0].id, x: 99 })))
      .toMatchObject({ status: "awaiting-confirmation" });
    expect(JSON.stringify(project)).toBe(before);
    expect(snapshot.model.nodes[0].position.x).toBe(1);
  });
});
