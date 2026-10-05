import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const directory = "docs/evidence/plan2/T2-18";
const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
try {
  const { freeGeometryFixtures } = await server.ssrLoadModule("/src/validation/free-geometry-fixtures.ts");
  const { captureAnalysisInput, NATIVE_STATIC_SOLVER, isAnalysisResultCurrent } = await server.ssrLoadModule("/src/domain/analysis.ts");
  const { createAnalysisRequest } = await server.ssrLoadModule("/src/domain/analysis-service.ts");
  const { decodeAnalysisResult, decodeProject, encodeProject } = await server.ssrLoadModule("/src/domain/project-file.ts");
  const { attachAnalysisResult } = await server.ssrLoadModule("/src/domain/project.ts");
  const { GEOMETRY_CONTRACT } = await server.ssrLoadModule("/src/domain/geometry-policy.ts");
  const samples = [];
  for (const fixture of freeGeometryFixtures()) {
    const request = createAnalysisRequest({ ...captureAnalysisInput(fixture.project), solver: NATIVE_STATIC_SOLVER });
    const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, child.stdout + child.stderr);
    const terminal = child.stdout.trim().split("\n").map(JSON.parse).at(-1);
    assert.equal(terminal.kind, "result", JSON.stringify(terminal));
    const result = decodeAnalysisResult(terminal.result);
    for (const axis of ["x", "y", "z"]) {
      const expected = fixture.expectedTip[axis];
      const tolerance = expected === 0 ? 1e-12 : Math.max(1e-18, Math.abs(expected) * 1e-9);
      assert.ok(Math.abs(result.nodes[1].displacement[axis] - expected) <= tolerance, `${fixture.id} ${axis}: ${result.nodes[1].displacement[axis]} versus ${expected}`);
    }
    assert.deepEqual(result.input.nodes, fixture.project.nodes);
    assert.deepEqual(result.input.members, fixture.project.members);
    if (fixture.id === "crossing") {
      assert.equal(result.input.nodes.length, 4); assert.equal(result.input.members.length, 2);
      for (const value of [...Object.values(result.nodes[3].displacement), ...Object.values(result.nodes[2].reaction)]) assert.equal(Math.abs(value), 0);
    }
    const saved = decodeProject(encodeProject(attachAnalysisResult(fixture.project, result)));
    assert.equal(isAnalysisResultCurrent(saved, saved.latestAnalysis), true);
    assert.deepEqual(saved.nodes, fixture.project.nodes);
    samples.push({ ...fixture, result, passed: true });
  }
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/wire-samples.json`, JSON.stringify(samples, null, 2));
  await writeFile(`${directory}/native-verification.json`, JSON.stringify({ passed: true, geometryContract: GEOMETRY_CONTRACT, solver: NATIVE_STATIC_SOLVER, references: "Axial PL/EA; cantilever PL^3/(3EI); unloaded disconnected member zero response", cases: samples.map(({ id, expectedTip, result }) => ({ id, expectedTip, actualTip: result.nodes[1].displacement, nodeCount: result.input.nodes.length, memberCount: result.input.members.length })) }, null, 2));
  console.log(`T2-18: ${samples.length} native geometry references passed`);
} finally { await server.close(); }
