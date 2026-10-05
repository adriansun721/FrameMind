import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "vite";

const directory = "docs/evidence/plan2/T2-21";
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { nodeMergeFixture, nodeMergeInput } = await server.ssrLoadModule("/src/validation/node-merge-fixtures.ts");
  const { applyProjectEdits } = await server.ssrLoadModule("/src/domain/project-operations.ts");
  const { captureAnalysisInput, NATIVE_STATIC_SOLVER } = await server.ssrLoadModule("/src/domain/analysis.ts");
  const { createAnalysisRequest } = await server.ssrLoadModule("/src/domain/analysis-service.ts");
  const { decodeAnalysisResult } = await server.ssrLoadModule("/src/domain/project-file.ts");
  const solve = (project) => {
    const request = createAnalysisRequest({ ...captureAnalysisInput(project), solver: NATIVE_STATIC_SOLVER });
    const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, child.stdout + child.stderr);
    const terminal = child.stdout.trim().split("\n").map(JSON.parse).at(-1);
    assert.equal(terminal.kind, "result", JSON.stringify(terminal));
    return decodeAnalysisResult(terminal.result);
  };
  const checks = [];
  const near = (id, actual, expected) => {
    const tolerance = Math.max(1e-12, Math.abs(expected) * 1e-9);
    assert.ok(Math.abs(actual - expected) <= tolerance, `${id}: ${actual} versus ${expected}`);
    checks.push({ id, actual, expected, tolerance, passed: true });
  };
  const p = nodeMergeFixture();
  const merged = applyProjectEdits(p, [{ type: "merge_nodes", ...nodeMergeInput(p) }]);
  const result = solve(merged.project);
  const tip = result.nodes.find((n) => n.nodeId === "node_0002");
  // Independent Euler–Bernoulli cantilever: P=10 kN, L=3m, E=200GPa, I=1e-4m4.
  near("merged-tip-PL3/3EI", tip.displacement.z, -.0045);
  near("merged-tip-PL2/2EI", tip.rotation.y, .00225);
  near("merged-reaction", result.nodes.reduce((sum, n) => sum + n.reaction.z, 0), 10);
  near("merged-base-moment", result.nodes[0].reactionMoment.y, -30);
  const conflict = nodeMergeFixture(true); const input = nodeMergeInput(conflict);
  const single = applyProjectEdits(conflict, [{ type: "merge_nodes", ...input }]);
  const singleResult = solve(single.project);
  near("explicit-conflict-removal-tip", singleResult.nodes.find((n) => n.nodeId === "node_0002").displacement.z, -.0045);
  const parallel = applyProjectEdits(conflict, [{ type: "merge_nodes", ...input, resolution: { ...input.resolution,
    keepMemberIds: conflict.members.slice(0, 2).map((m) => m.id), removeUniformLoadIds: [conflict.uniformLoads[1].id] } }]);
  const parallelResult = solve(parallel.project);
  // Explicit parallel beams: 2EI; one retained beam carries q=2 kN/m over L=3m.
  near("explicit-parallel-P-and-q-tip", parallelResult.nodes.find((n) => n.nodeId === "node_0002").displacement.z, -.00275625);
  near("explicit-parallel-total-force", parallelResult.nodes.reduce((sum, n) => sum + n.reaction.z, 0), 16);
  near("explicit-parallel-base-moment", parallelResult.nodes[0].reactionMoment.y, -39);
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/native-verification.json`, JSON.stringify({ passed: true, solver: NATIVE_STATIC_SOLVER, checks,
    references: "PL^3/(3EI), PL^2/(2EI), qL^4/(8EI); explicit parallel elements use 2EI; global force/moment equilibrium",
    receipts: [merged.receipt, single.receipt, parallel.receipt], results: { result, singleResult, parallelResult } }, null, 2));
  console.log(`T2-21: ${checks.length} independent native node-merge checks passed`);
} finally { await server.close(); }
