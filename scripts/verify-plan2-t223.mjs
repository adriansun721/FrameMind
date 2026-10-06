import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "vite";

const directory = "docs/evidence/plan2/T2-23";
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { sectionCantilever } = await server.ssrLoadModule("/src/validation/section-fixtures.ts");
  const { captureAnalysisInput, NATIVE_STATIC_SOLVER, isAnalysisResultCurrent, solveFrame } = await server.ssrLoadModule("/src/domain/analysis.ts");
  const { createAnalysisRequest } = await server.ssrLoadModule("/src/domain/analysis-service.ts");
  const { decodeAnalysisResult, decodeProject, encodeProject } = await server.ssrLoadModule("/src/domain/project-file.ts");
  const { updateSection, attachAnalysisResult } = await server.ssrLoadModule("/src/domain/project.ts");
  const { getSectionCatalogEntry } = await server.ssrLoadModule("/src/domain/resource-library.ts");
  const { describeSection } = await server.ssrLoadModule("/src/domain/catalog-section.ts");
  const checks = [], results = [];
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
  // Independent transcriptions of N/AD/AI/AN in the original V2026-1 workbook.
  const references = [
    ["arcelor-ipe100", .00103, 1.71e-6, 1.591e-7, 1.157e-8],
    ["arcelor-ipe200", .00285, 1.943e-5, 1.423e-6, 6.915e-8],
    ["arcelor-hea200", .00538, 3.692e-5, 1.335e-5, 2.104e-7],
  ];
  for (const [id, a, iy, iz, j] of references) for (const angle of [0, 90, 30]) {
    const base = sectionCantilever(undefined, angle), p = updateSection(base, base.sections[0].id, getSectionCatalogEntry(id));
    const result = solve(p), tip = result.nodes[1];
    const c = Math.cos(angle * Math.PI / 180), s = Math.sin(angle * Math.PI / 180), cy = 27 / (3 * 200e6 * iz), cz = 27 / (3 * 200e6 * iy);
    near(`${id}-${angle}-ux-FL/EA`, tip.displacement.x, 12 / (200e6 * a));
    near(`${id}-${angle}-uy`, tip.displacement.y, (c*c*cy+s*s*cz)*5+c*s*(cy-cz)*-10);
    near(`${id}-${angle}-uz`, tip.displacement.z, c*s*(cy-cz)*5+(s*s*cy+c*c*cz)*-10);
    near(`${id}-${angle}-rx-TL/GJ`, tip.rotation.x, 6 / (200e6 / 2.6 * j));
    for (const [key, expected] of Object.entries({ x: -4, y: -5, z: 10 })) near(`${id}-${angle}-reaction-${key}`, result.nodes[0].reaction[key], expected);
    for (const [key, expected] of Object.entries({ x: -2, y: -30, z: -15 })) near(`${id}-${angle}-reaction-moment-${key}`, result.nodes[0].reactionMoment[key], expected);
    assert.deepEqual(result.input.sections[0].catalogBasis, p.sections[0].catalogBasis);
    assert.deepEqual(decodeProject(encodeProject(attachAnalysisResult(p, result))).latestAnalysis, result);
    assert.equal(isAnalysisResultCurrent(p, result), true);
    results.push(result);
  }
  let legacy = sectionCantilever(); legacy = updateSection(legacy, legacy.sections[0].id, { name: "IPE 200", areaM2: .02, secondMomentYM4: .0001, secondMomentZM4: .0002, torsionalConstantM4: .0003 });
  const oldResult = solveFrame(legacy), historical = attachAnalysisResult(legacy, oldResult), oldFile = JSON.parse(encodeProject(historical)); oldFile.formatVersion = 1;
  const restored = decodeProject(JSON.stringify(oldFile));
  assert.deepEqual(JSON.parse(JSON.stringify(restored.latestAnalysis)), JSON.parse(JSON.stringify(oldResult))); assert.equal(isAnalysisResultCurrent(restored, oldResult), true);
  assert.equal(describeSection(restored.sections[0]).geometryStatus, "几何未定义");
  const fresh = solve(restored);
  for (const [key, expected] of Object.entries({ x: 12 / (200e6 * .02), y: 135 / (3 * 200e6 * .0002), z: -270 / (3 * 200e6 * .0001) })) near(`legacy-native-${key}`, fresh.nodes[1].displacement[key], expected);
  near("legacy-native-rx", fresh.nodes[1].rotation.x, 6 / (200e6 / 2.6 * .0003));
  const supplemented = updateSection(restored, restored.sections[0].id, getSectionCatalogEntry("arcelor-ipe200"));
  assert.equal(isAnalysisResultCurrent(supplemented, oldResult), false); assert.deepEqual(supplemented.latestAnalysis, restored.latestAnalysis);
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/native-verification.json`, JSON.stringify({ passed: true, solver: NATIVE_STATIC_SOLVER, references, checks, results, legacy: { restored, fresh, supplementationInvalidatesResult: true },
    conventions: "EB cantilever L=3 m, E=200 GPa, nu=.3; Fx=4,Fy=5,Fz=-10 kN, Tx=2 kNm. Reference catalog mechanics, not idealized geometry; tolerance max(1e-12,abs(reference)*1e-9)." }, null, 2));
  console.log(`T2-23: ${checks.length} native reference checks passed; 9 catalog/orientation solves and legacy migration solve`);
} finally { await server.close(); }
