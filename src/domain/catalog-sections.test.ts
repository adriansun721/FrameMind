import { expect, it } from "vitest";
import { addSection, attachAnalysisResult, createProject, updateSection } from "./project";
import { decodeProject, encodeProject } from "./project-file";
import { getSectionCatalogEntry, SECTION_CATALOG } from "./resource-library";
import { describeSection, idealizedCatalogComparison } from "./catalog-section";
import { sectionCantilever } from "../validation/section-fixtures";
import { isAnalysisResultCurrent, solveFrame } from "./analysis";
import { captureAiSnapshot, executeAiTool } from "../workspace/ai-tools";
import { ModelEditConfirmation, prepareModelEditConfirmation } from "../workspace/model-edits";
import { persistTaskState, type ConversationHistory } from "../workspace/task-persistence";
import { captureEngineeringReport } from "./engineering-report";
import { createReportContent } from "../workspace/report-content";
import { decodeSharedResourceLibrary } from "./shared-resource-library";
import { buildReportWord } from "../workspace/report-word";
import { buildReportPdfHtml } from "../workspace/report-pdf";
import JSZip from "jszip";

const call = (name: string, args: unknown) => ({ id: "catalog", type: "function" as const, function: { name, arguments: JSON.stringify(args) } });

it.each([
  ["arcelor-ipe100", .1, .055, .0041, .0057, .007, .00103, 1.71e-6, 1.591e-7, 1.157e-8],
  ["arcelor-ipe200", .2, .1, .0056, .0085, .012, .00285, 1.943e-5, 1.423e-6, 6.915e-8],
  ["arcelor-hea200", .19, .2, .0065, .01, .018, .00538, 3.692e-5, 1.335e-5, 2.104e-7],
] as const)("preserves independently transcribed V2026-1 source dimensions and mechanics for %s", (id, h, b, tw, tf, r, a, iy, iz, j) => {
  const s = addSection(createProject(), getSectionCatalogEntry(id)!).sections[0];
  expect(s.geometry?.shape).toBe("i-section");
  if (s.geometry?.shape !== "i-section") throw new Error("Expected catalog I/H geometry");
  [s.geometry.height, s.geometry.width, s.geometry.webThickness, s.geometry.flangeThickness].forEach((value, i) => expect(value).toBeCloseTo([h, b, tw, tf][i], 14));
  expect([s.areaM2, s.secondMomentYM4, s.secondMomentZM4, s.torsionalConstantM4]).toEqual([a, iy, iz, j]);
  expect(s.catalogBasis?.rootRadiusM).toBe(r);
  expect(s.catalogBasis?.location).toContain("EN sections!");
  expect(s.parameterBasis).toBeUndefined();
  expect(idealizedCatalogComparison(s.geometry!).properties.areaM2).not.toBe(a);
  expect(idealizedCatalogComparison(s.geometry!).properties.torsionalConstantM4).not.toBe(j);
});

it("retains a frozen catalog row on reopen and blocks inconsistent edits or corrupt source metadata", () => {
  const p = addSection(createProject(), SECTION_CATALOG[0]);
  expect(decodeProject(encodeProject(p)).sections).toEqual(p.sections);
  expect(decodeSharedResourceLibrary(JSON.stringify({ version: 1, materials: [], sections: [{ ...p.sections[0], libraryId: "copy" }] })).sections[0].catalogBasis).toEqual(p.sections[0].catalogBasis);
  expect(() => updateSection(p, p.sections[0].id, { ...p.sections[0], areaM2: .04 })).toThrow(/目录力学参数已修改/);
  expect(() => decodeProject(JSON.stringify({ ...p, sections: [{ ...p.sections[0], catalogBasis: { ...p.sections[0].catalogBasis, source: {} } }] }))).toThrow(/来源字段缺失/);
  expect(() => updateSection(p, p.sections[0].id, { ...p.sections[0], geometry: { shape: "i-section", width: .055, height: .12, webThickness: .0041, flangeThickness: .0057 } })).toThrow(/目录几何已修改/);
  const edited = updateSection(p, p.sections[0].id, { name: "custom", areaM2: .04, secondMomentYM4: 1e-4, secondMomentZM4: 2e-4, torsionalConstantM4: 3e-4 });
  expect(edited.sections[0].catalogBasis).toBeUndefined();
  expect(edited.sections[0].geometry).toBeUndefined();
  expect(edited.sections[0].provenance.derivedFrom?.catalogId).toBe("arcelor-ipe100");
  expect(idealizedCatalogComparison(SECTION_CATALOG[0].geometry!).withinApproximationLimits).toBe(false);
  expect(idealizedCatalogComparison(SECTION_CATALOG[1].geometry!).withinApproximationLimits).toBe(true);
});

it("uses archived idealized comparison values and basis when querying or reopening historical catalogs", () => {
  const entry = structuredClone(SECTION_CATALOG[1]);
  const comparison = entry.catalogBasis!.idealizedComparison;
  comparison.properties.torsionalConstantM4 = 4.9e-8;
  comparison.notes = "Archived idealized comparison from the project creator";
  comparison.basis.url += "?archived=1";
  const project = addSection(createProject(), entry);
  const reopened = decodeProject(encodeProject(project));
  expect(reopened.sections[0].catalogBasis?.idealizedComparison).toEqual(comparison);
  expect(describeSection(reopened.sections[0]).idealizedComparison).toEqual(comparison);
  expect(reopened.sections[0].torsionalConstantM4).toBe(6.915e-8);
});

it("reads a catalog with millimetre output and restores an unconfirmed catalog draft without applying it", () => {
  const p = sectionCantilever();
  const result = executeAiTool(captureAiSnapshot(p, []), call("propose_model_edits", { operations: [
    { type: "create_section", properties: { name: "IPE catalog", catalogId: "arcelor-ipe100" } },
    { type: "assign_section", id: "section_0002", memberIds: [p.members[0].id] },
  ] }));
  expect(result.status).toBe("awaiting-confirmation");
  const draft = result.modelEdits!;
  const history: ConversationHistory = { id: "catalog", updatedAt: 1, turns: [], sectionSelection: [], calculationRequested: false,
    requestPrompt: "Use IPE 100", proposalSource: p, conditionsSource: p, sectionSource: p, modelEditsSource: p, taskDraftSource: p, modelEdits: draft };
  const reopened = decodeProject(encodeProject({ ...p, taskState: persistTaskState(p.id, [history], []) }));
  expect(reopened.sections).toEqual(p.sections);
  const pending = reopened.taskState!.conversations[0].modelEdits!;
  const outcome = new ModelEditConfirmation().confirm(reopened, prepareModelEditConfirmation(reopened, pending));
  expect(outcome.result.status).toBe("applied");
  expect(outcome.project.sections[1].torsionalConstantM4).toBe(1.157e-8);
  const read = executeAiTool(captureAiSnapshot(outcome.project, []), call("read_model", { collection: "sections", outputUnitPreset: "mm-N" }));
  expect(read.data).toMatchObject({ items: [{ geometryStatus: "几何已定义" }, { geometry: { width: 55, height: 100 }, areaM2: 1030, catalogBasis: SECTION_CATALOG[0].catalogBasis, idealizedComparison: { withinApproximationLimits: false } }] });
  expect(executeAiTool(captureAiSnapshot(p, []), call("read_section_contract", {})).data).toMatchObject({ catalog: [{ catalogId: "arcelor-ipe100" }, { catalogId: "arcelor-ipe200" }, { catalogId: "arcelor-hea200" }] });
});

it("keeps a v1 same-name property section and its historical static result without catalog matching", () => {
  let p = sectionCantilever();
  p = updateSection(p, p.sections[0].id, { name: "IPE 200", areaM2: .02, secondMomentYM4: .0001, secondMomentZM4: .0002, torsionalConstantM4: .0003 });
  const result = solveFrame(p); p = attachAnalysisResult(p, result);
  const legacy = JSON.parse(encodeProject(p)); legacy.formatVersion = 1;
  const reopened = decodeProject(JSON.stringify(legacy));
  expect(reopened.sections[0]).toMatchObject({ name: "IPE 200", areaM2: .02 });
  expect(reopened.sections[0].geometry).toBeUndefined();
  expect(reopened.sections[0].catalogBasis).toBeUndefined();
  expect(reopened.latestAnalysis).toEqual(result);
  expect(isAnalysisResultCurrent(reopened, reopened.latestAnalysis!)).toBe(true);
  expect(describeSection(reopened.sections[0])).toMatchObject({ geometryStatus: "几何未定义", displayMode: "analysis-line" });
  expect(createReportContent(captureEngineeringReport(reopened, result.id)).some((b) => "text" in b && b.text.includes("几何未定义"))).toBe(true);
});

it("reports the actual catalog mechanics, comparison formula and source from frozen analysis input", async () => {
  let p = sectionCantilever(); p = updateSection(p, p.sections[0].id, SECTION_CATALOG[1]);
  const result = solveFrame(p); p = attachAnalysisResult(p, result);
  const report = captureEngineeringReport({ ...p, displayUnitPreset: "mm-N" }, result.id);
  const blocks = createReportContent(report);
  const text = blocks.filter((b) => "text" in b).map((b) => "text" in b ? b.text : "").join("\n");
  expect(text).toContain("正式分析采用目录参数"); expect(text).toContain("EN sections!C54:AN54");
  expect(text).toContain("圆角 r = 12 mm"); expect(text).toContain("Sci_p385.pdf");
  expect(blocks).toContainEqual(expect.objectContaining({ kind: "table", headers: ["参数", "目录（正式分析）", "理想化（仅对照）", "单位"] }));
  const html = buildReportPdfHtml(report);
  const zip = await JSZip.loadAsync(await buildReportWord(report, async () => new Uint8Array([1])));
  const xml = await zip.file("word/document.xml")!.async("string");
  for (const marker of ["正式分析采用目录参数", "原表圆角 r = 12 mm", "EN sections!C54:AN54", "V2026-1", "Sci_p385.pdf", "理想化（仅对照）", result.id]) {
    expect(html).toContain(marker); expect(xml).toContain(marker);
  }
});
