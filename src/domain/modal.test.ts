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
import { startAiTask } from "../workspace/ai-task";
import type { DeepSeekChatResult } from "../../electron/contracts";
import { createDiagnosticCopy } from "../workspace/diagnostic-trial";
import { captureEngineeringReport } from "./engineering-report";
import { modalDampingStatus, setModalDamping, validateModalDampingInput, type ModalDampingInput } from "./modal-damping";
import { ProjectHistory } from "./project-history";
import { updateAnalysisCase } from "./project";

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

it("binds effective uniform and override damping to a saved modal identity without changing eigenfrequencies", () => {
  const p = modalCantilever(), r = nativeResult(p), analyzed = attachAnalysisResult(p, r);
  const input: ModalDampingInput = { uniform: { ratio: .02, source: "user", basis: "试验输入" }, overrides: [{ modeNumber: 2, value: { ratio: .04, source: "suggestion", basis: "待核对试验建议" } }], truncation: { upperFrequencyHz: 100, modeIncrement: 2, maxModeCount: 10 } };
  expect(modalDampingStatus(analyzed, r).status).toBe("missing");
  const configured = setModalDamping(analyzed, "AC1", r.id, input);
  const copy = createDiagnosticCopy(configured);
  expect(copy.model.analysisCases[0].damping).toBeUndefined();
  expect(decodeProject(encodeProject(copy.model)).analysisCases[0].damping).toBeUndefined();
  expect(isAnalysisResultCurrent(configured, r)).toBe(true);
  const read = modalDampingStatus(decodeProject(encodeProject(configured)), r);
  expect(read.status).toBe("valid");
  expect(read.modes[0].damping).toEqual(input.uniform); expect(read.modes[1].damping).toEqual(input.overrides[0].value);
  expect(read.truncation).toMatchObject({ nextModeCount: 8, responseAccuracy: "not-verified" });
  const recomputed = attachAnalysisResult(configured, nativeResult(configured));
  expect(modalDampingStatus(recomputed, recomputed.latestAnalysis!).status).toBe("needs-review");
  expect(modalDampingStatus(recomputed, recomputed.latestAnalysis!).modes.every((m) => m.damping === null)).toBe(true);
  expect(recomputed.latestAnalysis!.modal).toEqual(r.modal);
});

it("previews damping as an atomic tool edit and reads the same effective values as manual settings", () => {
  const p = modalCantilever(), r = nativeResult(p), analyzed = attachAnalysisResult(p, r);
  const input: ModalDampingInput = { uniform: { ratio: .03, source: "suggestion", basis: "AI 建议，尚需工程核对" }, overrides: [], truncation: { upperFrequencyHz: 100, modeIncrement: 2, maxModeCount: 8 } };
  const tool = executeAiTool(captureAiSnapshot(analyzed, []), { id: "damping", type: "function", function: { name: "propose_model_edits", arguments: JSON.stringify({ operations: [{ type: "set_modal_damping", id: "AC1", analysisId: r.id, properties: input }] }) } });
  expect(tool.status).toBe("awaiting-confirmation");
  expect(analyzed.analysisCases[0].damping).toBeUndefined();
  const confirmation = prepareModelEditConfirmation(analyzed, tool.modelEdits!), stage = new ModelEditConfirmation();
  const applied = stage.confirm(analyzed, confirmation);
  expect(applied.result.status).toBe("applied");
  expect(applied.project.analysisCases).toEqual(setModalDamping(analyzed, "AC1", r.id, input).analysisCases);
  const read = executeAiTool(captureAiSnapshot(applied.project, []), { id: "read", type: "function", function: { name: "read_results", arguments: '{"collection":"modes","limit":1}' } });
  expect(read.data).toMatchObject({ items: [{ effectiveDamping: input.uniform }], damping: { status: "valid" } });
  expect(new ModelEditConfirmation().confirm(attachAnalysisResult(analyzed, nativeResult(analyzed)), confirmation).result.status).toBe("failed");
});

it("rejects ambiguous damping and invalid bindings and stops incremental checks at the mode budget", () => {
  const p = modalCantilever({ ...DEFAULT_MODAL_SETTINGS, modeCount: 3 }), r = nativeResult(p), analyzed = attachAnalysisResult(p, r);
  const input: ModalDampingInput = { uniform: { ratio: .02, source: "user", basis: "输入记录" }, overrides: [], truncation: { upperFrequencyHz: 1e6, modeIncrement: 2, maxModeCount: 5 } };
  for (const ratio of [0, 1, -.1, NaN, Infinity, "0.02"]) expect(() => validateModalDampingInput({ ...input, uniform: { ...input.uniform, ratio } })).toThrow(/阻尼比/);
  for (const extra of [{ uniform: { ratio: .02, source: "user", basis: "" } }, { rayleigh: { alpha: 1 } }, { truncation: { ...input.truncation, upperFrequencyHz: 0 } }]) expect(() => validateModalDampingInput({ ...input, ...extra })).toThrow();
  expect(() => setModalDamping(analyzed, "AC1", r.id, { ...input, overrides: [{ modeNumber: 4, value: input.uniform }] })).toThrow(/覆盖阶次/);
  expect(() => setModalDamping(analyzed, "AC1", r.id, { ...input, overrides: [{ modeNumber: 1, value: input.uniform }, { modeNumber: 1, value: input.uniform }] })).toThrow(/不重复/);
  expect(() => setModalDamping(analyzed, "AC1", r.id, { ...input, truncation: { ...input.truncation, maxModeCount: 2 } })).toThrow(/预算/);
  const configured = setModalDamping(analyzed, "AC1", r.id, input);
  const history = new ProjectHistory(); history.record(analyzed, configured);
  expect(modalDampingStatus(history.undo(configured)!, r).status).toBe("missing");
  expect(modalDampingStatus(history.redo(analyzed)!, r).status).toBe("valid");
  const moved = updateNode(configured, p.nodes[1].id, { x: 4, y: 0, z: 0 });
  expect(modalDampingStatus(moved, r).status).toBe("needs-review");
  expect(() => setModalDamping(moved, "AC1", r.id, input)).toThrow(/重读/);
  const grown = updateAnalysisCase(configured, "AC1", { ...configured.analysisCases[0], settings: { solver: "native-modal", modal: { ...DEFAULT_MODAL_SETTINGS, modeCount: 5 } } });
  const newResult = nativeResult(grown), next = attachAnalysisResult(grown, newResult);
  const reviewed = setModalDamping(next, "AC1", newResult.id, input), status = modalDampingStatus(reviewed, newResult);
  expect(status.truncation).toMatchObject({ frequencyCoverage: false, modeBudgetReached: true, nextModeCount: null, responseAccuracy: "not-verified" });
  expect(status.truncation.frequencyChecks.at(-1)).toMatchObject({ grew: true, requestedModeCount: 5, responseAccuracy: "not-verified" });
  const forged = JSON.parse(encodeProject(configured)); forged.analysisCases[0].damping.frequenciesHz[0] += 1;
  expect(() => decodeProject(JSON.stringify(forged))).toThrow(/阻尼绑定/);
  forged.analysisCases[0].damping.analysisId = "foreign";
  expect(() => decodeProject(JSON.stringify(forged))).toThrow(/阻尼绑定/);
  for (const source of [["user"], ["suggestion"], null, true, 1]) {
    expect(() => validateModalDampingInput({ ...input, uniform: { ...input.uniform, source } })).toThrow(/依据/);
    const invalid = JSON.parse(encodeProject(configured)); invalid.analysisCases[0].damping.uniform.source = source;
    expect(() => decodeProject(JSON.stringify(invalid))).toThrow(/依据/);
  }
  const lowBudget = JSON.parse(encodeProject(configured)); lowBudget.analysisCases[0].damping.truncation.maxModeCount = 1;
  expect(() => decodeProject(JSON.stringify(lowBudget))).toThrow(/阻尼绑定/);
});

it("keeps a damping draft available through the agent task loop without treating its case as a deleted member", async () => {
  const p = modalCantilever(), r = nativeResult(p), analyzed = attachAnalysisResult(p, r), snapshot = captureAiSnapshot(analyzed, []);
  const properties: ModalDampingInput = { uniform: { ratio: .02, source: "suggestion", basis: "待核对建议" }, overrides: [], truncation: { upperFrequencyHz: 100, modeIncrement: 2, maxModeCount: 8 } };
  const responses: DeepSeekChatResult[] = [
    { status: "success", message: "草案", assistant: { role: "assistant", content: null, tool_calls: [{ id: "damping", type: "function", function: { name: "propose_model_edits", arguments: JSON.stringify({ operations: [{ type: "set_modal_damping", id: "AC1", analysisId: r.id, properties }] }) } }] } },
    { status: "success", message: "完成", assistant: { role: "assistant", content: "请核对阻尼草案。" } },
  ];
  const result = await startAiTask(snapshot, "准备阻尼", { isCurrent: () => true, getCurrentSnapshot: () => snapshot,
    transport: { chatDeepSeek: async () => responses.shift()!, cancelDeepSeekChat: async () => undefined } }).promise;
  expect(result.status).toBe("awaiting-confirmation");
  expect(result.modelEdits?.operations[0].type).toBe("set_modal_damping");
  expect(result.records.find((record) => record.call.function.name === "propose_model_edits")?.result.status).toBe("awaiting-confirmation");
  const continued = await startAiTask(snapshot, "继续核对", { modelEdits: result.modelEdits!, isCurrent: () => true, getCurrentSnapshot: () => snapshot,
    transport: { chatDeepSeek: async () => responses.shift()!, cancelDeepSeekChat: async () => undefined } }).promise;
  expect(continued.status).toBe("completed");
});

it("preserves bound modal evidence across agent refresh after an unrelated static load edit", async () => {
  const p = modalCantilever(), r = nativeResult(p), analyzed = attachAnalysisResult(p, r);
  const properties: ModalDampingInput = { uniform: { ratio: .02, source: "user", basis: "试验" }, overrides: [], truncation: { upperFrequencyHz: 100, modeIncrement: 2, maxModeCount: 8 } };
  const configured = setModalDamping(analyzed, "AC1", r.id, properties), initial = captureAiSnapshot(configured, []);
  const current = updateNodalLoad(configured, configured.nodalLoads[0].id, configured.nodes[1].id, { x: 100, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  const responses: DeepSeekChatResult[] = [
    { status: "success", message: "查询", assistant: { role: "assistant", content: null, tool_calls: [{ id: "read", type: "function", function: { name: "read_results", arguments: '{"collection":"summary"}' } }] } },
    { status: "success", message: "草案", assistant: { role: "assistant", content: null, tool_calls: [{ id: "edit", type: "function", function: { name: "propose_model_edits", arguments: JSON.stringify({ operations: [{ type: "set_modal_damping", id: "AC1", analysisId: r.id, properties }] }) } }] } },
  ];
  const result = await startAiTask(initial, "核对阻尼", { isCurrent: () => true, getCurrentSnapshot: () => captureAiSnapshot(current, []),
    transport: { chatDeepSeek: async () => responses.shift()!, cancelDeepSeekChat: async () => undefined } }).promise;
  expect(result.status).toBe("awaiting-confirmation");
  expect(result.records.find((record) => record.call.function.name === "read_results")?.result.data).toMatchObject({ damping: { status: "valid" } });
  expect(decodeProject(encodeProject(result.draftBaseProject!)).analysisCases[0].damping!.analysisId).toBe(r.id);
});

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
