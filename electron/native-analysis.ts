import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

/** One process per request. No renderer-controlled executable or command line. */
export class NativeAnalysisHost {
  private readonly active = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(private readonly executable: string) {}

  run(owner: number, request: unknown): Promise<unknown[]> {
    const packet = request as { requestId?: unknown };
    if (!packet || typeof packet.requestId !== "string" || !/^request_[\w-]{1,100}$/.test(packet.requestId)) return Promise.reject(new Error("原生请求身份无效"));
    const key = `${owner}:${packet.requestId}`;
    if (this.active.has(key)) return Promise.reject(new Error("原生请求正在运行"));
    const bytes = JSON.stringify(request);
    if (Buffer.byteLength(bytes) > 4 * 1024 * 1024) return Promise.reject(new Error("原生输入超过 4 MiB"));
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, [], { windowsHide: true, stdio: "pipe" });
      this.active.set(key, child);
      let output = "", stderr = "", settled = false;
      const decoder = new StringDecoder("utf8");
      const finish = (error?: Error, messages?: unknown[]) => {
        if (settled) return;
        settled = true; clearTimeout(timer); this.active.delete(key);
        if (error) {
          child.kill();
          // Retain completed stage messages even when the process crashes or
          // truncates its terminal packet. The renderer validates their order.
          const phases: Array<{ kind: string; record: { stage: string } }> = [];
          for (const line of output.split("\n")) {
            try { const message = JSON.parse(line); if (message?.kind === "phase") phases.push(message); else break; }
            catch { break; }
          }
          resolve([...phases, { kind: "error", requestId: packet.requestId, error: { name: "AnalysisFailure", message: error.message,
            stage: phases.at(-1)?.record?.stage ?? "model-check", diagnostics: [{ code: phases.length ? "native-runtime-error" : "native-start-error", message: error.message, field: "native-core" }] } }]);
        } else resolve(messages!);
      };
      const timer = setTimeout(() => finish(new Error("原生计算超过单杆 30 秒预算")), 30_000);
      child.stdout.on("data", (data: Buffer) => {
        output += decoder.write(data);
        if (Buffer.byteLength(output) > 4 * 1024 * 1024) finish(new Error("原生输出超过 4 MiB"));
      });
      child.stderr.on("data", (data: Buffer) => { if (stderr.length < 4096) stderr += data.toString("utf8"); });
      child.on("error", (error) => finish(new Error(`原生核心启动失败：${error.message}`)));
      child.stdin.on("error", (error) => finish(new Error(`原生输入发送失败：${error.message}`)));
      child.on("close", (code, signal) => {
        if (settled) return;
        output += decoder.end();
        try {
          const messages = output.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { kind?: string });
          const terminal = messages.at(-1);
          if (!terminal || !["result", "error"].includes(terminal.kind ?? "") || messages.slice(0, -1).some((m) => m.kind !== "phase")
            || terminal.kind === "result" && code !== 0 || terminal.kind === "error" && code !== 1) {
            throw new Error(`原生核心未返回完整输出（exit=${code}，signal=${signal}）${stderr}`);
          }
          finish(undefined, messages);
        } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
      });
      child.stdin.end(bytes);
    });
  }

  cancel(owner: number, requestId: string): void { this.active.get(`${owner}:${requestId}`)?.kill(); }
  dispose(): void { for (const child of this.active.values()) child.kill(); }
}
