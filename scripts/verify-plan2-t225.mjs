import { createServer } from "vite";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
try {
  const { releasedBeam, releasedPortal } = await server.ssrLoadModule("/src/validation/member-release-fixtures.ts");
  const { updateMember } = await server.ssrLoadModule("/src/domain/project.ts");
  const { captureAnalysisInput, NATIVE_RELEASE_STATIC_SOLVER } = await server.ssrLoadModule("/src/domain/analysis.ts");
  const { createAnalysisRequest } = await server.ssrLoadModule("/src/domain/analysis-service.ts");
  const { decodeAnalysisResult, encodeProject, decodeProject } = await server.ssrLoadModule("/src/domain/project-file.ts");
  const checks = [], samples = [];
  const near = (name, actual, expected, unit = "kN") => {
    const tolerance = Math.max(unit === "m" || unit === "rad" ? 1e-12 : 1e-8, Math.abs(expected) * 1e-9);
    assert.ok(Math.abs(actual - expected) <= tolerance, `${name}: ${actual} vs ${expected} (${unit})`);
    checks.push({ name, actual, expected, unit, tolerance, passed: true });
  };
  const solve = (name, project) => {
    const request = createAnalysisRequest({ ...captureAnalysisInput(project), solver: NATIVE_RELEASE_STATIC_SOLVER });
    const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    if (child.error) throw child.error;
    const packet = JSON.parse(child.stdout.trim().split("\n").at(-1));
    assert.equal(packet.kind, "result", JSON.stringify(packet));
    const result = decodeAnalysisResult(packet.result);
    samples.push({ name, project: decodeProject(encodeProject(project)), result });
    // Actual process residual on every free DOF, including reference-eliminated rotations.
    const u = result.nodes.flatMap((n) => [...Object.values(n.displacement), ...Object.values(n.rotation)]);
    const residual = result.process.freeDofs.map((i) => result.process.assembledStiffness[i].reduce((sum, k, j) => sum + k * u[j], 0) - result.process.loadVector[i]);
    for (const [i, value] of residual.entries()) near(`${name}:residual:${i}`, value, 0);
    return result;
  };
  // Independent two-plane fixed/hinged EB beam references registered in ADR-0058.
  // q_y=-3, q_z=-2, L=4. Each plane's released ends are independent.
  for (let code = 0; code < 16; code++) {
    const endReleases = { start: { my: Boolean(code & 1), mz: Boolean(code & 2) }, end: { my: Boolean(code & 4), mz: Boolean(code & 8) } };
    let p = releasedBeam(); p = updateMember(p, p.members[0].id, { endReleases });
    p = { ...p, uniformLoads: p.uniformLoads.map((q) => ({ ...q, intensity: { x: 0, y: -3, z: -2 } })) };
    const r = solve(`combination-${code}`, p);
    for (const [axis, component, key, q] of [["z", 4, "my", 2], ["y", 5, "mz", 3]]) {
      const a = endReleases.start[key], b = endReleases.end[key];
      const ra = a === b ? q * 2 : a ? q * 1.5 : q * 2.5;
      const ma = a ? 0 : b ? q * 2 : q * 16 / 12;
      const mb = b ? 0 : a ? q * 2 : q * 16 / 12;
      near(`${code}:${axis}:Rstart`, r.nodes[0].reaction[axis], ra);
      near(`${code}:${axis}:Rend`, r.nodes[1].reaction[axis], q * 4 - ra);
      near(`${code}:${axis}:Mstart`, Math.abs(r.members[0].localEndForces.start[component]), ma, "kN·m");
      near(`${code}:${axis}:Mend`, Math.abs(r.members[0].localEndForces.end[component]), mb, "kN·m");
    }
  }
  const portal = solve("released-portal", releasedPortal());
  for (const n of portal.nodes.slice(2)) { near(`portal:${n.nodeId}:Rz`, n.reaction.z, 4); for (const a of ["x", "y", "z"]) near(`portal:${n.nodeId}:M${a}`, n.reactionMoment[a], 0, "kN·m"); }
  for (const m of portal.members.slice(1)) near(`portal:${m.memberId}:compression`, m.localEndForces.start[0], 4);
  for (const position of [0, 16]) near(`portal:beam-end:${position}`, portal.members[0].nativeResponses[position].forces[4], 0, "kN·m");
  await mkdir("docs/evidence/plan2/T2-25", { recursive: true });
  await writeFile("docs/evidence/plan2/T2-25/numerical-results.json", JSON.stringify({ passed: true, registeredBasis: "docs/decisions/0058-local-member-end-releases.md", solver: NATIVE_RELEASE_STATIC_SOLVER, checks, samples }, null, 2));
  console.log(`T2-25: ${samples.length} independent native cases, ${checks.length} checks passed`);
} finally { await server.close(); }
