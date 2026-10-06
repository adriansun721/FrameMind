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
  const { applyProjectEdits } = await server.ssrLoadModule("/src/domain/project-operations.ts");
  const { meshCalculationInput } = await server.ssrLoadModule("/src/domain/analysis-mesh.ts");
  const { additionalMassSources } = await server.ssrLoadModule("/src/domain/additional-mass.ts");
  const { createAnalysisRequest } = await server.ssrLoadModule("/src/domain/analysis-service.ts");
  const { decodeAnalysisResult, encodeProject, decodeProject } = await server.ssrLoadModule("/src/domain/project-file.ts");
  const cases = [], checks = [], failures = [];
  const near = (name, actual, expected, relative = 5e-4, absolute = 1e-10) => {
    assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= absolute + relative * Math.abs(expected), `${name}: ${actual} vs ${expected}`);
    checks.push({ name, actual, expected, relative, absolute });
  };
  const packet = (project, mutate) => {
    const input = a.captureAnalysisInput(project);
    const request = structuredClone(createAnalysisRequest(input.analysisCase?.method === "modal" ? input : { ...input, solver: { ...a.NATIVE_MESH_STATIC_SOLVER } }));
    mutate?.(request);
    const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    if (child.error) throw child.error;
    return JSON.parse(child.stdout.trim().split("\n").at(-1));
  };
  const solve = (name, project, convergenceStatus = "converged") => {
    const terminal = packet(project); assert.equal(terminal.kind, "result", JSON.stringify(terminal));
    const result = decodeAnalysisResult(terminal.result);
    const saved = decodeProject(encodeProject(p.attachAnalysisResult(project, result)));
    assert.deepEqual(saved.nodes, project.nodes); assert.deepEqual(saved.members, project.members);
    assert.equal(a.isAnalysisResultCurrent(saved, saved.latestAnalysis), true);
    if (result.modal) {
      assert.equal(result.modal.convergence.status, convergenceStatus);
      for (const level of result.input.meshPlan.levels) {
        const calculation = meshCalculationInput(result.input, level);
        near(`${name}:mapped-mass:${level.divisions}`, additionalMassSources(calculation).totalMassKg, result.modal.additionalMassKg, 1e-12);
        assert.equal(calculation.nodes.filter((n) => n.additionalMassKg > 0).length, project.nodes.filter((n) => n.additionalMassKg > 0).length);
      }
      const problem = result.modal.eigenproblem;
      assert.ok(problem.mass && problem.stiffness, "Registered small references must capture their actual matrices");
      const dot = (x, y) => x.reduce((sum, v, i) => sum + v * y[i], 0), product = (matrix, v) => matrix.map((row) => dot(row, v));
      const kNorm = Math.hypot(...problem.stiffness.flat());
      const mv = problem.vectors.map((v) => product(problem.mass, v));
      for (const [i, v] of problem.vectors.entries()) {
        const lambda = result.modal.modes[i].eigenvalue, kv = product(problem.stiffness, v);
        const residual = Math.hypot(...kv.map((x, j) => x - lambda * mv[i][j])) / Math.max(1e-30, kNorm * Math.hypot(...v) + Math.abs(lambda) * Math.hypot(...mv[i]));
        near(`${name}:residual:${i}`, residual, 0, 0, 1e-8);
        for (let j = 0; j <= i; j++) near(`${name}:orthogonality:${i}:${j}`, dot(v, mv[j]), i === j ? 1 : 0, 0, 1e-8);
      }
    }
    cases.push({ name, modal: result.modal, staticNodes: result.modal ? undefined : result.nodes });
    return result;
  };
  const project = modalCantilever(), section = project.sections[0], material = project.materials[0];
  const E = 200e9, G = E / (2 * 1.3), L = 3, baseLine = 157;
  const base = solve("structure-only", project);
  const lineProject = p.updateMember(project, project.members[0].id, { additionalLineMassKgM: 157 });
  const line = solve("equal-added-line-mass", lineProject);
  near("line:structural", line.modal.structuralMassKg, 471, 1e-12);
  near("line:additional", line.modal.additionalMassKg, 471, 1e-12);
  near("line:total", line.modal.totalMassKg, 942, 1e-12);
  const frequency = (beta, inertia, massPerLength) => beta ** 2 / (2 * Math.PI * L ** 2) * Math.sqrt(E * inertia / massPerLength);
  const betas = [1.875104068711961, 4.694091132974175, 7.854757438237612];
  const expected = [...betas.flatMap((b) => [frequency(b, section.secondMomentYM4, 314), frequency(b, section.secondMomentZM4, 314)]),
    ...[1, 3, 5].map((n) => n / (4 * L) * Math.sqrt(G * section.torsionalConstantM4 / (7850 * (section.secondMomentYM4 + section.secondMomentZM4)))),
    ...[1, 3].map((n) => n / (4 * L) * Math.sqrt(E * section.areaM2 / 314))].sort((x, y) => x - y);
  for (let i = 0; i < 6; i++) near(`line:continuum:${i}`, line.modal.modes[i].frequencyHz, expected[i]);
  // Independent continuous cantilever with a translational tip mass.
  const tipRoot = (mu) => {
    const equation = (b) => 1 + Math.cosh(b) * Math.cos(b) + mu * b * (Math.sinh(b) * Math.cos(b) - Math.cosh(b) * Math.sin(b));
    let low = .001, high = betas[0]; assert.ok(equation(low) > 0 && equation(high) <= 1e-12);
    for (let i = 0; i < 80; i++) { const mid = (low + high) / 2; if (equation(mid) > 0) low = mid; else high = mid; }
    return (low + high) / 2;
  };
  const tipProject = p.setNodeMass(project, project.nodes[1].id, 471), tip = solve("tip-point-mass", tipProject), root = tipRoot(1);
  near("tip:mass", tip.modal.totalMassKg, 942, 1e-12);
  near("tip:weak-frequency", tip.modal.modes[0].frequencyHz, frequency(root, section.secondMomentZM4, baseLine));
  near("tip:strong-frequency", tip.modal.modes[1].frequencyHz, frequency(root, section.secondMomentYM4, baseLine));
  assert.ok(tip.modal.modes[0].frequencyHz < base.modal.modes[0].frequencyHz);
  const sigma = (Math.cosh(root) + Math.cos(root)) / (Math.sinh(root) + Math.sin(root));
  const shape = Array.from({ length: 17 }, (_, i) => Math.cosh(root * i / 16) - Math.cos(root * i / 16) - sigma * (Math.sinh(root * i / 16) - Math.sin(root * i / 16)));
  const actualShape = tip.modal.modes[0].members[0].samples.map((s) => s.translation.y);
  const dot = (x, y) => x.reduce((sum, v, i) => sum + v * y[i], 0);
  near("tip:continuous-shape-correlation", Math.abs(dot(shape, actualShape)) / Math.sqrt(dot(shape, shape) * dot(actualShape, actualShape)), 1, 1e-6);
  const referenceTipFrequency = frequency(root, section.secondMomentZM4, baseLine);
  const tipErrors = tip.modal.convergence.runs.map((r) => Math.abs(r.frequenciesHz[0] / referenceTipFrequency - 1));
  assert.ok(tipErrors.at(-1) < tipErrors[0]); checks.push({ name: "tip:mesh-convergence", relativeErrors: tipErrors });
  const mixedProject = p.setNodeMass(lineProject, project.nodes[1].id, 471), mixed = solve("point-and-line", mixedProject);
  near("mixed:mass", mixed.modal.totalMassKg, 1413, 1e-12);
  near("mixed:frequency", mixed.modal.modes[0].frequencyHz, frequency(tipRoot(.5), section.secondMomentZM4, 314));
  const weighted = solve("self-weight-enabled", p.updateSelfWeight(mixedProject, { ...mixedProject.selfWeight, enabled: true }));
  assert.deepEqual(weighted.modal, mixed.modal);
  const fixedMass = solve("point-on-fixed-node", p.setNodeMass(project, project.nodes[0].id, 100));
  near("fixed-node:total", fixedMass.modal.totalMassKg, 571, 1e-12);
  for (let i = 0; i < 6; i++) near(`fixed-node:frequency:${i}`, fixedMass.modal.modes[i].frequencyHz, base.modal.modes[i].frequencyHz, 1e-10);
  const splitProject = applyProjectEdits(mixedProject, [{ type: "split_member", memberIds: [project.members[0].id], position: { x: 1, y: 0, z: 0 } }]).project;
  const split = solve("engineering-split", splitProject);
  near("split:mass", split.modal.totalMassKg, 1413, 1e-12);
  near("split:frequency", split.modal.modes[0].frequencyHz, frequency(tipRoot(.5), section.secondMomentZM4, 314));
  const rotatedProject = p.updateMember(p.updateNode(mixedProject, project.nodes[1].id, { x: 0, y: 0, z: 3 }), project.members[0].id, { rotationDegrees: 33 });
  const rotated = solve("rotated-vertical-axis", rotatedProject);
  for (let i = 0; i < 6; i++) near(`rotated:frequency:${i}`, rotated.modal.modes[i].frequencyHz, mixed.modal.modes[i].frequencyHz, 1e-8);
  let pinProject = p.updateMember(lineProject, project.members[0].id, { endReleases: { start: { my: true, mz: true }, end: { my: true, mz: true } } });
  pinProject = { ...pinProject, supports: [{ ...pinProject.supports[0], restraints: [true, true, true, true, false, false] }] };
  pinProject = p.addSupport(pinProject, project.nodes[1].id, [false, true, true, true, false, false]);
  const pinSix = solve("released-pinned-six-budget-stop", pinProject, "budget-exhausted");
  assert.equal(pinSix.modal.convergence.reason, "max-divisions");
  // This release reference validates the first three modes; higher requested
  // modes require a separate sufficient-modes study under T2-29.
  pinProject = p.updateAnalysisCase(pinProject, "AC1", { ...pinProject.analysisCases[0], settings: { solver: "native-modal", modal: { ...pinProject.analysisCases[0].settings.modal, modeCount: 3 } } });
  const pin = solve("released-pinned-line-mass", pinProject);
  near("pin:weak-frequency", pin.modal.modes[0].frequencyHz, frequency(Math.PI, section.secondMomentZM4, 314));
  assert.equal(pin.modal.counts.releaseCoordinates, 4);
  const staticProject = p.selectAnalysisCase(p.addAnalysisCase(project, { name: "static", method: "static", loadSourceId: "LC1", settings: { solver: "native-static" } }), "AC2");
  const linear = solve("static-before-mass", staticProject);
  const massStatic = p.setNodeMass(p.updateMember(staticProject, project.members[0].id, { additionalLineMassKgM: 157 }), project.nodes[1].id, 471);
  const linearAfter = solve("static-after-mass", massStatic);
  assert.deepEqual(linearAfter.nodes, linear.nodes); assert.deepEqual(linearAfter.members, linear.members);
  assert.equal(a.isAnalysisResultCurrent(massStatic, linear), true);
  const selfWeightStatic = p.updateSelfWeight(staticProject, { ...staticProject.selfWeight, enabled: true });
  const sw = solve("static-self-weight", selfWeightStatic);
  const swMass = solve("static-self-weight-with-additional", p.setNodeMass(p.updateMember(selfWeightStatic, project.members[0].id, { additionalLineMassKgM: 157 }), project.nodes[1].id, 471));
  assert.deepEqual(swMass.nodes, sw.nodes); assert.deepEqual(swMass.members, sw.members);
  for (const [name, collection, field, value] of [["negative-point", "nodes", "additionalMassKg", -1], ["nonscalar-point", "nodes", "additionalMassKg", { x: 1 }], ["negative-line", "members", "additionalLineMassKgM", -1], ["nonfinite-line", "members", "additionalLineMassKgM", null]]) {
    const terminal = packet(project, (r) => { r.input[collection][0][field] = value; });
    assert.equal(terminal.kind, "error"); assert.equal(terminal.error.stage, "model-check");
    assert.equal(terminal.error.diagnostics[0].field, field); failures.push({ name, diagnostic: terminal.error });
  }
  const overflow = packet(project, (r) => { r.input.members[0].additionalLineMassKgM = 1e308; });
  assert.equal(overflow.kind, "error"); failures.push({ name: "derived-mass-overflow", diagnostic: overflow.error });
  const evidence = resolve("docs/evidence/plan2/T2-28"); await mkdir(evidence, { recursive: true });
  await writeFile(resolve(evidence, "numerics.json"), JSON.stringify({ passed: true, reference: "ADR-0061 continuous EB tip-mass boundary determinant and uniform-line formulas", tipRoot: root, caseCount: cases.length, checkCount: checks.length, failureCount: failures.length, cases, checks, failures }, null, 2));
  await writeFile(resolve(evidence, "point-and-line.framemind"), encodeProject(p.attachAnalysisResult(mixedProject, mixed)));
  console.log(JSON.stringify({ passed: true, cases: cases.length, checks: checks.length, failures: failures.length, tipRoot: root, tipFrequencyHz: referenceTipFrequency }));
} finally { await server.close(); }
