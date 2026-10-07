import { numericalEvidenceDirectory } from "./numerical-evidence.mjs";
import { createServer } from "vite";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const evidence = numericalEvidenceDirectory("T2-34");
const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
try {
  const { modalCantilever } = await server.ssrLoadModule("/src/validation/modal-fixtures.ts");
  const p = await server.ssrLoadModule("/src/domain/project.ts");
  const a = await server.ssrLoadModule("/src/domain/analysis.ts");
  const { createAnalysisRequest } = await server.ssrLoadModule("/src/domain/analysis-service.ts");
  const { encodeProject, decodeProject, decodeAnalysisResult } = await server.ssrLoadModule("/src/domain/project-file.ts");
  const { setModalDamping } = await server.ssrLoadModule("/src/domain/modal-damping.ts");
  const { bandLimitedWhiteNoise, canonicalPsdConvention } = await server.ssrLoadModule("/src/domain/psd.ts");
  const { addPsdSpectrum, updatePsdSpectrum } = await server.ssrLoadModule("/src/domain/psd-project.ts");
  const { DEFAULT_RANDOM_ACCURACY } = await server.ssrLoadModule("/src/domain/random-response.ts");
  const { captureAiSnapshot, executeAiTool } = await server.ssrLoadModule("/src/workspace/ai-tools.ts");
  const { prepareModelEditConfirmation, ModelEditConfirmation } = await server.ssrLoadModule("/src/workspace/model-edits.ts");
  const { ProjectHistory } = await server.ssrLoadModule("/src/domain/project-history.ts");
  const checks = [], failures = [];
  const call = (name, input) => ({ id: "t234", type: "function", function: { name, arguments: JSON.stringify(input) } });
  const core = (request) => {
    const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
    if (child.error) throw child.error;
    return JSON.parse(child.stdout.trim().split("\n").at(-1));
  };
  const solve = (project) => {
    const message = core(createAnalysisRequest(a.captureAnalysisInput(project)));
    assert.equal(message.kind, "result", JSON.stringify(message.error));
    return p.attachAnalysisResult(project, decodeAnalysisResult(message.result));
  };
  const prepare = (maxDivisions = 16, split = false, frequencyTolerance = .002, releasedTip = false) => {
    let project = modalCantilever({ modeCount: 6, maxDivisions, maxEquations: 600, frequencyTolerance });
    if (releasedTip) project = p.updateMember(project, project.members[0].id, { endReleases: { start: { my: false, mz: false }, end: { my: false, mz: true } } });
    if (split) {
      project = p.addNode(project, { x: 1.5, y: 0, z: 0 });
      const original = project.members[0];
      project = p.updateMember(project, original.id, { endNodeId: project.nodes[2].id });
      project = p.addMember(project, { startNodeId: project.nodes[2].id, endNodeId: project.nodes[1].id, materialId: original.materialId, sectionId: original.sectionId, rotationDegrees: original.rotationDegrees });
    }
    project = solve(project);
    project = setModalDamping(project, "AC1", project.latestAnalysis.id, { uniform: { ratio: .02, source: "user", basis: "Independent continuum reference" }, overrides: [], truncation: { upperFrequencyHz: 25, modeIncrement: 2, maxModeCount: 50 } });
    project = addPsdSpectrum(project, bandLimitedWhiteNoise("White force", canonicalPsdConvention("force"), [0, 25], 1));
    project = addPsdSpectrum(project, bandLimitedWhiteNoise("Second force", canonicalPsdConvention("force"), [0, 25], 4));
    return project;
  };
  const settings = (project, sources) => ({ ...DEFAULT_RANDOM_ACCURACY, modalAnalysisId: project.latestAnalysis.id, sourceRelationship: "independent", sources,
    response: { nodeId: project.nodes[1].id, component: "y" }, bandHz: [0, 25] });
  const define = (project, sources) => p.selectAnalysisCase(p.addAnalysisCase(project, { name: "Distributed random force", method: "random", loadSourceId: "random", settings: { solver: "native-random", random: settings(project, sources) } }), "AC2");
  const node = (project, scale = 1, index = 1) => ({ kind: "node", nodeId: project.nodes[index].id, direction: { x: 0, y: 1, z: 0 }, scale });
  const uniform = (project, scalePerM = 1, index = 0) => ({ kind: "member-uniform", memberId: project.members[index].id, direction: { x: 0, y: 1, z: 0 }, scalePerM });
  const source = (actions, sourceId = "RS1", psdSpectrumId = "PSD1") => ({ sourceId, psdSpectrumId, actions });

  // Independent continuous EB eigenfunctions, not FE modes, display samples or
  // product transfer functions. Analytical integrals of distributed forcing.
  const roots = [1.875104068711961, 4.694091132974174, 7.854757438237612, 10.99554073487547, 14.13716839104647];
  const length = 3, lineMass = 7850 * .02 / 1000, ei = 200e6 * (.2 * .1 ** 3 / 12);
  const shape = (b, x) => {
    const sigma = (Math.cosh(b) + Math.cos(b)) / (Math.sinh(b) + Math.sin(b)), bx = b * x / length;
    return Math.cosh(bx) - Math.cos(bx) - sigma * (Math.sinh(bx) - Math.sin(bx));
  };
  const primitive = (b, x) => {
    const sigma = (Math.cosh(b) + Math.cos(b)) / (Math.sinh(b) + Math.sin(b)), bx = b * x / length;
    return length / b * (Math.sinh(bx) - Math.sin(bx) - sigma * (Math.cosh(bx) + Math.cos(bx) - 2));
  };
  const oracle = (project, sources) => {
    const modalCoefficients = sources.map((item) => roots.map((b) => {
      const force = item.actions.reduce((sum, action) => {
        if (action.kind === "node") return sum + action.scale * shape(b, project.nodes.find((n) => n.id === action.nodeId).position.x);
        const member = project.members.find((m) => m.id === action.memberId);
        const start = project.nodes.find((n) => n.id === member.startNodeId).position.x, end = project.nodes.find((n) => n.id === member.endNodeId).position.x;
        return sum + action.scalePerM * (primitive(b, end) - primitive(b, start));
      }, 0);
      return shape(b, length) * force / (lineMass * length);
    }));
    return (f) => sources.reduce((sum, item, sourceIndex) => {
      let re = 0, im = 0;
      for (let i = 0; i < roots.length; i++) {
        const wn = roots[i] ** 2 * Math.sqrt(ei / lineMass) / length ** 2, w = 2 * Math.PI * f;
        const real = wn * wn - w * w, imaginary = 2 * .02 * wn * w, denominator = real * real + imaginary * imaginary;
        re += modalCoefficients[sourceIndex][i] * real / denominator;
        im -= modalCoefficients[sourceIndex][i] * imaginary / denominator;
      }
      return sum + (re * re + im * im) * (item.psdSpectrumId === "PSD2" ? 4 : 1);
    }, 0);
  };
  const simpson = (at, intervals) => {
    const step = 25 / intervals; let sum = at(0) + at(25);
    for (let i = 1; i < intervals; i++) sum += (i % 2 ? 4 : 2) * at(i * step);
    return sum * step / 3;
  };
  const verify = (name, base, sources) => {
    const completed = solve(define(base, sources)), r = completed.latestAnalysis.random, at = oracle(base, sources);
    const coarse = simpson(at, 100000), fine = simpson(at, 200000);
    const referenceRms = Math.sqrt(fine), referencePeak = Math.max(...r.points.map((point) => at(point.frequencyHz)));
    const curveError = Math.max(...r.points.map((point) => Math.abs(point.density - at(point.frequencyHz)))) / Math.max(1e-30, referencePeak);
    const rmsError = Math.abs(r.rms - referenceRms) / Math.max(1e-30, referenceRms);
    assert.ok(Math.abs(coarse - fine) <= 1e-8 * Math.max(1e-30, fine), name + " independent integral convergence");
    assert.ok(curveError < .005, name + " PSD error " + curveError);
    assert.ok(rmsError < .005, name + " RMS error " + rmsError);
    checks.push({ name, reference: "continuous EB cantilever, five analytical bending modes and exact spatial integrals", independentIntegration: { method: "composite Simpson", coarseIntervals: 100000, fineIntervals: 200000, coarseVarianceM2: coarse, fineVarianceM2: fine, relativeChange: Math.abs(coarse - fine) / Math.max(1e-30, fine) }, referencePeakPsd: referencePeak, maxAbsolutePsdError: curveError * referencePeak, referenceRms, rmsM: r.rms, curveError, rmsError, tolerance: .005, selectedDivisions: r && completed.latestAnalysis.input.randomBasis.modal.modal.selectedDivisions, convergence: r.convergence });
    return completed;
  };

  const base = prepare();
  await mkdir(evidence, { recursive: true });
  await writeFile(evidence + "/prepared.framemind", encodeProject(base));
  const single = verify("single-node-source", base, [source([node(base)])]);
  const aligned = verify("same-source-aligned-node-pair", base, [source([node(base), node(base)])]);
  assert.ok(Math.abs(aligned.latestAnalysis.random.rms / single.latestAnalysis.random.rms - 2) < 1e-10);
  const cancelled = verify("same-source-opposite-node-pair", base, [source([node(base), node(base, -1)])]);
  assert.equal(cancelled.latestAnalysis.random.rms, 0);
  const independent = verify("independent-identical-spectrum-node-sources", base, [source([node(base)]), source([node(base, -1)], "RS2")]);
  assert.ok(Math.abs(independent.latestAnalysis.random.rms / single.latestAnalysis.random.rms - Math.SQRT2) < 1e-10);
  const line = verify("whole-member-uniform-force", base, [source([uniform(base)])]);
  verify("same-source-node-plus-uniform", base, [source([node(base), uniform(base)])]);
  const multi = verify("independent-node-and-member-distinct-spectra", base, [source([uniform(base)]), source([node(base)], "RS2", "PSD2")]);
  await writeFile(evidence + "/random.framemind", encodeProject(multi));
  assert.deepEqual(decodeProject(encodeProject(multi)).latestAnalysis.random, multi.latestAnalysis.random);
  const changedSource = p.updateAnalysisCase(multi, "AC2", { ...multi.analysisCases[1], settings: { solver: "native-random", random: { ...multi.analysisCases[1].settings.random, sources: [source([uniform(base, .5)]), source([node(base)], "RS2", "PSD2")] } } });
  assert.equal(a.isAnalysisResultCurrent(changedSource, multi.latestAnalysis), false);
  const changedPsd = updatePsdSpectrum(multi, "PSD2", bandLimitedWhiteNoise("Second force", canonicalPsdConvention("force"), [0, 25], 5));
  assert.equal(a.isAnalysisResultCurrent(changedPsd, multi.latestAnalysis), false);
  const summary = executeAiTool(captureAiSnapshot(multi, []), call("read_results", { collection: "summary" }));
  assert.equal(summary.data.inputSources.length, 2);
  const inputs = executeAiTool(captureAiSnapshot(multi, []), call("read_results", { collection: "input-psd", limit: 100 }));
  assert.deepEqual(inputs.data.items.map((item) => item.sourceId), ["RS1", "RS1", "RS2", "RS2"]);
  const properties = { name: "Converted member random force", method: "random", loadSourceId: "random", settings: { solver: "native-random", random: settings(base, [source([{ ...uniform(base), scalePerM: .001 }])]) } };
  const draft = executeAiTool(captureAiSnapshot(base, []), call("propose_model_edits", { inputUnits: { inverseLength: "1/mm" }, operations: [{ type: "create_analysis_case", properties }] }));
  assert.equal(draft.status, "awaiting-confirmation");
  const history = new ProjectHistory(), confirmed = new ModelEditConfirmation().confirm(base, prepareModelEditConfirmation(base, draft.modelEdits));
  assert.equal(confirmed.result.status, "applied"); history.record(base, confirmed.project);
  assert.equal(confirmed.project.analysisCases[1].settings.random.sources[0].actions[0].scalePerM, 1);
  assert.equal(history.undo(confirmed.project).analysisCases.length, 1);
  const equivalent = solve(p.selectAnalysisCase(confirmed.project, "AC2"));
  assert.ok(Math.abs(equivalent.latestAnalysis.random.rms / line.latestAnalysis.random.rms - 1) < 1e-10);
  checks.push({ name: "agent-confirmed-unit-equivalence-undo-and-frozen-reopening", passed: true, realAi: false });

  const split = prepare(16, true);
  verify("same-source-distinct-node-aligned", split, [source([node(split), node(split, 1, 2)])]);
  verify("same-source-distinct-node-opposed", split, [source([node(split), node(split, -1, 2)])]);
  const splitLine = verify("two-engineering-members-one-uniform-process", split, [source([uniform(split), uniform(split, 1, 1)])]);
  assert.ok(Math.abs(splitLine.latestAnalysis.random.rms / line.latestAnalysis.random.rms - 1) < .005);
  const coarseBase = prepare(8, false, .01), coarseLine = verify("uniform-force-eight-division-budget", coarseBase, [source([uniform(coarseBase)])]);
  assert.ok(Math.abs(coarseLine.latestAnalysis.random.rms / line.latestAnalysis.random.rms - 1) < .005);
  const released = prepare(16, false, .002, true);
  const releasedLine = verify("uniform-force-with-independent-released-tip-rotation", released, [source([uniform(released)])]);
  assert.ok(Math.abs(releasedLine.latestAnalysis.random.rms / line.latestAnalysis.random.rms - 1) < .005);

  for (const [name, alter] of [
    ["partial-correlation", (s) => { s.sourceRelationship = "partial"; }],
    ["cross-spectrum", (s) => { s.crossSpectrum = []; }],
    ["undeclared-phase", (s) => { s.sources[0].actions[0].phase = 1; }],
    ["duplicate-source", (s) => { s.sources.push(structuredClone(s.sources[0])); }],
    ["partial-member", (s) => { s.sources[0].actions[0].range = [0, .5]; }],
    ["local-direction", (s) => { s.sources[0].actions[0].coordinateSystem = "local"; }],
    ["missing-member", (s) => { s.sources[0].actions[0].memberId = "missing"; }],
  ]) {
    const invalid = settings(base, [source([uniform(base)])]); alter(invalid);
    assert.throws(() => p.addAnalysisCase(base, { name, method: "random", loadSourceId: "random", settings: { solver: "native-random", random: invalid } }));
    const request = structuredClone(createAnalysisRequest(a.captureAnalysisInput(define(base, [source([uniform(base)])]))));
    request.input.analysisCase.settings.random = invalid;
    assert.equal(core(request).kind, "error", name + " native rejection");
    failures.push({ name, rendererRejects: true, nativeRejects: true });
  }
  const mismatch = updatePsdSpectrum(base, "PSD2", bandLimitedWhiteNoise("Mismatch", canonicalPsdConvention("force"), [0, 20], 1));
  assert.throws(() => define(mismatch, [source([node(base)]), source([uniform(base)], "RS2", "PSD2")]));
  failures.push({ name: "different-source-bands", rendererRejects: true });
  const forged = structuredClone(multi.latestAnalysis); forged.input.randomBasis.spectra[1].spectrum.points[0].density *= 2;
  assert.throws(() => decodeAnalysisResult(forged)); failures.push({ name: "forged-frozen-second-source", decoderRejects: true });
  const invalidVectors = structuredClone(createAnalysisRequest(a.captureAnalysisInput(define(base, [source([uniform(base)])]))));
  invalidVectors.input.randomBasis.modal.modal.eigenproblem.vectors[0][5] *= 1.01;
  assert.equal(core(invalidVectors).kind, "error"); failures.push({ name: "forged-internal-modal-coordinate", nativeRejects: true });
  await writeFile(evidence + "/numerics.json", JSON.stringify({ passed: true, checks, failures }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, failures: failures.length, evidence }));
} finally { await server.close(); }

