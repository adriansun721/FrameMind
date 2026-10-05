import { freezeAnalysisInput, sameInputValue, type AnalysisInputSnapshot, type AnalysisResult } from "../domain/analysis";
import { analysisRunRecord, analysisServiceFailure, AnalysisServiceFailure, createAnalysisRequest, executeAnalysisRequest } from "../domain/analysis-service";
import { ANALYSIS_STAGE_ORDER, decodeAnalysisRun, type AnalysisOrigin, type AnalysisRunRecord, type AnalysisStageRecord } from "../domain/analysis-service-contract";
import { AnalysisFailure, type AnalysisDiagnostic, type AnalysisStage } from "../domain/analysis-diagnostics";
import { decodeAnalysisResult } from "../domain/project-file";

export type AnalysisTaskPhase = AnalysisStage;

export class AnalysisCancelledError extends Error {
  constructor(public readonly run?: AnalysisRunRecord) {
    super("分析任务已取消");
    this.name = "AnalysisCancelledError";
  }
}

export type AnalysisTaskMessage = { requestId: string } & (
  | { kind: "phase"; record: AnalysisStageRecord }
  | { kind: "result"; result: AnalysisResult }
  | { kind: "error"; error: { name: string; message: string; stage?: AnalysisStage; diagnostics?: AnalysisDiagnostic[]; run?: AnalysisRunRecord } }
);

export interface AnalysisTaskOptions {
  origin?: AnalysisOrigin;
  onPhase?(phase: AnalysisTaskPhase): void;
}

export interface AnalysisTask {
  promise: Promise<AnalysisResult>;
  cancel(): void;
}

/** Compatibility facade: manual, agent and supplemental callers keep their existing API. */
export function startAnalysisTask(input: AnalysisInputSnapshot, options: AnalysisTaskOptions = {}): AnalysisTask {
  const request = createAnalysisRequest(input, options.origin);
  const stages: AnalysisStageRecord[] = [];
  let settled = false;
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolvePromise!: (result: AnalysisResult) => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<AnalysisResult>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
  const finish = (callback: () => void) => {
    if (settled) return;
    settled = true;
    worker?.terminate();
    if (timer !== undefined) clearTimeout(timer);
    callback();
  };
  const fail = (error: unknown, code?: string) => finish(() => rejectPromise(analysisServiceFailure(request, stages, error, code)));
  const phase = (record: AnalysisStageRecord) => {
    if (settled) return;
    if (!record || record.stage !== ANALYSIS_STAGE_ORDER[stages.length] || !Number.isFinite(Date.parse(record.startedAt))) {
      fail(new Error("分析运行阶段记录无效"), "invalid-service-output");
      return;
    }
    stages.push(record);
    options.onPhase?.(record.stage);
  };
  const complete = (result: AnalysisResult) => {
    try {
      decodeAnalysisResult(result);
      if (result.id !== request.analysisId || result.projectId !== request.input.projectId
        || result.projectRevision !== request.input.projectRevision || !result.service
        || result.service.requestId !== request.requestId || !sameInputValue(result.input, request.input)
        || !sameInputValue(result.service.origin, request.origin)) throw new Error("分析输出与请求来源不一致");
      decodeAnalysisRun(result.service, result.input, result.id);
      freezeAnalysisInput(result.input);
      finish(() => resolvePromise(result));
    } catch (error) { fail(error, "invalid-service-output"); }
  };

  if (typeof Worker !== "undefined") {
    try { worker = new Worker(new URL("./analysis-worker.ts", import.meta.url), { type: "module" }); }
    catch { /* Preserve the existing restricted-runtime fallback. */ }
  }
  if (worker) {
    worker.onmessage = (event: MessageEvent<AnalysisTaskMessage>) => {
      if (settled) return;
      try {
        const message = event.data;
        if (!message || typeof message !== "object") throw new Error("分析 Worker 返回无效消息");
        if (message.requestId !== request.requestId) return;
        if (message.kind === "phase") phase(message.record);
        else if (message.kind === "result") complete(message.result);
        else if (message.kind === "error") {
          const error = message.error;
          if (error.stage && error.diagnostics) {
            const failure = new AnalysisFailure(error.stage, error.diagnostics);
            if (error.run && !sameInputValue(error.run, analysisRunRecord(request, "failed", stages))) throw new Error("分析失败来源与请求不一致");
            fail(error.run ? new AnalysisServiceFailure(error.stage, error.diagnostics, error.run) : failure);
          } else fail(new Error(error.message), "worker-error");
        } else fail(new Error("分析 Worker 返回未知消息"), "invalid-service-output");
      } catch (error) { fail(error, "invalid-service-output"); }
    };
    worker.onerror = (event) => fail(new Error(event.message || "分析 Worker 执行失败"), "worker-error");
    worker.onmessageerror = () => fail(new Error("分析 Worker 消息无法读取"), "worker-message-error");
    try { worker.postMessage(request); }
    catch (error) { fail(error, "worker-dispatch-error"); }
  } else {
    timer = setTimeout(() => {
      if (settled) return;
      try { complete(executeAnalysisRequest(request, phase)); }
      catch (error) { fail(error); }
    }, 0);
  }
  return { promise, cancel: () => finish(() => rejectPromise(new AnalysisCancelledError(analysisRunRecord(request, "cancelled", stages)))) };
}
