import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { CadParseError, CadParsePhase, CadParseResult } from "./contracts";

export const CAD_RUNTIME_LIMITS = Object.freeze({ inputBytes: 256 * 1024 * 1024, outputBytes: 32 * 1024 * 1024, timeoutMs: 120_000, concurrent: 1 });
export const CAD_PARSER_VERSION = "framemind-step-reader/2.0.0";

export interface CadParserRequest { requestId: string; inputPath: string; expectedSha256?: string; retryOf?: string; parameters?: { coordinateSystem?: "global-right-handed"; lengthUnit?: "m" }; }
export interface CadParserHostOptions {
  executable?: string;
  worker?: string;
  spawn?: typeof spawn;
  timeoutMs?: number;
}
type CadMessage = CadParsePhase | CadParseResult | { kind: "error"; requestId: string; error: CadParseError };

function requestId(value: unknown): value is string { return typeof value === "string" && /^cad_[A-Za-z0-9_-]{8,100}$/.test(value); }
function failure(requestIdValue: string, code: string, message: string, stage: CadParseError["stage"], phases: CadParsePhase[], extra: Partial<CadParseError> = {}) {
  return [...phases, { kind: "error" as const, requestId: requestIdValue, error: { code, message, stage, parserVersion: CAD_PARSER_VERSION, ...extra } }];
}

/** Starts one bounded worker per import. The worker receives a path, never the renderer's file bytes. */
export class CadParserHost {
  private readonly active = new Map<string, { cancel(): void }>();
  private disposed = false;
  private readonly options: Required<CadParserHostOptions>;

  constructor(options: CadParserHostOptions = {}) {
    this.options = {
      executable: options.executable ?? process.execPath,
      worker: options.worker ?? resolve(__dirname, "../scripts/cad-parser-worker.mjs"),
      spawn: options.spawn ?? spawn,
      timeoutMs: options.timeoutMs ?? CAD_RUNTIME_LIMITS.timeoutMs,
    };
  }

  async run(owner: number, request: CadParserRequest): Promise<Array<CadParsePhase | CadParseResult | { kind: "error"; requestId: string; error: CadParseError }>> {
    if (!request || !requestId(request.requestId)) return failure("cad_invalid", "cad-invalid-request", "CAD 任务身份无效", "startup", []);
    if (typeof request.inputPath !== "string" || !request.inputPath) return failure(request.requestId, "cad-invalid-path", "CAD 输入路径无效", "startup", []);
    if (this.disposed) return failure(request.requestId, "cad-service-closed", "CAD 解析服务已关闭", "startup", []);
    const extension = extname(request.inputPath).toLowerCase();
    if (extension !== ".step" && extension !== ".stp") return failure(request.requestId, "cad-unsupported-extension", "CAD 输入必须是 .step 或 .stp 文件", "startup", []);
    const key = `${owner}:${request.requestId}`;
    if (this.active.has(key)) return failure(request.requestId, "cad-duplicate-request", "CAD 任务正在运行", "startup", []);
    if (this.active.size >= CAD_RUNTIME_LIMITS.concurrent) return failure(request.requestId, "cad-resource-limit", "CAD 解析资源仍被占用，请稍后重试", "startup", []);
    let fileSize: number;
    try { fileSize = (await stat(request.inputPath)).size; }
    catch (error) { return failure(request.requestId, "cad-input-unreadable", `无法读取 CAD 文件：${error instanceof Error ? error.message : "文件不存在或不可读"}`, "read", []); }
    if (!Number.isSafeInteger(fileSize) || fileSize < 1 || fileSize > CAD_RUNTIME_LIMITS.inputBytes) return failure(request.requestId, "cad-resource-limit", "CAD 输入超过 256 MiB 传输预算", "read", []);

    return new Promise((resolveResult) => {
      const phases: CadParsePhase[] = [];
      let pending = "", outputBytes = 0, terminal: CadMessage | undefined, settled = false;
      const decoder = new StringDecoder("utf8");
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.options.spawn(this.options.executable, [this.options.worker], {
          windowsHide: true,
          stdio: "pipe",
          env: { ELECTRON_RUN_AS_NODE: "1", FRAMEMIND_CAD_WORKER: "1", PATH: process.env.PATH ?? "" },
        });
      } catch (error) {
        resolveResult(failure(request.requestId, "cad-start-error", `CAD 解析进程启动失败：${error instanceof Error ? error.message : "未知启动错误"}`, "startup", []));
        return;
      }
      const finish = (code?: string, message?: string, stage: CadParseError["stage"] = phases.at(-1)?.record.stage ?? "startup") => {
        if (settled) return;
        settled = true; clearTimeout(timer); this.active.delete(key);
        if (code) { try { child.kill(); } catch {} resolveResult(failure(request.requestId, code, message ?? "CAD 解析失败", stage, phases)); }
        else resolveResult([...phases, terminal!]);
      };
      const timer = setTimeout(() => finish("cad-timeout", `CAD 解析超过 ${Math.round(this.options.timeoutMs / 1000)} 秒运行预算`, "parse"), this.options.timeoutMs);
      this.active.set(key, { cancel: () => finish("cad-cancelled", "CAD 解析已取消，正式项目未修改", "startup") });
      const onLine = (line: string) => {
        if (settled || !line.trim()) return;
        try {
          const message = JSON.parse(line) as CadMessage;
          if (!message || message.requestId !== request.requestId || terminal) throw new Error("CAD 消息身份或顺序不匹配");
          if (message.kind === "phase") {
            if (!["read", "parse", "finalize"].includes(message.record?.stage) || typeof message.record.startedAt !== "string" || !Number.isFinite(Date.parse(message.record.startedAt)) || phases.length !== ["read", "parse", "finalize"].indexOf(message.record.stage)) throw new Error("CAD 阶段顺序无效");
            phases.push(message);
          } else if (message.kind === "result" || message.kind === "error") terminal = message;
          else throw new Error("CAD 消息类型无效");
        } catch (error) { finish("cad-protocol-error", error instanceof Error ? error.message : "CAD 协议无法读取", "finalize"); }
      };
      child.stdout.on("data", (data: Buffer) => {
        if (settled) return;
        outputBytes += data.length;
        if (outputBytes > CAD_RUNTIME_LIMITS.outputBytes) { finish("cad-resource-limit", "CAD 输出超过 32 MiB 传输预算", "finalize"); return; }
        pending += decoder.write(data);
        let end = pending.indexOf("\n");
        while (!settled && end !== -1) { onLine(pending.slice(0, end)); pending = pending.slice(end + 1); end = pending.indexOf("\n"); }
      });
      child.stderr.on("data", () => {});
      child.on("error", (error) => finish("cad-start-error", `CAD 解析进程启动失败：${error.message}`, "startup"));
      child.stdin.on("error", (error) => finish("cad-runtime-error", `CAD 解析输入发送失败：${error.message}`, "read"));
      child.on("close", (code, signal) => {
        if (settled) return;
        pending += decoder.end(); if (pending.trim()) onLine(pending);
        if (settled) return;
        const terminalKind = terminal?.kind;
        if (terminalKind === "result" && code === 0 || terminalKind === "error" && code === 1) finish();
        else finish("cad-crash", `CAD 解析进程异常退出（exit=${code}，signal=${signal}）`, "parse");
      });
      child.stdin.end(JSON.stringify({ ...request, parserVersion: CAD_PARSER_VERSION }));
    });
  }

  cancel(owner: number, requestIdValue: string): void { this.active.get(`${owner}:${requestIdValue}`)?.cancel(); }
  cancelOwner(owner: number): void { for (const [key, process] of this.active) if (key.startsWith(`${owner}:`)) process.cancel(); }
  dispose(): void { this.disposed = true; for (const process of this.active.values()) process.cancel(); }
}

export function hashCadInput(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
export function cadInputName(inputPath: string): string { return basename(inputPath).replace(/[\r\n]/g, "_"); }
