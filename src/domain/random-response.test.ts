// @vitest-environment node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { modalCantilever } from "../validation/modal-fixtures";
import { addAnalysisCase, addSupport, attachAnalysisResult, selectAnalysisCase, updateAnalysisCase, setNodeMass, updateNodalLoad, deleteAnalysisCase } from "./project";
import { captureAnalysisInput, isAnalysisResultCurrent, type AnalysisResult } from "./analysis";
import { createAnalysisRequest } from "./analysis-service";
import { decodeAnalysisResult, decodeProject, encodeProject } from "./project-file";
import { setModalDamping } from "./modal-damping";
import { bandLimitedWhiteNoise, canonicalPsdConvention } from "./psd";
import { addPsdSpectrum, deletePsdSpectrum, updatePsdSpectrum } from "./psd-project";
import { DEFAULT_RANDOM_ACCURACY } from "./random-response";
import { captureAiSnapshot, executeAiTool } from "../workspace/ai-tools";
import { ModelEditConfirmation, prepareModelEditConfirmation } from "../workspace/model-edits";
import { ProjectHistory } from "./project-history";
import { captureEngineeringReport } from "./engineering-report";

const native = (project: ReturnType<typeof modalCantilever>): AnalysisResult => {
  const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(createAnalysisRequest(captureAnalysisInput(project))), encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  if (child.error) throw child.error;
  const terminal = JSON.parse(child.stdout.trim().split("\n").at(-1)!);
  expect(terminal.kind, JSON.stringify(terminal)).toBe("result");
  return decodeAnalysisResult(terminal.result);
};
function prepared(restrainedX = false) {
  let project = modalCantilever();
  if (restrainedX) project = addSupport(project, project.nodes[1].id, [true, false, false, false, false, false]);
  const modal = native(project);
  project = attachAnalysisResult(project, modal);
  project = setModalDamping(project, "AC1", modal.id, { uniform: { ratio: .02, source: "suggestion", basis: "待用户核对的试验建议" }, overrides: [], truncation: { upperFrequencyHz: 25, modeIncrement: 2, maxModeCount: 50 } });
  project = addPsdSpectrum(project, bandLimitedWhiteNoise("White force", canonicalPsdConvention("force"), [0, 25], 1));
  const properties = { name: "节点随机力", method: "random" as const, loadSourceId: "random", settings: { solver: "native-random" as const, random: { ...DEFAULT_RANDOM_ACCURACY,
    modalAnalysisId: modal.id, psdSpectrumId: "PSD1", excitation: { nodeId: project.nodes[1].id, direction: { x: 0, y: 1, z: 0 }, scale: 1 }, response: { nodeId: project.nodes[1].id, component: "y" as const }, bandHz: [0, 25] as [number, number] } } };
  return { project, properties };
}
const call = (name: string, input: unknown) => ({ id: "random-call", type: "function", function: { name, arguments: JSON.stringify(input) } });

it("manual and agent-confirmed random cases share frozen modal, damping and spectrum and survive undo/reopening", () => {
  const { project, properties } = prepared(), history = new ProjectHistory();
  const proposed = executeAiTool(captureAiSnapshot(project, []), call("propose_model_edits", { operations: [{ type: "create_analysis_case", properties }] }));
  const raw = call("propose_model_edits", { operations: [{ type: "create_analysis_case", properties }] });
  raw.function.arguments = raw.function.arguments.replace('"scale":1', '"scale":1e-400');
  expect(executeAiTool(captureAiSnapshot(project, []), raw).status).toBe("failed");
  expect(proposed.status).toBe("awaiting-confirmation"); expect(project.analysisCases).toHaveLength(1);
  const confirmation = prepareModelEditConfirmation(project, proposed.modelEdits!), applied = new ModelEditConfirmation().confirm(project, confirmation);
  expect(applied.result.status).toBe("applied"); history.record(project, applied.project);
  const active = selectAnalysisCase(applied.project, "AC2"), result = native(active), completed = attachAnalysisResult(active, result);
  expect(result.nodes).toEqual([]); expect(result.members).toEqual([]); expect(result.random!.rms).toBeGreaterThan(.049); expect(result.random!.rms).toBeLessThan(.050);
  expect(result.input.randomBasis!.damping.uniform.source).toBe("suggestion");
  const manual = selectAnalysisCase(addAnalysisCase(project, properties), "AC2");
  expect(captureAnalysisInput(active)).toEqual({ ...captureAnalysisInput(manual), projectRevision: active.revision });
  const reopened = decodeProject(encodeProject(completed)); expect(reopened.latestAnalysis!.random).toEqual(result.random); expect(isAnalysisResultCurrent(reopened, reopened.latestAnalysis!)).toBe(true);
  expect(history.undo(applied.project)!.analysisCases).toHaveLength(1); expect(history.redo(project)!.analysisCases).toHaveLength(2);
  expect(() => captureEngineeringReport(completed, result.id)).toThrow(/T2-38/);
});

it("a small free component mixed with a restrained force direction is equivalent to a scaled free force", () => {
  const { project, properties } = prepared(true), s = properties.settings.random;
  const solve = (direction: typeof s.excitation.direction, scale: number) => native(selectAnalysisCase(addAnalysisCase(project, { ...properties,
    settings: { ...properties.settings, random: { ...s, excitation: { ...s.excitation, direction, scale } } } }), "AC2"));
  const mixed = solve({ x: 1, y: 1e-11, z: 0 }, 1), free = solve({ x: 0, y: 1, z: 0 }, 1e-11);
  expect(mixed.random!.rms).toBeGreaterThan(0);
  expect(mixed.random!.rms / free.random!.rms).toBeCloseTo(1, 10);
  expect(mixed.random!.points.map((p) => p.frequencyHz)).toEqual(free.random!.points.map((p) => p.frequencyHz));
  mixed.random!.points.forEach((point, i) => expect(point.density / free.random!.points[i].density).toBeCloseTo(1, 10));
});

it("agent reads bounded response PSD and creates a statistical RMS reference in equivalent display units", () => {
  const { project, properties } = prepared(), active = selectAnalysisCase(addAnalysisCase(project, properties), "AC2"), result = native(active), completed = attachAnalysisResult(active, result);
  const snapshot = captureAiSnapshot(completed, []);
  expect(snapshot.context.analysis?.status).toBe("complete");
  const summary = executeAiTool(snapshot, call("read_results", { collection: "summary", outputUnitPreset: "mm-N" }));
  expect(summary.status).toBe("completed"); expect(summary.data).toMatchObject({ method: "random", rms: result.random!.rms * 1000, rmsUnit: "mm", variance: result.random!.variance * 1e6, varianceUnit: "mm²", meaning: expect.stringContaining("不是瞬时峰值") });
  const response = executeAiTool(snapshot, call("read_results", { collection: "psd", offset: 4, limit: 3, outputUnitPreset: "mm-N" }));
  expect(response.data).toMatchObject({ total: result.random!.points.length, items: result.random!.points.slice(4, 7).map((v) => ({ frequencyHz: v.frequencyHz, density: v.density * 1e6, densityUnit: "mm²/Hz" })) });
  const reference = executeAiTool(snapshot, call("read_result", { kind: "node", id: properties.settings.random.response.nodeId, quantity: "rms", component: "y" }));
  expect(reference.reference).toMatchObject({ quantity: "rms", value: result.random!.rms, unit: "m", coordinateSystem: "global XYZ", current: true });
  expect(executeAiTool(snapshot, call("read_result", { kind: "node", id: properties.settings.random.response.nodeId, quantity: "displacement", component: "y" })).status).toBe("failed");
  expect(executeAiTool(snapshot, call("read_results", { collection: "nodes" })).status).toBe("failed");
});

it("random currentness follows mass, PSD, modal identity and damping while preserving frozen history", () => {
  const { project, properties } = prepared(), active = selectAnalysisCase(addAnalysisCase(project, properties), "AC2"), result = native(active), completed = attachAnalysisResult(active, result);
  const load = completed.nodalLoads[0];
  expect(isAnalysisResultCurrent(updateNodalLoad(completed, load.id, load.nodeId, { x: 1, y: 2, z: 3 }, load.moment), result)).toBe(true);
  expect(isAnalysisResultCurrent(setNodeMass(completed, completed.nodes[1].id, 100), result)).toBe(false);
  const edited = updatePsdSpectrum(completed, "PSD1", bandLimitedWhiteNoise("White force", canonicalPsdConvention("force"), [0, 25], 4));
  expect(isAnalysisResultCurrent(edited, result)).toBe(false);
  const recalculated = native(edited); expect(recalculated.random!.rms / result.random!.rms).toBeCloseTo(2, 10);
  const deleted = deletePsdSpectrum(completed, "PSD1"); expect(isAnalysisResultCurrent(deleted, result)).toBe(false); expect(decodeProject(encodeProject(deleted)).latestAnalysis!.random).toEqual(result.random);
  const noModalCase = deleteAnalysisCase(completed, "AC1"); expect(isAnalysisResultCurrent(noModalCase, result)).toBe(false); expect(decodeProject(encodeProject(noModalCase)).latestAnalysis!.random).toEqual(result.random);
  const modalProject = selectAnalysisCase(completed, "AC1"), newModal = native(modalProject), recomputed = attachAnalysisResult(modalProject, newModal);
  expect(isAnalysisResultCurrent(recomputed, result)).toBe(false);
  const changedDamping = setModalDamping(completed, "AC1", properties.settings.random.modalAnalysisId, { overrides: completed.analysisCases[0].damping!.overrides, truncation: completed.analysisCases[0].damping!.truncation, uniform: { ratio: .04, source: "user", basis: "Updated test measurement" } });
  expect(isAnalysisResultCurrent(changedDamping, result)).toBe(false); expect(decodeProject(encodeProject(changedDamping)).analysisResults.at(-1)!.random).toEqual(result.random);
});

it("saved random curves, RMS and convergence cannot be forged or routed into static slots", () => {
  const { project, properties } = prepared(), active = selectAnalysisCase(addAnalysisCase(project, properties), "AC2"), result = native(active);
  for (const alter of [(r: AnalysisResult) => { r.random!.rms *= 1.01; }, (r: AnalysisResult) => { r.random!.points[3].density *= 1.01; },
    (r: AnalysisResult) => { r.random!.convergence.runs.at(-1)!.varianceError = 0; }, (r: AnalysisResult) => { r.random!.coordinateSystem = "local xyz" as never; },
    (r: AnalysisResult) => { r.input.randomBasis!.damping.analysisId = "foreign"; }, (r: AnalysisResult) => { r.input.randomBasis!.modal.modal!.modes[0].nodes[1].translation.y *= 1.01; }]) {
    const changed = structuredClone(result); alter(changed); expect(() => decodeAnalysisResult(changed)).toThrow();
  }
  const invalid = { ...properties, settings: { ...properties.settings, random: { ...properties.settings.random, excitation: { ...properties.settings.random.excitation, direction: { x: 0, y: 0, z: 0 } } } } };
  expect(() => updateAnalysisCase(active, "AC2", invalid)).toThrow();
});
