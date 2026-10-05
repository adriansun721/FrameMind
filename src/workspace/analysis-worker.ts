import { executeAnalysisRequest, AnalysisServiceFailure, type AnalysisServiceRequest } from "../domain/analysis-service";
import type { AnalysisTaskMessage } from "./analysis-task";

interface WorkerScope {
  onmessage: ((event: MessageEvent<AnalysisServiceRequest>) => void) | null;
  postMessage(message: AnalysisTaskMessage): void;
}
const scope = globalThis as unknown as WorkerScope;
scope.onmessage = async ({ data: request }) => {
  try {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const result = executeAnalysisRequest(request, (record) => scope.postMessage({ requestId: request.requestId, kind: "phase", record }));
    scope.postMessage({ requestId: request.requestId, kind: "result", result });
  } catch (error) {
    scope.postMessage({ requestId: request.requestId, kind: "error", error: error instanceof AnalysisServiceFailure
      ? { name: error.name, message: error.message, stage: error.stage, diagnostics: error.diagnostics, run: error.run }
      : { name: "Error", message: error instanceof Error ? error.message : String(error) } });
  }
};
