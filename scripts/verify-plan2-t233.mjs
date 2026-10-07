import { numericalEvidenceDirectory } from "./numerical-evidence.mjs";
import { createServer } from "vite";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
try {
  const { modalCantilever } = await server.ssrLoadModule("/src/validation/modal-fixtures.ts");
  const p = await server.ssrLoadModule("/src/domain/project.ts");
  const a = await server.ssrLoadModule("/src/domain/analysis.ts");
  const d = await server.ssrLoadModule("/src/domain/modal-damping.ts");
  const psd = await server.ssrLoadModule("/src/domain/psd.ts");
  const { addPsdSpectrum, updatePsdSpectrum } = await server.ssrLoadModule("/src/domain/psd-project.ts");
  const { DEFAULT_RANDOM_ACCURACY } = await server.ssrLoadModule("/src/domain/random-response.ts");
  const { createAnalysisRequest } = await server.ssrLoadModule("/src/domain/analysis-service.ts");
  const { decodeAnalysisResult, encodeProject, decodeProject } = await server.ssrLoadModule("/src/domain/project-file.ts");
  const checks = [], failures = [];
  const core = (request) => {
    const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
    if (child.error) throw child.error;
    const message = JSON.parse(child.stdout.trim().split("\n").at(-1));
    if (message.kind === "result") assert.equal(child.status, 0); else assert.equal(child.status, 1);
    return message;
  };
  const solve = (project) => {
    const message = core(createAnalysisRequest(a.captureAnalysisInput(project)));
    assert.equal(message.kind, "result", JSON.stringify(message.error));
    return p.attachAnalysisResult(project, decodeAnalysisResult(message.result));
  };
  const prepare = (ratio = .02, band = [0, 25], overrides = [], modeCount = 6) => {
    let project = solve(modalCantilever({ modeCount, maxDivisions: 16, maxEquations: 600, frequencyTolerance: modeCount > 6 ? .01 : .002 }));
    assert.equal(project.latestAnalysis.modal.convergence.status, "converged");
    project = d.setModalDamping(project, "AC1", project.latestAnalysis.id, { uniform: { ratio, source: "user", basis: "Registered independent fixture" }, overrides,
      truncation: { upperFrequencyHz: band[1], modeIncrement: 2, maxModeCount: 50 } });
    project = addPsdSpectrum(project, psd.bandLimitedWhiteNoise("White force", psd.canonicalPsdConvention("force"), band, 1));
    const settings = { ...DEFAULT_RANDOM_ACCURACY, modalAnalysisId: project.latestAnalysis.id, psdSpectrumId: "PSD1", excitation: { nodeId: project.nodes[1].id, direction: { x: 0, y: 1, z: 0 }, scale: 1 }, response: { nodeId: project.nodes[1].id, component: "y" }, bandHz: band };
    return p.selectAnalysisCase(p.addAnalysisCase(project, { name: "Random node force", method: "random", loadSourceId: "random", settings: { solver: "native-random", random: settings } }), "AC2");
  };
  // Independent continuous Euler-Bernoulli tip receptance. No solver modes,
  // FE matrices, response helpers or application integrators enter this oracle.
  const roots = [1.875104068711961, 4.694091132974174, 7.854757438237612, 10.99554073487547, 14.13716839104647,
    ...Array.from({ length: 15 }, (_, i) => (i + 5.5) * Math.PI)];
  const ei = 200e6 * (.2 * .1 ** 3 / 12), lineMass = 7850 * .02 / 1000, length = 3;
  const frequencies = roots.map((beta) => beta ** 2 * Math.sqrt(ei / lineMass) / length ** 2 / (2 * Math.PI));
  const receptancePsd = (f, ratio, overrides = [], scale = 1, singleMode = false) => {
    let re = 0, im = 0;
    for (let i = 0; i < (singleMode ? 1 : roots.length); i++) {
      const omega = 2 * Math.PI * f, wn = 2 * Math.PI * frequencies[i];
      const damping = overrides.find((o) => o.modeNumber === i * 2 + 1)?.value.ratio ?? ratio;
      const a = wn * wn - omega * omega, b = 2 * damping * wn * omega;
      const coefficient = 4 * scale / (lineMass * length);
      re += coefficient * a / (a * a + b * b); im -= coefficient * b / (a * a + b * b);
    }
    return re * re + im * im;
  };
  const simpson = (functionAt, band, count) => {
    const step = (band[1] - band[0]) / count;
    let sum = functionAt(band[0]) + functionAt(band[1]);
    for (let i = 1; i < count; i++) sum += (i % 2 ? 4 : 2) * functionAt(band[0] + i * step);
    return sum * step / 3;
  };
  const independentCheck = (name, project, ratio, band, overrides = [], { curveTolerance = .005, singleMode = false, density = 1, scale = 1, densityAt } = {}) => {
    const result = project.latestAnalysis.random;
    const oracle = (f) => (densityAt ? densityAt(f) : density) * receptancePsd(f, ratio, overrides, scale, singleMode);
    const coarse = simpson(oracle, band, 200000), fine = simpson(oracle, band, 400000), referenceRms = Math.sqrt(fine);
    assert.ok(Math.abs(coarse - fine) / fine < 1e-5, "Independent Simpson quadrature must converge first");
    const referencePeak = Math.max(...result.points.map((v) => oracle(v.frequencyHz)));
    const curveError = Math.max(...result.points.map((v) => Math.abs(v.density - oracle(v.frequencyHz)))) / referencePeak;
    const rmsError = Math.abs(result.rms / referenceRms - 1);
    assert.ok(curveError < curveTolerance, `${name} PSD error ${curveError}`); assert.ok(rmsError < .005, `${name} RMS error ${rmsError}`);
    checks.push({ name, reference: singleMode ? "independent scalar oscillator: M=rho*A*L/4, K=M*omega1²" : "continuous EB cantilever, 20 analytic bending modes", firstFrequencyHz: frequencies[0], referenceRms, rmsM: result.rms,
      independentIntegration: { method: "composite Simpson", coarseIntervals: 200000, fineIntervals: 400000, coarseVarianceM2: coarse, fineVarianceM2: fine, relativeChange: Math.abs(coarse - fine) / fine }, referencePeakPsd: referencePeak, maxAbsolutePsdError: curveError * referencePeak, curveTolerance, curveError, rmsTolerance: .005, rmsError, convergence: result.convergence });
  };
  let project = solve(prepare());
  const r = project.latestAnalysis;
  independentCheck("continuous-cantilever", project, .02, [0, 25]);
  assert.equal(a.isAnalysisResultCurrent(project, r), true);
  assert.deepEqual(decodeProject(encodeProject(project)).latestAnalysis.random, r.random);
  await mkdir(numericalEvidenceDirectory("T2-33"), { recursive: true });
  await writeFile(`${numericalEvidenceDirectory("T2-33")}/random.framemind`, encodeProject(project));
  await writeFile(`${numericalEvidenceDirectory("T2-33")}/prepared.framemind`, encodeProject(p.deleteAnalysisCase(prepare(), "AC2")));
  const scalar = solve(prepare(.02, [8, 10]));
  independentCheck("dominant-simple-oscillator", scalar, .02, [8, 10], [], { singleMode: true });
  const highDamping = solve(prepare(.04));
  independentCheck("uniform-damping-effect", highDamping, .04, [0, 25]);
  assert.ok(highDamping.latestAnalysis.random.rms < r.random.rms * .72);
  const override = [{ modeNumber: 1, value: { ratio: .04, source: "suggestion", basis: "Independent registered override, not user input" } }];
  const overridden = solve(prepare(.02, [0, 25], override));
  independentCheck("mode-specific-damping", overridden, .02, [0, 25], override);
  assert.ok(Math.abs(overridden.latestAnalysis.random.rms / highDamping.latestAnalysis.random.rms - 1) < .001);
  const narrow = solve(prepare(.0001, [8, 10]));
  // Continuum/FE eigenfrequency error ~1e-6 is amplified by zeta=1e-4;
  // independently register 2% pointwise peak-normalized PSD, 0.5% RMS.
  independentCheck("narrow-resonance", narrow, .0001, [8, 10], [], { curveTolerance: .02 });
  const antiresonance = solve(prepare(.02, [20, 45], [], 10));
  independentCheck("coherent-modal-antiresonance", antiresonance, .02, [20, 45]);
  let triangular = prepare();
  triangular = updatePsdSpectrum(triangular, "PSD1", { ...psd.canonicalPsdConvention("force"), name: "Triangle force", band: [0, 25], points: [{ frequency: 0, density: 0 }, { frequency: 10, density: 2 }, { frequency: 25, density: 0 }] });
  triangular = solve(triangular);
  independentCheck("piecewise-linear-input-spectrum", triangular, .02, [0, 25], [], { densityAt: (f) => f <= 10 ? f / 5 : 2 * (25 - f) / 15 });
  const change = (base, changes) => p.updateAnalysisCase(base, "AC2", { ...base.analysisCases[1], settings: { solver: "native-random", random: { ...base.analysisCases[1].settings.random, ...changes } } });
  const negative = solve(change(prepare(), { excitation: { ...project.analysisCases[1].settings.random.excitation, scale: -2 } }));
  assert.ok(Math.abs(negative.latestAnalysis.random.rms / r.random.rms - 2) < 1e-10);
  checks.push({ name: "signed-spatial-coefficient", factor: -2, rmsRatio: negative.latestAnalysis.random.rms / r.random.rms });
  const zero = solve(change(prepare(), { excitation: { ...project.analysisCases[1].settings.random.excitation, scale: 0 } }));
  assert.equal(zero.latestAnalysis.random.rms, 0);
  const restrained = solve(change(prepare(), { response: { nodeId: project.nodes[0].id, component: "y" } }));
  assert.equal(restrained.latestAnalysis.random.rms, 0);
  checks.push({ name: "zero-coefficient-and-restrained-response", passed: true });
  const failure = (name, base, changes, expected) => {
    const message = core(createAnalysisRequest(a.captureAnalysisInput(change(base, changes))));
    assert.equal(message.kind, "error"); assert.equal(message.error.diagnostics[0].code, expected, JSON.stringify(message));
    assert.equal(base.latestAnalysis.modal !== undefined, true); assert.equal(message.error.diagnostics[0].randomConvergence.status, "failed");
    failures.push({ name, code: expected, publishedPartialResult: false, evidence: message.error.diagnostics[0].randomConvergence });
  };
  failure("frequency-budget", prepare(), { maxFrequencyPoints: 100 }, "random-frequency-budget");
  failure("integration-budget", prepare(), { maxRefinements: 1 }, "random-integration-budget");
  failure("modal-truncation", prepare(.02, [150, 170]), {}, "random-modal-truncation");
  for (const [name, changes] of [["cropped-band", { bandHz: [0, 20] }], ["uncovered-band", { bandHz: [0, 300] }], ["zero-direction", { excitation: { ...project.analysisCases[1].settings.random.excitation, direction: { x: 0, y: 0, z: 0 } } }],
    ["missing-force-participation", { excitation: { ...project.analysisCases[1].settings.random.excitation, direction: { x: 1, y: 0, z: 0 } } }]]) {
    assert.throws(() => a.captureAnalysisInput(change(prepare(), changes)));
    failures.push({ name, publicInputRejected: true });
  }
  const bad = structuredClone(r); bad.random.rms *= 1.01; assert.throws(() => decodeAnalysisResult(bad));
  const badCurve = structuredClone(r); badCurve.random.points[4].density *= 1.01; assert.throws(() => decodeAnalysisResult(badCurve));
  const badCheck = structuredClone(r); badCheck.random.convergence.modal.rmsError = 0; assert.throws(() => decodeAnalysisResult(badCheck));
  checks.push({ name: "persisted-numeric-tampering-rejected", passed: true });
  const unrelated = p.updateNodalLoad(project, project.nodalLoads[0].id, project.nodalLoads[0].nodeId, { x: 9, y: 8, z: 7 }, project.nodalLoads[0].moment);
  assert.equal(a.isAnalysisResultCurrent(unrelated, r), true);
  const mass = p.setNodeMass(project, project.nodes[1].id, 1); assert.equal(a.isAnalysisResultCurrent(mass, r), false);
  checks.push({ name: "precise-load-and-mass-dependencies", unrelatedStaticLoadCurrent: true, massChangeCurrent: false });
  await writeFile(`${numericalEvidenceDirectory("T2-33")}/numerics.json`, JSON.stringify({ task: "T2-33", passed: true, checks, failures }, null, 2));
  console.log(`T2-33: ${checks.length} numeric scenarios, ${failures.length} failure scenarios passed`);
} finally { await server.close(); }
