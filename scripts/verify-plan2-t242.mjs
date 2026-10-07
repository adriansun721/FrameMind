import { createServer } from "vite";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { evidenceRoot, protocol, hash, environment, buildHashes, recordMetric } from "./plan2-performance-evidence.mjs";
import { measureDesktop } from "./plan2-performance-desktop.mjs";
import { gzipSync } from "node:zlib";

// Separate registration from measurement so failed thresholds remain reviewable.
const register = process.argv.includes("--register");
const smoke = process.argv.includes("--smoke");
const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
const report = { generatedAt: new Date().toISOString(), registration: null, native: [], desktop: [], passed: false };
let runDirectory;
try {
  const modelModule = await server.ssrLoadModule("/src/validation/plan2-performance-models.ts");
  const p = await server.ssrLoadModule("/src/domain/project.ts");
  const a = await server.ssrLoadModule("/src/domain/analysis.ts");
  const { createAnalysisRequest } = await server.ssrLoadModule("/src/domain/analysis-service.ts");
  const { prepareAnalysisTaskInput } = await server.ssrLoadModule("/src/workspace/analysis-task.ts");
  const requestFor = (project) => createAnalysisRequest(prepareAnalysisTaskInput(a.captureAnalysisInput(project)));
  const { encodeProject, decodeProject, decodeAnalysisResult } = await server.ssrLoadModule("/src/domain/project-file.ts");
  const { checkAnalysisInput } = await server.ssrLoadModule("/src/domain/analysis-diagnostics.ts");
  const { DEFAULT_RANDOM_ACCURACY } = await server.ssrLoadModule("/src/domain/random-response.ts");
  const { bandLimitedWhiteNoise, canonicalPsdConvention } = await server.ssrLoadModule("/src/domain/psd.ts");
  const { addPsdSpectrum } = await server.ssrLoadModule("/src/domain/psd-project.ts");
  const { setModalDamping } = await server.ssrLoadModule("/src/domain/modal-damping.ts");
  const models = modelModule.PLAN2_PERFORMANCE_MODELS.map((spec) => {
    const started = performance.now(), project = modelModule.createPlan2PerformanceModel(spec);
    const content = encodeProject(project);
    assert.deepEqual(decodeProject(content).members, project.members);
    assert.equal(checkAnalysisInput(project).length, 0);
    return { spec, project, content, sha256: hash(content), modelMs: performance.now() - started };
  });
  const currentEnvironment = environment(), hashes = await buildHashes();
  await mkdir(evidenceRoot, { recursive: true });
  const registrationName = `registration-v${protocol.version}.json`;
  const registrationPath = join(evidenceRoot, registrationName);
  if (smoke) {
    runDirectory = join(evidenceRoot, "pilot", new Date().toISOString().replaceAll(":", "-"));
    await mkdir(runDirectory, { recursive: true });
    const entry = await measureDesktop({ model: models[0], repeat: 1, mode: "solid", runDirectory, modeling: { metrics: {}, failures: [] } });
    await writeFile(join(runDirectory, "pilot.json"), JSON.stringify({ formalAcceptance: false, entry }, null, 2));
    console.log(JSON.stringify({ pilot: runDirectory, failures: entry.failures }, null, 2));
  } else if (register) {
    // An existing registration is immutable; use a separately reviewed protocol version for changes.
    let exists = false;
    try { await readFile(registrationPath); exists = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
    assert.equal(exists, false, "Registration already exists; do not overwrite preregistered thresholds");
    const registration = {
      registeredAt: new Date().toISOString(), timezone: "Asia/Taipei", protocol,
      commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      environment: currentEnvironment, hashes,
      models: models.map(({ spec, sha256, project }) => ({ ...spec, sha256, supports: project.supports.length,
        totalDofs: project.nodes.length * 6, constrainedDofs: project.supports.length * 6,
        initialEquations: (project.nodes.length - project.supports.length) * 6,
        cases: project.analysisCases,
      })),
    };
    for (const model of models) await writeFile(join(evidenceRoot, `${model.spec.id}-input.framemind`), model.content);
    await writeFile(registrationPath, JSON.stringify(registration, null, 2) + "\n", { flag: "wx" });
    console.log(`Registered T2-42 protocol v${protocol.version} before formal runs: ${registration.registeredAt}`);
  } else {
    const registration = JSON.parse(await readFile(registrationPath, "utf8"));
    assert.deepEqual(registration.protocol, protocol, "Protocol changed after registration");
    assert.deepEqual(registration.environment, currentEnvironment, "Registered machine/software/budget changed");
    assert.deepEqual(registration.hashes, hashes, "Source or build changed after registration; keep this failed run and preregister a new version");
    for (const model of models) assert.equal(model.sha256, registration.models.find((s) => s.id === model.spec.id).sha256);
    report.registration = { path: registrationName, sha256: hash(await readFile(registrationPath)) };
    runDirectory = join(evidenceRoot, "runs", new Date().toISOString().replaceAll(":", "-"));
    await mkdir(runDirectory, { recursive: true });
    const save = () => writeFile(join(runDirectory, "results.json"), JSON.stringify(report, null, 2) + "\n");
    const native = (request, memoryMiB) => new Promise((done) => {
      const started = performance.now();
      const env = { ...process.env }; if (memoryMiB) env.FRAMEMIND_NATIVE_MEMORY_MIB = String(memoryMiB);
      const child = spawn(resolve("native/bin/framemind-core.exe"), [], { env, windowsHide: true, stdio: "pipe" });
      let bytes = 0, error, stderr = ""; const chunks = [];
      const timer = setTimeout(() => { error = "Native benchmark timeout"; child.kill(); }, protocol.nativeTimeoutMs);
      child.stdout.on("data", (chunk) => { bytes += chunk.length; if (bytes > 64 * 1024 ** 2) { error = "64 MiB output transport budget exceeded"; child.kill(); } else chunks.push(chunk); });
      child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-8192); });
      child.on("error", (e) => { error = String(e); });
      child.stdin.on("error", (e) => { error = String(e); });
      child.on("close", (exitCode, signal) => {
        clearTimeout(timer);
        let messages = [], resources = null;
        try { messages = Buffer.concat(chunks).toString().trim().split("\n").filter(Boolean).map(JSON.parse); } catch (e) { error = String(e); }
        for (const line of stderr.trim().split("\n")) { try { const item = JSON.parse(line); if (item.kind === "native-resources") resources = item; } catch {} }
        done({ ms: performance.now() - started, exitCode, signal, messages, resources, outputBytes: bytes, transportError: error ?? null });
      });
      child.stdin.end(JSON.stringify(request));
    });
    const describeInput = (request) => ({
      engineeringNodes: request.input.nodes.length, engineeringMembers: request.input.members.length,
      totalDofs: request.input.nodes.length * 6,
      constrainedDofs: request.input.supports.reduce((sum, s) => sum + s.restraints.filter(Boolean).length, 0),
      solver: request.input.solver, settings: request.input.analysisCase.settings,
      meshCandidates: request.input.meshPlan?.levels.map((level) => ({ divisions: level.divisions,
        calculationNodes: request.input.nodes.length + level.nodes.length, calculationElements: level.elements.length,
        totalDofs: (request.input.nodes.length + level.nodes.length) * 6,
        equations: (request.input.nodes.length + level.nodes.length) * 6 - request.input.supports.reduce((sum, s) => sum + s.restraints.filter(Boolean).length, 0),
      })) ?? [{ divisions: 1, calculationNodes: request.input.nodes.length, calculationElements: request.input.members.length,
        totalDofs: request.input.nodes.length * 6, equations: (request.input.nodes.length - request.input.supports.length) * 6 }],
    });
    const nativeCompleted = (run) => run.exitCode === 0 && !run.transportError
      && run.messages.at(-1)?.kind === "result" && run.resources?.peakCommittedBytes > 0
      && run.resources.peakCommittedBytes <= protocol.maxNativeCommittedBytes;
    const archive = (name, value) => writeFile(join(runDirectory, `${name}.json.gz`), gzipSync(JSON.stringify(value)));
    for (const model of models) {
      let analyzed;
      for (let repeat = 1; repeat <= protocol.repetitions; repeat++) {
        // Measure fresh public-domain construction, not replay of a prepared JSON file.
        const started = performance.now(), fresh = modelModule.createPlan2PerformanceModel(model.spec);
        const modeling = { metrics: {}, failures: [] };
        recordMetric(modeling.metrics, modeling.failures, "model", performance.now() - started, protocol.limitsMs.model);
        assert.equal(hash(encodeProject(fresh)), model.sha256);
        for (const definition of model.project.analysisCases) {
          const project = p.selectAnalysisCase(model.project, definition.id);
          const preparationStarted = performance.now();
          const request = requestFor(project);
          const entry = { model: model.spec.id, repeat, method: definition.method, inputSha256: hash(JSON.stringify(request)),
            inputBytes: Buffer.byteLength(JSON.stringify(request)), input: describeInput(request), preparationMs: performance.now() - preparationStarted,
            metrics: {}, failures: [], status: "pending" };
          report.native.push(entry);
          await archive(`${model.spec.id}-${definition.method}-${repeat}-request`, request);
          const result = await native(request);
          const terminal = result.messages.at(-1);
          entry.stages = result.messages.filter((m) => m.kind === "phase").map((m) => m.record);
          entry.resources = result.resources; entry.exitCode = result.exitCode; entry.outputBytes = result.outputBytes;
          entry.transportError = result.transportError;
          recordMetric(entry.metrics, entry.failures, definition.method, result.ms + entry.preparationMs, protocol.limitsMs[definition.method]);
          if (result.resources?.peakCommittedBytes > protocol.maxNativeCommittedBytes) entry.failures.push("Native memory exceeds registered 512 MiB");
          if (!result.resources?.peakCommittedBytes) entry.failures.push("Missing native peak commitment measurement");
          if (nativeCompleted(result)) {
            const decoded = decodeAnalysisResult(terminal.result);
            entry.status = "complete";
            entry.meshConvergence = decoded.discretization ? { status: decoded.discretization.status, reason: decoded.discretization.reason, selectedDivisions: decoded.discretization.selectedDivisions } : null;
            if (decoded.discretization && decoded.discretization.status !== "converged") entry.failures.push("Static initial-mesh result is retained, but mesh convergence is not established within the equation budget");
            entry.executedCounts = decoded.modal?.counts ?? decoded.buckling?.counts ?? decoded.discretization?.counts ?? { calculationNodes: decoded.nodes.length, calculationElements: decoded.members.length, equations: decoded.process?.freeDofs?.length ?? entry.input.meshCandidates[0].equations };
            if (definition.method === "static" && repeat === 1) {
              analyzed = p.attachAnalysisResult(model.project, decoded);
              await writeFile(join(runDirectory, `${model.spec.id}-static.framemind.gz`), gzipSync(encodeProject(analyzed)));
            }
          } else {
            entry.status = "failed"; entry.diagnostics = terminal?.error ?? null;
            entry.executedCounts = null;
            entry.failures.push(`Required ${definition.method} target-scale solve did not complete`);
            await writeFile(join(runDirectory, `${model.spec.id}-${definition.method}-${repeat}-failure.json`), JSON.stringify(result, null, 2));
          }
          console.log(`${model.spec.id}/${repeat}/${definition.method}: ${entry.status}, ${result.ms.toFixed(0)} ms`);
          await save();
        }
        // Random response must use a real modal result of this exact model.
        const randomStarted = performance.now();
        let randomError, randomRequest, randomRun, randomResult, modalDependency;
        try {
          let randomProject = p.selectAnalysisCase(model.project, "AC4");
          const basis = await native(requestFor(randomProject));
          modalDependency = { ms: basis.ms, resources: basis.resources, exitCode: basis.exitCode, transportError: basis.transportError,
            diagnostics: basis.messages.at(-1)?.error ?? null, stages: basis.messages.filter((m) => m.kind === "phase").map((m) => m.record) };
          const terminal = basis.messages.at(-1);
          if (!nativeCompleted(basis)) throw new Error(`Target modal dependency failed: ${terminal?.error?.diagnostics?.[0]?.message ?? basis.transportError ?? "Missing successful exit/resource measurement"}`);
          randomProject = p.attachAnalysisResult(randomProject, decodeAnalysisResult(terminal.result));
          randomProject = setModalDamping(randomProject, "AC4", randomProject.latestAnalysis.id, { uniform: { ratio: protocol.random.dampingRatio, source: "user", basis: "T2-42 preregistered ratio" }, overrides: [], truncation: { upperFrequencyHz: 25, modeIncrement: 2, maxModeCount: 50 } });
          randomProject = addPsdSpectrum(randomProject, bandLimitedWhiteNoise("Target force PSD", canonicalPsdConvention("force"), protocol.random.bandHz, 1));
          randomProject = p.selectAnalysisCase(p.addAnalysisCase(randomProject, { name: "Target random", method: "random", loadSourceId: "random", settings: { solver: "native-random", random: { ...DEFAULT_RANDOM_ACCURACY, modalAnalysisId: randomProject.latestAnalysis.id, psdSpectrumId: "PSD1", excitation: { nodeId: randomProject.nodes.at(-1).id, direction: { x: 1, y: 0, z: 0 }, scale: 1 }, response: { nodeId: randomProject.nodes.at(-1).id, component: "x" }, bandHz: protocol.random.bandHz } } }), "AC5");
          const request = requestFor(randomProject);
          randomRequest = request;
          await archive(`${model.spec.id}-random-${repeat}-request`, request);
          const result = await native(request);
          randomRun = result;
          if (!nativeCompleted(result)) throw new Error(JSON.stringify(result));
          // This branch requires full result decoding, not merely a success flag.
          randomResult = decodeAnalysisResult(result.messages.at(-1).result);
        } catch (error) { randomError = String(error); }
        const randomEntry = { model: model.spec.id, repeat, method: "random", requested: protocol.random,
          engineeringNodes: model.project.nodes.length, engineeringMembers: model.project.members.length,
          totalDofs: model.project.nodes.length * 6, constrainedDofs: model.project.supports.length * 6,
          initialEquations: (model.project.nodes.length - model.project.supports.length) * 6,
          modalDependency, input: randomRequest ? describeInput(randomRequest) : null,
          inputSha256: randomRequest ? hash(JSON.stringify(randomRequest)) : null,
          resources: randomRun?.resources ?? null, exitCode: randomRun?.exitCode ?? null,
          transportError: randomRun?.transportError ?? null,
          status: randomError ? randomRequest ? "failed" : "blocked-by-modal-dependency" : "complete",
          executedCounts: randomResult ? { ...randomResult.input.randomBasis.modal.modal.counts,
            modes: randomResult.random.modeCount, frequencyPoints: randomResult.random.points.length } : null,
          metrics: {}, failures: randomError ? [randomError, "No target-scale random solve/PSD/RMS/display/export evidence"] : [] };
        recordMetric(randomEntry.metrics, randomEntry.failures, "random", performance.now() - randomStarted, protocol.limitsMs.random);
        report.native.push(randomEntry);
        // A real low-memory request must fail without a partial result.
        const faultRequest = requestFor(model.project);
        const fault = await native(faultRequest, 16);
        report.native.push({ model: model.spec.id, repeat, method: "resourceFailure", ms: fault.ms,
          passed: fault.exitCode === 1 && fault.messages.at(-1)?.error?.diagnostics?.[0]?.code === "native-resource-limit" && fault.messages.every((m) => m.kind !== "result") && fault.ms <= protocol.limitsMs.resourceFailure,
          resources: fault.resources, diagnostics: fault.messages.at(-1)?.error, transportError: fault.transportError });
        await writeFile(join(runDirectory, `${model.spec.id}-resource-${repeat}.json`), JSON.stringify(fault, null, 2));
        for (const mode of protocol.displayModes) {
          const entry = await measureDesktop({ model, repeat, mode, runDirectory, modeling });
          report.desktop.push(entry); await save();
        }
      }
    }
    report.finalHashesMatch = JSON.stringify(await buildHashes()) === JSON.stringify(hashes);
    report.passed = report.finalHashesMatch && report.native.length === models.length * protocol.repetitions * 6
      && report.native.every((entry) => entry.method === "resourceFailure" ? entry.passed : entry.status === "complete" && entry.failures.length === 0)
      && report.desktop.length === models.length * protocol.repetitions * protocol.displayModes.length
      && report.desktop.every((entry) => entry.failures.length === 0 && entry.coverage?.randomDisplayAndExport === true);
    await save();
    await writeFile(join(evidenceRoot, "latest.json"), JSON.stringify({ directory: runDirectory, passed: report.passed }, null, 2));
    console.log(`T2-42 evidence saved to ${runDirectory}; full acceptance passed=${report.passed}`);
    if (!report.passed) process.exitCode = 1;
  }
} catch (error) {
  report.passed = false;
  if (runDirectory) { report.runnerError = String(error); await writeFile(join(runDirectory, "results.json"), JSON.stringify(report, null, 2)); }
  throw error;
} finally { await server.close(); }
