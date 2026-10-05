import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

/** Transport budgets, not engineering node/member limits. Memory is enforced by the core's Windows Job. */
export const NATIVE_RUNTIME_LIMITS = Object.freeze({ inputBytes: 16 * 1024 * 1024, outputBytes: 64 * 1024 * 1024, timeoutMs: 120_000, concurrent: 1 });
const stages = ["model-check", "assembly", "solve", "recovery"];
interface PhaseMessage { kind: "phase"; requestId: string; record: { stage: string; startedAt: string }; }

/** One bounded process per request. No renderer-controlled executable or command line. */
export class NativeAnalysisHost {
  private readonly active = new Map<string, { cancel(): void }>();
  private disposed = false;

  constructor(private readonly executable: string) {}

  run(owner: number, request: unknown, onPhase?: (message: PhaseMessage) => void): Promise<unknown[]> {
    const packet = request as { requestId?: unknown };
    if (!packet || typeof packet.requestId !== "string" || !/^request_[\w-]{1,100}$/.test(packet.requestId)) return Promise.reject(new Error("原生请求身份无效"));
    const requestId = packet.requestId;
    const key = `${owner}:${requestId}`;
    if (this.disposed) return Promise.reject(new Error("原生计算服务已关闭"));
    if (this.active.has(key)) return Promise.reject(new Error("原生请求正在运行"));
    const bytes = JSON.stringify(request);
    const failure = (code: string, message: string, phases: PhaseMessage[] = []) => [...phases, {
      kind: "error", requestId, error: { name: "AnalysisFailure", message, stage: phases.at(-1)?.record.stage ?? "model-check",
        diagnostics: [{ code, message, field: "native-core" }] },
    }];
    if (Buffer.byteLength(bytes) > NATIVE_RUNTIME_LIMITS.inputBytes) return Promise.resolve(failure("native-resource-limit", "原生输入超过 16 MiB 传输预算"));
    if (this.active.size >= NATIVE_RUNTIME_LIMITS.concurrent) return Promise.resolve(failure("native-resource-limit", "原生计算资源仍被占用，请稍后重算"));
    return new Promise((resolve) => {
      const child = spawn(this.executable, [], { windowsHide: true, stdio: "pipe" });
      let pending = "", stderr = "", outputBytes = 0, settled = false;
      const phases: PhaseMessage[] = [];
      let terminal: unknown;
      const decoder = new StringDecoder("utf8");
      const finish = (code?: string, message?: string) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (code) { child.kill(); resolve(failure(code, message!, phases)); }
        else resolve([...phases, terminal]);
      };
      const timer = setTimeout(() => finish("native-timeout", "原生计算超过 120 秒运行预算"), NATIVE_RUNTIME_LIMITS.timeoutMs);
      this.active.set(key, { cancel: () => finish("native-cancelled", "原生计算已取消，未发布部分结果") });
      const line = (bytes: string) => {
        if (settled) return;
        try {
          const message = JSON.parse(bytes);
          // Allocation can fail before JSON parsing has recovered the request ID.
          // This isolated child's failure can be attributed to its owning request;
          // a success packet with a missing/foreign ID is always rejected.
          if (message?.kind === "error" && message.requestId === null
            && message.error?.diagnostics?.[0]?.code === "native-resource-limit") {
            finish("native-resource-limit", "原生内存预算不足，未发布部分结果"); return;
          }
          if (!message || message.requestId !== requestId || terminal) throw new Error("原生消息身份或顺序不匹配");
          if (message.kind === "phase") {
            if (message.record?.stage !== stages[phases.length] || typeof message.record.startedAt !== "string"
              || !Number.isFinite(Date.parse(message.record.startedAt))) throw new Error("原生阶段无效");
            phases.push(message); onPhase?.(message);
          } else if (message.kind === "result" || message.kind === "error") terminal = message;
          else throw new Error("原生消息类型无效");
        } catch (error) { finish("native-protocol-error", error instanceof Error ? error.message : "原生协议无法读取"); }
      };
      child.stdout.on("data", (data: Buffer) => {
        if (settled) return;
        outputBytes += data.length;
        if (outputBytes > NATIVE_RUNTIME_LIMITS.outputBytes) { finish("native-resource-limit", "原生输出超过 64 MiB 传输预算"); return; }
        pending += decoder.write(data);
        let end: number;
        while (!settled && (end = pending.indexOf("\n")) !== -1) {
          const message = pending.slice(0, end); pending = pending.slice(end + 1);
          if (message.trim()) line(message);
        }
      });
      child.stderr.on("data", (data: Buffer) => { stderr = (stderr + data.toString("utf8")).slice(0, 4096); });
      child.on("error", (error) => finish("native-start-error", `原生核心启动失败：${error.message}`));
      child.stdin.on("error", (error) => finish("native-runtime-error", `原生输入发送失败：${error.message}`));
      child.on("close", (code, signal) => {
        this.active.delete(key);
        if (settled) return;
        pending += decoder.end();
        if (pending.trim()) line(pending);
        if (settled) return;
        const kind = (terminal as { kind?: string } | undefined)?.kind;
        if (kind === "result" && code === 0 || kind === "error" && code === 1) finish();
        else finish("native-runtime-error", `原生核心未正常完成（exit=${code}，signal=${signal}）${stderr}`);
      });
      child.stdin.end(bytes);
    });
  }

  cancel(owner: number, requestId: string): void { this.active.get(`${owner}:${requestId}`)?.cancel(); }
  cancelOwner(owner: number): void { for (const [key, process] of this.active) if (key.startsWith(`${owner}:`)) process.cancel(); }
  dispose(): void { this.disposed = true; for (const process of this.active.values()) process.cancel(); }
}
