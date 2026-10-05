import { createServer } from "vite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import os from "node:os";
import assert from "node:assert/strict";

const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
try {
  const analysis = await server.ssrLoadModule("/src/domain/analysis.ts");
  const service = await server.ssrLoadModule("/src/domain/analysis-service.ts");
  const projectApi = await server.ssrLoadModule("/src/domain/project.ts");
  const { decodeAnalysisResult, encodeProject } = await server.ssrLoadModule("/src/domain/project-file.ts");
  if (process.argv.includes("--reference")) {
    let bytes = ""; for await (const chunk of process.stdin) bytes += chunk;
    const project = JSON.parse(bytes);
    const started = performance.now(); const result = analysis.solveFrame(project);
    process.stdout.write(JSON.stringify({ elapsedMs: performance.now() - started, maxRssBytes: process.resourceUsage().maxRSS * 1024, nodes: result.nodes.length, members: result.members.length }));
  } else {
    const directory = "docs/evidence/plan2/T2-15";
    await mkdir(directory, { recursive: true });
    const bytes = await readFile("src/validation/t31-references.json");
    const references = JSON.parse(bytes);
    const { runNumericalBenchmark, runInvalidBenchmarks } = await server.ssrLoadModule("/src/validation/numerical-benchmarks.ts");
    const { AnalysisFailure } = await server.ssrLoadModule("/src/domain/analysis-diagnostics.ts");
    const executable = resolve("native/bin/framemind-core.exe");
    const compilerFreeEnv = { ...process.env, PATH: `${process.env.SystemRoot}\\System32` };
    const requestFor = project => service.createAnalysisRequest({ ...analysis.captureAnalysisInput(project), solver: { ...analysis.NATIVE_STATIC_SOLVER } });
    const raw = (request, env = compilerFreeEnv) => {
      const started = performance.now();
      const child = spawnSync(executable, [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 64 * 1024 * 1024, env });
      if (child.error) throw child.error;
      const messages = child.stdout.trim().split("\n").map(JSON.parse);
      return { child, messages, elapsedMs: performance.now() - started };
    };
    const invoke = project => {
      const request = requestFor(project), { child, messages } = raw(request);
      const terminal = messages.at(-1);
      if (terminal.kind === "error") throw new AnalysisFailure(terminal.error.stage, terminal.error.diagnostics);
      assert.equal(child.status, 0); const result = decodeAnalysisResult(terminal.result);
      assert.ok(analysis.sameInputValue(result.input, request.input));
      assert.deepEqual(result.service.stages, messages.slice(0, -1).map(message => message.record));
      return result;
    };
    const cases = references.cases.map(benchmark => runNumericalBenchmark(benchmark, invoke));
    const failures = runInvalidBenchmarks(invoke);
    assert.ok(cases.every(item => item.passed)); assert.ok(failures.every(item => item.passed));
    const samples = JSON.parse(await readFile("docs/evidence/plan2/T2-14/wire-samples.json", "utf8"));
    const seed = structuredClone(samples.find(item => item.id === "axial").project);
    // Same topology for every measured run; no count limit in the product.
    const star = structuredClone(seed);
    const root = star.nodes[0], tip = star.nodes[1], member = star.members[0];
    star.nodes = [root, ...Array.from({ length: 200 }, (_, i) => ({ ...tip, id: `node_${String(i+2).padStart(4,"0")}`, label: `N${i+2}`, position: { x: 4, y: i/1000, z: 0 } }))];
    star.members = star.nodes.slice(1).map((node, i) => ({ ...member, id: `member_${String(i+1).padStart(4,"0")}`, label: `M${i+1}`, startNodeId: root.id, endNodeId: node.id }));
    star.nodalLoads = star.nodes.slice(1).map((node, i) => ({ ...seed.nodalLoads[0], id: `load_${String(i+1).padStart(4,"0")}`, label: `P${i+1}`, nodeId: node.id }));
    const baseline = { environment: { platform: process.platform, release: os.release(), cpu: os.cpus()[0].model, logicalProcessors: os.cpus().length, totalMemoryBytes: os.totalmem(), node: process.version }, model: { nodes: star.nodes.length, members: star.members.length, dofs: star.nodes.length*6, sha256: createHash("sha256").update(JSON.stringify(star)).digest("hex") }, memoryDefinitions: { typescript: "Node process peak RSS including Vite reference harness", native: "Windows Job peak committed process memory including input/output encoding" }, runs: [] };
    for (let repeat = 1; repeat <= 3; repeat++) {
      const reference = spawnSync(process.execPath, [resolve("scripts/verify-plan2-t215.mjs"), "--reference"], { input: JSON.stringify(star), encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 4*1024*1024 });
      assert.equal(reference.status, 0, reference.stderr);
      const native = raw(requestFor(star)); assert.equal(native.child.status, 0, native.child.stdout.slice(-500));
      const resources = JSON.parse(native.child.stderr.trim());
      assert.ok(resources.peakCommittedBytes > 0);
      baseline.runs.push({ repeat, typescriptReference: JSON.parse(reference.stdout), native: { elapsedMs: native.elapsedMs, core: resources, outputBytes: Buffer.byteLength(native.child.stdout) } });
    }
    const memoryFault = raw(requestFor(star), { ...compilerFreeEnv, FRAMEMIND_NATIVE_MEMORY_MIB: "16" });
    assert.equal(memoryFault.child.status, 1);
    const memoryFailure = memoryFault.messages.at(-1);
    assert.equal(memoryFailure.kind, "error"); assert.equal(memoryFailure.error.diagnostics[0].code, "native-resource-limit");
    // The same input succeeds after correcting the resource setting.
    assert.equal(raw(requestFor(star)).child.status, 0);
    const { NativeAnalysisHost } = createRequire(import.meta.url)("../dist-electron/native-analysis.js");
    const processFaults = [];
    for (const fault of ["crash", "truncated", "protocol", "wait"]) {
      const host = new NativeAnalysisHost(resolve("native/build/Release/framemind-fault-core.exe"));
      const phases = []; let cancelAt;
      const request = { ...requestFor(seed), fault };
      const messages = await host.run(1, request, message => {
        phases.push(message.record.stage);
        if (fault === "wait" && message.record.stage === "solve") setTimeout(() => { cancelAt = performance.now(); host.cancel(1, request.requestId); }, 0);
      });
      const terminal = messages.at(-1);
      assert.equal(terminal.kind, "error"); assert.deepEqual(phases, ["model-check", "assembly", "solve"]);
      const cancellationMs = fault === "wait" ? performance.now() - cancelAt : undefined;
      if (cancellationMs !== undefined) assert.ok(cancellationMs < 500);
      processFaults.push({ fault, phases, terminal, cancellationMs }); host.dispose();
    }
    // Both supplemental and diagnostic origins are accepted and round-trip.
    const origins = [];
    for (const kind of ["diagnostic-copy", "supplemental"]) {
      const input = { ...analysis.captureAnalysisInput(seed), solver: { ...analysis.NATIVE_STATIC_SOLVER }, projectId: kind === "diagnostic-copy" ? "diagnostic_native_probe" : seed.id };
      const origin = kind === "diagnostic-copy" ? { kind, copyId: input.projectId, sourceProjectId: seed.id, sourceProjectRevision: seed.revision } : { kind, sourceAnalysisId: "analysis_historical" };
      const request = service.createAnalysisRequest(input, origin), outcome = raw(request);
      assert.equal(outcome.child.status, 0); const result = decodeAnalysisResult(outcome.messages.at(-1).result);
      assert.deepEqual(result.service.origin, origin); origins.push({ kind, passed: true, service: result.service });
    }
    const report = { passed: true, generatedAt: new Date().toISOString(), criteria: "docs/decisions/0048-native-production-isolation.md", referenceSha256: createHash("sha256").update(bytes).digest("hex"), cases, failures, baseline, memoryFailure, processFaults, origins };
    await writeFile(`${directory}/runtime-results.json`, JSON.stringify(report, null, 2) + "\n");
    await writeFile(`${directory}/star.framemind`, encodeProject(star));
    console.log(`T2-15 passed: ${cases.length} independent cases, ${failures.length} invalid cases, ${processFaults.length} process faults, real memory exhaustion and 3 baseline repetitions`);
  }
} finally { await server.close(); }
