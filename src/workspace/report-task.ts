import type { EngineeringReport } from "../domain/engineering-report";
import { captureEngineeringReport, withSupplementalReportProcess } from "../domain/engineering-report";
import type { FrameProject } from "../domain/project";
import type { AnalysisResult } from "../domain/analysis";
import type { ReportAppendixSelection } from "../domain/report-appendix";
import { createReportFigures, reportSvgToPng } from "./report-figures";

export type ReportFormat = "Word" | "PDF";
export type PreparedReport = { format: "Word"; bytes: Uint8Array } | { format: "PDF"; html: string };

/** Rasterize the two figures with browser APIs; expensive packing runs separately. */
export async function prepareProjectReport(project: FrameProject, analysisId: string, selection: ReportAppendixSelection, supplemental: AnalysisResult | null, format: ReportFormat): Promise<PreparedReport> {
  const selected = project.analysisResults.find((result) => result.id === analysisId);
  if (!selected || selected.projectId !== project.id) throw new Error("请选择本项目已完成且可对应的分析结果");
  if (selected.random) throw new Error("随机响应计算书由 T2-38 接入，请在 PSD/RMS 面板核查结果");
  if (selected.modal) throw new Error("模态计算书尚未接入，请在频率与振型面板核查结果");
  // Capture before the first await; earlier analyses need not cross this boundary.
  const source = structuredClone({ project: { ...project, analysisResults: [selected], latestAnalysis: undefined }, selection, supplemental });
  const report: EngineeringReport = { displayUnitPreset: source.project.displayUnitPreset, projectName: source.project.name, generatedAt: new Date().toISOString(), result: source.project.analysisResults[0] };
  const figures = format === "Word" ? await Promise.all(Object.values(createReportFigures(report)).map(async (svg) => ({ svg, bytes: await reportSvgToPng(svg) }))) : [];
  if (typeof Worker === "undefined") {
    const captured = captureEngineeringReport(source.project, analysisId, source.selection);
    const validated = source.supplemental && captured.appendix ? withSupplementalReportProcess(captured, source.supplemental) : captured;
    if (format === "PDF") return { format, html: (await import("./report-pdf")).buildReportPdfHtml(validated) };
    return { format, bytes: await (await import("./report-word")).buildReportWord(validated, async (svg) => {
      const figure = figures.find((item) => item.svg === svg);
      if (!figure) throw new Error("计算书图表来源不一致");
      return figure.bytes;
    }) };
  }
  const worker = new Worker(new URL("./report-worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const finish = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<PreparedReport | { error: string }>) => {
      finish();
      if ("error" in event.data) reject(new Error(event.data.error));
      else resolve(event.data);
    };
    worker.onerror = (event) => { finish(); reject(new Error(event.message || "计算书生成失败")); };
    try { worker.postMessage({ source, analysisId, format, figures }, figures.map((item) => item.bytes.buffer)); }
    catch (error) { finish(); reject(error); }
  });
}
