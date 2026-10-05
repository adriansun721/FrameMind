import { describe, expect, it } from "vitest";
import { addNode, addSupport, addMaterial, attachAnalysisResult, updateNode, updateMaterial, type NodeId } from "../domain/project";
import { inspectNearNodes, inspectNodeMerge } from "../domain/node-merge";
import { applyProjectEdits } from "../domain/project-operations";
import { solveFrame, isAnalysisResultCurrent } from "../domain/analysis";
import { ProjectHistory } from "../domain/project-history";
import { encodeProject, decodeProject } from "../domain/project-file";
import { nodeMergeFixture, nodeMergeInput } from "../validation/node-merge-fixtures";
import { captureAiSnapshot, executeAiTool } from "./ai-tools";
import { proposeModelEdits, prepareModelEditConfirmation, ModelEditConfirmation } from "./model-edits";
import { coordinateModelEdits, engineeringDraftTargets, targetConflicts } from "./draft-coordination";
import { persistTaskState, type ConversationHistory } from "./task-persistence";

const call = (name: string, input: unknown) => ({ id: "merge", type: "function", function: { name, arguments: JSON.stringify(input) } });
describe("T2-21 reviewed node merge public boundaries", () => {
  it("uses fixed physical tolerance across units and large origins; never merges a transitive chain", () => {
    const p = nodeMergeFixture(); const before = structuredClone(p);
    const scan = executeAiTool(captureAiSnapshot(p, []), call("inspect_near_nodes", { tolerance: .001, inputUnits: { length: "mm" }, outputUnitPreset: "mm-N" }));
    expect(scan.status).toBe("completed"); expect(scan.data).toMatchObject({ tolerance: .001, unit: "mm", pairs: [{ nodeIds: ["node_0002", "node_0003"], distance: expect.closeTo(.00025, 10) }] });
    expect(inspectNearNodes(p, 0).pairs).toHaveLength(0);
    const duplicate = addNode(p, p.nodes[1].position); expect(inspectNearNodes(duplicate, 0).pairs).toHaveLength(1);
    const large = { ...p, nodes: p.nodes.map((n) => ({ ...n, position: { ...n.position, x: n.position.x + 1e8 } })) };
    expect(inspectNearNodes(large, 1e-6).pairs).toHaveLength(1); expect(inspectNearNodes(large, 1e-8).pairs).toHaveLength(0);
    const chain = addNode(p, { x: 3 + 1.1e-6, y: 0, z: 0 });
    expect(inspectNearNodes(chain, 1e-6).pairs).toHaveLength(2);
    expect(() => inspectNodeMerge(chain, { ...nodeMergeInput(chain), targetNodeId: p.nodes[1].id })).toThrow("近重合链");
    for (const tolerance of [-1, NaN, Infinity]) expect(() => inspectNearNodes(p, tolerance)).toThrow("容差");
    expect(p).toEqual(before);
  });
  it("lists supports, loads, duplicate and zero-length members; requires every conflict and cascade decision", () => {
    const p = nodeMergeFixture(true); const input = nodeMergeInput(p); const before = structuredClone(p);
    const inspection = executeAiTool(captureAiSnapshot(p, []), call("inspect_node_merge", input));
    expect(inspection.status).toBe("failed"); // resolution belongs only to the proposal, not the read tool.
    const { resolution, ...selection } = input;
    expect(executeAiTool(captureAiSnapshot(p, []), call("inspect_node_merge", selection)).data).toMatchObject({ zeroLengthMemberIds: ["member_0003"], duplicateMemberGroups: [["member_0001", "member_0002"]], supports: expect.any(Array), nodalLoads: expect.any(Array), uniformLoads: expect.any(Array) });
    for (const change of [
      { acceptGeometryChange: false }, { keepSupportIds: p.supports.slice(1).map((s) => s.id) },
      { keepMemberIds: p.members.map((m) => m.id) }, { removeUniformLoadIds: [] },
      { keepNodalLoadIds: ["missing"] },
    ]) expect(executeAiTool(captureAiSnapshot(p, []), call("merge_nodes", { ...input, resolution: { ...resolution, ...change } })).status).toBe("failed");
    expect(executeAiTool(captureAiSnapshot(p, []), call("merge_nodes", { ...selection })).status).toBe("failed");
    expect(() => applyProjectEdits(p, [{ type: "merge_nodes", ...input }, { type: "delete_node", id: "missing" as NodeId }])).toThrow("不存在");
    expect(p).toEqual(before);
    const applied = applyProjectEdits(p, [{ type: "merge_nodes", ...input, resolution: { ...resolution, keepSupportIds: [p.supports[1].id] } }]);
    expect(applied.project.members.map((m) => m.id)).toEqual(["member_0001"]); expect(applied.project.uniformLoads).toEqual([]);
    expect(applied.project.supports.map((s) => s.id)).toEqual(["support_0001", "support_0002"]);
    expect(applied.project.nodalLoads.map((l) => [l.id, l.nodeId, l.force.z])).toEqual([["load_0001", "node_0002", -4], ["load_0002", "node_0002", -6]]);
    const parallel = applyProjectEdits(p, [{ type: "merge_nodes", ...input, resolution: { ...resolution, keepMemberIds: p.members.slice(0, 2).map((m) => m.id), removeUniformLoadIds: [p.uniformLoads[1].id] } }]);
    expect(parallel.project.members).toHaveLength(2); expect(parallel.project.uniformLoads).toHaveLength(1);
  });
  it("manual and tool proposals share an atomic receipt, frozen history, save/readback and complete undo", () => {
    let p = nodeMergeFixture();
    const historical = solveFrame({ ...p, nodes: p.nodes.slice(0, 2), nodalLoads: p.nodalLoads.slice(0, 1) });
    p = attachAnalysisResult(p, historical); const input = nodeMergeInput(p);
    const draft = executeAiTool(captureAiSnapshot(p, []), call("merge_nodes", input)); expect(draft.status).toBe("awaiting-confirmation");
    const manual = proposeModelEdits(p, { operations: [{ type: "merge_nodes", ...input }] });
    expect(draft.modelEdits?.preview).toEqual(manual.preview); expect(p.nodes).toHaveLength(3);
    const prepared = prepareModelEditConfirmation(p, draft.modelEdits!); const stage = new ModelEditConfirmation();
    const applied = stage.confirm(p, prepared); expect(applied.result.status).toBe("applied"); expect(applied.project.revision).toBe(p.revision + 1);
    expect(applied.result.data).toMatchObject({ nodeMerges: [{ removedNodeIds: ["node_0003"] }], readback: { objects: expect.arrayContaining([{ kind: "node", id: "node_0003", exists: false }]) } });
    expect(applied.project.analysisResults).toEqual(p.analysisResults); expect(isAnalysisResultCurrent(applied.project, historical)).toBe(false);
    const saved = decodeProject(encodeProject(applied.project)); expect(saved.confirmedOperations).toEqual(applied.project.confirmedOperations);
    expect(new ModelEditConfirmation().confirm(saved, prepared).project).toBe(saved);
    const result = solveFrame(saved); expect(result.status).toBe("complete"); expect(result.nodes.find((n) => n.nodeId === "node_0002")!.displacement.z).toBeCloseTo(-.0045, 12);
    const read = executeAiTool(captureAiSnapshot(saved, []), call("read_objects", { objects: [{ kind: "node", id: "node_0002" }] })); expect(JSON.stringify(read.data)).toContain("node_0002");
    const history = new ProjectHistory(); history.record(p, applied.project); const restored = history.undo(applied.project)!;
    for (const key of ["nodes", "members", "supports", "nodalLoads", "uniformLoads", "nextNodeNumber", "nextMemberNumber", "nextLoadNumber"] as const) expect(restored[key]).toEqual(p[key]);
    expect(stage.confirm(restored, prepared).project).toBe(restored); expect(history.redo(restored)).toEqual(applied.project);
    expect(engineeringDraftTargets(p, { modelEdits: draft.modelEdits }, [])).toEqual(input.nodeIds.map((id) => ({ kind: "node", id })));
    expect(targetConflicts(saved, [{ kind: "node", id: "node_0003" }])).toHaveLength(1);
  });
  it("blocks stale reviews and changed incident conditions, allows unrelated additions and refuses unknown semantics", () => {
    const p = nodeMergeFixture(); const input = nodeMergeInput(p); const draft = proposeModelEdits(p, { operations: [{ type: "merge_nodes", ...input }] });
    const fresh = addSupport(p, p.nodes[2].id, [true, false, false, false, false, false]);
    expect(coordinateModelEdits(p, fresh, draft).conflicts.join(" ")).toContain("合并影响");
    expect(new ModelEditConfirmation().confirm(fresh, prepareModelEditConfirmation(p, draft)).result.status).toBe("failed");
    const unrelated = addNode(p, { x: 50, y: 0, z: 0 }); expect(coordinateModelEdits(p, unrelated, draft).conflicts).toEqual([]);
    const remoteEndpoint = updateNode(p, p.nodes[0].id, { x: 0, y: 1, z: 0 });
    expect(coordinateModelEdits(p, remoteEndpoint, draft).conflicts.join(" ")).toContain("合并影响");
    const unrelatedMaterial = addMaterial(p, { name: "Unused", elasticModulusGPa: 100, poissonRatio: .25, densityKgM3: 5000 });
    expect(coordinateModelEdits(p, unrelatedMaterial, draft).conflicts).toEqual([]);
    const changedMaterial = updateMaterial(p, p.materials[0].id, { ...p.materials[0], elasticModulusGPa: 210 });
    expect(coordinateModelEdits(p, changedMaterial, draft).conflicts.join(" ")).toContain("合并影响");
    const future = { ...p, members: p.members.map((m) => ({ ...m, endRelease: "hinged" })) };
    expect(() => applyProjectEdits(future, [{ type: "merge_nodes", ...input }])).toThrow("未登记");
    const tampered = { ...draft, preview: { ...draft.preview, nodeMerges: [] } };
    expect(new ModelEditConfirmation().confirm(p, prepareModelEditConfirmation(p, tampered)).result.status).toBe("failed");
  });
  it("preserves and rereads task identities across metadata changes and pending-draft restart", () => {
    const p = nodeMergeFixture(); const input = nodeMergeInput(p); const draft = proposeModelEdits(p, { operations: [{ type: "merge_nodes", ...input }] });
    const conversation: ConversationHistory = { id: "merge-task", updatedAt: 1, turns: [], sectionSelection: [], calculationRequested: false, requestPrompt: "merge",
      proposalSource: p, conditionsSource: p, sectionSource: p, modelEditsSource: p, taskDraftSource: p, modelEdits: draft,
      targets: [{ kind: "node", id: "node_0003" }] };
    const updated = { ...p, taskState: persistTaskState(p.id, [conversation], []) };
    expect(inspectNodeMerge(updated, input).taskReferences).toEqual([{ taskId: "merge-task", kind: "node", id: "node_0003" }]);
    const applied = new ModelEditConfirmation().confirm(updated, prepareModelEditConfirmation(p, draft)); expect(applied.result.status).toBe("applied");
    expect(applied.project.taskState).toEqual(updated.taskState);
    const reopened = decodeProject(encodeProject(updated));
    const restoredDraft = reopened.taskState!.conversations[0].modelEdits!;
    expect(restoredDraft.operations).toEqual(draft.operations);
    expect(new ModelEditConfirmation().confirm(reopened, prepareModelEditConfirmation(reopened, restoredDraft)).result.status).toBe("applied");
  });
});
