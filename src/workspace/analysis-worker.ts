import { solveFrame, type AnalysisInputSnapshot } from "../domain/analysis";
import { AnalysisFailure } from "../domain/analysis-diagnostics";

type WorkerRequest = AnalysisInputSnapshot;
type WorkerResponse =
  | { kind: "phase"; phase: "model-check" | "assembly" | "solve" | "recovery" }
  | { kind: "result"; result: ReturnType<typeof solveFrame> }
  | { kind: "error"; error: { name: string; message: string; stage?: string; diagnostics?: unknown[] } };

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = async (event) => {
  try {
    // Yield once so the renderer can cancel a newly started task before a fast solve begins.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const result = solveFrame(event.data, (phase) => scope.postMessage({ kind: "phase", phase }));
    scope.postMessage({ kind: "result", result });
  } catch (error) {
    if (error instanceof AnalysisFailure) {
      scope.postMessage({ kind: "error", error: { name: error.name, message: error.message, stage: error.stage, diagnostics: error.diagnostics } });
    } else {
      scope.postMessage({ kind: "error", error: { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) } });
    }
  }
};
