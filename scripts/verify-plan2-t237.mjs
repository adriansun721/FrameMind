import { createServer } from "vite";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const evidence = "docs/evidence/plan2/T2-37";
const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
try {
  const load = (path) => server.ssrLoadModule(`/src/${path}.ts`);
  const p = await load("domain/project"), a = await load("domain/analysis");
  const { createAnalysisRequest } = await load("domain/analysis-service");
  const { decodeAnalysisResult, decodeProject, encodeProject } = await load("domain/project-file");
  const { captureEngineeringReport } = await load("domain/engineering-report");
  const { reportAppendixSteps } = await load("domain/report-appendix");
  const { createReportContent } = await load("workspace/report-content");
  const { modalCantilever } = await load("validation/modal-fixtures");
  const { secondOrderColumn } = await load("validation/second-order-fixtures");
  const { bucklingColumn } = await load("validation/buckling-fixtures");
  const { reportFixture } = await load("domain/engineering-report.fixture");
  const { DEFAULT_MODAL_SETTINGS } = await load("domain/modal");
  const solve = (project) => {
    const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(createAnalysisRequest(a.captureAnalysisInput(project))), encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
    if (child.error) throw child.error;
    const terminal = JSON.parse(child.stdout.trim().split("\n").at(-1));
    assert.equal(terminal.kind, "result", JSON.stringify(terminal.error));
    return p.attachAnalysisResult(project, decodeAnalysisResult(terminal.result));
  };
  let modal = modalCantilever({ ...DEFAULT_MODAL_SETTINGS, modeCount: 2 });
  modal = p.setNodeMass(modal, modal.nodes[1].id, 100);
  modal = p.updateMember(modal, modal.members[0].id, { additionalLineMassKgM: 50 });
  let missing = modalCantilever({ ...DEFAULT_MODAL_SETTINGS, frequencyTolerance: 1e-8 });
  for (let i = 1; i <= 2; i++) {
    missing = p.addNode(missing, { x: 3, y: i, z: 0 });
    missing = p.addMember(missing, { startNodeId: missing.nodes[0].id, endNodeId: missing.nodes.at(-1).id, materialId: missing.materials[0].id, sectionId: missing.sections[0].id, rotationDegrees: 0 });
  }
  const reuse = process.argv.includes("--reuse-fixtures");
  const samples = reuse ? Object.fromEntries(await Promise.all(["static", "combination", "modal", "buckling", "second-order", "missing"].map(async (name) => [name, decodeProject(await readFile(`${evidence}/${name}.framemind`, "utf8"))])))
    : { static: reportFixture(), combination: reportFixture(true), modal: solve(modal), buckling: solve(bucklingColumn(30)), "second-order": solve(secondOrderColumn(100, .1)), missing: solve(missing) };
  await mkdir(evidence, { recursive: true });
  const checks = [];
  for (const [name, original] of Object.entries(samples)) {
    const result = original.analysisResults.at(-1);
    const project = reuse ? original : p.updateNode(original, original.nodes[1].id, { ...original.nodes[1].position, x: 8 });
    const selection = { memberIds: [result.input.members[0].id], steps: reportAppendixSteps(result) };
    const report = captureEngineeringReport(project, result.id, selection);
    assert.equal(report.current, false);
    assert.deepEqual(JSON.parse(JSON.stringify(report.result.input)), JSON.parse(JSON.stringify(result.input)));
    assert.ok(Object.isFrozen(report.result));
    const blocks = createReportContent(report);
    const content = JSON.stringify(blocks);
    assert.ok(content.includes(result.id)); assert.ok(content.includes("历史结果"));
    if (result.modal || result.buckling) {
      assert.ok(!content.includes("最大节点位移幅值"));
      const modes = result.modal?.modes ?? result.buckling.modes;
      for (const mode of modes) assert.ok(content.includes(Number((mode.frequencyHz ?? mode.factor).toPrecision(7)).toString()));
    }
    if (name === "modal") assert.ok(Math.abs(result.modal.totalMassKg - 721) < 1e-9);
    if (name === "missing") { assert.equal(result.modal.eigenproblem.mass, null); assert.ok(report.appendix.missing.length >= 2); }
    if (!reuse) await writeFile(`${evidence}/${name}.framemind`, encodeProject(project));
    await writeFile(`${evidence}/${name}-content.json`, JSON.stringify(blocks, null, 2));
    checks.push({ name, analysisId: result.id, revision: result.projectRevision, current: report.current, method: result.input.analysisCase?.method ?? "static", appendix: selection.steps, missing: report.appendix?.missing ?? [],
      numbers: result.modal ? { massKg: result.modal.totalMassKg, frequenciesHz: result.modal.modes.map((m) => m.frequencyHz) } : result.buckling ? { factors: result.buckling.modes.map((m) => m.factor) } : { nodes: result.nodes } });
  }
  await writeFile(`${evidence}/verification.json`, JSON.stringify({ passed: true, checks, frozenInputs: true, nativeSavedRecords: true, recalculatedForAppendix: false }, null, 2));
  console.log("T2-37: six frozen report fixtures and original numerical/appendix correspondence passed.");
} finally { await server.close(); }
