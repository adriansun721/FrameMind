import { captureEngineeringReport, withSupplementalReportProcess } from "../domain/engineering-report";
import type { FrameProject } from "../domain/project";
import type { AnalysisResult } from "../domain/analysis";
import type { ReportAppendixSelection } from "../domain/report-appendix";
import { buildReportWord } from "./report-word";
import { buildReportPdfHtml } from "./report-pdf";
import type { ReportFormat } from "./report-task";

const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };
scope.onmessage = async (event: MessageEvent<{ source: { project: FrameProject; selection: ReportAppendixSelection; supplemental: AnalysisResult | null }; analysisId: string; format: ReportFormat; figures: { svg: string; bytes: Uint8Array }[] }>) => {
  try {
    const { source, analysisId, format, figures } = event.data;
    const captured = captureEngineeringReport(source.project, analysisId, source.selection);
    const report = source.supplemental && captured.appendix ? withSupplementalReportProcess(captured, source.supplemental) : captured;
    if (format === "PDF") scope.postMessage({ format, html: buildReportPdfHtml(report) });
    else {
      const bytes = await buildReportWord(report, async (svg) => {
        const figure = figures.find((item) => item.svg === svg);
        if (!figure) throw new Error("计算书图表来源不一致");
        return figure.bytes;
      });
      scope.postMessage({ format, bytes }, [bytes.buffer]);
    }
  } catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : "计算书生成失败" }); }
};
