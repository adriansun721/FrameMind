import type { DeepSeekChatMessage, DeepSeekToolCall, FrameMindDesktopApi } from "../../electron/contracts";
import { executeAiTool, type AiContext, type AiSnapshot, type AiStatus, type AiToolResult } from "./ai-tools";
import { frameResourceOptions, type FrameProposal } from "./frame-proposal";
import type { ConditionsProposal } from "./analysis-conditions";

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
  conditions?: ConditionsProposal | null;
}
export interface AiTaskOptions {
  transport: AiTransport;
  isCurrent(): boolean;
  history?: readonly { role: "user" | "assistant"; content: string }[];
  proposal?: FrameProposal;
  conditions?: ConditionsProposal;
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
  let conditions: ConditionsProposal | null | undefined = options.conditions;
  const messages: DeepSeekChatMessage[] = [
    { role: "system", content: `你是 FrameMind 模型助手。通过 read_model、read_selection、read_objects 读取已应用模型，引用稳定对象身份、单位及真实工具数据。read_model 必须提供 collection（summary/nodes/members/materials/sections/supports/loads/load-cases），offset 默认为0，limit 默认为50且不超过100。read_selection 参数为{}，read_objects 参数为 {objects:[{kind:node或member,id:稳定身份}]}。新建结构请求的第一个工具必须是 propose_frame，即使只有层数等少数已知参数也先生成卡片，不要先读已有模型或选择。新建结构不需要已有节点或选中对象，资源列表已在本提示中。没有选中对象时禁止调用 read_selection。建模请求必须调用 propose_frame 生成参数卡片，不能仅用文字描述方案。仅支持沿全局 XYZ 正交网格、Z 向分层的空间刚接梁柱框架。parameters 是部分字段映射，各字段格式 {value,source:user或suggestion,replace?:boolean}。字段 storeys 为层数整数，必须与 storeyHeights 数组长度一致。xSpans/ySpans 为按顺序跨长数组(m)，storeyHeights 为每层层高数组(m)，origin 为三个坐标(m)，material/columnSection/beamSection 为资源标识，rotationDegrees 为度。用户未给定的值留空，或明确标记 suggestion，绝不冒充用户输入；仅对用户明确改正或澄清的字段使用 replace:true 和 source:user。两层的层高未知时不捏造用户层高，提供待确认建议或询问。当前卡片为补充参数的唯一依据，卡片编辑优先于对话历史。不支持的结构应说明并询问，不强行改成正交框架。用户明确拒绝或取消方案时调用 discard_frame_proposal，参数为{}。没有结果时不编造数值或规范结论。不执行脚本或计算，不得通过工具直接应用模型修改。完整方案由用户在卡片中点击“确认应用建模阶段”后本地原子应用；聊天中的同意不能替代该确认。已确认内容以当前已应用模型为准，后续新增修改必须重新生成预览并再次确认。可用钢材：${JSON.stringify(frameResourceOptions(snapshot, "material"))}。可用截面：${JSON.stringify(frameResourceOptions(snapshot, "beamSection"))}。当前参数卡片：${JSON.stringify(options.proposal?.parameters ?? null)}。上下文：${JSON.stringify(snapshot.context)}` },
    { role: "system", content: `支座与节点力/力矩由 propose_analysis_conditions 准备，不直接应用。当前消息若说明“建模阶段已确认”，其中引用的原请求不是新的建模请求，此时禁止 propose_frame，继续读取正式对象并准备条件。必须先用 read_model 读取正式 nodes/supports/loads/load-cases，引用真实 nodeId/id/loadCaseId；禁止用预览身份或标签代替稳定身份。该工具部分字段 supports/nodalLoads 分别为数组；省略代表尚缺失，空数组仅代表用户明确没有新增该类条件。条目 source 为 user 或 suggestion。supports 条目 {id?:已有支座身份,nodeId,restraints:[UX,UY,UZ,RX,RY,RZ六个布尔值],source}；nodalLoads 条目 {id?:已有荷载身份,nodeId,loadCaseId,force:{x,y,z},moment:{x,y,z},source}。全局 XYZ，力 kN、力矩 kN·m，按右手规则。未知分量不要冒充用户提供，建议必须标记 suggestion。修改已有支座或荷载必须提供其 id，否则是新增。完整阶段由用户点击“确认应用分析条件阶段”。用户已要求建模并计算时，建模确认后继续准备必要条件，条件确认后本地续算；不要要求用户再次授权同一计算。拒绝条件时调用 discard_analysis_conditions。当前条件卡片：${JSON.stringify(options.conditions ?? null)}。` },
    { role: "system", content: "仅当用户明确要求计算当前已应用模型，并且本轮无需准备任何变更阶段时，调用 request_analysis（参数{}）记录续算请求。该工具尚未计算，结果由本地应用实际求解后展示。只是解释计算过程、读取数据或问答时不要调用；建模或条件尚缺时必须先准备对应卡片，不能用 request_analysis 跳过这些阶段。" },
    { role: "system", content: "分析条件卡片还可指定 analysisSourceId，表示确认后选中并计算的现有工况或组合。用户明确指定已有工况时，荷载 loadCaseId 和续算 analysisSourceId 必须一致；若明确请求组合，则提供该组合身份。卡片会显示当前来源到确认后来源的变化，不创建工况或组合，不擅自改系数。省略时，新方案仅有一个节点荷载工况则以该工况续算，否则保留当前来源。" },
    ...(options.history ?? []), { role: "user", content: prompt.trim() },
  ];
  const result = (status: AiStatus, message: string, assistant?: string): AiTaskResult => ({
    status, message, context: snapshot.context, assistant, records: records.slice(), proposal, conditions,
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
        const toolResult = executeAiTool(snapshot, call, proposal ?? undefined, conditions ?? undefined);
        if (toolResult.proposal !== undefined) proposal = toolResult.proposal;
        if (toolResult.conditions !== undefined) conditions = toolResult.conditions;
        records.push({ round, call, result: toolResult });
        options.onProgress?.({ phase: "tool", round, toolCall: call, toolResult });
        if (toolResult.proposal === null || toolResult.conditions === null) return result("completed", toolResult.message);
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
