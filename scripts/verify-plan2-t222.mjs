import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "vite";

const directory = "docs/evidence/plan2/T2-22";
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { SECTION_REFERENCES, sectionCantilever } = await server.ssrLoadModule("/src/validation/section-fixtures.ts");
  const { captureAnalysisInput, NATIVE_STATIC_SOLVER, isAnalysisResultCurrent } = await server.ssrLoadModule("/src/domain/analysis.ts");
  const { createAnalysisRequest } = await server.ssrLoadModule("/src/domain/analysis-service.ts");
  const { decodeAnalysisResult, decodeProject, encodeProject } = await server.ssrLoadModule("/src/domain/project-file.ts");
  const { updateSection, attachAnalysisResult } = await server.ssrLoadModule("/src/domain/project.ts");
  const { compareAnalysisResults } = await server.ssrLoadModule("/src/domain/analysis-comparison.ts");
  const checks = [], results = [];
  // Pre-registered relative numerical tolerance 1e-9; near-zero absolute tolerance 1e-12.
  const near = (id, actual, expected) => {
    const tolerance = Math.max(1e-12, Math.abs(expected) * 1e-9);
    assert.ok(Math.abs(actual - expected) <= tolerance, `${id}: ${actual} vs ${expected}`);
    checks.push({ id, actual, expected, tolerance, passed: true });
  };
  const solve = (p) => {
    const request = createAnalysisRequest({ ...captureAnalysisInput(p), solver: NATIVE_STATIC_SOLVER });
    const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, child.stdout + child.stderr);
    const terminal = child.stdout.trim().split("\n").map(JSON.parse).at(-1);
    assert.equal(terminal.kind, "result", JSON.stringify(terminal));
    return decodeAnalysisResult(terminal.result);
  };
  for (const { geometry, expected: [a, iy, iz, j] } of SECTION_REFERENCES) {
    for (const angle of [0, 90, 30]) {
      const p = sectionCantilever(geometry, angle), result = solve(p), tip = result.nodes[1];
      // Independent EB compliance rotated by R diag(Cy,Cz) R^T. E=200e6 kN/m²,
      // G=E/(2*(1+.3)), L=3 m; Fx=4, Fy=5, Fz=-10 kN and Tx=2 kN·m.
      const c = Math.cos(angle * Math.PI / 180), s = Math.sin(angle * Math.PI / 180);
      const cy = 27 / (3 * 200e6 * iz), cz = 27 / (3 * 200e6 * iy);
      near(`${geometry.shape}-${angle}-ux-FL/EA`, tip.displacement.x, 12 / (200e6 * a));
      near(`${geometry.shape}-${angle}-uy-rotated`, tip.displacement.y, (c*c*cy+s*s*cz)*5+c*s*(cy-cz)*-10);
      near(`${geometry.shape}-${angle}-uz-rotated`, tip.displacement.z, c*s*(cy-cz)*5+(s*s*cy+c*c*cz)*-10);
      near(`${geometry.shape}-${angle}-rx-TL/GJ`, tip.rotation.x, 6 / (200e6 / 2.6 * j));
      near(`${geometry.shape}-${angle}-force-x`, result.nodes[0].reaction.x, -4);
      near(`${geometry.shape}-${angle}-force-y`, result.nodes[0].reaction.y, -5);
      near(`${geometry.shape}-${angle}-force-z`, result.nodes[0].reaction.z, 10);
      near(`${geometry.shape}-${angle}-moment-x`, result.nodes[0].reactionMoment.x, -2);
      near(`${geometry.shape}-${angle}-moment-y`, result.nodes[0].reactionMoment.y, -30);
      near(`${geometry.shape}-${angle}-moment-z`, result.nodes[0].reactionMoment.z, -15);
      assert.deepEqual(result.input.sections[0].geometry, geometry);
      const saved = attachAnalysisResult(p, result);
      assert.equal(isAnalysisResultCurrent(saved, result), true);
      assert.deepEqual(decodeProject(encodeProject(saved)).latestAnalysis, result);
      results.push(result);
    }
  }
  const p = sectionCantilever(), before = solve(p);
  const edited = updateSection(attachAnalysisResult(p, before), p.sections[0].id, { name: "width doubled", geometry: { shape: "rectangle", width: .4, height: .4 } });
  assert.equal(isAnalysisResultCurrent(edited, before), false);
  const after = solve(edited), comparison = compareAnalysisResults(before, after);
  assert.equal(comparison.compatible, true);
  near("dimension-edit-uz-halved", after.nodes[1].displacement.z, before.nodes[1].displacement.z / 2);
  near("dimension-edit-uy-one-eighth", after.nodes[1].displacement.y, before.nodes[1].displacement.y / 8);
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/native-verification.json`, JSON.stringify({ passed: true, solver: NATIVE_STATIC_SOLVER,
    references: SECTION_REFERENCES, checks, results, comparison, staleAfterDimensionEdit: true,
    conventions: "Idealized symmetric sections; source SCI P385 Appendix B.2; EB FL/EA, PL³/3EI, TL/GJ. Thin-wall approximations are not independent validation of real manufactured torsional constants." }, null, 2));
  console.log(`T2-22: ${checks.length} independent native checks passed; 15 shape/orientation solves plus edit/recompute`);
} finally { await server.close(); }
