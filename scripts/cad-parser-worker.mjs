import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { stdin, stdout } from "node:process";
import { hashAudit, parseStepIntermediate, STEP_READER_INFO } from "./step-intermediate.mjs";

export const CAD_PARSER_VERSION = "framemind-step-reader/2.0.0";
export const CAD_KERNEL = {
  ...STEP_READER_INFO,
};

const write = (message) => stdout.write(`${JSON.stringify(message)}\n`);
const phase = (requestId, stage) => write({ kind: "phase", requestId, record: { stage, startedAt: new Date().toISOString() } });
const error = (requestId, code, message, stage, extra = {}) => {
  write({ kind: "error", requestId, error: { code, message, stage, parserVersion: CAD_PARSER_VERSION, kernel: CAD_KERNEL, ...extra } });
  process.exitCode = 1;
};
const readRequest = async () => {
  let value = "";
  for await (const chunk of stdin) value += chunk;
  return JSON.parse(value);
};
const lineAt = (text, index) => text.slice(0, index).split(/\r?\n/).length;
const first = (text, pattern) => text.match(pattern)?.[1]?.trim();

let currentRequestId = "cad_unknown";
try {
  const request = await readRequest();
  currentRequestId = typeof request?.requestId === "string" ? request.requestId : currentRequestId;
  if (!request || typeof request.requestId !== "string" || typeof request.inputPath !== "string") {
    error(request?.requestId ?? "cad_invalid", "cad-invalid-request", "CAD 任务请求无效", "startup");
  } else {
    const requestId = request.requestId;
    const extension = extname(request.inputPath).toLowerCase();
    if (extension !== ".step" && extension !== ".stp") {
      error(requestId, "cad-unsupported-extension", "CAD 输入必须是 .step 或 .stp 文件", "startup");
    } else {
      phase(requestId, "read");
      let bytes;
      try { bytes = await readFile(request.inputPath); }
      catch (cause) { error(requestId, "cad-input-unreadable", "CAD 文件无法读取", "read"); bytes = null; }
      if (!bytes) {
        // The structured error above is the terminal response for this task.
      } else {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (request.expectedSha256 && request.expectedSha256 !== sha256) {
        error(requestId, "cad-input-hash-mismatch", "CAD 输入哈希与任务登记不一致", "read");
      } else {
        phase(requestId, "parse");
        const text = bytes.toString("utf8");
        const start = text.indexOf("ISO-10303-21;");
        const end = text.lastIndexOf("END-ISO-10303-21;");
        if (start < 0 || end < start) {
          error(requestId, "cad-invalid-step", "文件不是完整的 ISO 10303-21 STEP 文档", "parse", { line: 1 });
        } else if (!/HEADER\s*;/i.test(text) || !/DATA\s*;/i.test(text) || !/ENDSEC\s*;/i.test(text)) {
          error(requestId, "cad-invalid-step", "STEP 文件缺少 HEADER、DATA 或 ENDSEC 段", "parse", { line: lineAt(text, start) });
        } else {
          const entities = [];
          const entityPattern = /#(\d+)\s*=\s*([A-Z][A-Z0-9_]*)\s*\(/gi;
          let match;
          while ((match = entityPattern.exec(text))) entities.push({ id: Number(match[1]), type: match[2].toUpperCase(), line: lineAt(text, match.index) });
          const malformedEntity = text.split(/\r?\n/).find((line) => /^\s*#\d+\s*=/.test(line) && !/^\s*#\d+\s*=\s*[A-Z][A-Z0-9_]*\s*\(/i.test(line) && !/^\s*#\d+\s*=\s*\(/.test(line));
          if (malformedEntity) {
            const malformedId = Number(malformedEntity.match(/#(\d+)/)?.[1]);
            error(requestId, "cad-partial-entity", "STEP 实体记录不完整，解析已停止", "parse", { entityId: malformedId, line: text.split(/\r?\n/).indexOf(malformedEntity) + 1 });
          } else {
          const products = entities.filter((entity) => entity.type === "PRODUCT").length;
          const solidBreps = entities.filter((entity) => entity.type === "MANIFOLD_SOLID_BREP").length;
          const assemblyInstances = entities.filter((entity) => entity.type === "NEXT_ASSEMBLY_USAGE_OCCURRENCE").length;
          const warnings = [];
          if (entities.length === 0) warnings.push("STEP DATA 段没有可识别的实体定义");
          if (solidBreps === 0) warnings.push("未发现 MANIFOLD_SOLID_BREP；后续几何重建需要人工确认");
          const headerText = text.slice(start, text.indexOf("ENDSEC;", start) + 7);
          const application = first(headerText, /APPLICATION_PROTOCOL_DEFINITION\s*\([^,]+,\s*'([^']+)'/i);
          const schema = first(headerText, /FILE_SCHEMA\s*\(\s*\(('([^']+)'|[^)]+)\)/i);
          const units = /MILLI|MILLIMETRE|MILLIMETER/i.test(text) ? "millimetre (inferred from STEP units context)" : undefined;
          let parsed;
          try {
            parsed = parseStepIntermediate(bytes, { inputSha256: sha256, parserVersion: CAD_PARSER_VERSION, parameters: request.parameters });
          } catch (cause) {
            error(requestId, "cad-intermediate-error", cause instanceof Error ? cause.message : "STEP 中间态生成失败", "finalize");
            parsed = null;
          }
          if (parsed) {
            phase(requestId, "finalize");
            const audit = { ...parsed.audit, requestId, recordedAt: new Date().toISOString() };
            write({ kind: "result", requestId, parserVersion: CAD_PARSER_VERSION, kernel: CAD_KERNEL,
              input: { sha256, sizeBytes: bytes.length, extension },
              diagnostics: { products, solidBreps, assemblyInstances, entities: entities.length, header: { ...(application ? { application } : {}), ...(schema ? { schema } : {}), ...(units ? { units } : {}) }, ...parsed.state.diagnostics, warnings: [...warnings, ...parsed.state.warnings] },
              intermediateState: { ...parsed.state, source: { inputSha256: sha256, parserVersion: CAD_PARSER_VERSION }, geometryHash: parsed.geometryHash, auditHash: hashAudit(audit) },
              audit,
              aiSummary: parsed.aiSummary,
            });
          }
          }
        }
      }
      }
    }
  }
} catch (cause) {
  const detail = cause instanceof Error ? cause.message.replace(/[A-Za-z]:[\\/][^\\n]*/g, "<path>") : "未知错误";
  error(currentRequestId, "cad-worker-error", `CAD worker 发生未知错误：${detail}`, "read");
}
