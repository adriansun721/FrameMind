import { expect, it } from "vitest";
import { createProject } from "../domain/project";
import { canonicalPsdConvention } from "../domain/psd";
import { captureAiSnapshot, executeAiTool } from "./ai-tools";
import { applyProjectEdits } from "../domain/project-operations";
import { decodeProject, encodeProject } from "../domain/project-file";
import { ProjectHistory } from "../domain/project-history";
import { ModelEditConfirmation, prepareModelEditConfirmation, proposeModelEdits } from "./model-edits";
import { coordinateModelEdits } from "./draft-coordination";
import { bandLimitedWhiteNoise, psdSpectrumInput } from "../domain/psd";

const call = (name: string, input: unknown) => ({ id: "psd-call", type: "function", function: { name, arguments: JSON.stringify(input) } });

it.each(["-1e-400", "1e-400"])("rejects raw tool density %s before JSON parsing can hide underflow", (density) => {
  const request = call("prepare_psd_input", { format: "white-noise", metadata: { name: "underflow", ...canonicalPsdConvention("force"), band: [0, 1] }, density: 2 });
  request.function.arguments = request.function.arguments.replace('"density":2', `"density":${density}`);
  const project = createProject();
  const result = executeAiTool(captureAiSnapshot(project, []), request);
  expect(result.status).toBe("failed");
  expect(result.message).toContain("下溢");
  expect(project.psdSpectra).toHaveLength(0);
});

it.each(["-1e-400", "1e-400"])("rejects JSON density %s before preparing a confirmable PSD edit", (density) => {
  const properties = bandLimitedWhiteNoise("underflow", canonicalPsdConvention("force"), [0, 1], 2);
  const request = call("propose_model_edits", { operations: [{ type: "create_psd_spectrum", properties }] });
  request.function.arguments = request.function.arguments.replaceAll('"density":2', `"density":${density}`);
  const result = executeAiTool(captureAiSnapshot(createProject(), []), request);
  expect(result.status).toBe("failed");
  expect(result.message).toContain("下溢");
  expect(result.modelEdits).toBeUndefined();
});

it.each(["prepare_psd_input", "propose_model_edits"])("allows genuine zero spectra and numeric-looking quoted names through %s", (name) => {
  const properties = bandLimitedWhiteNoise('quoted "-1e-400" \\ 1e-400', canonicalPsdConvention("force"), [0, 1], 0);
  const { points, ...metadata } = properties;
  const args = name === "prepare_psd_input" ? { format: "table", metadata, points }
    : { operations: [{ type: "create_psd_spectrum", properties }] };
  const result = executeAiTool(captureAiSnapshot(createProject(), []), call(name, args));
  expect(result.status).toBe(name === "prepare_psd_input" ? "completed" : "awaiting-confirmation");
});

it("prepares the same band-limited input through the tool without mutating formal spectra", () => {
  const project = createProject();
  const result = executeAiTool(captureAiSnapshot(project, []), call("prepare_psd_input", { format: "white-noise", metadata: { name: "rectangle", ...canonicalPsdConvention("force"), band: [10, 20] }, density: 2 }));
  expect(result.status).toBe("completed");
  expect(result.data).toMatchObject({ variance: 20, varianceUnit: "kN²", input: { points: [{ frequency: 10, density: 2 }, { frequency: 20, density: 2 }] } });
  expect(project.psdSpectra).toEqual([]);
});

it("accepts declared common tool preferences without overriding the PSD's own units", () => {
  const result = executeAiTool(captureAiSnapshot(createProject(), []), call("prepare_psd_input", { format: "white-noise", metadata: { name: "rectangle", ...canonicalPsdConvention("force"), band: [10, 20] }, density: 2, inputUnits: { force: "N" }, outputUnitPreset: "mm-N" }));
  expect(result.status).toBe("completed");
  expect(result.data).toMatchObject({ variance: 20, varianceUnit: "kN²", displayUnitPreset: "mm-N", canonical: { excitationUnit: "kN", densityUnit: "kN²/Hz", points: [{ frequency: 10, density: 2 }, { frequency: 20, density: 2 }] } });
});

it("manual and confirmed tool editing persist identical spectra with readback, undo and idempotence", () => {
  const project = createProject(), properties = bandLimitedWhiteNoise("rectangle", canonicalPsdConvention("force"), [10, 20], 2);
  const operations = [{ type: "create_psd_spectrum" as const, properties }];
  const result = executeAiTool(captureAiSnapshot(project, []), call("propose_model_edits", { operations }));
  expect(result.status).toBe("awaiting-confirmation"); expect(project.psdSpectra).toHaveLength(0);
  const confirmation = prepareModelEditConfirmation(project, result.modelEdits!), service = new ModelEditConfirmation();
  const applied = service.confirm(project, confirmation);
  expect(applied.result.status).toBe("applied");
  expect(applied.project.psdSpectra).toEqual(applyProjectEdits(project, operations).project.psdSpectra);
  expect(applied.result.data).toMatchObject({ readback: { objects: [{ kind: "psd-spectrum", id: "PSD1", exists: true }] } });
  const saved = decodeProject(encodeProject(applied.project));
  expect(saved.psdSpectra).toEqual(applied.project.psdSpectra);
  expect(service.confirm(saved, confirmation).project.psdSpectra).toHaveLength(1);
  const read = executeAiTool(captureAiSnapshot(saved, []), call("read_model", { collection: "psd-spectra", fields: ["id", "band", "densityUnit", "points"] }));
  expect(read.status).toBe("completed"); expect(read.data).toMatchObject({ total: 1, items: [{ id: "PSD1", band: [10, 20], densityUnit: "kN²/Hz" }] });
  const history = new ProjectHistory(); history.record(project, saved);
  expect(history.undo(saved)!.psdSpectra).toHaveLength(0);
  expect(history.redo(project)!.psdSpectra).toEqual(saved.psdSpectra);
  const legacy = JSON.parse(encodeProject(project)); delete legacy.psdSpectra; delete legacy.nextPsdNumber;
  expect(decodeProject(JSON.stringify(legacy)).psdSpectra).toEqual([]);
});

it("update/delete spectrum drafts block conflicting edits while compatible unrelated edits can continue", () => {
  const original = applyProjectEdits(createProject(), [{ type: "create_psd_spectrum", properties: bandLimitedWhiteNoise("original", canonicalPsdConvention("force"), [10, 20], 2) }]).project;
  const properties = { ...psdSpectrumInput(original.psdSpectra[0]), name: "agent change" };
  const proposal = proposeModelEdits(original, { operations: [{ type: "update_psd_spectrum", id: "PSD1", properties }] });
  const current = applyProjectEdits(original, [{ type: "update_psd_spectrum", id: "PSD1", properties: { ...properties, name: "manual change" } }]).project;
  expect(coordinateModelEdits(original, current, proposal).conflicts.length).toBeGreaterThan(0);
  expect(new ModelEditConfirmation().confirm(current, prepareModelEditConfirmation(original, proposal)).result.status).toBe("failed");
  const unrelated = applyProjectEdits(original, [{ type: "create_node", position: { x: 1, y: 0, z: 0 } }]).project;
  expect(coordinateModelEdits(original, unrelated, proposal).conflicts).toEqual([]);
  const deleted = applyProjectEdits(original, [{ type: "delete_psd_spectrum", id: "PSD1" }]).project;
  const next = applyProjectEdits(deleted, [{ type: "create_psd_spectrum", properties }]).project;
  expect(next.psdSpectra[0].id).toBe("PSD2");
});

it("failed mixed batches are atomic and malformed saved spectra cannot silently drop units", () => {
  const project = createProject(), properties = bandLimitedWhiteNoise("valid", canonicalPsdConvention("force"), [10, 20], 2);
  expect(() => applyProjectEdits(project, [{ type: "create_psd_spectrum", properties }, { type: "delete_psd_spectrum", id: "PSD999" }])).toThrow();
  expect(project.psdSpectra).toHaveLength(0); expect(project.revision).toBe(0);
  const saved = JSON.parse(encodeProject(applyProjectEdits(project, [{ type: "create_psd_spectrum", properties }]).project));
  delete saved.psdSpectra[0].densityUnit;
  expect(() => decodeProject(JSON.stringify(saved))).toThrow();
});

it("CSV preparation uses explicit metadata and refuses missing units before a draft exists", () => {
  const snapshot = captureAiSnapshot(createProject(), []), metadata = { name: "csv", ...canonicalPsdConvention("force"), band: [10, 20] };
  const ready = executeAiTool(snapshot, call("prepare_psd_input", { format: "csv", metadata, csv: "frequency,density\n10,2\n20,2" }));
  expect(ready.status).toBe("completed"); expect(ready.data).toMatchObject({ variance: 20 });
  expect(executeAiTool(snapshot, call("prepare_psd_input", { format: "csv", metadata: { ...metadata, densityUnit: undefined }, csv: "frequency,density\n10,2\n20,2" })).status).toBe("failed");
});
