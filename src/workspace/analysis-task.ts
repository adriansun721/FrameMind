import { solveFrame, type AnalysisInputSnapshot, type AnalysisResult } from "../domain/analysis";
import { AnalysisFailure, type AnalysisDiagnostic, type AnalysisStage } from "../domain/analysis-diagnostics";

export type AnalysisTaskPhase = AnalysisStage;

export class AnalysisCancelledError extends Error {
  constructor() {
    super("分析任务已取消");
    this.name = "AnalysisCancelledError";
  }
}

interface SerializedAnalysisFailure {
  name: "AnalysisFailure";
  message: string;
  stage: AnalysisStage;
  diagnostics: AnalysisDiagnostic[];
}

interface AnalysisTaskPhaseMessage {
  kind: "phase";
  phase: AnalysisTaskPhase;
}

interface AnalysisTaskResultMessage {
  kind: "result";
  result: AnalysisResult;
}

interface AnalysisTaskErrorMessage {
  kind: "error";
  error: SerializedAnalysisFailure | { name: string; message: string };
}

type AnalysisTaskMessage = AnalysisTaskPhaseMessage | AnalysisTaskResultMessage | AnalysisTaskErrorMessage;

export interface AnalysisTaskOptions {
  onPhase?(phase: AnalysisTaskPhase): void;
}

export interface AnalysisTask {
  promise: Promise<AnalysisResult>;
  cancel(): void;
}

function restoreError(error: SerializedAnalysisFailure | { name: string; message: string }): Error {
  if (error.name === "AnalysisFailure" && "stage" in error && "diagnostics" in error) {
    return new AnalysisFailure(error.stage, error.diagnostics);
  }
  const restored = new Error(error.message);
  restored.name = error.name;
  return restored;
}

function startFallback(input: AnalysisInputSnapshot, options: AnalysisTaskOptions): AnalysisTask {
  let cancelled = false;
  let settled = false;
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<AnalysisResult>((resolve, reject) => {
    rejectPromise = reject;
    timer = globalThis.setTimeout(() => {
      if (cancelled) return;
      try {
        const result = solveFrame(input, options.onPhase);
        if (cancelled || settled) return;
        settled = true;
        resolve(result);
      } catch (error) {
        if (cancelled || settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }, 0);
  });
  return {
    promise,
    cancel: () => {
      if (settled || cancelled) return;
      cancelled = true;
      if (timer !== undefined) globalThis.clearTimeout(timer);
      settled = true;
      rejectPromise(new AnalysisCancelledError());
    },
  };
}

export function startAnalysisTask(input: AnalysisInputSnapshot, options: AnalysisTaskOptions = {}): AnalysisTask {
  if (typeof Worker === "undefined") return startFallback(input, options);

  let worker: Worker;
  try {
    worker = new Worker(new URL("./analysis-worker.ts", import.meta.url), { type: "module" });
  } catch {
    return startFallback(input, options);
  }

  let settled = false;
  let resolvePromise!: (result: AnalysisResult) => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<AnalysisResult>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const finish = (callback: () => void) => {
    if (settled) return;
    settled = true;
    worker.terminate();
    callback();
  };
  worker.onmessage = (event: MessageEvent<AnalysisTaskMessage>) => {
    if (settled) return;
    const message = event.data;
    if (message.kind === "phase") {
      options.onPhase?.(message.phase);
    } else if (message.kind === "result") {
      finish(() => resolvePromise(message.result));
    } else {
      finish(() => rejectPromise(restoreError(message.error)));
    }
  };
  worker.onerror = (event) => {
    finish(() => rejectPromise(new Error(event.message || "分析 Worker 执行失败")));
  };
  worker.postMessage(input);

  return {
    promise,
    cancel: () => finish(() => rejectPromise(new AnalysisCancelledError())),
  };
}
