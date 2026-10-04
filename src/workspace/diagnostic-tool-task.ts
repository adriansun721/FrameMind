import type { DeepSeekToolCall } from "../../electron/contracts";
import { AnalysisCancelledError } from "./analysis-task";
import { executeAiTool, type AiSnapshot, type AiToolResult } from "./ai-tools";
import type { DiagnosticCopy } from "./diagnostic-trial";

export interface DiagnosticToolTask {
  promise: Promise<AiToolResult>;
  cancel(): void;
}

/** Diagnostic solves share the owning agent's scheduler slot, but run off the UI thread. */
export function startDiagnosticToolTask(snapshot: AiSnapshot, call: DeepSeekToolCall, copy?: DiagnosticCopy): DiagnosticToolTask {
  let worker: Worker | undefined;
  if (typeof Worker !== "undefined") {
    // A Worker creation failure is a real resource failure, not a reason to block the UI.
    try { worker = new Worker(new URL("./diagnostic-tool-worker.ts", import.meta.url), { type: "module" }); } catch { worker = undefined; }
  }
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectPromise!: (error: Error) => void;
  const finish = (action: () => void) => {
    if (settled) return;
    settled = true;
    worker?.terminate();
    if (timer !== undefined) clearTimeout(timer);
    action();
  };
  const promise = new Promise<AiToolResult>((resolve, reject) => {
    rejectPromise = reject;
    if (worker) {
      worker.onmessage = (event: MessageEvent<AiToolResult>) => finish(() => resolve(event.data));
      worker.onerror = (event) => finish(() => reject(new Error(event.message || "诊断 Worker 执行失败")));
      worker.postMessage({ snapshot, call, copy });
    } else {
      // Non-browser tests use the same public tool contract and cancellation boundary.
      timer = setTimeout(() => {
        try { const result = executeAiTool(snapshot, call, undefined, undefined, undefined, undefined, undefined, copy); finish(() => resolve(result)); }
        catch (error) { finish(() => reject(error instanceof Error ? error : new Error(String(error)))); }
      }, 0);
    }
  });
  return { promise, cancel: () => finish(() => rejectPromise(new AnalysisCancelledError())) };
}
