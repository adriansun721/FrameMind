import JSZip from "jszip";
import type { EngineeringReport } from "../domain/engineering-report";
import { readRecordedProcess, type ProcessSection } from "../domain/result-inspection";
import { randomSpectra } from "../domain/random-response";
import { unitPresentation } from "../domain/units";
import { randomReportPointIndexes } from "./random-report-content";

const csv = (rows: (string | number)[][]) => "\uFEFF" + rows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n";

/** The caller captures the report before any await; exports never revisit the editable project. */
export async function buildRandomReportData(report: EngineeringReport): Promise<Uint8Array> {
  if (!report.result.random) throw new Error("请选择随机响应分析以导出 PSD/RMS 数据");
  const { result } = report, r = result.random!, u = unitPresentation(report.displayUnitPreset), zip = new JSZip();
  const spectra = randomSpectra(result.input.randomBasis!);
  const frame = r.referenceFrame ?? "fixed-global";
  const process = (["settings", "stages", "mesh", "coordinates", "stiffness", "mass"] as ProcessSection[]).map((section) => {
    const summary = readRecordedProcess(result, section);
    return readRecordedProcess(result, section, 0, summary.total);
  });
  const files = ["manifest.json", "analysis.json", "response.csv", "rms.csv", "process.json", ...spectra.map((_, i) => `input-${i + 1}.csv`)];
  zip.file("manifest.json", JSON.stringify({ schema: "framemind-random-export-v1", files,
    projectId: result.projectId, projectName: report.projectName, analysisId: result.id, inputRevision: result.projectRevision,
    createdAt: result.createdAt, exportedAt: report.generatedAt, current: report.current, displayUnitPreset: u.preset,
    response: r.response, coordinateSystem: r.coordinateSystem, referenceFrame: frame, sidedness: r.sidedness,
    frequencyUnit: "Hz", densityUnit: r.densityUnit, rmsUnit: r.rmsUnit, varianceUnit: "m²", responsePoints: r.points.length,
    reportSummaryIndexes: randomReportPointIndexes(r.points.length).map((i) => i + 1),
    reportSummaryPolicy: "Default report tables show at most 32 saved rows: first 16 and last 16. Optional full tables include every row. Indexes are one-based.",
    spectra: spectra.map(({ sourceId, spectrum: s }, i) => ({ sourceId, spectrumId: s.id, file: `input-${i + 1}.csv`, quantity: s.quantity, frequencyUnit: s.frequencyUnit, densityUnit: s.densityUnit, sidedness: s.sidedness, interpolation: s.interpolation, outsideBand: s.outsideBand, band: s.band, points: s.points.length, reportSummaryIndexes: randomReportPointIndexes(s.points.length).map((j) => j + 1) })),
    missingRecords: process.filter((v) => !v.available).map((v) => ({ section: v.section, sourceAnalysisId: v.sourceAnalysisId, message: v.message })),
    precision: "JSON/CSV preserve saved numeric values; report tables round to seven significant digits. CSV display columns convert units without rounding. Matrices and modal vectors retain canonical mixed units.",
  }, null, 2));
  zip.file("analysis.json", JSON.stringify(result));
  zip.file("process.json", JSON.stringify(process));
  zip.file("response.csv", csv([["analysis_id", "node_id", "component", "coordinate_system", "reference_frame", "index", "frequency_Hz", "density_m²/Hz", `density_${u.unit("m²/Hz")}`],
    ...r.points.map((p, i) => [result.id, r.response.nodeId, r.response.component, r.coordinateSystem, frame, i + 1, p.frequencyHz, p.density, u.value(p.density, "m²/Hz")])]));
  zip.file("rms.csv", csv([["analysis_id", "node_id", "component", "coordinate_system", "reference_frame", "rms_m", `rms_${u.unit("m")}`, "variance_m²", `variance_${u.unit("m²")}`],
    [result.id, r.response.nodeId, r.response.component, r.coordinateSystem, frame, r.rms, u.value(r.rms, "m"), r.variance, u.value(r.variance, "m²")]]));
  spectra.forEach(({ sourceId, spectrum: s }, i) => zip.file(`input-${i + 1}.csv`, csv([["analysis_id", "source_id", "spectrum_id", "index", "frequency_Hz", `density_${s.densityUnit}`, `density_${u.unit(s.densityUnit)}`],
    ...s.points.map((p, j) => [result.id, sourceId, s.id, j + 1, p.frequency, p.density, u.value(p.density, s.densityUnit)])])));
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  if (bytes.length > 67_500_000) throw new Error("随机数据包超过 67.5 MB 导出预算，未截断或保存部分数据");
  return bytes;
}
