import { createServer } from "vite";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const evidence = "docs/evidence/plan2/T2-35";
const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
try {
  const load = (path) => server.ssrLoadModule('/src/' + path + '.ts');
  const { modalCantilever } = await load('validation/modal-fixtures');
  const p = await load('domain/project'), a = await load('domain/analysis');
  const { createAnalysisRequest } = await load('domain/analysis-service');
  const { decodeAnalysisResult, encodeProject, decodeProject } = await load('domain/project-file');
  const { setModalDamping } = await load('domain/modal-damping');
  const { bandLimitedWhiteNoise, canonicalPsdConvention, psdDensityUnit } = await load('domain/psd');
  const { addPsdSpectrum } = await load('domain/psd-project');
  const { DEFAULT_RANDOM_ACCURACY } = await load('domain/random-response');
  const { captureAiSnapshot, executeAiTool } = await load('workspace/ai-tools');
  const { ModelEditConfirmation, prepareModelEditConfirmation } = await load('workspace/model-edits');
  const { ProjectHistory } = await load('domain/project-history');
  const checks = [], failures = [];
  const core = (request) => {
    const child = spawnSync(resolve('native/bin/framemind-core.exe'), [], { input: JSON.stringify(request), encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
    if (child.error) throw child.error;
    return JSON.parse(child.stdout.trim().split('\n').at(-1));
  };
  const solve = (project) => {
    const message = core(createAnalysisRequest(a.captureAnalysisInput(project)));
    assert.equal(message.kind, 'result', JSON.stringify(message.error));
    return p.attachAnalysisResult(project, decodeAnalysisResult(message.result));
  };
  const prepare = ({ divisions = 16, densityFactor = 1, line = 0, point = 0, converted = false, released = false, split = false, multiSupport = false, modeCount = 6, tolerance = .002 } = {}) => {
    let project = modalCantilever({ modeCount, maxDivisions: divisions, maxEquations: 600, frequencyTolerance: tolerance });
    if (densityFactor !== 1) project = p.updateMaterial(project, project.materials[0].id, { ...project.materials[0], densityKgM3: 7850 * densityFactor });
    if (line || released) project = p.updateMember(project, project.members[0].id, { additionalLineMassKgM: line, ...(released ? { endReleases: { start: { my: false, mz: false }, end: { my: false, mz: true } } } : {}) });
    if (point) project = p.setNodeMass(project, project.nodes[1].id, point);
    if (split) {
      project = p.addNode(project, { x: 1.5, y: 0, z: 0 });
      const member = project.members[0];
      project = p.updateMember(project, member.id, { endNodeId: project.nodes[2].id });
      project = p.addMember(project, { startNodeId: project.nodes[2].id, endNodeId: project.nodes[1].id, materialId: member.materialId, sectionId: member.sectionId, rotationDegrees: member.rotationDegrees, additionalLineMassKgM: member.additionalLineMassKgM });
    }
    if (multiSupport) {
      project = p.addNode(project, { x: 0, y: 1, z: 0 }); project = p.addNode(project, { x: 3, y: 1, z: 0 });
      const member = project.members[0];
      project = p.addMember(project, { startNodeId: project.nodes[2].id, endNodeId: project.nodes[3].id, materialId: member.materialId, sectionId: member.sectionId, rotationDegrees: member.rotationDegrees });
      project = p.addSupport(project, project.nodes[2].id, [true, true, true, true, true, true]);
    }
    project = solve(project);
    project = setModalDamping(project, 'AC1', project.latestAnalysis.id, { uniform: { ratio: .02, source: 'user', basis: 'Independent analytical reference' }, overrides: [], truncation: { upperFrequencyHz: 25, modeIncrement: 2, maxModeCount: 50 } });
    const convention = converted ? { quantity: 'acceleration', excitationUnit: 'mm/s²', frequencyUnit: 'rad/s', densityUnit: psdDensityUnit('mm/s²', 'rad/s'), sidedness: 'two-sided-even-positive' } : canonicalPsdConvention('acceleration');
    project = addPsdSpectrum(project, bandLimitedWhiteNoise('Base acceleration', convention, [0, converted ? 50 * Math.PI : 25], converted ? 1e6 / (4 * Math.PI) : 1));
    return addPsdSpectrum(project, bandLimitedWhiteNoise('Independent force', canonicalPsdConvention('force'), [0, 25], 1));
  };
  const baseAction = (scale = 1, direction = { x: 0, y: 1, z: 0 }) => ({ kind: 'base-translation', scale, direction });
  const source = (actions, sourceId = 'RS1', psdSpectrumId = 'PSD1') => ({ sourceId, psdSpectrumId, actions });
  const settings = (project, sources) => ({ ...DEFAULT_RANDOM_ACCURACY, modalAnalysisId: project.latestAnalysis.id, sourceRelationship: 'independent', sources, response: { nodeId: project.nodes[1].id, component: 'y' }, bandHz: [0, 25] });
  const properties = (project, sources) => ({ name: 'Whole-base random acceleration', method: 'random', loadSourceId: 'random', settings: { solver: 'native-random', random: settings(project, sources) } });
  const define = (project, sources) => p.selectAnalysisCase(p.addAnalysisCase(project, properties(project, sources)), 'AC2');
  // Continuous EB eigenfunctions and analytic spatial integrals, independent of FE.
  const roots = [1.875104068711961, 4.694091132974174, 7.854757438237612, 10.99554073487547, 14.13716839104647];
  const oracle = (lineMass, count = 5, stiffnessFactor = 1) => (f) => {
    let re = 0, im = 0;
    for (const b of roots.slice(0, count)) {
      const sigma = (Math.cosh(b) + Math.cos(b)) / (Math.sinh(b) + Math.sin(b));
      const tip = Math.cosh(b) - Math.cos(b) - sigma * (Math.sinh(b) - Math.sin(b));
      const integral = (Math.sinh(b) - Math.sin(b) - sigma * (Math.cosh(b) + Math.cos(b) - 2)) / b;
      const coefficient = -tip * integral, wn = b ** 2 * Math.sqrt(stiffnessFactor * (200e6 * (.2 * .1 ** 3 / 12)) / lineMass) / 9, w = 2 * Math.PI * f;
      const real = wn * wn - w * w, imaginary = 2 * .02 * wn * w, denominator = real * real + imaginary * imaginary;
      re += coefficient * real / denominator; im -= coefficient * imaginary / denominator;
    }
    return re * re + im * im;
  };
  const simpson = (at, intervals) => {
    const h = 25 / intervals; let sum = at(0) + at(25);
    for (let i = 1; i < intervals; i++) sum += (i % 2 ? 4 : 2) * at(i * h);
    return sum * h / 3;
  };
  const verify = (name, prepared, at, direction = { x: 0, y: 1, z: 0 }, component = 'y') => {
    const props = properties(prepared, [source([baseAction(1, direction)])]); props.settings.random.response.component = component;
    const completed = solve(p.selectAnalysisCase(p.addAnalysisCase(prepared, props), 'AC2')), r = completed.latestAnalysis.random;
    const coarse = simpson(at, 100000), fine = simpson(at, 200000), referenceRms = Math.sqrt(fine);
    const peak = Math.max(...r.points.map((point) => at(point.frequencyHz)));
    const curveError = Math.max(...r.points.map((point) => Math.abs(point.density - at(point.frequencyHz)))) / peak;
    const rmsError = Math.abs(r.rms / referenceRms - 1);
    assert.ok(Math.abs(coarse / fine - 1) < 1e-8, name + ' oracle integration convergence');
    assert.ok(curveError < .005, name + ' PSD ' + curveError); assert.ok(rmsError < .005, name + ' RMS ' + rmsError);
    assert.equal(r.referenceFrame, 'relative-to-base');
    checks.push({ name, referenceRms, rmsM: r.rms, curveError, rmsError, tolerance: .005, oracleIntervals: [100000, 200000], convergence: r.convergence });
    return completed;
  };
  await mkdir(evidence, { recursive: true });
  const prepared = prepare(); await writeFile(evidence + '/prepared.framemind', encodeProject(prepared));
  const single = verify('continuous-cantilever-base', prepared, oracle(.157));
  verify('global-z-direction', prepared, oracle(.157, 5, 4), { x: 0, y: 0, z: 1 }, 'z');
  const heavier = verify('double-structural-density', prepare({ densityFactor: 2 }), oracle(.314));
  assert.ok(heavier.latestAnalysis.random.rms > single.latestAnalysis.random.rms);
  verify('additional-line-mass', prepare({ line: 157 }), oracle(.314));
  verify('released-tip-rotation', prepare({ released: true }), oracle(.157));
  verify('two-engineering-members', prepare({ split: true }), oracle(.157));
  verify('two-supports-share-one-base-process', prepare({ multiSupport: true, modeCount: 12 }), oracle(.157));
  const coarse = verify('eight-divisions', prepare({ divisions: 8, tolerance: .01 }), oracle(.157));
  assert.ok(Math.abs(coarse.latestAnalysis.random.rms / single.latestAnalysis.random.rms - 1) < .005);
  // Mass-dominated cantilever tends to an SDOF oscillator with k=3EI/L³.
  // Finite beam mass is <0.05% of tip mass; 0.5% acceptance includes this error.
  const tipMass = 1e6, stiffness = 3 * 200e6 * (.2 * .1 ** 3 / 12) / 27, wn = Math.sqrt(stiffness / (tipMass / 1000));
  verify('mass-dominated-sdof', prepare({ point: tipMass }), (f) => 1 / ((wn * wn - (2 * Math.PI * f) ** 2) ** 2 + (2 * .02 * wn * 2 * Math.PI * f) ** 2));
  const converted = solve(define(prepare({ converted: true }), [source([baseAction()])]));
  assert.ok(Math.abs(converted.latestAnalysis.random.rms / single.latestAnalysis.random.rms - 1) < 1e-10);
  for (const [name, sources, ratio] of [
    ['same-source-aligned', [source([baseAction(), baseAction()])], 2],
    ['same-source-cancelled', [source([baseAction(), baseAction(-1)])], 0],
    ['independent-base-sources', [source([baseAction()]), source([baseAction(-1)], 'RS2')], Math.SQRT2],
  ]) {
    const completed = solve(define(prepared, sources)); assert.ok(Math.abs(completed.latestAnalysis.random.rms / single.latestAnalysis.random.rms - ratio) < 1e-10); checks.push({ name, passed: true });
  }
  const force = source([{ kind: 'node', nodeId: prepared.nodes[1].id, direction: { x: 0, y: 1, z: 0 }, scale: 1 }], 'RF', 'PSD2');
  const forced = solve(define(prepared, [force])), combined = solve(define(prepared, [source([baseAction()]), force]));
  assert.ok(Math.abs(combined.latestAnalysis.random.variance / (single.latestAnalysis.random.variance + forced.latestAnalysis.random.variance) - 1) < .005);
  await writeFile(evidence + '/random.framemind', encodeProject(combined));
  assert.deepEqual(decodeProject(encodeProject(combined)).latestAnalysis.random, combined.latestAnalysis.random);
  const call = (name, input) => ({ id: 't235', type: 'function', function: { name, arguments: JSON.stringify(input) } });
  const snapshot = captureAiSnapshot(combined, []);
  const summary = executeAiTool(snapshot, call('read_results', { collection: 'summary' })); assert.equal(summary.data.referenceFrame, 'relative-to-base');
  const psd = executeAiTool(snapshot, call('read_results', { collection: 'input-psd' })); assert.deepEqual(psd.data.items.map((v) => v.densityUnit), ['(m/s²)²/Hz', '(m/s²)²/Hz', 'kN²/Hz', 'kN²/Hz']);
  const ref = executeAiTool(snapshot, call('read_result', { kind: 'node', id: prepared.nodes[1].id, quantity: 'rms', component: 'y' })); assert.equal(ref.reference.referenceFrame, 'relative-to-base');
  const draft = executeAiTool(captureAiSnapshot(prepared, []), call('propose_model_edits', { operations: [{ type: 'create_analysis_case', properties: properties(prepared, [source([baseAction()])]) }] }));
  assert.equal(draft.status, 'awaiting-confirmation');
  const applied = new ModelEditConfirmation().confirm(prepared, prepareModelEditConfirmation(prepared, draft.modelEdits)); assert.equal(applied.result.status, 'applied');
  const history = new ProjectHistory(); history.record(prepared, applied.project); assert.equal(history.undo(applied.project).analysisCases.length, 1);
  const changed = p.updateAnalysisCase(combined, 'AC2', properties(prepared, [source([baseAction(2)]), force])); assert.equal(a.isAnalysisResultCurrent(changed, combined.latestAnalysis), false);
  checks.push({ name: 'units-independent-force-provenance-confirmation-undo-history', passed: true, realAi: false });
  for (const [name, alter] of [
    ['differential-target', (s) => { s.sources[0].actions[0].nodeId = prepared.nodes[0].id; }],
    ['base-rotation', (s) => { s.sources[0].actions[0].kind = 'base-rotation'; }],
    ['correlated-force-and-base', (s) => { s.sources[0].actions.push(force.actions[0]); }],
    ['partial-correlation', (s) => { s.sourceRelationship = 'partial'; }],
    ['wrong-force-spectrum', (s) => { s.sources[0].psdSpectrumId = 'PSD2'; }],
    ['uncovered-axial-direction', (s) => { s.sources[0].actions[0].direction = { x: 1, y: 0, z: 0 }; }],
  ]) {
    const invalid = settings(prepared, [source([baseAction()])]); alter(invalid);
    assert.throws(() => p.addAnalysisCase(prepared, { ...properties(prepared, []), settings: { solver: 'native-random', random: invalid } }), name);
    const request = structuredClone(createAnalysisRequest(a.captureAnalysisInput(define(prepared, [source([baseAction()])])))); request.input.analysisCase.settings.random = invalid;
    assert.equal(core(request).kind, 'error', name + ' native rejection'); failures.push({ name, rendererRejects: true, nativeRejects: true });
  }
  const request = structuredClone(createAnalysisRequest(a.captureAnalysisInput(define(prepared, [source([baseAction()])]))));
  request.input.supports[0].restraints[1] = false; assert.equal(core(request).kind, 'error');
  const unrestrained = structuredClone(prepared); unrestrained.supports[0].restraints[1] = false;
  assert.throws(() => define(unrestrained, [source([baseAction()])])); failures.push({ name: 'unsupported-support-restraint', rendererRejects: true, nativeRejects: true });
  const fixedProps = properties(prepared, [source([baseAction()])]); fixedProps.settings.random.response.nodeId = prepared.nodes[0].id;
  const fixed = solve(p.selectAnalysisCase(p.addAnalysisCase(prepared, fixedProps), 'AC2')); assert.equal(fixed.latestAnalysis.random.rms, 0);
  checks.push({ name: 'moving-support-relative-translation-is-zero', passed: true });
  for (const [name, mutate] of [['missing-relative-frame', (r) => { delete r.random.referenceFrame; }], ['forged-absolute-frame', (r) => { r.random.referenceFrame = 'absolute'; }], ['forged-acceleration-spectrum', (r) => { r.input.randomBasis.spectra[0].spectrum.points[0].density *= 2; }]]) {
    const forged = structuredClone(combined.latestAnalysis); mutate(forged); assert.throws(() => decodeAnalysisResult(forged));
    failures.push({ name, decoderRejects: true });
  }
  const budget = structuredClone(createAnalysisRequest(a.captureAnalysisInput(define(prepared, [source([baseAction()])]))));
  budget.input.analysisCase.settings.random.maxFrequencyPoints = 100;
  const exhausted = core(budget); assert.equal(exhausted.kind, 'error'); assert.equal(exhausted.error.diagnostics[0].code, 'random-frequency-budget'); assert.equal(exhausted.result, undefined);
  failures.push({ name: 'base-frequency-budget-no-partial-result', nativeRejects: true });
  const fewer = verify('increased-modal-extraction', prepare({ modeCount: 8, tolerance: .01 }), oracle(.157));
  assert.ok(Math.abs(fewer.latestAnalysis.random.rms / single.latestAnalysis.random.rms - 1) < .005);
  await writeFile(evidence + '/numerics.json', JSON.stringify({ passed: true, reference: 'continuous EB analytical eigenfunctions; mass-dominated SDOF', checks, failures }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, failures: failures.length, evidence }));
} finally { await server.close(); }
