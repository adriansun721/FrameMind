import { createServer } from "vite";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import JSZip from "jszip";

const evidence = "docs/evidence/plan2/T2-38";
const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
try {
  const load = (p) => server.ssrLoadModule(`/src/${p}.ts`);
  const p = await load("domain/project"), a = await load("domain/analysis");
  const { decodeProject, decodeAnalysisResult, encodeProject } = await load("domain/project-file");
  const { createAnalysisRequest } = await load("domain/analysis-service");
  const { DEFAULT_RANDOM_ACCURACY } = await load("domain/random-response");
  const { setModalDamping } = await load("domain/modal-damping");
  const { captureEngineeringReport } = await load("domain/engineering-report");
  const { createReportContent } = await load("workspace/report-content");
  const { buildRandomReportData } = await load("workspace/random-report-data");
  const { captureAiSnapshot, executeAiTool } = await load("workspace/ai-tools");
  const prepared = decodeProject(await readFile("docs/evidence/plan2/T2-35/prepared.framemind", "utf8"));
  const force = { kind: "node", nodeId: prepared.nodes[1].id, direction: { x: 0, y: 1, z: 0 }, scale: 1 };
  const distributed = { kind: "member-uniform", memberId: prepared.members[0].id, direction: { x: 0, y: 1, z: 0 }, scalePerM: .5 };
  const base = { kind: "base-translation", direction: { x: 0, y: 1, z: 0 }, scale: 1 };
  const source = (id, psd, actions) => ({ sourceId: id, psdSpectrumId: psd, actions });
  const samples = {
    force: [source("force", "PSD2", [force])],
    base: [source("base", "PSD1", [base])],
    multi: [source("base", "PSD1", [base]), source("force", "PSD2", [force, distributed])],
    long: [source("force", "PSD2", [force])],
    missing: [source("force", "PSD2", [force])],
  };
  await mkdir(evidence, { recursive: true });
  const checks = [];
  for (const [name, sources] of Object.entries(samples)) {
    let project = structuredClone(prepared);
    if (name === "missing") {
      project = p.addNode(project, { x: 3, y: 1, z: 0 });
      project = p.addMember(project, { startNodeId: project.nodes[0].id, endNodeId: project.nodes.at(-1).id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
      const definition = project.analysisCases[0];
      definition.settings.modal = { ...definition.settings.modal, maxDivisions: 16, frequencyTolerance: 1e-4 };
      const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(createAnalysisRequest(a.captureAnalysisInput(project))), encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
      if (child.error) throw child.error;
      const message = JSON.parse(child.stdout.trim().split("\n").at(-1));
      assert.equal(message.kind, "result", JSON.stringify(message.error));
      project = p.attachAnalysisResult(project, decodeAnalysisResult(message.result));
      assert.equal(project.latestAnalysis.modal.eigenproblem.mass, null);
      project = setModalDamping(project, definition.id, project.latestAnalysis.id, { uniform: { ratio: .02, source: "user", basis: "T2-38 missing-matrix report fixture" }, overrides: [], truncation: { upperFrequencyHz: 25, modeIncrement: 2, maxModeCount: 6 } });
    }
    if (name === "long") {
      project.psdSpectra[1].points = Array.from({ length: 257 }, (_, i) => ({ frequency: 25 * i / 256, density: 1 }));
    }
    project = p.selectAnalysisCase(p.addAnalysisCase(project, { name: `${name} random report`, method: "random", loadSourceId: "random", settings: { solver: "native-random", random: {
      ...DEFAULT_RANDOM_ACCURACY, modalAnalysisId: project.latestAnalysis.id, sourceRelationship: "independent", sources,
      response: { nodeId: project.nodes[1].id, component: "y" }, bandHz: [0, 25], ...(name === "long" ? { frequencyPoints: 257 } : {}),
    } } }), "AC2");
    const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(createAnalysisRequest(a.captureAnalysisInput(project))), encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
    if (child.error) throw child.error;
    const message = JSON.parse(child.stdout.trim().split("\n").at(-1));
    assert.equal(message.kind, "result", JSON.stringify(message.error));
    const result = decodeAnalysisResult(message.result);
    project = p.attachAnalysisResult(project, result);
    const ref = executeAiTool(captureAiSnapshot(project, []), { id: "rms", type: "function", function: { name: "read_result", arguments: JSON.stringify({ kind: "node", id: result.random.response.nodeId, quantity: "rms", component: "y", outputUnitPreset: "mm-N" }) } });
    assert.equal(ref.status, "completed");
    assert.equal(ref.reference.value, result.random.rms);
    const curve = executeAiTool(captureAiSnapshot(project, []), { id: "psd", type: "function", function: { name: "read_results", arguments: JSON.stringify({ collection: "psd", offset: 0, limit: 100, outputUnitPreset: "mm-N" }) } });
    assert.equal(curve.status, "completed");
    curve.data.items.forEach((item, i) => {
      assert.equal(item.frequencyHz, result.random.points[i].frequencyHz);
      assert.equal(item.density, result.random.points[i].density * 1e6);
      assert.equal(item.densityUnit, "mm²/Hz");
    });
    project = p.updateNode(project, project.nodes[1].id, { x: 8, y: 0, z: 0 });
    project.displayUnitPreset = "mm-N";
    const selection = { memberIds: [], steps: name === "long" ? ["random-tables"] : ["analysis-settings"] };
    const report = captureEngineeringReport(project, result.id, selection);
    assert.equal(report.current, false);
    const blocks = createReportContent(report), content = JSON.stringify(blocks);
    assert.ok(content.includes("历史结果")); assert.ok(content.includes("mm²/Hz"));
    assert.ok(!content.includes("最大节点位移幅值"));
    const bytes = await buildRandomReportData(report), zip = await JSZip.loadAsync(bytes);
    const frozen = JSON.parse(await zip.file("analysis.json").async("string"));
    assert.deepEqual(frozen, JSON.parse(JSON.stringify(result)));
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    assert.equal(manifest.responsePoints, result.random.points.length);
    const rows = (await zip.file("response.csv").async("string")).trim().split("\r\n");
    assert.equal(rows.length, result.random.points.length + 1);
    let area = 0;
    result.random.points.forEach((point, i) => {
      const values = rows[i + 1].split(",").map((v) => v.replaceAll('"', ""));
      assert.equal(Number(values[6]), point.frequencyHz);
      assert.equal(Number(values[7]), point.density);
      assert.equal(Number(values[8]), point.density * 1e6);
      if (i) { const prev = result.random.points[i - 1]; area += (prev.density + point.density) / 2 * (point.frequencyHz - prev.frequencyHz); }
    });
    assert.ok(Math.abs(Math.sqrt(area) / result.random.rms - 1) < 1e-12);
    await writeFile(`${evidence}/${name}.framemind`, encodeProject(project));
    await writeFile(`${evidence}/${name}.zip`, bytes);
    await writeFile(`${evidence}/${name}-content.json`, JSON.stringify(blocks, null, 2));
    checks.push({ name, analysisId: result.id, modalAnalysisId: result.input.randomBasis.modal.id, revision: result.projectRevision, points: result.random.points.length, inputPoints: manifest.spectra.map((s) => s.points), rmsM: result.random.rms, current: false, referenceFrame: manifest.referenceFrame, zipBytes: bytes.length, rmsReference: ref.reference });
  }
  await writeFile(`${evidence}/verification.json`, JSON.stringify({ passed: true, checks, fullPrecisionCsv: true, frozenSource: true, trapezoidalRmsChecked: true }, null, 2));
  console.log("T2-38: five native random report/data fixtures verified.");
} finally { await server.close(); }
