import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";

/** Main-process-only paths; the renderer confirms a parsed request identity, never supplies a path to hash. */
export class CadImportSources {
  private readonly sources = new Map<string, { path: string; sha256: string }>();
  register(owner: number, requestId: string, path: string, sha256: string): void {
    for (const key of this.sources.keys()) if (key.startsWith(`${owner}:`)) this.sources.delete(key);
    this.sources.set(`${owner}:${requestId}`, { path, sha256 });
  }
  async verify(owner: number, request: { requestId: string; inputSha256: string }): Promise<void> {
    if (!request || typeof request.requestId !== "string" || !/^[a-f0-9]{64}$/.test(request.inputSha256)) throw new Error("导入来源身份无效");
    const source = this.sources.get(`${owner}:${request.requestId}`);
    if (!source || source.sha256 !== request.inputSha256) throw new Error("STEP 解析会话已失效，请重新读取原文件");
    let currentHash: string;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const size = (await stat(source.path)).size;
      if (size < 1 || size > 256 * 1024 * 1024) throw new Error("source size invalid");
      const hash = createHash("sha256");
      let bytes = 0;
      for await (const chunk of createReadStream(source.path, { signal: controller.signal })) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 256 * 1024 * 1024) throw new Error("source grew beyond budget");
        hash.update(chunk);
      }
      currentHash = hash.digest("hex");
    } catch { throw new Error("原 STEP 缺失、不可读或超出预算，无法重新核验来源；正式模型未应用"); }
    finally { clearTimeout(timer); }
    if (this.sources.get(`${owner}:${request.requestId}`) !== source) throw new Error("STEP 解析会话已失效，请重新读取原文件");
    if (currentHash !== source.sha256) throw new Error("原 STEP 字节已变化，请重新解析并核验；正式模型未应用");
  }
}
