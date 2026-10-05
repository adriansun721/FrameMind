import { ANALYSIS_DOF_ORDER, NATIVE_ANALYSIS_SOLVER, NATIVE_STATIC_SOLVER, freezeAnalysisInput, sameInputValue, type AnalysisInputSnapshot, type AnalysisResult } from "../domain/analysis";
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
  /** TypeScript is an explicit test/reference adapter, never a production fallback. */
  backend?: "typescript-reference" | "native-single-member" | "native-static";
  origin?: AnalysisOrigin;
  onPhase?(phase: AnalysisTaskPhase): void;
}

export interface AnalysisTask {
  promise: Promise<AnalysisResult>;
  cancel(): void;
}

function validDiagnostic(value: AnalysisDiagnostic): boolean {
  if (!value || typeof value !== "object" || typeof value.code !== "string" || !value.code.trim()
    || typeof value.message !== "string" || !value.message.trim()
    || value.field !== undefined && typeof value.field !== "string"
    || value.dof !== undefined && !ANALYSIS_DOF_ORDER.includes(value.dof)) return false;
  if (value.target && (!value.target.id || typeof value.target.id !== "string"
    || !["node", "member", "material", "section", "support", "load", "uniform-load", "self-weight", "load-combination"].includes(value.target.kind))) return false;
  if (value.evidence && (![value.evidence.pivotMagnitude, value.evidence.threshold, value.evidence.matrixScale].every(Number.isFinite)
    || !Number.isSafeInteger(value.evidence.globalDofIndex) || value.evidence.globalDofIndex < 0)) return false;
  return true;
}

/** Compatibility facade: manual, agent and supplemental callers keep their existing API. */
export function startAnalysisTask(input: AnalysisInputSnapshot, options: AnalysisTaskOptions = {}): AnalysisTask {
  const native = options.backend !== "typescript-reference";
  const nativeSolver = options.backend === "native-single-member" ? NATIVE_ANALYSIS_SOLVER : NATIVE_STATIC_SOLVER;
  const request = createAnalysisRequest(native ? { ...input, solver: { ...nativeSolver } } : input, options.origin);
  const stages: AnalysisStageRecord[] = [];
  let settled = false;
  let worker: Worker | undefined;
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolvePromise!: (result: AnalysisResult) => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<AnalysisResult>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
  const finish = (callback: () => void) => {
    if (settled) return;
    settled = true;
    worker?.terminate();
    unsubscribe?.();
    if (timer !== undefined) clearTimeout(timer);
    callback();
  };
  const cancelNative = () => {
    if (native && typeof window !== "undefined") void window.frameMind?.cancelNativeAnalysis?.(request.requestId).catch(() => {});
  };
  const fail = (error: unknown, code?: string) => finish(() => { cancelNative(); rejectPromise(analysisServiceFailure(request, stages, error, code)); });
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
      if (!sameInputValue(result.service.stages, stages)) throw new Error("分析结果阶段与实际运行消息不一致");
      freezeAnalysisInput(result.input);
      finish(() => resolvePromise(result));
    } catch (error) { fail(error, "invalid-service-output"); }
  };

  const receive = (message: AnalysisTaskMessage) => {
      if (settled) return;
      try {
        if (!message || typeof message !== "object") throw new Error("分析 Worker 返回无效消息");
        if (message.requestId !== request.requestId) {
          if (native) throw new Error("原生输出请求身份不一致");
          return;
        }
        if (message.kind === "phase") phase(message.record);
        else if (message.kind === "result") complete(message.result);
        else if (message.kind === "error") {
          const error = message.error;
          if (error.stage !== undefined || error.diagnostics !== undefined || error.run !== undefined) {
            if (error.name !== "AnalysisFailure" || !error.stage || !ANALYSIS_STAGE_ORDER.includes(error.stage)
              || !Array.isArray(error.diagnostics) || !error.diagnostics.length || !error.diagnostics.every(validDiagnostic)) {
              throw new Error("分析 Worker 返回无效诊断");
            }
            const failure = new AnalysisFailure(error.stage, error.diagnostics);
            if (error.run && !sameInputValue(error.run, analysisRunRecord(request, "failed", stages))) throw new Error("分析失败来源与请求不一致");
            fail(error.run ? new AnalysisServiceFailure(error.stage, error.diagnostics, error.run) : failure);
          } else fail(new Error(error.message), "worker-error");
        } else fail(new Error("分析 Worker 返回未知消息"), "invalid-service-output");
      } catch (error) { fail(error, "invalid-service-output"); }
  };
  if (native) {
    const desktop = typeof window === "undefined" ? undefined : window.frameMind;
    if (!desktop?.runNativeAnalysis) fail(new Error("当前运行环境无法启动 C++ 核心"), "native-start-error");
    else {
      try {
        // Subscribe before dispatch; request-scoped IPC excludes foreign and late runs.
        unsubscribe = desktop.onNativeAnalysisPhase?.(request.requestId, (message) => receive(message as AnalysisTaskMessage));
        void desktop.runNativeAnalysis(request).then((messages) => {
          if (settled) return;
          if (!Array.isArray(messages)) { fail(new Error("原生输出不是消息列表"), "invalid-service-output"); return; }
          let index = 0;
          for (const message of messages as AnalysisTaskMessage[]) {
            if (!message || typeof message !== "object") { fail(new Error("原生消息无效"), "invalid-service-output"); break; }
            if (message.kind === "phase" && index < stages.length) {
              if (message.requestId !== request.requestId || !sameInputValue(message.record, stages[index])) {
                fail(new Error("原生实时阶段与最终记录不一致"), "invalid-service-output"); break;
              }
              index++; continue;
            }
            receive(message);
            if (message.kind === "phase") index++;
          }
          if (!settled) fail(new Error("原生核心未返回完整结果"), "invalid-service-output");
        }).catch((error) => fail(error, stages.length ? "native-runtime-error" : "native-start-error"));
      } catch (error) { fail(error, "native-start-error"); }
    }
  } else if (typeof Worker !== "undefined") {
    try { worker = new Worker(new URL("./analysis-worker.ts", import.meta.url), { type: "module" }); }
    catch { /* Preserve the existing restricted-runtime fallback. */ }
  }
  if (worker) {
    worker.onmessage = (event: MessageEvent<AnalysisTaskMessage>) => receive(event.data);
    worker.onerror = (event) => fail(new Error(event.message || "分析 Worker 执行失败"), "worker-error");
    worker.onmessageerror = () => fail(new Error("分析 Worker 消息无法读取"), "worker-message-error");
    try { worker.postMessage(request); }
    catch (error) { fail(error, "worker-dispatch-error"); }
  } else if (!native) {
    timer = setTimeout(() => {
      if (settled) return;
      try { complete(executeAnalysisRequest(request, phase)); }
      catch (error) { fail(error); }
    }, 0);
  }
  return { promise, cancel: () => finish(() => {
    cancelNative();
    rejectPromise(new AnalysisCancelledError(analysisRunRecord(request, "cancelled", stages)));
  }) };
}
