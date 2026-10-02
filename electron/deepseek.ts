import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DEEPSEEK_MODELS, type DeepSeekModel, type DeepSeekSettings, type DeepSeekStatus, type DeepSeekResult,
  type DeepSeekChatRequest, type DeepSeekChatResult, type DeepSeekAssistantMessage, type DeepSeekChatMessage,
  type DeepSeekToolCall } from "./contracts";

export interface CredentialEncryption {
  isAvailable(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}
interface Credential { version: 1; apiKey: string; model: DeepSeekModel; }
interface StoredSettings { settings: DeepSeekSettings; credential?: Credential; }

const modelTools = [
  { type: "function", function: { name: "request_analysis", description: "Queue a local analysis only when the user explicitly requests computation of the applied model. Does not compute itself; unconfirmed changes still require stage confirmation.",
    parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "discard_frame_proposal", description: "Discard the current unapplied frame proposal when the user rejects or cancels it. Never changes the applied model.",
    parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "read_model", description: "Read the applied model summary or a paginated collection. All values come from the current model snapshot.",
    parameters: { type: "object", properties: {
      collection: { type: "string", enum: ["summary", "nodes", "members", "materials", "sections", "supports", "loads", "load-cases"] },
      offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 100 },
    }, required: ["collection"], additionalProperties: false } } },
  { type: "function", function: { name: "read_selection", description: "Read the selected nodes and members using stable object identifiers.",
    parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "read_objects", description: "Read actual nodes or members by stable identifiers. This tool cannot change the model.",
    parameters: { type: "object", properties: { objects: { type: "array", minItems: 1, maxItems: 100,
      items: { type: "object", properties: { kind: { type: "string", enum: ["node", "member"] }, id: { type: "string" } }, required: ["kind", "id"], additionalProperties: false },
    } }, required: ["objects"], additionalProperties: false } } },
  { type: "function", function: { name: "propose_frame", description: "Create or update an unapplied parameter card and batch preview for an orthogonal spatial frame. Missing fields remain missing. Never applies changes.",
    parameters: { type: "object", properties: { parameters: { type: "object", additionalProperties: false,
      properties: Object.fromEntries(["storeys", "xSpans", "ySpans", "storeyHeights", "origin", "material", "columnSection", "beamSection", "rotationDegrees"].map((name) => [name, {
        type: "object", additionalProperties: false, required: ["value", "source"], properties: {
          value: ["material", "columnSection", "beamSection"].includes(name) ? { type: "string" }
            : name === "storeys" ? { type: "integer", minimum: 1, maximum: 100 }
            : name === "rotationDegrees" ? { type: "number" } : { type: "array", items: { type: "number" }, minItems: 1, maxItems: 100 },
          source: { type: "string", enum: ["user", "suggestion"] }, replace: { type: "boolean", description: "Only true for an explicit user correction or clarification." },
        },
      }])) } }, required: ["parameters"], additionalProperties: false } } },
  { type: "function", function: { name: "discard_analysis_conditions", description: "Discard unapplied support and nodal load conditions. Keeps confirmed work.",
    parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "propose_analysis_conditions", description: "Prepare a stage preview of supports and nodal forces/moments on applied stable node IDs. Omit unknown collections; empty arrays mean explicitly no changes. Does not apply or solve.",
    parameters: { type: "object", additionalProperties: false, properties: { analysisSourceId: { type: "string", description: "Existing load case or combination to select and calculate after confirmation. When omitted, a single proposed nodal load case is selected; otherwise the current source is retained." }, ...Object.fromEntries(["supports", "nodalLoads"].map((key) => [key, {
      type: "array", maxItems: 100, items: { type: "object", additionalProperties: false,
        required: key === "supports" ? ["nodeId", "restraints", "source"] : ["nodeId", "loadCaseId", "force", "moment", "source"],
        properties: { id: { type: "string", description: "Existing condition ID for updates; omit to create." }, nodeId: { type: "string" }, source: { type: "string", enum: ["user", "suggestion"] },
          ...(key === "supports" ? { restraints: { type: "array", minItems: 6, maxItems: 6, items: { type: "boolean" }, description: "UX UY UZ RX RY RZ; true means restrained." } }
            : { loadCaseId: { type: "string" }, ...Object.fromEntries(["force", "moment"].map((kind) => [kind, { type: "object", additionalProperties: false, required: ["x", "y", "z"], properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } }, description: kind === "force" ? "Global XYZ kN" : "Global XYZ kN*m right hand rule" }])) }),
        },
      },
    }])) } } } },
];
const MAX_CHAT_BYTES = 1_048_576;
const MAX_TOOL_CALLS = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}
function parseToolCall(value: unknown, allowResponseIndex: boolean): DeepSeekToolCall | null {
  if (!isRecord(value) || !hasOnlyKeys(value, allowResponseIndex ? ["id", "type", "function", "index"] : ["id", "type", "function"])
    || allowResponseIndex && value.index !== undefined && (typeof value.index !== "number" || !Number.isSafeInteger(value.index) || value.index < 0)
    || !isIdentifier(value.id)
    || value.type !== "function" || !isRecord(value.function) || !hasOnlyKeys(value.function, ["name", "arguments"])
    || typeof value.function.name !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value.function.name)
    || typeof value.function.arguments !== "string" || Buffer.byteLength(value.function.arguments) > 16_384) return null;
  return { id: value.id, type: "function", function: { name: value.function.name, arguments: value.function.arguments } };
}
function parseAssistant(value: unknown, strictKeys = false): DeepSeekAssistantMessage | null {
  if (!isRecord(value) || value.role !== "assistant" || value.content !== null && typeof value.content !== "string"
    || strictKeys && !hasOnlyKeys(value, ["role", "content", "tool_calls"])) return null;
  let toolCalls: DeepSeekToolCall[] | undefined;
  if (value.tool_calls !== undefined && value.tool_calls !== null) {
    if (!Array.isArray(value.tool_calls) || value.tool_calls.length === 0 || value.tool_calls.length > MAX_TOOL_CALLS) return null;
    // DeepSeek may attach index metadata even to non-streaming tool calls; omit it from replay.
    const parsed = value.tool_calls.map((call) => parseToolCall(call, !strictKeys));
    if (parsed.some((call) => !call) || new Set(parsed.map((call) => call!.id)).size !== parsed.length) return null;
    toolCalls = parsed as DeepSeekToolCall[];
  }
  if (!toolCalls && (typeof value.content !== "string" || !value.content.trim())) return null;
  return { role: "assistant", content: value.content, ...(toolCalls ? { tool_calls: toolCalls } : {}) };
}
function parseChatRequest(value: unknown): DeepSeekChatRequest | null {
  try {
    if (!isRecord(value) || !hasOnlyKeys(value, ["requestId", "messages"]) || !isIdentifier(value.requestId)
      || !Array.isArray(value.messages) || value.messages.length === 0 || value.messages.length > 100
      || Buffer.byteLength(JSON.stringify(value)) > MAX_CHAT_BYTES) return null;
    const result: DeepSeekChatMessage[] = [];
    const pending = new Set<string>();
    const used = new Set<string>();
    for (const message of value.messages) {
      if (!isRecord(message)) return null;
      if (message.role === "tool") {
        if (!hasOnlyKeys(message, ["role", "content", "tool_call_id"]) || typeof message.content !== "string"
          || !message.content || !isIdentifier(message.tool_call_id) || !pending.delete(message.tool_call_id)) return null;
        result.push({ role: "tool", content: message.content, tool_call_id: message.tool_call_id });
      } else {
        if (pending.size) return null;
        if (message.role === "assistant") {
          const assistant = parseAssistant(message, true);
          if (!assistant) return null;
          for (const call of assistant.tool_calls ?? []) {
            if (used.has(call.id)) return null;
            used.add(call.id); pending.add(call.id);
          }
          result.push(assistant);
        } else if ((message.role === "user" || message.role === "system") && hasOnlyKeys(message, ["role", "content"])
          && typeof message.content === "string" && message.content.trim()) {
          result.push({ role: message.role, content: message.content });
        } else return null;
      }
    }
    return pending.size ? null : { requestId: value.requestId, messages: result };
  } catch { return null; }
}
async function readAssistant(response: Response, apiKey: string, signal: AbortSignal): Promise<DeepSeekAssistantMessage | null> {
  if (!response.body) return null;
  if (Number(response.headers.get("content-length")) > MAX_CHAT_BYTES) {
    void response.body.cancel().catch(() => undefined);
    return null;
  }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let text = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_CHAT_BYTES) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    if (text.includes(apiKey)) return null;
    const value = JSON.parse(text);
    const assistant = parseAssistant(value?.choices?.[0]?.message);
    return assistant && !JSON.stringify(assistant).includes(apiKey) ? assistant : null;
  } catch { return null; }
  finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}

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
  private activeChats = new Map<string, AbortController>();

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

  private abortChats(): void {
    for (const controller of this.activeChats.values()) controller.abort();
    this.activeChats.clear();
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
        this.abortChats();
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
      this.abortChats();
      return this.result("removed", (await this.read()).settings);
    });
  }

  async chat(input: unknown): Promise<DeepSeekChatResult> {
    const result = (status: DeepSeekStatus): DeepSeekChatResult => ({ status, message: status === "success" ? "AI 响应已接收"
      : status === "invalid-input" ? "AI 请求格式无效或超出限制"
      : status === "cancelled" ? "AI 请求已取消" : status === "timeout" ? "AI 请求超时，请稍后重试" : messages[status] });
    const request = parseChatRequest(input);
    if (!request) return result("invalid-input");
    const { settings, credential, controller } = await this.serial(async () => {
      this.activeChats.get(request.requestId)?.abort();
      const controller = new AbortController();
      this.activeChats.set(request.requestId, controller);
      return { ...await this.read(), controller };
    });
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (() => void) | undefined;
    try {
      if (controller.signal.aborted) return result("cancelled");
      if (!credential) return result(settings.issue ?? "not-configured");
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectAbort = () => reject(new Error("Aborted"));
        controller.signal.addEventListener("abort", rejectAbort, { once: true });
        timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
      });
      const performRequest = async (): Promise<DeepSeekChatResult> => {
        const response = await this.fetcher("https://api.deepseek.com/chat/completions", {
          method: "POST", redirect: "error", signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential.apiKey}` },
          body: JSON.stringify({ model: credential.model, messages: request.messages, tools: modelTools,
            tool_choice: "auto", thinking: { type: "disabled" }, stream: false, max_tokens: 2048 }),
        });
        if (controller.signal.aborted || !response.ok) {
          void response.body?.cancel().catch(() => undefined);
          return result(controller.signal.aborted ? "cancelled"
            : response.status === 401 || response.status === 403 ? "authentication"
            : response.status === 402 ? "balance" : response.status === 429 ? "rate-limit"
            : [400, 404, 422].includes(response.status) ? "invalid-response" : "service");
        }
        const assistant = await readAssistant(response, credential.apiKey, controller.signal);
        if (!assistant) return result("invalid-response");
        return { ...result("success"), assistant };
      };
      const response = await Promise.race([performRequest(), aborted]);
      return controller.signal.aborted ? result(timedOut ? "timeout" : "cancelled") : response;
    } catch {
      return result(controller.signal.aborted ? timedOut ? "timeout" : "cancelled" : "network");
    } finally {
      clearTimeout(timer);
      if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
      if (this.activeChats.get(request.requestId) === controller) this.activeChats.delete(request.requestId);
    }
  }

  cancelChat(requestId: unknown): Promise<void> {
    return this.serial(async () => {
      if (isIdentifier(requestId)) this.activeChats.get(requestId)?.abort();
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
