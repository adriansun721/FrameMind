import type { DeepSeekToolCall } from "../../electron/contracts";
import { AnalysisCancelledError, type AnalysisTaskOptions } from "./analysis-task";
import { finishDiagnosticTool, prepareDiagnosticTool, type AiSnapshot, type AiToolResult } from "./ai-tools";
import type { DiagnosticCopy } from "./diagnostic-trial";
import { startDiagnosticTrialTask } from "./diagnostic-analysis-task";

export interface DiagnosticToolTask {
  promise: Promise<AiToolResult>;
  cancel(): void;
}

/** Diagnostic solves share the owning agent's scheduler slot and native host. */
export function startDiagnosticToolTask(snapshot: AiSnapshot, call: DeepSeekToolCall, copy?: DiagnosticCopy, options: AnalysisTaskOptions = {}): DiagnosticToolTask {
  let cancelled = false;
  let trial: ReturnType<typeof startDiagnosticTrialTask> | undefined;
  let rejectCancellation!: (error: Error) => void;
  const cancellation = new Promise<AiToolResult>((_resolve, reject) => { rejectCancellation = reject; });
  const work = Promise.resolve().then(async () => {
    if (cancelled) throw new AnalysisCancelledError();
    const prepared = prepareDiagnosticTool(snapshot, call, copy);
    if ("result" in prepared) return prepared.result;
    trial = startDiagnosticTrialTask(prepared.copy, prepared.request, options);
    return finishDiagnosticTool(snapshot, call, await trial.promise);
  });
  return { promise: Promise.race([work, cancellation]), cancel: () => {
    if (cancelled) return;
    cancelled = true; trial?.cancel(); rejectCancellation(new AnalysisCancelledError());
  } };
}
