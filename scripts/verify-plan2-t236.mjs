import { createServer } from "vite";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const evidence = "docs/evidence/plan2/T2-36";
const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
try {
  const load = (path) => server.ssrLoadModule('/src/' + path + '.ts');
  const p = await load('domain/project'), a = await load('domain/analysis');
  const { secondOrderColumn } = await load('validation/second-order-fixtures');
  const { createAnalysisRequest } = await load('domain/analysis-service');
  const { decodeAnalysisResult, decodeProject, encodeProject } = await load('domain/project-file');
  const { DEFAULT_MODAL_SETTINGS } = await load('domain/modal');
  const { DEFAULT_BUCKLING_SETTINGS } = await load('domain/buckling');
  const { setModalDamping } = await load('domain/modal-damping');
  const { bandLimitedWhiteNoise, canonicalPsdConvention } = await load('domain/psd');
  const { addPsdSpectrum } = await load('domain/psd-project');
  const { DEFAULT_RANDOM_ACCURACY } = await load('domain/random-response');
  const { captureAiSnapshot, executeAiTool } = await load('workspace/ai-tools');
  const { compareAnalysisResults } = await load('domain/analysis-comparison');
  const solve = (project) => {
    let input = a.captureAnalysisInput(project);
    if (input.analysisCase.method === 'static') input = { ...input, solver: a.NATIVE_MESH_STATIC_SOLVER };
    const child = spawnSync(resolve('native/bin/framemind-core.exe'), [], { input: JSON.stringify(createAnalysisRequest(input)), encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
    if (child.error) throw child.error;
    const message = JSON.parse(child.stdout.trim().split('\n').at(-1));
    assert.equal(message.kind, 'result', JSON.stringify(message.error));
    return p.attachAnalysisResult(project, decodeAnalysisResult(message.result));
  };
  let project = secondOrderColumn(100, .1);
  project = p.addAnalysisCase(project, { name: 'Modal', method: 'modal', loadSourceId: 'structure', settings: { solver: 'native-modal', modal: { ...DEFAULT_MODAL_SETTINGS } } });
  project = p.addAnalysisCase(project, { name: 'Static', method: 'static', loadSourceId: 'LC1', settings: { solver: 'native-static' } });
  project = p.addAnalysisCase(project, { name: 'Buckling', method: 'buckling', loadSourceId: 'buckling', settings: { solver: 'native-buckling', buckling: structuredClone(DEFAULT_BUCKLING_SETTINGS) } });
  for (const id of ['AC1', 'AC2', 'AC3', 'AC4']) project = solve(p.selectAnalysisCase(project, id));
  const modal = project.analysisResults.find((r) => r.modal);
  project = setModalDamping(project, 'AC2', modal.id, { uniform: { ratio: .02, source: 'user', basis: 'T2-36 deterministic verification' }, overrides: [], truncation: { upperFrequencyHz: 25, modeIncrement: 2, maxModeCount: 50 } });
  project = addPsdSpectrum(project, bandLimitedWhiteNoise('Base', canonicalPsdConvention('acceleration'), [0, 25], 1));
  project = p.addAnalysisCase(project, { name: 'Random', method: 'random', loadSourceId: 'random', settings: { solver: 'native-random', random: { ...DEFAULT_RANDOM_ACCURACY, modalAnalysisId: modal.id, sourceRelationship: 'independent',
    sources: [{ sourceId: 'BASE', psdSpectrumId: 'PSD1', actions: [{ kind: 'base-translation', direction: { x: 0, y: 1, z: 0 }, scale: 1 }] }], response: { nodeId: project.nodes[1].id, component: 'y' }, bandHz: [0, 25] } } });
  project = solve(p.selectAnalysisCase(project, 'AC5'));
  const random = project.latestAnalysis;
  const call = (name, input) => ({ id: 'verify', type: 'function', function: { name, arguments: JSON.stringify(input) } });
  const query = (project, result, name, input) => executeAiTool(captureAiSnapshot(project, [], result), call(name, input));
  const checks = [];
  const rms = query(project, random, 'read_result', { kind: 'node', id: random.random.response.nodeId, quantity: 'rms', component: random.random.response.component });
  assert.equal(rms.reference.value, random.random.rms);
  for (const result of project.analysisResults) {
    const method = result.input.analysisCase.method;
    const summary = query(project, result, 'read_results', { collection: 'summary' });
    assert.equal(summary.status, 'completed'); assert.equal(summary.data.method, method);
    assert.equal(summary.data.analysisId, result.id); assert.equal(summary.data.inputRevision, result.input.projectRevision);
    for (const section of ['settings', 'mesh', 'stages', 'coordinates', 'stiffness', 'mass', 'geometric', 'iterations']) {
      const output = query(project, result, 'read_results', { collection: 'process', section, limit: 2 });
      assert.equal(output.status, 'completed'); assert.ok(output.data.process.items.length <= 2);
      if (!output.data.process.available) assert.match(output.data.process.message, /未保存/);
    }
    checks.push({ method, analysisId: result.id, inputRevision: result.input.projectRevision, current: summary.data.current, completion: summary.data.completion });
    if (['static', 'second-order'].includes(method)) {
      const station = result.members[0].nativeResponses[8];
      const ref = query(project, result, 'read_result', { kind: 'member', id: result.members[0].memberId, quantity: 'displacement', component: 'y', position: station.position });
      assert.equal(ref.status, 'completed'); assert.equal(ref.reference.value, station.globalDisplacement.y);
    }
  }
  const modalMatrix = query(project, random, 'read_results', { collection: 'process', section: 'mass', limit: 2 });
  assert.equal(modalMatrix.data.process.sourceAnalysisId, modal.id);
  assert.deepEqual(modalMatrix.data.process.items, modal.modal.eigenproblem.mass.slice(0, 2));
  const station = modal.modal.modes[1].members[0].samples[8];
  const shapeArgs = { kind: 'member', id: project.members[0].id, quantity: 'shapeTranslation', component: 'y', modeNumber: 2, position: station.position };
  const ref = query(project, modal, 'read_result', shapeArgs);
  assert.equal(ref.status, 'completed'); assert.equal(ref.reference.value, station.translation.y);
  const changed = p.updateNode(project, project.nodes[1].id, { ...project.nodes[1].position, x: 4 });
  for (const result of changed.analysisResults) assert.equal(a.isAnalysisResultCurrent(changed, result), false);
  const deleted = decodeProject(encodeProject(p.deleteMember(changed, changed.members[0].id)));
  const historyRef = query(deleted, deleted.analysisResults.find((r) => r.id === modal.id), 'read_result', shapeArgs);
  assert.equal(historyRef.reference.current, false); assert.deepEqual(historyRef.reference.object, ref.reference.object); assert.equal(historyRef.reference.value, ref.reference.value);
  const recomputed = solve(p.selectAnalysisCase(project, 'AC2'));
  assert.equal(a.isAnalysisResultCurrent(recomputed, random), false);
  assert.equal(query(recomputed, random, 'read_results', { collection: 'summary' }).data.modalAnalysisId, modal.id);
  for (const result of project.analysisResults.filter((r) => r.modal || r.buckling || r.random)) assert.equal(compareAnalysisResults(result, result).compatible, false);
  await mkdir(evidence, { recursive: true });
  await writeFile(evidence + '/all-methods.framemind', encodeProject(project));
  await writeFile(evidence + '/deleted-history.framemind', encodeProject(deleted));
  await writeFile(evidence + '/verification.json', JSON.stringify({ passed: true, checks, actualProcessPages: true, frozenModalMatrices: true, localCitationEquality: true, staleSharedGeometry: true, deletedMemberHistory: true, obsoleteModalIdentity: true, prohibitedComparisons: true, numericalAlgorithmChanged: false, realAi: false }, null, 2));
  console.log('T2-36: five native methods, actual records, frozen citations, dependency history and comparison refusals passed.');
} finally { await server.close(); }
