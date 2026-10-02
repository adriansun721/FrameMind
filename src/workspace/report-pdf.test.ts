import { expect, it } from "vitest";
import JSZip from "jszip";
import { captureEngineeringReport } from "../domain/engineering-report";
import { reportFixture } from "../domain/engineering-report.fixture";
import { buildReportPdfHtml } from "./report-pdf";
import { buildReportWord } from "./report-word";
import { addMember, addNode, attachAnalysisResult } from "../domain/project";
import { solveFrame } from "../domain/analysis";
import { createPerformanceModel, PERFORMANCE_MODELS } from "../validation/performance-models";

it("bounds large print batches while preserving all rows and attaching captions to their tables", () => {
  const model = createPerformanceModel(PERFORMANCE_MODELS[1]);
  const project = attachAnalysisResult(model, solveFrame(model));
  const report = captureEngineeringReport(project, project.analysisResults[0].id, { memberIds: [], steps: ["dof-mapping", "constraints"] });
  const html = buildReportPdfHtml(report);
  const parts = html.split("<!--FRAMEMIND_PRINT_PART-->");
  expect(parts.length).toBeGreaterThan(2);
  for (const part of parts) {
    const document = new DOMParser().parseFromString(part, "text/html");
    expect(document.querySelectorAll("td,th").length).toBeLessThanOrEqual(6000);
    for (const table of document.querySelectorAll("table")) expect(table.querySelectorAll("tbody tr").length).toBeLessThanOrEqual(150);
    const last = document.body.lastElementChild;
    if (last?.matches("p.caption,h1,h2")) throw new Error("Orphaned print heading or caption");
  }
  for (const value of ["node_0196", "member_0399", "1175", report.result.id]) expect(html).toContain(value);
});

it("exports the same frozen combination and selected process content in PDF and Word", async () => {
  const project = reportFixture(true);
  const report = captureEngineeringReport(project, project.analysisResults[0].id, { memberIds: ["member_0001"], steps: ["member-process", "constraints"] });
  const html = buildReportPdfHtml(report);
  const zip = await JSZip.loadAsync(await buildReportWord(report, async () => new Uint8Array([1])));
  const xml = await zip.file("word/document.xml")!.async("string");
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const text of Array.from(document.querySelectorAll("h1,h2,p,th,td,figcaption"), (element) => element.textContent!)) {
    expect(xml).toContain(text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"));
  }
  for (const value of [report.result.id, "0.00003", "500000", "-0.5", "4.62051", "附录 A", "阎军、杨春秋"]) expect(document.body.textContent).toContain(value);
  expect(document.body.textContent).not.toContain("整体刚度矩阵 K ·");
  expect(document.querySelectorAll("img")).toHaveLength(2);
});

it("omits crowded model labels while retaining their identities in the report tables", () => {
  let project = reportFixture();
  for (let index = 0; index < 18; index++) {
    project = addNode(project, { x: 4 + index, y: 1, z: 1 });
    project = addMember(project, { startNodeId: project.nodes[0].id, endNodeId: project.nodes.at(-1)!.id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
  }
  project = attachAnalysisResult(project, solveFrame(project));
  const report = captureEngineeringReport(project, project.analysisResults.at(-1)!.id);
  const doc = new DOMParser().parseFromString(buildReportPdfHtml(report), "text/html");
  const model = new DOMParser().parseFromString(decodeURIComponent(doc.images[0].src.split(",")[1]), "image/svg+xml");
  const labels = Array.from(model.querySelectorAll("text"), (element) => element.textContent ?? "").filter((text) => /^[MN]\d+$/.test(text));
  expect(labels.length).toBeLessThan(15);
  expect(doc.body.textContent).toContain("member_0019");
  expect(model.documentElement.textContent).toContain("拥挤时省略");
});

it("keeps complete long resource names in tables and escapes document markup", () => {
  const initial = reportFixture();
  const label = "中文材料名称用于检查跨行表格保留完整名称".repeat(3);
  const name = '<script>alert("input")</script> & 长名称';
  const changed = { ...initial, name, materials: initial.materials.map((material) => ({ ...material, name: label })) };
  const project = attachAnalysisResult(changed, solveFrame(changed));
  const report = captureEngineeringReport(project, project.analysisResults.at(-1)!.id);
  const doc = new DOMParser().parseFromString(buildReportPdfHtml(report), "text/html");
  expect(doc.querySelector("script")).toBeNull();
  expect(doc.querySelector("h1")!.textContent).toContain(name);
  expect(Array.from(doc.querySelectorAll("td"), (cell) => cell.textContent)).toContain(label);
});
