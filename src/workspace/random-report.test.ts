// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { decodeProject } from "../domain/project-file";
import { captureEngineeringReport, withSupplementalReportProcess } from "../domain/engineering-report";
import { updateNode } from "../domain/project";
import { createReportContent } from "./report-content";
import { buildRandomReportData } from "./random-report-data";
import { buildReportPdfHtml } from "./report-pdf";
import { buildReportWord } from "./report-word";
import type { ReportBlock } from "./report-content-blocks";

const fixture = (name: string) => decodeProject(readFileSync(`docs/evidence/plan2/T2-38/${name}.framemind`, "utf8"));
const csvRows = (value: string) => value.trim().split("\r\n").slice(1).map((row) => row.split(",").map((v) => v.replaceAll('"', "")));

describe("random engineering report and data public exports", () => {
  it.each(["force", "base", "multi"])("preserves %s frozen identity, reference frame and full precision PSD/RMS", async (name) => {
    const original = fixture(name), result = original.analysisResults.at(-1)!;
    const changed = updateNode(original, original.nodes[1].id, { x: 99, y: 0, z: 0 });
    changed.psdSpectra = []; changed.analysisCases = [];
    const report = captureEngineeringReport(changed, result.id);
    const zip = await JSZip.loadAsync(await buildRandomReportData(report));
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest).toMatchObject({ current: false, analysisId: result.id, referenceFrame: name === "force" ? "fixed-global" : "relative-to-base", responsePoints: result.random!.points.length });
    expect(JSON.parse(await zip.file("analysis.json")!.async("string"))).toEqual(JSON.parse(JSON.stringify(result)));
    const rows = csvRows(await zip.file("response.csv")!.async("string"));
    expect(rows).toHaveLength(result.random!.points.length);
    rows.forEach((row, i) => {
      expect(Number(row[6])).toBe(result.random!.points[i].frequencyHz);
      expect(Number(row[7])).toBe(result.random!.points[i].density);
      expect(Number(row[8])).toBe(result.random!.points[i].density * 1e6);
    });
    const rms = csvRows(await zip.file("rms.csv")!.async("string"))[0];
    expect(Number(rms[5])).toBe(result.random!.rms);
    expect(Number(rms[6])).toBe(result.random!.rms * 1000);
    expect(Number(rms[8])).toBe(result.random!.variance * 1e6);
    const input = csvRows(await zip.file(name === "force" ? "input-1.csv" : name === "base" ? "input-1.csv" : "input-2.csv")!.async("string"));
    expect(Number(input[0][5])).toBe(1);
    expect(Number(input[0][6])).toBe(1e6);
    expect(Object.isFrozen(report.result.input.randomBasis!.modal)).toBe(true);
    expect(report.result.input.nodes[1].position.x).toBe(3);
    expect(() => withSupplementalReportProcess(report, result)).toThrow(/只读取原运行/);
  });

  it("makes long-table omission explicit and exports full optional tables identically to Word and PDF", async () => {
    const project = fixture("long"), result = project.analysisResults.at(-1)!;
    const summary = captureEngineeringReport(project, result.id), full = captureEngineeringReport(project, result.id, { memberIds: [], steps: ["random-tables"] });
    const summaryTables = createReportContent(summary).filter((b): b is Extract<ReportBlock, { kind: "table" }> => b.kind === "table" && b.headers[0] === "原表索引");
    expect(summaryTables.map((t) => t.rows.length)).toEqual([32, 32]);
    expect(summaryTables[0].rows[16][0]).toBe(String(result.random!.points.length - 15));
    const fullTables = createReportContent(full).filter((b): b is Extract<ReportBlock, { kind: "table" }> => b.kind === "table" && b.headers[0] === "原表索引");
    expect(fullTables.map((t) => t.rows.length)).toEqual([result.random!.points.length, 257]);
    const zip = await JSZip.loadAsync(await buildReportWord(full, async () => new Uint8Array([1])));
    const xml = await zip.file("word/document.xml")!.async("string"), html = buildReportPdfHtml(full);
    for (const text of ["历史结果 已过期", "统计均方根", "mm²/Hz", "冻结模态", "完整频点附录", result.id]) { expect(xml).toContain(text); expect(html).toContain(text); }
    expect(html).not.toContain("最大节点位移幅值");
    expect(html).not.toContain("无节点集中荷载");
    expect(html).not.toContain("杆端局部内力 正值");
    const wordValues = new Set([...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]));
    const pdfValues = new Set([...html.matchAll(/<td>([^<]*)<\/td>/g)].map((m) => m[1]));
    for (const table of fullTables) for (const row of table.rows) for (const value of row) { expect(wordValues.has(value)).toBe(true); expect(pdfValues.has(value)).toBe(true); }
  }, 30000);

  it("records absent modal matrices explicitly and locates them by their original analysis ID", async () => {
    const project = fixture("missing"), result = project.analysisResults.at(-1)!;
    const report = captureEngineeringReport(project, result.id, { memberIds: [], steps: ["analysis-settings"] });
    const zip = await JSZip.loadAsync(await buildRandomReportData(report));
    const process = JSON.parse(await zip.file("process.json")!.async("string"));
    expect(process.find((p: { section: string }) => p.section === "mass").sourceAnalysisId).toBe(result.input.randomBasis!.modal.id);
    expect(process.find((p: { section: string }) => p.section === "mass")).toMatchObject({ available: false, items: [], origin: "not-recorded" });
    expect(JSON.parse(await zip.file("manifest.json")!.async("string")).missingRecords).toContainEqual(expect.objectContaining({ section: "mass" }));
  });
});
