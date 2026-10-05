import { describe, expect, it } from "vitest";
import { addNode, addUniformLoad, attachAnalysisResult, updateMaterial, type MemberId } from "../domain/project";
import { solveFrame, isAnalysisResultCurrent } from "../domain/analysis";
import { applyProjectEdits } from "../domain/project-operations";
import { ProjectHistory } from "../domain/project-history";
import { decodeProject, encodeProject } from "../domain/project-file";
import { freeGeometryFixtures } from "../validation/free-geometry-fixtures";
import { captureAiSnapshot, executeAiTool } from "./ai-tools";
import { ModelEditConfirmation, prepareModelEditConfirmation } from "./model-edits";
import { coordinateModelEdits, engineeringDraftTargets, targetConflicts } from "./draft-coordination";
import { MODEL_EDIT_TOOL_DEFINITIONS } from "../../electron/model-edit-schema";
import { topologyFixture } from "../validation/topology-fixtures";

const point = { x: 0, y: 0, z: .5 };
const call = (name: string, input: unknown) => ({ id: "topology", type: "function", function: { name, arguments: JSON.stringify(input) } });
const crossing = () => freeGeometryFixtures()[2].project;

describe("T2-20 reviewed engineering topology", () => {
  it("keeps a split isolated until confirmation and retains frozen history, load range and one undo step", () => {
    let project = crossing();
    project = addUniformLoad(project, { kind: "uniform", memberId: project.members[0].id, coordinateSystem: "local", loadCaseId: "LC1", intensity: { x: 0, y: -2, z: 3 } });
    project = attachAnalysisResult(project, solveFrame(project));
    const before = structuredClone(project);
    const draft = executeAiTool(captureAiSnapshot(project, []), call("split_member", { memberIds: [project.members[0].id], position: { x: 500, y: 500, z: 500 }, inputUnits: { length: "mm" } }));
    expect(draft.status).toBe("awaiting-confirmation");
    expect(project).toEqual(before);
    const short = topologyFixture();
    expect(() => applyProjectEdits(short, [{ type: "split_member", memberIds: [short.members[0].id], position: { x: -2 + 2e-12, y: 0, z: 5e-10 } }])).toThrow("局部朝向");
    expect(draft.modelEdits?.preview.topology).toMatchObject([{ sharedNodeId: "node_0005", mappings: [{ sourceMemberId: "member_0001", segments: [{ memberId: "member_0003" }, { memberId: "member_0004" }], uniformLoads: [{ sourceLoadId: "uniform_load_0001", replacementLoadIds: ["uniform_load_0002", "uniform_load_0003"] }] }] }]);
    const ranges = draft.modelEdits!.preview.topology![0].mappings[0].segments.map((s) => s.range);
    expect(ranges[0][0]).toBe(0); expect(ranges[0][1]).toBeCloseTo(.625, 14);
    expect(ranges[1][0]).toBe(ranges[0][1]); expect(ranges[1][1]).toBe(1);
    const confirmation = prepareModelEditConfirmation(project, draft.modelEdits!);
    const stage = new ModelEditConfirmation();
    const outcome = stage.confirm(project, confirmation);
    expect(outcome.result.status).toBe("applied");
    expect(outcome.project.revision).toBe(project.revision + 1);
    const children = outcome.project.members.filter((member) => member.id !== "member_0002");
    for (const child of children) expect(child).toMatchObject({ materialId: project.members[0].materialId, sectionId: project.members[0].sectionId, rotationDegrees: 17.5 });
    expect(outcome.project.uniformLoads.map((load) => [load.memberId, load.coordinateSystem, load.loadCaseId, load.intensity])).toEqual(children.map((child) => [child.id, "local", "LC1", { x: 0, y: -2, z: 3 }]));
    expect(outcome.project.supports).toEqual(project.supports);
    expect(outcome.project.nodalLoads).toEqual(project.nodalLoads);
    expect(outcome.project.analysisResults).toEqual(project.analysisResults);
    expect(isAnalysisResultCurrent(outcome.project, outcome.project.latestAnalysis!)).toBe(false);
    const saved = decodeProject(encodeProject(outcome.project));
    expect(saved.members).toEqual(outcome.project.members);
    expect(saved.confirmedOperations).toEqual(outcome.project.confirmedOperations);
    expect(saved.analysisResults[0].input.members).toEqual(project.members);
    expect(new ModelEditConfirmation().confirm(saved, confirmation).project).toBe(saved);
    const history = new ProjectHistory(); history.record(project, outcome.project);
    const restored = history.undo(outcome.project)!;
    expect(restored.nodes).toEqual(project.nodes); expect(restored.members).toEqual(project.members);
    expect(restored.uniformLoads).toEqual(project.uniformLoads); expect(restored.nextMemberNumber).toBe(project.nextMemberNumber);
    expect(history.redo(restored)).toEqual(outcome.project);
    expect(stage.confirm(restored, confirmation).project).toBe(restored);
  });

  it("connects only by explicit shared identity and exposes replacement targets for rereading", () => {
    const project = crossing();
    const input = { memberIds: project.members.map((m) => m.id), position: point };
    const prepared = executeAiTool(captureAiSnapshot(project, []), call("connect_members", input));
    expect(prepared.status).toBe("awaiting-confirmation");
    expect(project.nodes).toHaveLength(4); expect(project.members).toHaveLength(2);
    const applied = new ModelEditConfirmation().confirm(project, prepareModelEditConfirmation(project, prepared.modelEdits!));
    expect(applied.project.nodes).toHaveLength(5); expect(applied.project.members).toHaveLength(4);
    expect(applied.project.members.every((m) => m.startNodeId === "node_0005" || m.endNodeId === "node_0005")).toBe(true);
    expect(applied.result.data).toMatchObject({ topology: [{ taskTargets: "reread-replacement-identities" }], readback: { objects: expect.arrayContaining([{ kind: "member", id: "member_0001", exists: false }]) } });
    const targets = engineeringDraftTargets(project, { modelEdits: prepared.modelEdits }, []);
    expect(targets).toEqual(project.members.map((m) => ({ kind: "member", id: m.id })));
    expect(targetConflicts(applied.project, targets)).toHaveLength(2);
    const same = applyProjectEdits(project, [{ type: "connect_members", ...input }]);
    expect(same.project.members).toEqual(applied.project.members);
    expect(same.receipt).toEqual(prepared.modelEdits?.preview);
  });

  it("refuses ambiguous endpoints, off-line points, stale identities and unknown engineering fields atomically", () => {
    const project = crossing(); const before = structuredClone(project);
    const ids = project.members.map((m) => m.id);
    for (const [name, args] of [
      ["split_member", { memberIds: [ids[0]], position: project.nodes[0].position }],
      ["split_member", { memberIds: [ids[0]], position: { ...point, z: .5001 } }],
      ["split_member", { memberIds: [ids[0]], position: { ...point, x: 9 } }],
      ["connect_members", { memberIds: [ids[0], ids[0]], position: point }],
      ["connect_members", { memberIds: [ids[0]], position: point }],
      ["connect_members", { memberIds: ids, position: point, nodeId: project.nodes[0].id }],
      ["connect_members", { memberIds: [ids[0], "missing"], position: point }],
    ] as const) expect(executeAiTool(captureAiSnapshot(project, []), call(name, args)).status, JSON.stringify(args)).toBe("failed");
    const existing = addNode(project, point);
    expect(executeAiTool(captureAiSnapshot(existing, []), call("connect_members", { memberIds: ids, position: point })).status).toBe("failed");
    expect(executeAiTool(captureAiSnapshot(existing, []), call("connect_members", { memberIds: ids, position: point, nodeId: existing.nodes.at(-1)!.id })).status).toBe("awaiting-confirmation");
    const future = { ...project, members: project.members.map((member) => ({ ...member, endRelease: "hinged" })) };
    expect(() => applyProjectEdits(future, [{ type: "split_member", memberIds: [ids[0]], position: point }])).toThrow("未登记端部属性");
    const loaded = addUniformLoad(project, { kind: "uniform", memberId: ids[0], coordinateSystem: "global", loadCaseId: "LC1", intensity: { x: 0, y: 0, z: -1 } });
    const partialLoad = { ...loaded, uniformLoads: loaded.uniformLoads.map((load) => ({ ...load, startFraction: .2 })) };
    expect(() => applyProjectEdits(partialLoad, [{ type: "split_member", memberIds: [ids[0]], position: point }])).toThrow("分段");
    expect(() => applyProjectEdits(project, [{ type: "split_member", memberIds: [ids[0]], position: point }, { type: "split_member", memberIds: ["missing" as MemberId], position: point }])).toThrow("不存在");
    expect(project).toEqual(before);
  });

  it("preserves an existing end joint without copying its conditions or splitting its member again", () => {
    const project = crossing();
    // Node 3 is the start of the second member, and lies inside the first after moving the first end.
    const aligned = { ...project, nodes: project.nodes.map((n, i) => i === 0 ? { ...n, position: { x: -2, y: 0, z: .5 } } : i === 1 ? { ...n, position: { x: -2, y: 4, z: .5 } } : n) };
    const operation = { type: "connect_members" as const, memberIds: aligned.members.map((m) => m.id), position: aligned.nodes[2].position };
    expect(() => applyProjectEdits(aligned, [operation])).toThrow("明确共享节点身份");
    const result = applyProjectEdits(aligned, [{ ...operation, nodeId: aligned.nodes[2].id }]);
    expect(result.project.nodes).toEqual(aligned.nodes);
    expect(result.project.members).toHaveLength(3);
    expect(result.project.members[0]).toEqual(aligned.members[1]);
    expect(result.project.supports).toEqual(aligned.supports);
    expect(result.receipt.topology?.[0].mappings).toHaveLength(1);
  });

  it("requires fresh review for relevant engineering edits but rebases an unrelated node", () => {
    const project = crossing();
    const draft = executeAiTool(captureAiSnapshot(project, []), call("split_member", { memberIds: [project.members[0].id], position: point })).modelEdits!;
    const unrelated = addNode(project, { x: 50, y: 50, z: 50 });
    expect(coordinateModelEdits(project, unrelated, draft).conflicts).toEqual([]);
    const material = project.materials[0];
    const modified = updateMaterial(project, material.id, { ...material, elasticModulusGPa: 210 });
    expect(coordinateModelEdits(project, modified, draft).conflicts.join(" ")).toContain("重新确认拓扑影响");
    expect(new ModelEditConfirmation().confirm(modified, prepareModelEditConfirmation(project, draft)).result.status).toBe("failed");
    const loadChanged = addUniformLoad(project, { kind: "uniform", memberId: project.members[0].id, coordinateSystem: "global", loadCaseId: "LC1", intensity: { x: 0, y: 0, z: -2 } });
    expect(coordinateModelEdits(project, loadChanged, draft).conflicts.length).toBeGreaterThan(0);
    for (const name of ["split_member", "connect_members"]) {
      const schema = MODEL_EDIT_TOOL_DEFINITIONS.find((tool) => tool.function.name === name)!;
      expect(schema.function.parameters.properties).toMatchObject({ memberIds: { minItems: name === "split_member" ? 1 : 2, maxItems: name === "split_member" ? 1 : 100 } });
    }
  });
});
