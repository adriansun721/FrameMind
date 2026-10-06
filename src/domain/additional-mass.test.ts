// @vitest-environment node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { modalCantilever } from "../validation/modal-fixtures";
import { captureAnalysisInput, isAnalysisResultCurrent, NATIVE_MESH_STATIC_SOLVER } from "./analysis";
import { createAnalysisRequest } from "./analysis-service";
import { attachAnalysisResult, setNodeMass, updateMember, selectAnalysisCase, addAnalysisCase, updateSelfWeight, type FrameProject, type NodeId } from "./project";
import { applyProjectEdits } from "./project-operations";
import { additionalMassSources } from "./additional-mass";
import { decodeAnalysisResult, decodeProject, encodeProject } from "./project-file";
import { ProjectHistory } from "./project-history";
import { captureAiSnapshot, executeAiTool } from "../workspace/ai-tools";
import { prepareModelEditConfirmation, ModelEditConfirmation, proposeModelEdits } from "../workspace/model-edits";
import { convertQuantity, unitPresentation } from "./units";
import { coordinateModelEdits, engineeringDraftTargets, targetConflicts } from "../workspace/draft-coordination";

function solve(p: FrameProject) {
  const input = captureAnalysisInput(p);
  const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(createAnalysisRequest(input.analysisCase?.method === "modal" ? input : { ...input, solver: { ...NATIVE_MESH_STATIC_SOLVER } })), encoding: "utf8", windowsHide: true, timeout: 30000 });
  if (child.error) throw child.error;
  const terminal = JSON.parse(child.stdout.trim().split("\n").at(-1)!);
  expect(terminal.kind, JSON.stringify(terminal)).toBe("result");
  return decodeAnalysisResult(terminal.result);
}

it("persists separate point and line sources and rejects illegal values or targets atomically", () => {
  const p = modalCantilever();
  const edited = applyProjectEdits(p, [{ type: "set_node_mass", id: p.nodes[1].id, massKg: 100 }, { type: "update_member", id: p.members[0].id, changes: { additionalLineMassKgM: 20 } }]).project;
  expect(edited.revision).toBe(p.revision + 1);
  expect(additionalMassSources(decodeProject(encodeProject(edited))).totalMassKg).toBe(160);
  expect(edited.selfWeight).toEqual(p.selfWeight); expect(edited.nodalLoads).toEqual(p.nodalLoads);
  for (const mass of [-1, NaN, Infinity, "1", { x: 1 }]) {
    expect(() => proposeModelEdits(p, { operations: [{ type: "set_node_mass", id: p.nodes[1].id, massKg: mass }] })).toThrow();
    expect(() => proposeModelEdits(p, { operations: [{ type: "update_member", id: p.members[0].id, changes: { additionalLineMassKgM: mass } }] })).toThrow();
  }
  expect(() => setNodeMass(p, "missing" as NodeId, 1)).toThrow(/不存在/);
  expect(() => proposeModelEdits(p, { operations: [{ type: "set_node_mass", id: p.nodes[1].id, massKg: 1, rotation: { x: 1 } }] })).toThrow(/未定义字段/);
  const bad = JSON.parse(encodeProject(edited)); bad.nodes[1].additionalMassKg = -1;
  expect(() => decodeProject(JSON.stringify(bad))).toThrow(/质量/);
  expect(p.nodes[1].additionalMassKg).toBeUndefined();
});

it("inherits attached masses when copying and splitting and removes them with deleted objects", () => {
  let p = modalCantilever(); p = setNodeMass(updateMember(p, p.members[0].id, { additionalLineMassKgM: 20 }), p.nodes[1].id, 100);
  const split = applyProjectEdits(p, [{ type: "split_member", memberIds: [p.members[0].id], position: { x: 1, y: 0, z: 0 } }]);
  expect(split.project.members.map((m) => m.additionalLineMassKgM)).toEqual([20, 20]);
  expect(split.project.nodes.at(-1)!.additionalMassKg).toBeUndefined();
  expect(additionalMassSources(split.project).totalMassKg).toBe(160);
  const copied = applyProjectEdits(p, [{ type: "duplicate_node", id: p.nodes[1].id }, { type: "duplicate_member", id: p.members[0].id }]).project;
  expect(additionalMassSources(copied).totalMassKg).toBe(320);
  const merged = applyProjectEdits(copied, [{ type: "merge_nodes", nodeIds: [p.nodes[1].id, copied.nodes.at(-1)!.id], targetNodeId: p.nodes[1].id, tolerance: 1e-6,
    resolution: { keepSupportIds: [], keepNodalLoadIds: copied.nodalLoads.map((l) => l.id), keepMemberIds: copied.members.map((m) => m.id), removeUniformLoadIds: [], acceptGeometryChange: true } }]).project;
  expect(merged.nodes[1].additionalMassKg).toBe(200);
  expect(additionalMassSources(merged).totalMassKg).toBe(320);
  const deleted = applyProjectEdits(copied, [{ type: "delete_node", id: copied.nodes.at(-1)!.id }, { type: "delete_member", id: copied.members.at(-1)!.id }]).project;
  expect(additionalMassSources(deleted).totalMassKg).toBe(160);
});

it("confirms unit-declared mass drafts once and exposes frozen source queries", () => {
  const p = modalCantilever(), snapshot = captureAiSnapshot(p, []);
  const draft = executeAiTool(snapshot, { id: "mass", type: "function", function: { name: "propose_model_edits", arguments: JSON.stringify({ inputUnits: { mass: "t", lineMass: "kg/mm" }, operations: [{ type: "set_node_mass", id: p.nodes[1].id, massKg: .1 }, { type: "update_member", id: p.members[0].id, changes: { additionalLineMassKgM: .02 } }] }) } });
  expect(draft.status).toBe("awaiting-confirmation");
  const request = prepareModelEditConfirmation(p, draft.modelEdits!), stage = new ModelEditConfirmation(), applied = stage.confirm(p, request);
  expect(applied.result.status).toBe("applied");
  expect(applied.project.nodes[1].additionalMassKg).toBe(100); expect(applied.project.members[0].additionalLineMassKgM).toBe(20);
  expect(stage.confirm(applied.project, request).project).toBe(applied.project);
  const r = solve(applied.project), saved = decodeProject(encodeProject(attachAnalysisResult(applied.project, r)));
  expect(r.modal).toMatchObject({ structuralMassKg: expect.closeTo(471, 10), additionalMassKg: 160, totalMassKg: expect.closeTo(631, 10) });
  const read = executeAiTool(captureAiSnapshot(saved, []), { id: "source", type: "function", function: { name: "read_results", arguments: '{"collection":"mass","offset":1,"limit":2,"outputUnitPreset":"mm-N"}' } });
  expect(read.data).toMatchObject({ items: [{ kind: "point", nodeId: p.nodes[1].id, massKg: 100 }, { kind: "line", memberId: p.members[0].id, massPerLengthKgM: .02, lengthM: 3000, massKg: 60 }] });
  expect(unitPresentation("mm-N").quantity(20, "kg/m")).toBe("0.02 kg/mm");
  expect(convertQuantity(.02, "lineMass", "kg/mm", "kg/m")).toBe(20);
  expect(() => convertQuantity(1, "lineMass", "kN/m", "kg/m")).toThrow();
  const forged = structuredClone(r); forged.modal!.additionalSources![0].massKg += 1;
  expect(() => decodeAnalysisResult(forged)).toThrow(/质量/);
});

it("changes modal dependencies without changing static results or self-weight mass", () => {
  let p = modalCantilever(); const modal = solve(p);
  p = selectAnalysisCase(addAnalysisCase(p, { name: "static", method: "static", loadSourceId: "LC1", settings: { solver: "native-static" } }), "AC2");
  const linear = solve(p), edited = setNodeMass(updateMember(p, p.members[0].id, { additionalLineMassKgM: 157 }), p.nodes[1].id, 471);
  expect(isAnalysisResultCurrent(edited, modal)).toBe(false); expect(isAnalysisResultCurrent(edited, linear)).toBe(true);
  const linearAfter = solve(edited);
  expect(linearAfter.nodes).toEqual(linear.nodes); expect(linearAfter.members).toEqual(linear.members);
  const switched = selectAnalysisCase(edited, "AC1"), withMass = solve(switched);
  expect(solve(updateSelfWeight(switched, { ...switched.selfWeight, enabled: true })).modal).toEqual(withMass.modal);
  expect(withMass.modal!.totalMassKg).toBeCloseTo(1413, 10);
});

it("retains newly computed modal history when undoing the mass change", () => {
  const p = modalCantilever(), before = attachAnalysisResult(p, solve(p)), history = new ProjectHistory();
  const changed = setNodeMass(before, p.nodes[1].id, 471); history.record(before, changed);
  const after = attachAnalysisResult(changed, solve(changed)), undone = history.undo(after)!;
  expect(undone.nodes[1].additionalMassKg).toBeUndefined();
  expect(undone.analysisResults).toHaveLength(2);
  expect(isAnalysisResultCurrent(undone, undone.analysisResults[0])).toBe(true);
  expect(isAnalysisResultCurrent(undone, undone.analysisResults[1])).toBe(false);
  expect(decodeProject(encodeProject(undone)).analysisResults).toHaveLength(2);
});

it("binds a point mass draft to its node and preserves independent geometry changes", () => {
  const p = modalCantilever(), draft = proposeModelEdits(p, { operations: [{ type: "set_node_mass", id: p.nodes[1].id, massKg: 100 }] });
  expect(targetConflicts(p, engineeringDraftTargets(p, { modelEdits: draft }, []))).toEqual([]);
  const moved = applyProjectEdits(p, [{ type: "update_node", id: p.nodes[1].id, position: { x: 4 } }]).project;
  const rebased = coordinateModelEdits(p, moved, draft);
  expect(rebased.conflicts).toEqual([]);
  expect(applyProjectEdits(moved, rebased.draft.operations).project.nodes[1]).toMatchObject({ position: { x: 4 }, additionalMassKg: 100 });
  expect(coordinateModelEdits(p, setNodeMass(p, p.nodes[1].id, 50), draft).conflicts).not.toEqual([]);
});
