import { createServer } from "vite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const directory = "docs/evidence/plan2/T2-14";
const bytes = await readFile("src/validation/t31-references.json");
const references = JSON.parse(bytes);
const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
const executable = resolve("native/bin/framemind-core.exe");
try {
  const analysis = await server.ssrLoadModule("/src/domain/analysis.ts");
  const service = await server.ssrLoadModule("/src/domain/analysis-service.ts");
  const { AnalysisFailure } = await server.ssrLoadModule("/src/domain/analysis-diagnostics.ts");
  const { decodeAnalysisResult, decodeProject, encodeProject } = await server.ssrLoadModule("/src/domain/project-file.ts");
  const { attachAnalysisResult } = await server.ssrLoadModule("/src/domain/project.ts");
  const { runNumericalBenchmark, runInvalidBenchmarks } = await server.ssrLoadModule("/src/validation/numerical-benchmarks.ts");
  const samples = [], comparisons = [];
  const invoke = (request) => {
    const child = spawnSync(executable, [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 30000,
      maxBuffer: 4 * 1024 * 1024, env: { ...process.env, PATH: `${process.env.SystemRoot}\\System32` } });
    if (child.error) throw child.error;
    const messages = child.stdout.trim().split("\n").map(JSON.parse);
    const terminal = messages.at(-1);
    if (terminal.kind === "error") throw new AnalysisFailure(terminal.error.stage, terminal.error.diagnostics);
    assert.equal(child.status, 0);
    assert.equal(terminal.kind, "result");
    const result = decodeAnalysisResult(terminal.result);
    assert.deepEqual(result.service.stages, messages.slice(0, -1).map((m) => m.record));
    assert.equal(analysis.sameInputValue(result.input, request.input), true);
    return result;
  };
  const requestFor = (project) => service.createAnalysisRequest({ ...analysis.captureAnalysisInput(project),
    solver: { implementation: "framemind-native/2", algorithm: "sparse-ldlt", constraints: "free-dof-elimination", relativePivotTolerance: 1e-12 } });
  const cases = references.cases.map((benchmark) => {
    try {
      return runNumericalBenchmark(benchmark, (project) => {
        const request = requestFor(project), result = invoke(request);
        const saved = decodeProject(encodeProject(attachAnalysisResult(project, result)));
        assert.equal(analysis.sameInputValue(saved.latestAnalysis, result), true);
        assert.equal(analysis.isAnalysisResultCurrent(saved, saved.latestAnalysis), true);
        const legacy = analysis.solveFrame(project);
        let maxAbsoluteDifference = 0;
        for (let i = 0; i < result.nodes.length; i++) for (const field of ["displacement", "rotation", "reaction", "reactionMoment"]) {
          for (const axis of ["x", "y", "z"]) {
            const a = result.nodes[i][field][axis], b = legacy.nodes[i][field][axis];
            maxAbsoluteDifference = Math.max(maxAbsoluteDifference, Math.abs(a - b));
            assert.ok(Math.abs(a - b) <= Math.max(1e-9, 1e-8 * Math.abs(b)));
          }
        }
        for (let i = 0; i < result.members.length; i++) for (const end of ["start", "end"]) {
          result.members[i].localEndForces[end].forEach((a, j) => {
            const b = legacy.members[i].localEndForces[end][j];
            assert.ok(Math.abs(a - b) <= Math.max(1e-9, 1e-8 * Math.abs(b)));
            maxAbsoluteDifference = Math.max(maxAbsoluteDifference, Math.abs(a - b));
          });
        }
        comparisons.push({ id: benchmark.id, passed: true, maxAbsoluteDifference });
        samples.push({ id: benchmark.id, request, result, project });
        return result;
      });
    } catch (error) { return { id: benchmark.id, passed: false, error: String(error) }; }
  });
  const failures = runInvalidBenchmarks((project) => invoke(requestFor(project)));
  const protocolFailures = [];
  for (const [id, edit, code, kind, field, fixture = "axial"] of [
    ["duplicate-member", r => r.input.members.push(r.input.members[0]), "invalid-identity", "member", "id"],
    ["missing-load-node", r => r.input.nodalLoads[0].nodeId = "node_9999", "invalid-reference", "load", "nodeId"],
    ["invalid-support-node", r => r.input.supports[0].nodeId = "node_9999", "invalid-reference", "support", "nodeId"],
    ["invalid-material", r => r.input.materials[0].densityKgM3 = -1, "invalid-parameter", "material", "densityKgM3"],
    ["invalid-section", r => r.input.sections[0].secondMomentYM4 = 0, "invalid-parameter", "section", "secondMomentYM4"],
    ["nonfinite-load", r => r.input.nodalLoads[0].force.x = null, "native-input-error", "load", "force.x"],
    ["invalid-uniform-reference", r => r.input.uniformLoads[0].memberId = "member_9999", "invalid-reference", "uniform-load", "memberId", "uniform-local"],
    ["invalid-uniform-axis", r => r.input.uniformLoads[0].coordinateSystem = "invalid", "native-input-error", "uniform-load", "coordinateSystem", "uniform-local"],
    ["effective-combination-mismatch", r => r.input.uniformLoads[0].intensity.x += 1, "native-input-error", undefined, undefined, "combination-negative"],
    ["effective-combination-case-mismatch", r => r.input.combination.cases[0].loadCase.id = "LC99", "native-input-error", undefined, undefined, "combination-negative"],
    ["overflow", r => r.input.sections[0].areaM2 = 1e308, "native-computation-error", "member", "stiffness"],
  ]) {
    // Choose raw wire input so the C++ validator, rather than renderer validation, sees it.
    const request = structuredClone(samples.find(s => s.id === fixture)?.request);
    if (!request) { protocolFailures.push({ id, passed: false, error: "Missing successful fixture" }); continue; }
    edit(request);
    try { invoke(request); protocolFailures.push({ id, passed: false }); }
    catch (error) { protocolFailures.push({ id, passed: error instanceof AnalysisFailure && error.diagnostics[0].code === code
      && (!kind || error.diagnostics[0].target?.kind === kind && error.diagnostics[0].field === field), stage: error.stage, diagnostics: error.diagnostics }); }
  }
  const boundaryCases = [];
  if (samples.length) {
    for (const id of ["fully-constrained", "sparse-storage"]) {
      try {
        const request = structuredClone(samples.find(s => s.id === "axial").request);
        if (id === "fully-constrained") {
          request.input.supports.push({ ...request.input.supports[0], id: "support_0002", label: "B2", nodeId: request.input.nodes[1].id });
          const result = invoke(request);
          assert.deepEqual(result.process.freeDofs, []);
          assert.equal(result.nodes[1].displacement.x, 0);
          assert.equal(result.nodes[1].reaction.x, -8);
        } else {
          const node = request.input.nodes[0], member = request.input.members[0];
          request.input.nodes = Array.from({ length: 41 }, (_, i) => ({ ...node, id: `node_${String(i+1).padStart(4,"0")}`, label: `N${i+1}`, position: { x: i/10, y: 0, z: 0 } }));
          request.input.members = request.input.nodes.slice(1).map((n, i) => ({ ...member, id: `member_${String(i+1).padStart(4,"0")}`, label: `M${i+1}`, startNodeId: request.input.nodes[i].id, endNodeId: n.id }));
          request.input.nodalLoads[0].nodeId = request.input.nodes.at(-1).id;
          const result = invoke(request);
          assert.equal(result.process.assembledStiffness, null);
          assert.equal(result.process.reducedStiffness, null);
          assert.equal(result.process.members.length, 40);
          assert.ok(Math.abs(result.nodes.at(-1).displacement.x - 0.000016) < 1e-11);
          assert.ok(Math.abs(result.nodes[0].reaction.x + 8) < 1e-9);
        }
        boundaryCases.push({ id, passed: true });
      } catch (error) { boundaryCases.push({ id, passed: false, error: String(error) }); }
    }
  }
  const failed = [...cases, ...failures, ...protocolFailures, ...boundaryCases].filter((item) => !item.passed).map((item) => item.id);
  const report = { generatedAt: new Date().toISOString(),
    executableSha256: createHash("sha256").update(await readFile(executable)).digest("hex"),
    referenceSha256: createHash("sha256").update(bytes).digest("hex"),
    passed: failed.length === 0, summary: { cases: cases.length, failureCases: failures.length,
      checks: cases.flatMap((item) => item.checks ?? []).length, failed }, cases, failures, comparisons, protocolFailures, boundaryCases };
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/numerical-results.json`, JSON.stringify(report, null, 2) + "\n");
  await writeFile(`${directory}/wire-samples.json`, JSON.stringify(samples, null, 2) + "\n");
  console.log(JSON.stringify({ passed: report.passed, ...report.summary, errors: [...cases, ...boundaryCases].filter((c) => c.error), failures: [...failures, ...protocolFailures].filter((c) => !c.passed).map(({ id, expected, actual, diagnostics }) => ({ id, expected, actual, diagnostics })) }));
  if (!report.passed) process.exitCode = 1;
} finally { await server.close(); }
