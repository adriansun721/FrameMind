import { AnalysisCancelledError, startAnalysisTask, type AnalysisTaskOptions } from "./analysis-task";
import { captureDiagnosticInput, diagnosticAnalysisOrigin, finishDiagnosticTrial, prepareDiagnosticTrial, type DiagnosticCopy, type DiagnosticTrialRequest } from "./diagnostic-trial";
import type { AnalysisStage } from "../domain/analysis-diagnostics";

export function startDiagnosticTrialTask(copy: DiagnosticCopy, request: DiagnosticTrialRequest, options: AnalysisTaskOptions = {}) {
  const prepared = prepareDiagnosticTrial(copy, request);
  if (prepared.check.status !== "valid") return { promise: Promise.resolve(finishDiagnosticTrial(prepared)), cancel() {} };
  const stages: AnalysisStage[] = [];
  const task = startAnalysisTask(captureDiagnosticInput(prepared.candidate, prepared.check.sourceId), { ...options, origin: diagnosticAnalysisOrigin(prepared.candidate),
    onPhase: (stage) => { stages.push(stage); options.onPhase?.(stage); } });
  return { promise: task.promise.then((result) => finishDiagnosticTrial(prepared, result, undefined, stages)).catch((error) => {
    if (error instanceof AnalysisCancelledError) throw error;
    return finishDiagnosticTrial(prepared, undefined, error, stages);
  }), cancel: () => task.cancel() };
}
