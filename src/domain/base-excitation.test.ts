// @vitest-environment node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { modalCantilever } from "../validation/modal-fixtures";
import { addAnalysisCase, attachAnalysisResult, selectAnalysisCase, setNodeMass, updateAnalysisCase, type FrameProject } from "./project";
import { captureAnalysisInput, isAnalysisResultCurrent } from "./analysis";
import { createAnalysisRequest } from "./analysis-service";
import { decodeAnalysisResult, decodeProject, encodeProject } from "./project-file";
import { setModalDamping } from "./modal-damping";
import { addPsdSpectrum } from "./psd-project";
import { bandLimitedWhiteNoise, canonicalPsdConvention } from "./psd";
import { DEFAULT_RANDOM_ACCURACY, validateRandomSettings, type RandomAction } from "./random-response";
import { captureAiSnapshot, executeAiTool } from "../workspace/ai-tools";

function solve(project: FrameProject) {
  const child = spawnSync(resolve('native/bin/framemind-core.exe'), [], { input: JSON.stringify(createAnalysisRequest(captureAnalysisInput(project))), encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
  if (child.error) throw child.error;
  const message = JSON.parse(child.stdout.trim().split('\n').at(-1)!);
  expect(message.kind, JSON.stringify(message.error)).toBe('result');
  return attachAnalysisResult(project, decodeAnalysisResult(message.result));
}
function prepared() {
  let project = solve(modalCantilever());
  project = setModalDamping(project, 'AC1', project.latestAnalysis!.id, { uniform: { ratio: .02, source: 'user', basis: 'Test reference' }, overrides: [], truncation: { upperFrequencyHz: 25, modeIncrement: 2, maxModeCount: 50 } });
  project = addPsdSpectrum(project, bandLimitedWhiteNoise('Base', canonicalPsdConvention('acceleration'), [0, 25], 1));
  const properties = { name: 'Base', method: 'random' as const, loadSourceId: 'random', settings: { solver: 'native-random' as const, random: { ...DEFAULT_RANDOM_ACCURACY, modalAnalysisId: project.latestAnalysis!.id, sourceRelationship: 'independent' as const,
    sources: [{ sourceId: 'BASE', psdSpectrumId: 'PSD1', actions: [{ kind: 'base-translation', direction: { x: 0, y: 1, z: 0 }, scale: 1 } as RandomAction] }], response: { nodeId: project.nodes[1].id, component: 'y' as const }, bandHz: [0, 25] as [number, number] } } };
  return { project, properties };
}
it('base response preserves its relative frame, acceleration units and frozen history through save/reopen', () => {
  const { project, properties } = prepared(), completed = solve(selectAnalysisCase(addAnalysisCase(project, properties), 'AC2'));
  const result = completed.latestAnalysis!;
  expect(result.random!.referenceFrame).toBe('relative-to-base'); expect(result.random!.rms).toBeGreaterThan(0);
  expect(decodeProject(encodeProject(completed)).latestAnalysis!.random).toEqual(result.random);
  const call = (name: string, input: unknown) => ({ id: 'base-call', type: 'function', function: { name, arguments: JSON.stringify(input) } });
  const snapshot = captureAiSnapshot(completed, []);
  const inputs = executeAiTool(snapshot, call('read_results', { collection: 'input-psd', outputUnitPreset: 'mm-N' }));
  expect(inputs.status).toBe('completed'); expect(inputs.data).toMatchObject({ items: [{ density: 1e6, densityUnit: '(mm/s²)²/Hz' }, { density: 1e6, densityUnit: '(mm/s²)²/Hz' }] });
  const summary = executeAiTool(snapshot, call('read_results', { collection: 'summary' })); expect(summary.data).toMatchObject({ referenceFrame: 'relative-to-base' });
  const ref = executeAiTool(snapshot, call('read_result', { kind: 'node', id: project.nodes[1].id, quantity: 'rms', component: 'y' })); expect(ref.reference).toMatchObject({ referenceFrame: 'relative-to-base', quantity: 'rms' });
  expect(isAnalysisResultCurrent(setNodeMass(completed, project.nodes[1].id, 100), result)).toBe(false);
  const changed = updateAnalysisCase(completed, 'AC2', { ...properties, settings: { ...properties.settings, random: { ...properties.settings.random, sources: [{ ...properties.settings.random.sources[0], actions: [{ kind: 'base-translation', direction: { x: 0, y: 1, z: 0 }, scale: 2 }] }] } } });
  expect(isAnalysisResultCurrent(changed, result)).toBe(false);
  for (const frame of [undefined, 'absolute']) {
    const forged = structuredClone(result); (forged.random as unknown as Record<string, unknown>).referenceFrame = frame;
    expect(() => decodeAnalysisResult(forged)).toThrow();
  }
});
it('rejects differential targets, base rotations and a force mixed into an acceleration source', () => {
  const { properties } = prepared(), settings = properties.settings.random;
  for (const action of [
    { kind: 'base-translation', direction: { x: 0, y: 1, z: 0 }, scale: 1, nodeId: 'node_0001' },
    { kind: 'base-rotation', direction: { x: 0, y: 1, z: 0 }, scale: 1 },
  ]) expect(() => validateRandomSettings({ ...settings, sources: [{ ...settings.sources[0], actions: [action] }] })).toThrow();
  expect(() => validateRandomSettings({ ...settings, sources: [{ ...settings.sources[0], actions: [...settings.sources[0].actions, { kind: 'node', nodeId: 'node_0002', direction: { x: 0, y: 1, z: 0 }, scale: 1 }] }] })).toThrow(/力与加速度/);
});
