// @vitest-environment node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { modalCantilever } from "../validation/modal-fixtures";
import { DEFAULT_MODAL_SETTINGS, modalDisplayResult, validateModalSettings } from "./modal";
import { addAnalysisCase, attachAnalysisResult, selectAnalysisCase, updateMaterial, updateNodalLoad, updateNode, updateSelfWeight } from "./project";
import { captureAnalysisInput, getMemberResponseSamples, isAnalysisResultCurrent } from "./analysis";
import { createAnalysisRequest, type AnalysisServiceRequest } from "./analysis-service";
import { decodeAnalysisResult, decodeProject, encodeProject } from "./project-file";
import { captureAiSnapshot, executeAiTool } from "../workspace/ai-tools";
import { ModelEditConfirmation, prepareModelEditConfirmation } from "../workspace/model-edits";
import { readResults } from "../workspace/ai-results";
import { startAnalysisTask } from "../workspace/analysis-task";
import { captureEngineeringReport } from "./engineering-report";

function nativeMessages(request: AnalysisServiceRequest) {
  const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 30000 });
  if (child.error) throw child.error;
  return child.stdout.trim().split("\n").map((line) => JSON.parse(line));
}
function nativeResult(project = modalCantilever()) {
  const terminal = nativeMessages(createAnalysisRequest(captureAnalysisInput(project))).at(-1);
  expect(terminal.kind, JSON.stringify(terminal)).toBe("result");
  return decodeAnalysisResult(terminal.result);
}
afterEach(() => vi.unstubAllGlobals());

it("forms structural mass without consuming loads and persists modal sources and shapes", () => {
  const p = modalCantilever(), r = nativeResult(p);
  expect(r.input.nodalLoads).toEqual([]); expect(r.input.selfWeight?.enabled).toBe(false);
  expect(r.service?.dependencies).toEqual([]); expect(r.nodes).toEqual([]); expect(r.members).toEqual([]);
  expect(r.modal!.totalMassKg).toBeCloseTo(471, 10);
  // Continuum weak-plane cantilever beta=1.875104068711961, E=200GPa,
  // I=0.0000166666667 m^4, rho*A=157 kg/m, L=3 m -> 9.05977724 Hz.
  expect(r.modal!.modes[0].frequencyHz).toBeCloseTo(9.05977724, 4);
  expect(r.modal!.convergence.status).toBe("converged");
  const saved = decodeProject(encodeProject(attachAnalysisResult(p, r)));
  expect(saved.latestAnalysis!.modal).toEqual(JSON.parse(JSON.stringify(r.modal)));
  expect(saved.members).toEqual(p.members); expect(saved.nodes).toEqual(p.nodes);
  expect(isAnalysisResultCurrent(saved, saved.latestAnalysis!)).toBe(true);
});

it("tracks density and geometry dependencies independently of static loads and self-weight", () => {
  const p = modalCantilever(), r = nativeResult(p);
  const weighted = updateSelfWeight(p, { enabled: true, loadCaseId: "LC1", gravity: { x: 0, y: 0, z: -9.81 } });
  expect(nativeResult(weighted).modal).toEqual(r.modal);
  const loaded = updateNodalLoad(p, p.nodalLoads[0].id, p.nodes[1].id, { x: 500, y: 500, z: 500 }, { x: 20, y: 20, z: 20 });
  expect(isAnalysisResultCurrent(loaded, r)).toBe(true);
  expect(isAnalysisResultCurrent(weighted, r)).toBe(true);
  expect(isAnalysisResultCurrent(updateMaterial(p, p.materials[0].id, { ...p.materials[0], densityKgM3: 8000 }), r)).toBe(false);
  expect(isAnalysisResultCurrent(updateNode(p, p.nodes[1].id, { x: 4, y: 0, z: 0 }), r)).toBe(false);
});

it("creates a modal case through reviewed tools with the same settings as manual creation", () => {
  const original = modalCantilever(), p = { ...original, analysisCases: [], activeAnalysisCaseId: undefined, nextAnalysisCaseNumber: 1 };
  const properties = { name: "AI modal", method: "modal" as const, loadSourceId: "structure", settings: { solver: "native-modal" as const, modal: { ...DEFAULT_MODAL_SETTINGS, modeCount: 3 } } };
  const call = { id: "modal-case", type: "function" as const, function: { name: "propose_model_edits", arguments: JSON.stringify({ operations: [{ type: "create_analysis_case", properties }] }) } };
  const draft = executeAiTool(captureAiSnapshot(p, []), call).modelEdits!;
  expect(draft).toBeDefined(); expect(p.analysisCases).toEqual([]);
  const confirmation = prepareModelEditConfirmation(p, draft), stage = new ModelEditConfirmation();
  const applied = stage.confirm(p, confirmation);
  expect(applied.result.status).toBe("applied");
  expect(applied.project.analysisCases).toEqual(addAnalysisCase(p, properties).analysisCases);
  expect(stage.confirm(applied.project, confirmation).project.analysisCases).toHaveLength(1);
  const r = nativeResult(selectAnalysisCase(applied.project, "AC1"));
  expect(r.modal!.modes).toHaveLength(3);
  const snapshot = captureAiSnapshot(attachAnalysisResult(selectAnalysisCase(applied.project, "AC1"), r), []);
  expect(snapshot.context.analysis).toMatchObject({ status: "complete", current: true });
  const read = executeAiTool(snapshot, { id: "read-modes", type: "function", function: { name: "read_results", arguments: '{"collection":"modes","limit":1}' } });
  expect(read.status).toBe("completed"); expect(read.data).toMatchObject({ total: 3, items: [{ number: 1 }] });
  // Result reads use the established public paginated tool boundary.
  expect(readResults(r, true, { collection: "mass" })).toMatchObject({ items: [{ massKg: expect.closeTo(471) }] });
  expect(readResults(r, true, { collection: "modes", offset: 1, limit: 1 })).toMatchObject({ total: 3, items: [{ number: 2 }], page: { hasMore: true } });
});

it("dispatches modal work through the default native bridge with frozen mappings", async () => {
  vi.stubGlobal("window", { frameMind: { runNativeAnalysis: async (request: AnalysisServiceRequest) => nativeMessages(request) } });
  const phases: string[] = [];
  const r = await startAnalysisTask(captureAnalysisInput(modalCantilever()), { onPhase: (p) => phases.push(p) }).promise;
  expect(r.input.solver!.implementation).toBe("framemind-native/5"); expect(r.modal!.modes).toHaveLength(6);
  expect(phases).toEqual(["model-check", "assembly", "solve", "recovery"]);
});

it("separates display scaling from saved shapes and rejects static interpretations", () => {
  const p = modalCantilever(), r = nativeResult(p), before = JSON.stringify(r.modal);
  const display = modalDisplayResult(r, 1), samples = getMemberResponseSamples(display, p.members[0].id, 17);
  expect(Math.max(...samples.map((s) => Math.hypot(s.globalDisplacement.x, s.globalDisplacement.y, s.globalDisplacement.z)))).toBeCloseTo(.001, 12);
  expect(JSON.stringify(r.modal)).toBe(before); expect(r.nodes).toEqual([]);
  expect(() => readResults(r, true, { collection: "nodes" })).toThrow(/静力/);
  expect(() => captureEngineeringReport(attachAnalysisResult(p, r), r.id)).toThrow(/模态/);
});

it("rejects malformed extraction settings, foreign mappings and forged mass/frequency/shape records", () => {
  for (const settings of [{ modeCount: 0 }, { maxEquations: 1201 }, { maxDivisions: 3 }, { frequencyTolerance: NaN }]) {
    expect(() => validateModalSettings({ ...DEFAULT_MODAL_SETTINGS, ...settings })).toThrow();
  }
  const r = nativeResult();
  for (const mutate of [
    (x: typeof r) => { x.modal!.totalMassKg += 1; },
    (x: typeof r) => { x.modal!.modes[0].frequencyHz += 1; },
    (x: typeof r) => { x.modal!.modes[0].nodes[1].translation.x = NaN; },
    (x: typeof r) => { x.input.meshPlan!.levels[0].elements[0].memberId = "foreign"; },
    (x: typeof r) => { x.modal!.modes[0].residual = 1; },
    (x: typeof r) => { x.modal!.convergence.runs[0].divisions = 16; },
    (x: typeof r) => { x.modal!.eigenproblem.stiffness = x.modal!.eigenproblem.stiffness!.map((row) => row.map(() => 1e308)); },
    (x: typeof r) => { x.modal!.eigenproblem.stiffness![0][0] = 1e308; },
    (x: typeof r) => { x.modal!.modes[0].members[0].samples[8].translation.x += 1; },
  ]) { const forged = structuredClone(r); mutate(forged); expect(() => decodeAnalysisResult(forged)).toThrow(); }
});

it("rejects deletion of an inactive free coordinate even if matching matrix rows and vectors are removed", () => {
  const forged = structuredClone(nativeResult()), modal = forged.modal!, problem = modal.eigenproblem;
  const index = problem.coordinates.findIndex((c) => c.kind === "node" && c.id === "node_0002" && c.dof === "ux");
  expect(index).toBeGreaterThanOrEqual(0);
  problem.coordinates.splice(index, 1); problem.vectors.forEach((v) => v.splice(index, 1));
  for (const matrix of [problem.stiffness!, problem.mass!]) { matrix.splice(index, 1); matrix.forEach((row) => row.splice(index, 1)); }
  modal.counts.equations--; modal.convergence.runs.at(-1)!.equations--;
  expect(() => decodeAnalysisResult(forged)).toThrow(/计算坐标/);
});
