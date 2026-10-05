import { createServer } from "vite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { resolve } from "node:path";

const directory = "docs/evidence/plan2/T2-13";
const bytes = await readFile("src/validation/t31-references.json");
const references = JSON.parse(bytes);
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const executable = resolve("native/bin/framemind-core.exe");
try {
  const analysis = await server.ssrLoadModule("/src/domain/analysis.ts");
  const service = await server.ssrLoadModule("/src/domain/analysis-service.ts");
  const { AnalysisFailure } = await server.ssrLoadModule("/src/domain/analysis-diagnostics.ts");
  const { decodeAnalysisResult, decodeProject, encodeProject } = await server.ssrLoadModule("/src/domain/project-file.ts");
  const { attachAnalysisResult } = await server.ssrLoadModule("/src/domain/project.ts");
  const { runNumericalBenchmark } = await server.ssrLoadModule("/src/validation/numerical-benchmarks.ts");
  const samples = [];
  const invoke = (request) => {
    const child = spawnSync(executable, [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 30000,
      env: { ...process.env, PATH: `${process.env.SystemRoot}\\System32` } });
    if (child.error) throw child.error;
    const messages = child.stdout.trim().split("\n").map(JSON.parse);
    const terminal = messages.at(-1);
    if (terminal.kind === "error") throw new AnalysisFailure(terminal.error.stage, terminal.error.diagnostics);
    assert.equal(child.status, 0);
    assert.equal(terminal.kind, "result");
    const result = decodeAnalysisResult(terminal.result);
    assert.deepEqual(result.service.stages, messages.slice(0, -1).map((m) => m.record));
    assert.equal(analysis.sameInputValue(result.input, request.input), true);
    assert.equal(result.service.requestId, request.requestId);
    return result;
  };
  const ids = ["axial", "bend-y", "bend-z", "torsion", "moment-y", "moment-z", "six-components", "vertical", "skew-rotated-section"];
  const cases = references.cases.filter((item) => ids.includes(item.id)).map((benchmark) => {
    try {
      return runNumericalBenchmark(benchmark, (project) => {
        const request = service.createAnalysisRequest({ ...analysis.captureAnalysisInput(project), solver: { ...analysis.NATIVE_ANALYSIS_SOLVER } });
        const result = invoke(request);
        const saved = decodeProject(encodeProject(attachAnalysisResult(project, result)));
        assert.equal(analysis.sameInputValue(saved.latestAnalysis, result), true);
        assert.equal(analysis.isAnalysisResultCurrent(saved, saved.latestAnalysis), true);
        samples.push({ id: benchmark.id, request, result, project });
        return result;
      });
    } catch (error) { return { id: benchmark.id, passed: false, error: String(error) }; }
  });
  const failures = [];
  if (samples.length) {
    for (const [id, edit, expectedStage, code] of [
      ["invalid-material", (r) => { r.input.materials[0].elasticModulusGPa = 0; }, "model-check", "native-input-error"],
      ["mechanism", (r) => { r.input.supports[0].restraints = [true,true,true,false,false,false]; }, "solve", "singular-system"],
      ["overflow", (r) => { r.input.sections[0].areaM2 = 1e308; }, "assembly", "native-computation-error"],
      ["invalid-units", (r) => { r.input.assumptions.units = "mm-N"; }, "model-check", "native-input-error"],
    ]) {
      const request = structuredClone(samples[0].request); edit(request);
      try { invoke(request); failures.push({ id, passed: false }); }
      catch (error) { failures.push({ id, passed: error instanceof AnalysisFailure && error.stage === expectedStage && error.diagnostics[0].code === code, stage: error.stage, diagnostics: error.diagnostics }); }
    }
  }
  const failed = [...cases, ...failures].filter((item) => !item.passed).map((item) => item.id);
  const report = { generatedAt: new Date().toISOString(), baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    executableSha256: createHash("sha256").update(await readFile(executable)).digest("hex"), referenceSha256: createHash("sha256").update(bytes).digest("hex"),
    environment: { platform: process.platform, arch: process.arch, node: process.version, childPath: "Windows System32 only" },
    passed: cases.length === ids.length && failed.length === 0 && failures.length === 4,
    summary: { cases: cases.length, failureCases: failures.length, checks: cases.flatMap((item) => item.checks ?? []).length, failed }, cases, failures };
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/numerical-results.json`, JSON.stringify(report, null, 2) + "\n");
  await writeFile(`${directory}/wire-samples.json`, JSON.stringify(samples, null, 2) + "\n");
  console.log(JSON.stringify({ passed: report.passed, ...report.summary, errors: cases.filter((c) => c.error) }));
  if (!report.passed) process.exitCode = 1;
} finally { await server.close(); }
