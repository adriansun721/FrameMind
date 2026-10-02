import type { DeepSeekChatMessage, DeepSeekToolCall, FrameMindDesktopApi } from "../../electron/contracts";
import { executeAiTool, type AiContext, type AiSnapshot, type AiStatus, type AiToolResult } from "./ai-tools";
import { frameResourceOptions, type FrameProposal } from "./frame-proposal";

export type AiTransport = Pick<FrameMindDesktopApi, "chatDeepSeek" | "cancelDeepSeekChat">;
export interface AiToolRecord { round: number; call: DeepSeekToolCall; result: AiToolResult; }
export interface AiProgress {
  phase: "requesting" | "tool" | "responding";
  round: number;
  toolCall?: DeepSeekToolCall;
  toolResult?: AiToolResult;
}
export interface AiTaskResult {
  status: AiStatus;
  message: string;
  context: AiContext;
  assistant?: string;
  records: readonly AiToolRecord[];
  proposal?: FrameProposal | null;
}
export interface AiTaskOptions {
  transport: AiTransport;
  isCurrent(): boolean;
  history?: readonly { role: "user" | "assistant"; content: string }[];
  proposal?: FrameProposal;
  onProgress?(progress: AiProgress): void;
}
export interface AiTask { requestId: string; promise: Promise<AiTaskResult>; cancel(): void; }

const MAX_ROUNDS = 8;
const MAX_TOOL_RECORDS = 64;

export function startAiTask(snapshot: AiSnapshot, prompt: string, options: AiTaskOptions): AiTask {
  const requestId = `ai_${crypto.randomUUID()}`;
  let cancelled = false;
  let settled = false;
  let resolveCancellation!: (result: AiTaskResult) => void;
  const cancellation = new Promise<AiTaskResult>((resolve) => { resolveCancellation = resolve; });
  const records: AiToolRecord[] = [];
  let proposal: FrameProposal | null | undefined = options.proposal;
  const messages: DeepSeekChatMessage[] = [
    { role: "system", content: `你是 FrameMind 模型助手。通过 read_model、read_selection、read_objects 读取已应用模型，引用稳定对象身份、单位及真实工具数据。read_model 必须提供 collection（summary/nodes/members/materials/sections/supports/loads/load-cases），offset 默认为0，limit 默认为50且不超过100。read_selection 参数为{}，read_objects 参数为 {objects:[{kind:node或member,id:稳定身份}]}。新建结构请求的第一个工具必须是 propose_frame，即使只有层数等少数已知参数也先生成卡片，不要先读已有模型或选择。新建结构不需要已有节点或选中对象，资源列表已在本提示中。没有选中对象时禁止调用 read_selection。建模请求必须调用 propose_frame 生成参数卡片，不能仅用文字描述方案。仅支持沿全局 XYZ 正交网格、Z 向分层的空间刚接梁柱框架。parameters 是部分字段映射，各字段格式 {value,source:user或suggestion,replace?:boolean}。字段 storeys 为层数整数，必须与 storeyHeights 数组长度一致。xSpans/ySpans 为按顺序跨长数组(m)，storeyHeights 为每层层高数组(m)，origin 为三个坐标(m)，material/columnSection/beamSection 为资源标识，rotationDegrees 为度。用户未给定的值留空，或明确标记 suggestion，绝不冒充用户输入；仅对用户明确改正或澄清的字段使用 replace:true 和 source:user。两层的层高未知时不捏造用户层高，提供待确认建议或询问。当前卡片为补充参数的唯一依据，卡片编辑优先于对话历史。不支持的结构应说明并询问，不强行改成正交框架。用户明确拒绝或取消方案时调用 discard_frame_proposal，参数为{}。没有结果时不编造数值或规范结论。不执行脚本、应用模型修改或计算；完整方案仍需阶段确认。可用钢材：${JSON.stringify(frameResourceOptions(snapshot, "material"))}。可用截面：${JSON.stringify(frameResourceOptions(snapshot, "beamSection"))}。当前参数卡片：${JSON.stringify(options.proposal?.parameters ?? null)}。上下文：${JSON.stringify(snapshot.context)}` },
    ...(options.history ?? []), { role: "user", content: prompt.trim() },
  ];
  const result = (status: AiStatus, message: string, assistant?: string): AiTaskResult => ({
    status, message, context: snapshot.context, assistant, records: records.slice(), proposal,
  });
  const run = async (): Promise<AiTaskResult> => {
    for (let round = 1; ; round += 1) {
      if (cancelled || !options.isCurrent()) return result("cancelled", "对话上下文已改变，请基于当前模型重新发送");
      if (round > MAX_ROUNDS) return result("failed", "工具读取轮次已达上限，请缩小对象范围或分开提问");
      options.onProgress?.({ phase: "requesting", round });
      const response = await options.transport.chatDeepSeek({ requestId, messages });
      if (cancelled) return result("cancelled", "对话已取消");
      if (!options.isCurrent()) return result("cancelled", "对话上下文已改变，请基于当前模型重新发送");
      if (response.status !== "success" || !response.assistant) return result(response.status === "cancelled" ? "cancelled" : "failed", response.message);
      const assistant = response.assistant;
      if (!assistant.tool_calls?.length) {
        options.onProgress?.({ phase: "responding", round });
        return result("completed", records.length ? "已根据当前已应用模型完成回复" : "AI 回复已接收，未读取模型工具", assistant.content ?? undefined);
      }
      messages.push(assistant);
      for (const call of assistant.tool_calls) {
        if (cancelled || !options.isCurrent()) return result("cancelled", "对话上下文已改变，请基于当前模型重新发送");
        if (records.length >= MAX_TOOL_RECORDS) return result("failed", "工具读取数量已达上限，请缩小对象范围或分开提问");
        options.onProgress?.({ phase: "tool", round, toolCall: call });
        const toolResult = executeAiTool(snapshot, call, proposal ?? undefined);
        if (toolResult.proposal !== undefined) proposal = toolResult.proposal;
        records.push({ round, call, result: toolResult });
        options.onProgress?.({ phase: "tool", round, toolCall: call, toolResult });
        if (toolResult.status !== "completed") return result(toolResult.status, toolResult.message);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(toolResult) });
      }
    }
  };
  const promise = Promise.race([
    run().catch(() => result(cancelled ? "cancelled" : "failed", cancelled ? "对话已取消" : "对话未完成，请检查连接设置后重试")),
    cancellation,
  ]).then((value) => { settled = true; return value; });
  return { requestId, promise, cancel: () => {
    if (settled || cancelled) return;
    cancelled = true;
    resolveCancellation(result("cancelled", "对话已取消"));
    void Promise.resolve().then(() => options.transport.cancelDeepSeekChat(requestId)).catch(() => {});
  } };
}
