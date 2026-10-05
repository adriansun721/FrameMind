import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const directory = "docs/evidence/plan2/T2-20";
const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
try {
  const { topologyFixture } = await server.ssrLoadModule("/src/validation/topology-fixtures.ts");
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
  const near = (id, actual, expected, tolerance = Math.max(1e-12, Math.abs(expected) * 1e-9)) => {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${id}: ${actual} versus ${expected}`);
    checks.push({ id, actual, expected, tolerance, passed: true });
  };
  const node = (result, id) => result.nodes.find((n) => n.nodeId === id);
  const project = topologyFixture();
  const split = applyProjectEdits(project, [{ type: "split_member", memberIds: [project.members[0].id], position: { x: -.5, y: 0, z: 0 } }]);
  const connect = applyProjectEdits(project, [{ type: "connect_members", memberIds: project.members.map((m) => m.id), position: { x: 0, y: 0, z: 0 } }]);
  const before = solve(project), divided = solve(split.project), connected = solve(connect.project);
  // Cantilever PL^3/(3EI), L=4m; unloaded independent cantilever has zero response.
  near("disconnected-tip", node(before, "node_0002").displacement.z, -.010666666666666667);
  near("disconnected-other-tip", node(before, "node_0004").displacement.z, 0);
  near("split-tip", node(divided, "node_0002").displacement.z, -.010666666666666667);
  // Independent joint stiffness calculation: a=2m, t=GJ/EI=5/13.
  // Both joint rotations remain free: Kzz=24EI/a^3, |Kzr|=6EI/a^2,
  // Krr=(4+t)EI/a. Condensing both rotations gives w=P*a^3/EI*(10+t)/(24+24t).
  near("connected-joint", node(connected, "node_0005").displacement.z, -.00125);
  near("connected-loaded-tip", node(connected, "node_0002").displacement.z, -.004 * 1187 / 912);
  near("connected-other-tip", node(connected, "node_0004").displacement.z, -.004 * 225 / 304);
  near("connected-other-support", node(connected, "node_0003").reaction.z, 225 / 19);
  near("connected-total-reaction", connected.nodes.reduce((sum, n) => sum + n.reaction.z, 0), 10);
  const loaded = topologyFixture(true);
  const loadedSplit = applyProjectEdits(loaded, [{ type: "split_member", memberIds: [loaded.members[0].id], position: { x: -.5, y: 0, z: 0 } }]);
  const loadedBefore = solve(loaded), loadedAfter = solve(loadedSplit.project);
  for (const id of loaded.nodes.map((n) => n.id)) for (const field of ["displacement", "rotation", "reaction", "reactionMoment"]) for (const axis of ["x", "y", "z"]) near(`uniform-selfweight:${id}:${field}:${axis}`, node(loadedAfter, id)[field][axis], node(loadedBefore, id)[field][axis]);
  // Original 4m distribution with 2kN/m global Y plus rotated local -2Y/-3Z.
  const angle = 17.5 * Math.PI / 180;
  near("uniform-total-global-Y", loadedAfter.nodes.reduce((sum, n) => sum + n.reaction.y, 0), 8 + 8 * Math.cos(angle) - 12 * Math.sin(angle));
  near("uniform-selfweight-total-global-Z", loadedAfter.nodes.reduce((sum, n) => sum + n.reaction.z, 0), 10 + 12 + 8 * Math.sin(angle) + 12 * Math.cos(angle) + 6.16068);
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/native-verification.json`, JSON.stringify({ passed: true, solver: NATIVE_STATIC_SOLVER, checks, references: "PL^3/(3EI); independently condensed joint stiffness; global force balance; split before/after response regression", receipts: [split.receipt, connect.receipt, loadedSplit.receipt], results: { before, divided, connected, loadedBefore, loadedAfter } }, null, 2));
  console.log(`T2-20: ${checks.length} native topology checks passed`);
} finally { await server.close(); }
