import type { DeepSeekToolCall } from "../../electron/contracts";
import { executeAiTool, type AiSnapshot, type AiToolResult } from "./ai-tools";
import type { DiagnosticCopy } from "./diagnostic-trial";

interface DiagnosticWorkerScope {
  onmessage: ((event: MessageEvent<{ snapshot: AiSnapshot; call: DeepSeekToolCall; copy?: DiagnosticCopy }>) => void) | null;
  postMessage(result: AiToolResult): void;
}
const scope = globalThis as unknown as DiagnosticWorkerScope;
scope.onmessage = ({ data }) => {
  scope.postMessage(executeAiTool(data.snapshot, data.call, undefined, undefined, undefined, undefined, undefined, data.copy));
};
