import { createServer } from "vite";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
try {
  const { releasedBeam, releasedPortal } = await server.ssrLoadModule("/src/validation/member-release-fixtures.ts");
  const p = await server.ssrLoadModule("/src/domain/project.ts");
  const a = await server.ssrLoadModule("/src/domain/analysis.ts");
  const { createAnalysisRequest } = await server.ssrLoadModule("/src/domain/analysis-service.ts");
  const { createMeshPlan, DEFAULT_MESH_POLICY } = await server.ssrLoadModule("/src/domain/analysis-mesh.ts");
  const { decodeAnalysisResult, encodeProject, decodeProject } = await server.ssrLoadModule("/src/domain/project-file.ts");
  const checks = [], cases = [], samples = [];
  const near = (name, actual, expected, unit = "kN") => {
    const tolerance = Math.max(unit === "m" || unit === "rad" ? 1e-12 : 1e-8, Math.abs(expected) * 1e-9);
    assert.ok(Math.abs(actual - expected) <= tolerance, `${name}: ${actual} vs ${expected}`);
    checks.push({ name, actual, expected, unit, tolerance, passed: true });
  };
  const packet = (project, policy = DEFAULT_MESH_POLICY) => {
    const input = { ...a.captureAnalysisInput(project), solver: a.NATIVE_MESH_STATIC_SOLVER };
    const request = createAnalysisRequest({ ...input, meshPlan: createMeshPlan(input, policy) });
    const started = performance.now();
    const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    if (child.error) throw child.error;
    const messages = child.stdout.trim().split("\n").map((line) => JSON.parse(line));
    return { request, messages, terminal: messages.at(-1), elapsedMs: performance.now() - started };
  };
  const solve = (id, project, policy = DEFAULT_MESH_POLICY, keep = false) => {
    const output = packet(project, policy);
    assert.equal(output.terminal.kind, "result", JSON.stringify(output.terminal));
    const result = decodeAnalysisResult(output.terminal.result);
    assert.deepEqual(result.nodes.map((n) => n.nodeId), project.nodes.map((n) => n.id));
    assert.deepEqual(result.members.map((m) => m.memberId), project.members.map((m) => m.id));
    assert.deepEqual(output.messages.filter((m) => m.kind === "phase").map((m) => m.record.stage), ["model-check", "assembly", "solve", "recovery"]);
    const saved = decodeProject(encodeProject(p.attachAnalysisResult(project, result)));
    assert.equal(a.isAnalysisResultCurrent(saved, saved.latestAnalysis), true);
    assert.deepEqual(saved.nodes, project.nodes); assert.deepEqual(saved.members, project.members);
    for (const run of result.discretization.runs) {
      const inner = run.result, process = inner.process;
      const u = inner.nodes.flatMap((n) => [...Object.values(n.displacement), ...Object.values(n.rotation)]);
      if (process.assembledStiffness) for (const i of process.freeDofs) near(`${id}:${run.divisions}:residual:${i}`, process.assembledStiffness[i].reduce((sum, k, j) => sum + k * u[j], 0) - process.loadVector[i], 0);
      for (const axis of ["x", "y", "z"]) {
        // Integral of uniform + self-weight and nodal force from frozen input.
        let resultant = project.nodalLoads.filter((q) => q.loadCaseId === inner.input.loadCase.id).reduce((sum, q) => sum + q.force[axis], 0);
        if (inner.input.combination) resultant = inner.input.nodalLoads.reduce((sum, q) => sum + q.force[axis], 0);
        for (const member of inner.members) {
          const record = a.getMemberAnalysisRecord(inner, member.memberId);
          resultant += member.length * (record.geometry.localX[axis] * record.totalIntensity.x + record.geometry.localY[axis] * record.totalIntensity.y + record.geometry.localZ[axis] * record.totalIntensity.z);
        }
        near(`${id}:${run.divisions}:load-balance:${axis}`, resultant + inner.nodes.reduce((sum, n) => sum + n.reaction[axis], 0), 0);
      }
    }
    cases.push({ id, elapsedMs: output.elapsedMs, counts: result.discretization.counts, status: result.discretization.status, reason: result.discretization.reason, runs: result.discretization.runs.map(({ divisions, error }) => ({ divisions, error })) });
    if (keep) samples.push({ id, project, result });
    return result;
  };
  for (let code = 0; code < 16; code++) {
    const ends = { start: { my: Boolean(code & 1), mz: Boolean(code & 2) }, end: { my: Boolean(code & 4), mz: Boolean(code & 8) } };
    let beam = p.updateMember(releasedBeam(), "member_0001", { endReleases: ends });
    beam = { ...beam, uniformLoads: beam.uniformLoads.map((q) => ({ ...q, intensity: { x: 1, y: -3, z: -2 } })) };
    const r = solve(`releases-${code}`, beam, DEFAULT_MESH_POLICY, code === 4 || code === 15);
    assert.equal(r.discretization.status, "converged");
    for (const [axis, component, key, q] of [["z", 4, "my", 2], ["y", 5, "mz", 3]]) {
      const start = ends.start[key], end = ends.end[key];
      const ra = start === end ? q * 2 : start ? q * 1.5 : q * 2.5;
      near(`${code}:${axis}:R-start`, r.nodes[0].reaction[axis], ra);
      near(`${code}:${axis}:R-end`, r.nodes[1].reaction[axis], q * 4 - ra);
      near(`${code}:${axis}:M-start`, Math.abs(r.members[0].localEndForces.start[component]), start ? 0 : end ? q * 2 : q * 16 / 12, "kN·m");
      near(`${code}:${axis}:M-end`, Math.abs(r.members[0].localEndForces.end[component]), end ? 0 : start ? q * 2 : q * 16 / 12, "kN·m");
      const ei = 200e6 * beam.sections[0][key === "my" ? "secondMomentYM4" : "secondMomentZM4"];
      const coefficient = start && end ? 5 / 384 : !start && !end ? 1 / 384 : 1 / 192;
      near(`${code}:${axis}:midpoint`, a.getMemberResponseSamples(r, r.members[0].memberId, 33)[16].localDisplacement[axis], -coefficient * q * 4 ** 4 / ei, "m");
    }
    near(`${code}:axial-midpoint`, a.getMemberResponseSamples(r, r.members[0].memberId, 33)[16].localDisplacement.x, 4 ** 2 / (8 * 200e6 * beam.sections[0].areaM2), "m");
  }
  const portal = solve("portal", releasedPortal(), DEFAULT_MESH_POLICY, true);
  for (const n of portal.nodes.slice(2)) near(`portal:${n.nodeId}:Rz`, n.reaction.z, 4);
  const axialProject = JSON.parse(await readFile("docs/evidence/plan2/T2-14/wire-samples.json", "utf8")).find((s) => s.id === "axial").project;
  const axial = solve("axial", axialProject, DEFAULT_MESH_POLICY, true);
  near("axial:tip", axial.nodes[1].displacement.x, .000016, "m");
  let oblique = p.updateMember(releasedBeam(), "member_0001", { rotationDegrees: 37 });
  oblique = { ...oblique, supports: oblique.supports.map((s, i) => ({ ...s, restraints: [true, true, true, true, i === 0, i === 0] })) };
  const rotated = solve("oblique", oblique, DEFAULT_MESH_POLICY, true);
  near("oblique:Rstart", rotated.nodes[0].reaction.z, 5 * Math.cos(37 * Math.PI / 180));
  assert.equal(rotated.discretization.counts.releaseGaugeDofs, 1);
  // Analytic fixed-fixed beam at both sides of the reference-axis switch.
  for (const origin of [1, 10, 100, 1000]) for (const dz of [3.6 - 1e-8, 3.6, 3.6 + 1e-8]) {
    const base = releasedBeam(), dx = Math.sqrt(.19) * 4;
    const beam = { ...base, nodes: base.nodes.map((n, i) => ({ ...n, position: i ? { x: origin + dx, y: origin, z: origin + dz } : { x: origin, y: origin, z: origin } })), members: base.members.map((m) => ({ ...m, endReleases: { start: { my: false, mz: false }, end: { my: false, mz: false } } })), uniformLoads: base.uniformLoads.map((q) => ({ ...q, intensity: { x: 0, y: -2, z: 0 } })) };
    const id = `axis-boundary-${origin}-${dz}`;
    const r = solve(id, beam, { ...DEFAULT_MESH_POLICY, relativeTolerance: 1e-24, forceTolerance: 1e-24, displacementTolerance: 1e-24 }, origin === 100 && dz === 3.6);
    const frame = r.input.meshPlan.frames[beam.members[0].id];
    assert.equal(frame.referenceAxis, dz < 3.6 ? "global-z" : "global-y");
    for (const run of r.discretization.runs) {
      for (const member of run.result.members) assert.deepEqual(member.localAxes, { x: frame.localX, y: frame.localY, z: frame.localZ });
      for (const axis of ["x", "y", "z"]) near(`${id}:${run.divisions}:engineering-load:${axis}`, run.result.nodes.reduce((sum, n) => sum + n.reaction[axis], 0), 2 * frame.length * frame.localY[axis]);
    }
    near(`${id}:midpoint`, a.getMemberResponseSamples(r, beam.members[0].id, 33)[16].localDisplacement.y, -2 * frame.length ** 4 / (384 * 200e6 * beam.sections[0].secondMomentZM4), "m");
  }
  let combination = p.updateSelfWeight(releasedBeam(), { enabled: true, loadCaseId: "LC1", gravity: { x: 0, y: 0, z: -9.81 } });
  combination = p.addLoadCase(combination, "second");
  combination = p.addNodalLoad(combination, combination.nodes[0].id, { x: 0, y: 0, z: -3 }, { x: 0, y: 0, z: 0 }, "LC2");
  combination = p.addLoadCombination(combination, "combined", [{ loadCaseId: "LC1", factor: 1.5 }, { loadCaseId: "LC2", factor: -.5 }]);
  combination = p.selectAnalysisSource(combination, combination.loadCombinations[0].id);
  const combined = solve("combination", combination, DEFAULT_MESH_POLICY, true);
  const q = 2 + 7850 * .08 * 9.81 / 1000;
  near("combination:Rstart", combined.nodes[0].reaction.z, 1.5 * q * 4 * 5 / 8 - 1.5);
  const single = solve("single-mesh-budget", releasedBeam(), { ...DEFAULT_MESH_POLICY, maxDivisions: 1 }, true);
  assert.equal(single.discretization.status, "budget-exhausted");
  const equation = solve("equation-budget", releasedBeam(), { ...DEFAULT_MESH_POLICY, maxEquations: 1 }, true);
  assert.equal(equation.discretization.reason, "equation-budget");
  const strict = solve("tight-accuracy-budget", releasedBeam(), { ...DEFAULT_MESH_POLICY, maxDivisions: 8, relativeTolerance: 1e-24, forceTolerance: 1e-24, displacementTolerance: 1e-24 }, true);
  assert.equal(strict.discretization.status, "budget-exhausted"); assert.equal(strict.discretization.runs.length, 4);
  const mechanism = p.updateMember({ ...releasedBeam(), supports: releasedBeam().supports.slice(0, 1) }, "member_0001", { endReleases: { start: { my: true, mz: false }, end: { my: true, mz: false } } });
  const failed = packet(mechanism); assert.equal(failed.terminal.kind, "error");
  assert.equal(failed.terminal.error.diagnostics[0].target.id, mechanism.nodes[1].id);
  const initialBudget = packet(releasedPortal(), { ...DEFAULT_MESH_POLICY, maxEquations: 1 });
  assert.equal(initialBudget.terminal.error.diagnostics[0].code, "mesh-budget-exhausted");
  const evidence = "docs/evidence/plan2/T2-26"; await mkdir(evidence, { recursive: true });
  await writeFile(`${evidence}/wire-samples.json`, JSON.stringify(samples));
  await writeFile(`${evidence}/numerical-results.json`, JSON.stringify({ passed: true, registeredBasis: "docs/decisions/0059-internal-mesh-and-static-convergence.md", cases, checks, failures: [failed.terminal, initialBudget.terminal] }, null, 2));
  console.log(`T2-26: ${cases.length} native cases, ${checks.length} independent checks, 2 explicit failures passed`);
} finally { await server.close(); }
