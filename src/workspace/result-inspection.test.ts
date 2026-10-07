// @vitest-environment node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { captureAnalysisInput, solveFrame, NATIVE_MESH_STATIC_SOLVER } from "../domain/analysis";
import { createAnalysisRequest } from "../domain/analysis-service";
import { compareAnalysisResults } from "../domain/analysis-comparison";
import { decodeAnalysisResult, decodeProject, encodeProject } from "../domain/project-file";
import { addAnalysisCase, attachAnalysisResult, deleteMember, selectAnalysisCase, updateNode, type FrameProject } from "../domain/project";
import { modalCantilever } from "../validation/modal-fixtures";
import { bucklingColumn } from "../validation/buckling-fixtures";
import { secondOrderColumn } from "../validation/second-order-fixtures";
import { sectionCantilever } from "../validation/section-fixtures";
import { captureAiSnapshot, executeAiTool } from "./ai-tools";

function native(project: FrameProject) {
  const input = captureAnalysisInput(project);
  const request = createAnalysisRequest(project.analysisCases.find((c) => c.id === project.activeAnalysisCaseId)?.method === "static" ? { ...input, solver: NATIVE_MESH_STATIC_SOLVER } : input);
  const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
  if (child.error) throw child.error;
  const message = JSON.parse(child.stdout.trim().split("\n").at(-1)!);
  if (message.kind !== "result") throw new Error(JSON.stringify(message.error));
  return attachAnalysisResult(project, decodeAnalysisResult(message.result));
}
const call = (name: string, input: unknown) => ({ id: "inspection", type: "function", function: { name, arguments: JSON.stringify(input) } });

it("modal citations bind the extracted mode and original member station, unaffected by display units or deleted objects", () => {
  const p = native(modalCantilever()), result = p.latestAnalysis!, mode = result.modal!.modes[0];
  const station = mode.members[0].samples[8], memberId = mode.members[0].memberId;
  const changed = decodeProject(encodeProject(deleteMember(p, p.members[0].id)));
  const snapshot = captureAiSnapshot(changed, [], changed.analysisResults.find((r) => r.id === result.id));
  const frequency = executeAiTool(snapshot, call("read_result", { kind: "member", id: memberId, quantity: "frequency", component: "scalar", modeNumber: 1 }));
  expect(frequency.reference).toMatchObject({ analysisId: result.id, current: false, method: "modal", modeNumber: 1, value: mode.frequencyHz, unit: "Hz", object: { id: memberId } });
  const shape = executeAiTool(snapshot, call("read_result", { kind: "member", id: memberId, quantity: "shapeTranslation", component: "y", modeNumber: 1, position: station.position, outputUnitPreset: "mm-N" }));
  expect(shape.status).toBe("completed");
  expect(shape.reference).toMatchObject({ value: station.translation.y, position: station.position, unit: "归一化幅值", current: false });
  expect(shape.data).toMatchObject({ value: station.translation.y, position: station.position * 1000 });
  for (const input of [
    { kind: "member", id: memberId, quantity: "displacement", component: "y", modeNumber: 1 },
    { kind: "member", id: memberId, quantity: "shapeTranslation", component: "y", modeNumber: 99, position: station.position },
    { kind: "member", id: memberId, quantity: "shapeTranslation", component: "y", modeNumber: 1, position: station.position + .001 },
    { kind: "node", id: result.input.meshPlan!.levels.at(-1)!.nodes[0].nodeId, quantity: "frequency", component: "scalar", modeNumber: 1 },
  ]) expect(executeAiTool(snapshot, call("read_result", input)).status).toBe("failed");
});

it("buckling factor citations preserve reference-only meaning and reject static displacement semantics", () => {
  const p = native(bucklingColumn(30)), result = p.latestAnalysis!, snapshot = captureAiSnapshot(p, []);
  const input = { kind: "node", id: p.nodes[1].id, quantity: "bucklingFactor", component: "scalar", modeNumber: 1, outputUnitPreset: "mm-N" };
  const ref = executeAiTool(snapshot, call("read_result", input));
  expect(ref.status).toBe("completed");
  expect(ref.reference).toMatchObject({ method: "buckling", value: result.buckling!.modes[0].factor, unit: "无", modeNumber: 1 });
  expect(ref.reference!.meaning).toContain("只放大参考荷载");
  expect(executeAiTool(snapshot, call("read_result", { ...input, quantity: "displacement", component: "x" })).status).toBe("failed");
  expect(compareAnalysisResults(result, result).compatible).toBe(false);
});

it("process reads return actual recorded static and second-order data, with bounded pages and explicit absent records", () => {
  let p = sectionCantilever({ shape: "rectangle", width: .1, height: .2 });
  p = native(selectAnalysisCase(addAnalysisCase(p, { name: "Mesh", method: "static", loadSourceId: "LC1", settings: { solver: "native-static", mesh: { maxDivisions: 2, maxEquations: 600, relativeTolerance: .01, displacementTolerance: 1e-12, forceTolerance: 1e-8 } } }), "AC1"));
  const result = p.latestAnalysis!, actual = result.discretization!.runs.at(-1)!.result;
  const tool = (project: FrameProject, section: string) => executeAiTool(captureAiSnapshot(project, []), call("read_results", { collection: "process", section, offset: 1, limit: 2, outputUnitPreset: "mm-N" }));
  expect(tool(p, "stiffness").data).toMatchObject({ method: "static", process: { available: true, sourceAnalysisId: actual.id, items: actual.process!.assembledStiffness!.slice(1, 3) } });
  expect(tool(p, "mesh").data).toMatchObject({ process: { total: result.input.meshPlan!.levels.find((l) => l.divisions === result.discretization!.selectedDivisions)!.elements.length } });
  const second = native(secondOrderColumn()), r = second.latestAnalysis!, iterations = r.secondOrder!.runs.at(-1)!.calculation.iterations;
  expect(tool(second, "iterations").data).toMatchObject({ method: "second-order", process: { sourceAnalysisId: r.id, items: iterations.slice(1, 3), total: iterations.length } });
  const sample = r.members[0].nativeResponses![8];
  const displacement = executeAiTool(captureAiSnapshot(second, []), call("read_result", { kind: "member", id: r.members[0].memberId, quantity: "displacement", component: "y", position: sample.position, outputUnitPreset: "mm-N" }));
  expect(displacement.status).toBe("completed");
  expect(displacement.reference).toMatchObject({ method: "second-order", value: sample.globalDisplacement.y, unit: "m", position: sample.position, coordinateSystem: "global XYZ" });
  expect(displacement.data).toMatchObject({ value: sample.globalDisplacement.y * 1000 });
  const direct = sectionCantilever({ shape: "rectangle", width: .1, height: .2 });
  const old = { ...solveFrame(direct), process: undefined };
  const missing = executeAiTool(captureAiSnapshot(direct, [], old), call("read_results", { collection: "process", section: "stiffness" }));
  expect(missing.data).toMatchObject({ process: { available: false, items: [], total: 0 } });
  expect(tool(p, "unrecorded").status).toBe("failed");
});

it("frozen input reads do not substitute current edited coordinates, while unrelated browsing preserves validity", () => {
  const p = native(modalCantilever()), original = p.nodes[1];
  const changed = updateNode(p, original.id, { ...original.position, x: original.position.x + 1 });
  const snapshot = captureAiSnapshot(changed, []);
  const read = executeAiTool(snapshot, call("read_results", { collection: "frozen-input", section: "nodes", offset: 1, limit: 1 }));
  expect(read.data).toMatchObject({ method: "modal", current: false, inputRevision: p.latestAnalysis!.input.projectRevision, items: [{ id: original.id, position: original.position }], page: { hasMore: false } });
  expect(executeAiTool(captureAiSnapshot(p, [{ kind: "member", id: p.members[0].id }]), call("read_results", { collection: "summary" })).data).toMatchObject({ current: true, canonicalUnits: "m-kN-kN·m", method: "modal" });
});
