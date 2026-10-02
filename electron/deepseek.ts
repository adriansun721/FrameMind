import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DEEPSEEK_MODELS, type DeepSeekModel, type DeepSeekSettings, type DeepSeekStatus, type DeepSeekResult } from "./contracts";

export interface CredentialEncryption {
  isAvailable(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}
interface Credential { version: 1; apiKey: string; model: DeepSeekModel; }
interface StoredSettings { settings: DeepSeekSettings; credential?: Credential; }

const messages: Record<DeepSeekStatus, string> = {
  saved: "连接设置已保存", removed: "本机凭据已移除", success: "连接成功",
  "not-configured": "尚未配置 DeepSeek API Key",
  "invalid-input": "请选择支持的模型，并填写有效的 API Key",
  "storage-unavailable": "本机安全存储不可用，无法保存或读取凭据",
  "storage-error": "无法读取或写入本机凭据，请重新保存或移除凭据",
  authentication: "认证失败，请检查或更新 API Key", balance: "DeepSeek 账户余额不足",
  "rate-limit": "请求受到限流，请稍后重试", timeout: "连接测试超时，请稍后重试",
  network: "网络连接失败，请检查网络后重试", service: "DeepSeek 服务暂不可用，请稍后重试",
  "invalid-response": "DeepSeek 返回了无法识别的响应", cancelled: "连接设置已改变，此次测试已失效",
};
function isModel(value: unknown): value is DeepSeekModel {
  return DEEPSEEK_MODELS.some((model) => model === value);
}
function isKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && /^[\x21-\x7e]+$/.test(value);
}
function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export class DeepSeekConnection {
  private queue: Promise<unknown> = Promise.resolve();
  private activeTest: AbortController | null = null;

  constructor(private readonly path: string, private readonly encryption: CredentialEncryption,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init), private readonly timeoutMs = 15_000) {}

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private available(): boolean {
    try { return this.encryption.isAvailable(); } catch { return false; }
  }

  private async read(): Promise<StoredSettings> {
    const settings: DeepSeekSettings = { configured: false, model: "deepseek-flash", storageAvailable: this.available() };
    try {
      const bytes = await readFile(this.path);
      if (!settings.storageAvailable) return { settings: { ...settings, issue: "storage-unavailable" } };
      const value = JSON.parse(this.encryption.decrypt(bytes));
      if (value?.version !== 1 || !isModel(value.model) || !isKey(value.apiKey)) throw new Error("Invalid credential");
      return { settings: { ...settings, configured: true, model: value.model }, credential: value };
    } catch (error) {
      return { settings: isMissing(error) ? settings : { ...settings, issue: "storage-error" } };
    }
  }

  private result(status: DeepSeekStatus, settings: DeepSeekSettings): DeepSeekResult {
    return { status, message: messages[status], settings };
  }

  getSettings(): Promise<DeepSeekSettings> {
    return this.serial(async () => (await this.read()).settings);
  }

  save(request: unknown): Promise<DeepSeekResult> {
    return this.serial(async () => {
      const current = await this.read();
      if (typeof request !== "object" || request === null || !("model" in request) || !("apiKey" in request)
        || !isModel(request.model) || typeof request.apiKey !== "string") return this.result("invalid-input", current.settings);
      const apiKey = request.apiKey.trim() || current.credential?.apiKey;
      if (!isKey(apiKey)) return this.result("invalid-input", current.settings);
      if (!this.available()) return this.result("storage-unavailable", current.settings);
      const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
      try {
        const credential: Credential = { version: 1, model: request.model, apiKey };
        const encrypted = this.encryption.encrypt(JSON.stringify(credential));
        await mkdir(dirname(this.path), { recursive: true });
        await writeFile(temporaryPath, encrypted, { mode: 0o600, flag: "wx" });
        await rename(temporaryPath, this.path);
        this.activeTest?.abort();
        this.activeTest = null;
        return this.result("saved", { configured: true, model: request.model, storageAvailable: true });
      } catch {
        return this.result("storage-error", current.settings);
      } finally {
        await unlink(temporaryPath).catch(() => undefined);
      }
    });
  }

  remove(): Promise<DeepSeekResult> {
    return this.serial(async () => {
      try { await unlink(this.path); }
      catch (error) { if (!isMissing(error)) return this.result("storage-error", (await this.read()).settings); }
      this.activeTest?.abort();
      this.activeTest = null;
      return this.result("removed", (await this.read()).settings);
    });
  }

  async testConnection(): Promise<DeepSeekResult> {
    const snapshot = await this.serial(async () => {
      const stored = await this.read();
      this.activeTest?.abort();
      const controller = new AbortController();
      this.activeTest = controller;
      return { ...stored, controller };
    });
    const { settings, credential, controller } = snapshot;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!credential) return this.result(settings.issue ?? "not-configured", settings);
      const aborted = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
        timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
      });
      const request = async (): Promise<DeepSeekStatus> => {
        const response = await this.fetcher("https://api.deepseek.com/chat/completions", {
          method: "POST", redirect: "error", signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential.apiKey}` },
          body: JSON.stringify({ model: credential.model, messages: [{ role: "user", content: "Reply OK." }],
            thinking: { type: "disabled" }, stream: false, max_tokens: 8 }),
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          switch (response.status) {
            case 401: case 403: return "authentication";
            case 402: return "balance";
            case 429: return "rate-limit";
            case 400: case 404: case 422: return "invalid-response";
            default: return "service";
          }
        }
        try {
          const data = await response.json();
          const message = data?.choices?.[0]?.message;
          return message?.role === "assistant" && typeof message.content === "string" && message.content.trim()
            ? "success" : "invalid-response";
        } catch { return "invalid-response"; }
      };
      const status = await Promise.race([request(), aborted]);
      if (this.activeTest !== controller) return this.result("cancelled", await this.getSettings());
      return this.result(status, settings);
    } catch {
      if (this.activeTest !== controller) return this.result("cancelled", await this.getSettings());
      return this.result(timedOut ? "timeout" : "network", settings);
    } finally {
      clearTimeout(timer);
      if (this.activeTest === controller) this.activeTest = null;
    }
  }
}
