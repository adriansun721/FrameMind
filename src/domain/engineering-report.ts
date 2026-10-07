import type { UnitPresetId } from "./units";
import { decodeAnalysisResult } from "./project-file";
import { freezeAnalysisInput, isAnalysisResultCurrent, type AnalysisResult } from "./analysis";
import { calculateMemberGeometry } from "./member-geometry";
import type { FrameProject } from "./project";
import { captureReportAppendix, freezeReportData, type ReportAppendix, type ReportAppendixSelection } from "./report-appendix";

export interface EngineeringReport {
  displayUnitPreset?: UnitPresetId;
  projectName: string;
  generatedAt: string;
  result: AnalysisResult;
  appendix?: ReportAppendix;
  current?: boolean;
}

export function reportSourceLabel(result: AnalysisResult): string {
  if (result.input.analysisCase) return `${result.input.analysisCase.id} · ${result.input.analysisCase.name} · ${result.secondOrder ? "弹性二阶" : result.buckling ? "特征值屈曲" : result.modal ? "模态" : "线性静力"} · ${result.input.analysisCase.loadSourceId}`;
  const source = result.input.combination?.definition ?? result.input.loadCase;
  return source ? `${source.id} · ${source.name}${result.input.combination ? " · 用户定义组合" : ""}` : "LC1 · 默认工况";
}

/** Capture once, before any await. All document content and figures use this copy. */
export function captureEngineeringReport(project: FrameProject, analysisId: string, selection: ReportAppendixSelection = { memberIds: [], steps: [] }): EngineeringReport {
  const selected = project.analysisResults.find((result) => result.id === analysisId);
  if (!selected || selected.projectId !== project.id) throw new Error("请选择本项目已完成且可对应的分析结果");
  const result = decodeAnalysisResult(structuredClone(selected));
  if (result.random) throw new Error("随机响应计算书由 T2-38 接入；请在 PSD/RMS 面板核查");
  if (!result.input.nodes.length || !result.input.members.length) throw new Error("分析输入缺少节点或杆件，不能导出成功报告");
  for (const member of result.modal || result.buckling ? [] : result.input.members) {
    const start = result.input.nodes.find((node) => node.id === member.startNodeId)!;
    const end = result.input.nodes.find((node) => node.id === member.endNodeId)!;
    const geometry = calculateMemberGeometry(start.position, end.position, member.rotationDegrees);
    const output = result.members.find((item) => item.memberId === member.id)!;
    const close = (a: number, b: number) => Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(b));
    const axes = [geometry.localX, geometry.localY, geometry.localZ];
    if (!close(output.length, geometry.length) || (["x", "y", "z"] as const).some((axis, index) =>
      (["x", "y", "z"] as const).some((component) => !close(output.localAxes[axis][component], axes[index][component])))) {
      throw new Error(`杆件 ${member.label} 的结果几何与冻结输入不可对应`);
    }
  }
  result.input = freezeAnalysisInput(result.input);
  result.nodes.forEach((node) => { Object.values(node).forEach((value) => { if (typeof value === "object") Object.freeze(value); }); Object.freeze(node); });
  result.members.forEach((member) => {
    Object.values(member.localAxes).forEach(Object.freeze); Object.freeze(member.localAxes);
    Object.freeze(member.localEndForces.start); Object.freeze(member.localEndForces.end); Object.freeze(member.localEndForces); Object.freeze(member);
  });
  Object.freeze(result.nodes); Object.freeze(result.members); Object.freeze(result);
  return freezeReportData({ current: isAnalysisResultCurrent(project, selected), displayUnitPreset: project.displayUnitPreset, projectName: project.name, generatedAt: new Date().toISOString(), result, appendix: captureReportAppendix(result, selection) });
}

export const reportNumber = (value: number): string => value === 0 ? "0" : Number(value.toPrecision(7)).toString();

/** Supplement only the appendix, preserving the body and its historical output. */
export function withSupplementalReportProcess(report: EngineeringReport, supplementalResult: AnalysisResult): EngineeringReport {
  if (report.result.modal || report.result.buckling || report.result.secondOrder) throw new Error("稳定性与模态附录只读取原运行记录，不支持补算替代");
  if (!report.appendix) throw new Error("请先选择要补算的过程附录步骤");
  const supplemental = decodeAnalysisResult(structuredClone(supplementalResult));
  const { solver: originalSolver, ...originalInput } = report.result.input;
  const { solver: supplementalSolver, ...supplementalInput } = supplemental.input;
  if (supplemental.id === report.result.id || JSON.stringify(originalInput) !== JSON.stringify(supplementalInput)) throw new Error("补算过程必须来自所选分析的同一冻结输入并具有独立分析 ID");
  const appendix = captureReportAppendix(supplemental, report.appendix.selection)!;
  for (const record of [...appendix.members, ...(appendix.overall ? [appendix.overall] : [])]) {
    record.origin = "supplemental-reconstruction";
    record.sourceAnalysisId = report.result.id;
  }
  return freezeReportData({ ...report, appendix });
}
