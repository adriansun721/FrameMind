// @vitest-environment node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import JSZip from "jszip";
import { modalCantilever } from "../validation/modal-fixtures";
import { captureAnalysisInput } from "../domain/analysis";
import { createAnalysisRequest } from "../domain/analysis-service";
import { decodeAnalysisResult } from "../domain/project-file";
import { addAnalysisCase, addLoadCase, addMember, addNode, attachAnalysisResult, selectAnalysisCase, updateNode, type FrameProject } from "../domain/project";
import { captureEngineeringReport, withSupplementalReportProcess } from "../domain/engineering-report";
import { DEFAULT_BUCKLING_SETTINGS } from "../domain/buckling";
import { DEFAULT_MODAL_SETTINGS } from "../domain/modal";
import { reportAppendixSteps } from "../domain/report-appendix";
import { secondOrderColumn } from "../validation/second-order-fixtures";
import { createReportContent } from "./report-content";
import { buildReportPdfHtml } from "./report-pdf";
import { buildReportWord } from "./report-word";

function solve(project: FrameProject) {
  const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(createAnalysisRequest(captureAnalysisInput(project))), encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
  if (child.error) throw child.error;
  const terminal = JSON.parse(child.stdout.trim().split("\n").at(-1)!);
  expect(terminal.kind, JSON.stringify(terminal.error)).toBe("result");
  return decodeAnalysisResult(terminal.result);
}

it("exports historical modal frequency and mass from the selected frozen native result", () => {
  const project = modalCantilever();
  const result = solve(project);
  const changed = updateNode(attachAnalysisResult(project, result), project.nodes[1].id, { x: 8, y: 0, z: 0 });
  const report = captureEngineeringReport(changed, result.id);
  const content = JSON.stringify(createReportContent(report));
  expect(content).toContain("历史结果");
  expect(content).toContain("单位广义质量");
  expect(content).toContain("质量来源");
  expect(content).toContain(Number(result.modal!.modes[0].frequencyHz.toPrecision(7)).toString());
  expect(content).not.toContain("最大节点位移幅值");
  expect(report.result.input.nodes[1].position).toEqual(result.input.nodes[1].position);
  expect(Object.isFrozen(report.result.modal!.modes[0].members[0].samples)).toBe(true);
  const matrixOnly = captureEngineeringReport(changed, result.id, { memberIds: [], steps: ["analysis-mass"] });
  const matrixContent = JSON.stringify(createReportContent(matrixOnly));
  expect(matrixContent).toContain("工程对象 / 位置");
  expect(matrixContent).toContain("已随所选矩阵");
  expect(matrixContent).toContain("member_0001 @");
});

it("keeps actual second-order matrices and corrections in identical Word/PDF content without supplementing", async () => {
  const project = secondOrderColumn(100, .1), result = solve(project);
  const report = captureEngineeringReport(attachAnalysisResult(project, result), result.id, { memberIds: [], steps: reportAppendixSteps(result) });
  const content = createReportContent(report);
  const html = buildReportPdfHtml(report);
  const zip = await JSZip.loadAsync(await buildReportWord(report, async () => new Uint8Array([1])));
  const xml = await zip.file("word/document.xml")!.async("string");
  for (const block of content) if ("text" in block) {
    const escaped = block.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    expect(xml).toContain(escaped);
    expect(html).toContain(escaped);
  }
  const selected = result.secondOrder!.runs.find((r) => r.divisions === result.secondOrder!.selectedDivisions)!;
  expect(report.appendix!.recorded!.find((r) => r.section === "iterations")!.items).toEqual(selected.calculation.iterations);
  expect(report.appendix!.recorded!.find((r) => r.section === "stiffness")!.items).toEqual(selected.calculation.stiffness);
  expect(html).toContain("初应力弹性二阶近似");
  expect(html).toContain("最终加载因子 1");
  expect(html).toContain("最大节点位移幅值");
  expect(() => withSupplementalReportProcess(report, result)).toThrow(/只读取原运行/);
});

it("reports frozen fixed and reference buckling patterns and never labels a shape as actual displacement", () => {
  let project = addLoadCase(secondOrderColumn(100, .1), "固定荷载");
  project = selectAnalysisCase(addAnalysisCase(project, { name: "稳定性", method: "buckling", loadSourceId: "buckling", settings: { solver: "native-buckling", buckling: { ...DEFAULT_BUCKLING_SETTINGS, fixed: [{ loadCaseId: "LC1", factor: .2 }], reference: [{ loadCaseId: "LC1", factor: .8 }] } } }), "AC2");
  const result = solve(project);
  const report = captureEngineeringReport(attachAnalysisResult(project, result), result.id, { memberIds: [], steps: ["analysis-geometric", "analysis-prestress", "analysis-shapes"] });
  const html = buildReportPdfHtml(report);
  for (const text of ["Gfixed 固定预荷载", "Greference 参考荷载", "0.2", "0.8", "固定预荷载不变", "完整归一化形态", "λ (无量纲)"]) expect(html).toContain(text);
  expect(html).not.toContain("节点位移与转角");
  expect(html).not.toContain("杆端局部内力");
  expect(html).toContain(Number(result.buckling!.modes[0].factor.toPrecision(7)).toString());
  expect(() => captureEngineeringReport(attachAnalysisResult(project, result), result.id, { memberIds: [], steps: ["constraints"] })).toThrow(/不支持该附录/);
});

it("reports unrecorded oversized modal matrices and budget exhaustion without substituting another run", () => {
  let project = modalCantilever({ ...DEFAULT_MODAL_SETTINGS, frequencyTolerance: 1e-8, maxEquations: 600 });
  for (let i = 1; i <= 2; i++) {
    project = addNode(project, { x: 3, y: i, z: 0 });
    project = addMember(project, { startNodeId: project.nodes[0].id, endNodeId: project.nodes.at(-1)!.id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
  }
  const result = solve(project);
  expect(result.modal!.counts.equations).toBeGreaterThan(144);
  expect(result.modal!.eigenproblem.mass).toBeNull();
  const report = captureEngineeringReport(attachAnalysisResult(project, result), result.id, { memberIds: [], steps: ["analysis-mass", "analysis-stiffness"] });
  expect(report.appendix!.missing).toHaveLength(2);
  expect(report.appendix!.recorded!.every((r) => r.origin === "not-recorded")).toBe(true);
  const html = buildReportPdfHtml(report);
  expect(html).toContain("预算内未满足收敛要求");
  expect(html).toContain("缺少记录");
  expect(html).not.toContain("补算过程分析");
});
