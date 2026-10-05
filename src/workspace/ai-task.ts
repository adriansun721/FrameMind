import type { DeepSeekChatMessage, DeepSeekChatResult, DeepSeekToolCall, FrameMindDesktopApi } from "../../electron/contracts";
import { captureAiSnapshot, executeAiTool, type AiContext, type AiSnapshot, type AiStatus, type AiToolResult } from "./ai-tools";
import { frameResourceOptions, type FrameProposal } from "./frame-proposal";
import type { ConditionsProposal } from "./analysis-conditions";
import type { SectionChangeProposal } from "./section-stage";
import type { ModelEditProposal } from "./model-edits";
import type { TaskDraft } from "./task-draft";
import type { DiagnosticComparison, DiagnosticCopy, DiagnosticTrial } from "./diagnostic-trial";
import type { FrameProject } from "../domain/project";
import { coordinateFrame, coordinateModelEdits, coordinateSection, coordinateTaskDraft, engineeringDraftTargets, targetConflicts, validateConditions } from "./draft-coordination";
import { createExplorationBudget, type ExplorationBudgetOptions, type ExplorationBudgetSnapshot } from "./exploration-budget";
import { startDiagnosticToolTask, type DiagnosticToolTask } from "./diagnostic-tool-task";
import type { AnalysisStage } from "../domain/analysis-diagnostics";

export type AiTransport = Pick<FrameMindDesktopApi, "chatDeepSeek" | "cancelDeepSeekChat">;
export type AiWorkKind = "conversation" | "agent";
export interface AiToolRecord { round: number; call: DeepSeekToolCall; result: AiToolResult; }
export interface AiProgress {
  phase: "requesting" | "tool" | "responding";
  round: number;
  toolCall?: DeepSeekToolCall;
  toolResult?: AiToolResult;
  analysisPhase?: AnalysisStage;
  exploration?: ExplorationBudgetSnapshot;
}
export interface AiTaskResult {
  requestId?: string;
  retryOf?: string;
  interruption?: { phase: AiProgress["phase"]; round: number; completedTools: number; draftsDiscarded: boolean };
  status: AiStatus;
  workKind: AiWorkKind;
  message: string;
  context: AiContext;
  assistant?: string;
  records: readonly AiToolRecord[];
  proposal?: FrameProposal | null;
  conditions?: ConditionsProposal | null;
  sectionChange?: SectionChangeProposal | null;
  modelEdits?: ModelEditProposal | null;
  taskDraft?: TaskDraft | null;
  diagnosticCopy?: DiagnosticCopy | null;
  diagnosticTrial?: DiagnosticTrial;
  diagnosticComparison?: DiagnosticComparison;
  draftBaseProject?: FrameProject;
  exploration?: ExplorationBudgetSnapshot;
  lifecycle?: { request: { id: string; state: "initiated" }; response: { kind: "none" | "text" | "tool"; state: "received" | "not-received" }; task: { state: "completed" | "failed" | "cancelled"; status: AiStatus } };
}
export interface AiTaskOptions {
  retryOf?: string;
  transport: AiTransport;
  isCurrent(): boolean;
  getCurrentSnapshot(): AiSnapshot;
  history?: readonly { role: "user" | "assistant"; content: string }[];
  proposal?: FrameProposal;
  conditions?: ConditionsProposal;
  sectionChange?: SectionChangeProposal;
  modelEdits?: ModelEditProposal;
  taskDraft?: TaskDraft;
  diagnosticCopy?: DiagnosticCopy;
  onProgress?(progress: AiProgress): void;
  onOutput?(output: Pick<AiTaskResult, "assistant" | "records">): void;
  /** Supplying this enables bounded autonomous exploration for this task. */
  exploration?: ExplorationBudgetOptions;
  onExploration?(snapshot: ExplorationBudgetSnapshot): void;
}
export interface AiTask { requestId: string; promise: Promise<AiTaskResult>; cancel(): void; pause(): boolean; resume(): void; }

const MAX_ROUNDS = 8;
const MAX_TOOL_RECORDS = 64;

function explorationStopMessage(snapshot: ExplorationBudgetSnapshot): string {
  switch (snapshot.stopReason) {
    case "budget-exhausted": return `探索预算已用尽（${Math.round(snapshot.elapsedMs / 1000)} 秒活动时间，模式：${snapshot.mode}）。${snapshot.nextSteps.join(" ")}`;
    case "no-progress": return `探索已停止：连续 ${snapshot.noProgressRounds} 轮没有新证据。${snapshot.nextSteps.join(" ")}`;
    case "repeated-failure": return `探索已停止：同一失败已重复 ${snapshot.repeatedFailures} 次。${snapshot.nextSteps.join(" ")}`;
    case "resource-limit": return `探索已达到资源上限（轮次 ${snapshot.rounds}、调用 ${snapshot.toolCalls}、候选 ${snapshot.candidates}、分析 ${snapshot.analyses}）。${snapshot.nextSteps.join(" ")}`;
    case "cancelled": return `探索已取消。${snapshot.nextSteps.join(" ")}`;
    default: return "探索未完成，请根据已保留证据决定下一步。";
  }
}

function outcomeFingerprint(result: AiToolResult): { evidenceKey?: string; failureKey?: string } {
  if (result.status === "failed") return { failureKey: `${result.message}:${JSON.stringify(result.data ?? null)}` };
  if (result.status !== "completed" && result.status !== "applied") return {};
  return { evidenceKey: JSON.stringify({ status: result.status, data: result.data ?? null, reference: result.reference ?? null, diagnosticTrial: result.diagnosticTrial ? { id: result.diagnosticTrial.id, status: result.diagnosticTrial.status } : null }) };
}

function publicDiagnosticResult(result: AiToolResult): AiToolResult {
  const output = { ...result } as AiToolResult & { diagnosticCopy?: unknown };
  delete output.diagnosticCopy;
  if (result.diagnosticTrial) output.diagnosticTrial = { ...result.diagnosticTrial, result: undefined };
  const data = result.data as Record<string, unknown> | undefined;
  if (data && typeof data === "object") {
    const next = { ...data };
    const trial = next.trial as Record<string, unknown> | undefined;
    if (trial && typeof trial === "object") next.trial = { ...trial, result: undefined };
    const comparison = next.analysis as Record<string, unknown> | undefined;
    if (comparison && typeof comparison === "object") {
      next.analysis = {
        compatible: comparison.compatible,
        issues: comparison.issues,
        changes: comparison.changes,
        nodes: Array.isArray(comparison.nodes) ? comparison.nodes.map((item) => { const row = item as Record<string, unknown>; return { id: row.id, label: row.label, displacementDelta: row.displacementDelta, reactionDelta: row.reactionDelta }; }) : [],
        members: Array.isArray(comparison.members) ? comparison.members.map((item) => { const row = item as Record<string, unknown>; return { id: row.id, label: row.label, startDelta: row.startDelta, endDelta: row.endDelta }; }) : [],
      };
    }
    output.data = next;
  }
  if (result.diagnosticComparison) output.diagnosticComparison = { ...result.diagnosticComparison, analysis: result.diagnosticComparison.analysis ? {
    compatible: result.diagnosticComparison.analysis.compatible,
    issues: result.diagnosticComparison.analysis.issues,
    changes: result.diagnosticComparison.analysis.changes,
    nodes: result.diagnosticComparison.analysis.nodes.map(({ id, label, displacementDelta, reactionDelta }) => ({ id, label, displacementDelta, reactionDelta })),
    members: result.diagnosticComparison.analysis.members.map(({ id, label, startDelta, endDelta }) => ({ id, label, startDelta, endDelta })),
  } as never : undefined };
  return output;
}

export function startAiTask(snapshot: AiSnapshot, prompt: string, options: AiTaskOptions): AiTask {
  const requestId = `ai_${crypto.randomUUID()}`;
  const exploration = options.exploration ? createExplorationBudget(options.exploration) : undefined;
  const explorationNow = options.exploration?.now ?? (() => Date.now());
  let cancelled = false;
  let settled = false;
  let paused = false;
  let releasePause: (() => void) | undefined;
  let interruptRequest: (() => void) | undefined;
  let activeRequestId: string | undefined;
  let activeDiagnosticTask: DiagnosticToolTask | undefined;
  let requestAttempt = 0;
  const waitForResume = async () => {
    while (paused && !cancelled) await new Promise<void>((resolve) => { releasePause = resolve; });
    releasePause = undefined;
  };
  let resolveCancellation!: (result: AiTaskResult) => void;
  const cancellation = new Promise<AiTaskResult>((resolve) => { resolveCancellation = resolve; });
  const records: AiToolRecord[] = [];
  let proposal: FrameProposal | null | undefined = options.proposal;
  let conditions: ConditionsProposal | null | undefined = options.conditions;
  let sectionChange: SectionChangeProposal | null | undefined = options.sectionChange;
  let modelEdits: ModelEditProposal | null | undefined = options.modelEdits;
  let taskDraft: TaskDraft | null | undefined = options.taskDraft;
  let diagnosticCopy: DiagnosticCopy | null | undefined = options.diagnosticCopy;
  let diagnosticTrial: DiagnosticTrial | undefined;
  let diagnosticComparison: DiagnosticComparison | undefined;
  let draftBaseProject = snapshot.editProject;
  let taskSnapshot: AiSnapshot = { ...snapshot, context: { ...snapshot.context, goal: prompt.trim() } };
  const targets = snapshot.context.selection.map(({ kind, id }) => ({ kind, id }));
  const isCurrent = () => options.isCurrent() && options.getCurrentSnapshot().context.projectId === snapshot.context.projectId;
  const initialReadCall: DeepSeekToolCall = { id: `${requestId}_state`, type: "function", function: { name: "read_model", arguments: JSON.stringify({ collection: "summary" }) } };
  let phase: AiProgress["phase"] = "requesting";
  let currentRound = 1;
  const messages: DeepSeekChatMessage[] = [
    { role: "system", content: `你是 Frame，FrameMind 内负责结构建模与分析的 AI 助手。用户询问姓名或身份时，以 Frame 自称。通过 read_model、read_selection、read_objects 读取已应用模型，引用稳定对象身份、单位及真实工具数据。read_model 必须提供 collection（summary/nodes/members/materials/sections/supports/loads/load-cases），offset 默认为0，limit 默认为50且不超过100。read_selection 参数为{}，read_objects 参数为 {objects:[{kind:node或member,id:稳定身份}]}。当一项用户任务同时包含几何/材料截面、支座、荷载或分析意图时，优先调用 propose_task 生成一份完整任务草案；该工具的 frame.parameters 沿用 propose_frame 的字段格式，supports/nodalLoads 可引用本次 frame 生成的 draft:<frameId>:node:... 身份，省略字段表示尚缺，空数组表示用户明确没有该类变更。完整任务中的所有类别共享任务身份和版本，后续补充只发送改变字段，旧字段必须保留。只有用户点击“确认整体任务”才可应用，聊天同意不能替代按钮。若请求只涉及纯几何建模且不含其他类别，才使用 propose_frame。新建结构不需要已有节点或选中对象，资源列表已在本提示中。没有选中对象时禁止调用 read_selection。仅支持沿全局 XYZ 正交网格、Z 向分层的空间刚接梁柱框架。parameters 是部分字段映射，各字段格式 {value,source:existing/user/catalog/suggestion/assumption/unknown,replace?:boolean}。字段 storeys 为层数整数，必须与 storeyHeights 数组长度一致。xSpans/ySpans 为按顺序跨长数组(m)，storeyHeights 为每层层高数组(m)，origin 为三个坐标(m)，material/columnSection/beamSection 为资源标识，rotationDegrees 为度。existing 表示当前模型事实，catalog 表示目录来源，user 表示用户值，suggestion 表示建议，assumption 表示待确认假设，unknown 表示尚缺来源；unknown 必须补齐，不能当作已确认值。用户未给定的值留空，或明确标记 suggestion/assumption，绝不冒充用户输入；仅对用户明确改正或澄清的字段使用 replace:true 和 source:user。当前卡片为补充参数的唯一依据，卡片编辑优先于对话历史。不支持的结构应说明并询问，不强行改成正交框架。用户明确拒绝完整任务时调用 discard_task_draft，参数为{}；拒绝纯建模方案时调用 discard_frame_proposal。没有结果时不编造数值或规范结论。不执行脚本或计算，不得通过工具直接应用模型修改。已确认内容以当前已应用模型为准，后续新增修改必须重新生成完整草案并再次确认。可用钢材：${JSON.stringify(frameResourceOptions(snapshot, "material"))}。可用截面：${JSON.stringify(frameResourceOptions(snapshot, "beamSection"))}。当前完整任务草案：${JSON.stringify(options.taskDraft ?? null)}。当前纯建模参数卡片：${JSON.stringify(options.proposal?.parameters ?? null)}。上下文：${JSON.stringify(snapshot.context)}` },
    { role: "system", content: `支座与节点力/力矩由 propose_analysis_conditions 准备，不直接应用。当前消息若说明“建模阶段已确认”，其中引用的原请求不是新的建模请求，此时禁止 propose_frame，继续读取正式对象并准备条件。必须先用 read_model 读取正式 nodes/supports/loads/load-cases，引用真实 nodeId/id/loadCaseId；禁止用预览身份或标签代替稳定身份。该工具部分字段 supports/nodalLoads 分别为数组；省略代表尚缺失，空数组仅代表用户明确没有新增该类条件。条目 source 为 existing/user/catalog/suggestion/assumption/unknown；unknown 必须补齐，existing/catalog 用于标记事实来源。supports 条目 {id?:已有支座身份,nodeId,restraints:[UX,UY,UZ,RX,RY,RZ六个布尔值],source}；nodalLoads 条目 {id?:已有荷载身份,nodeId,loadCaseId,force:{x,y,z},moment:{x,y,z},source}。全局 XYZ，力 kN、力矩 kN·m，按右手规则。未知分量不要冒充用户提供，建议必须标记 suggestion。修改已有支座或荷载必须提供其 id，否则是新增。完整阶段由用户点击“确认应用分析条件阶段”。用户已要求建模并计算时，建模确认后继续准备必要条件，条件确认后本地续算；不要要求用户再次授权同一计算。拒绝条件时调用 discard_analysis_conditions。当前条件卡片：${JSON.stringify(options.conditions ?? null)}。` },
    { role: "system", content: "仅当用户明确要求计算当前已应用模型，并且本轮无需准备任何变更阶段时，调用 request_analysis（参数{}）记录续算请求。该工具尚未计算，结果由本地应用实际求解后展示。只是解释计算过程、读取数据或问答时不要调用；建模或条件尚缺时必须先准备对应卡片，不能用 request_analysis 跳过这些阶段。" },
    { role: "system", content: "自主诊断必须先调用 inspect_diagnostics，依据正式模型返回的结构化证据、阶段和稳定对象身份工作。需要验证工程含义假设时调用 create_diagnostic_copy，再用 run_diagnostic_trial 在副本中执行最多20项候选操作；副本、试算结果和失败证据不能写入正式模型或正式 analysisResults。候选支座、连接、荷载、材料、截面或几何改变工程含义，不能偷偷当作修复；必须在摘要中区分 evidence、proven、hypotheses、attempted、impact、remaining，并由用户确认正式草案后再应用。数值成功只表示 solver complete，必须同时说明 engineeringValidity 为 numerically-solved-not-engineering-validated。用 read_diagnostic 读取副本及试算，compare_diagnostic_trials 只比较同一副本中有兼容结果的两次试算；正式模型版本变化后旧副本须重新创建。" },
    { role: "system", content: `propose_analysis_conditions 还支持全部首版荷载与多工况组合，仍只预览。必须先读取 members/materials/sections/loads/load-cases 核对真实身份与已有参数；read_model loads 包含均布荷载和自重，load-cases 包含组合。uniformLoads:[{id?:已有均布荷载身份,memberId:正式杆件身份,coordinateSystem:global或local,loadCaseId,intensity:{x,y,z}:kN/m,source}]，只支持整杆均布力，全局XYZ或杆件局部xyz；不要把竖向全局Z误当局部z。selfWeight:{enabled,loadCaseId,gravity:{x,y,z}:全局m/s²,source}，全结构只一份自重，密度kg/m³与面积m²来自正式材料/截面，不创建等效均布荷载副本。loadCases:[{id?:已有LC身份,ref:唯一方案引用,name,description,source}]；loadCombinations:[{id?:已有CB身份,ref:唯一方案引用,name,terms:[{loadCaseId,factor:有限无量纲系数}],source}]。新建省略id，ref不可冒用其他正式身份；荷载loadCaseId及组合terms可引用工况ref，analysisSourceId可引用新工况/组合ref，确认后才映射正式身份。省略字段保留当前卡片，无新增用空数组；支座与节点荷载仍需明确或给空数组，不重复既有条件。部分自然语言更新应只发送用户改动字段，不能丢弃或重写未改动卡片。所有未知参数留缺失或标为suggestion，绝不自动确认建议。组合始终是用户自定义，允许零、负系数；不擅自添加规范系数、规范类别或符合性结论。用户要求组合计算时明确指定analysisSourceId，未指定时单一新增荷载工况作为来源，否则保留当前来源。` },
    { role: "system", content: `单位规则：read_unit_contract 可核对完整契约；工具数值默认按已声明内部规范单位，不随界面预设变化。混合输入用 inputUnits 显式指定量纲单位，读取可指定 outputUnitPreset。外部数据未注明单位时先询问用户，禁止按数值大小猜测；不要把数值字段名中的 M2/GPa 当成覆盖 inputUnits 的依据。引用与确认草案始终是规范单位。结果解释必须先 read_results（collection:summary/nodes/members，分页limit<=100）读取当前所选分析。当前分析身份：${snapshot.context.analysisId ?? "无成功结果"}。无成功结果时明确需要本地计算，不补造数值。read_result 用 {kind:node或member,id:稳定身份,quantity,component,position?:距杆起点m,analysisId?:当前身份} 核对每个引用项。节点 quantity 为 displacement(m)、rotation(rad)、reaction(kN)、reactionMoment(kN·m)，component 为全局 x/y/z；杆件为 sectionForces（正局部x面截面内力，必须给position）或 startEndForces/endEndForces（杆端节点作用力），component 为 N/Vy/Vz/T/My/Mz，注意符号不同。数值事实直接插入工具返回的 token（如 [[result:call_1]]），界面会显示真实对象、分量、数值和单位；禁止自行拼接、改写标记或引用旧对话标记。解释按“计算事实”和“原因推断”分开，推断须说明依据和不确定性，不把相关性当因果。current:false 必须称历史输入结果，给出分析身份、来源工况/用户自定义组合及输入版本，说明当前模型需重算。禁止从线弹性位移或内力断言安全、强度/稳定/变形合格或符合规范；没有规范验算。关键位移 summary 仅比较节点各平移分量绝对值，不代表连续全结构最大位移。` },
    { role: "system", content: "本软件全局Z竖直向上，X/Y为水平方向，不能把全局y荷载或位移称为竖向。read_results summary 的 frozenConditions 提供本次冻结输入的有效支座、节点荷载、均布荷载和自重，组合有效荷载已按用户系数加权，禁止对有效荷载再次乘系数。originalCombinationLoads只提供未加权原工况荷载，不能混同。原因推断只定性描述已核查的方向和边界条件，不自行计算或引入任何新数值；未核查成因明确未知。原因说明须核对这些真实方向、符号和边界条件，不能用当前已编辑模型条件解释历史数值；若条件总数超过limit，明确展示不完整，不推断未读取部分。当前model快照中的编辑都已经应用；没有当前proposal/conditions卡片时，不得称这些编辑尚未确认或待确认。未重新计算与未确认修改是两种不同状态。不要自行合计条件总数。输出保持理性、冷静、克制，先说明结论，再按需解释依据。默认使用普通文本和连贯的简短自然段；仅在步骤、对照或必要列举时使用简短列表，避免把完整论述拆成大量并列条目。不使用 Markdown 加粗、装饰性星号、表情或其他装饰性符号；保留工具返回的结果与对比引用 token。措辞客观、直接，避免夸张、奉承、口号和不必要的安慰，不反复自我介绍或添加署名。" },
    { role: "system", content: `修改“这些柱”的截面必须调用 propose_section_change，只引用 read_selection 返回的当前选中 Z 向柱。没有选择、引用失效或含非柱时询问用户重新选择，不得扩大到其他杆件。工具参数 {memberIds?:必须与当前选中柱完全一致, sectionId?:项目或库截面ID, section?:{name,areaM2,secondMomentYM4,secondMomentZM4,torsionalConstantM4}, source:user或suggestion}；sectionId 与 section 二选一。新截面 A 单位m²、Iy/Iz/J单位m⁴，未知值不冒充用户输入，建议必须标为suggestion。该工具只生成截面参数前后预览，不修改共享资源；用户点击“确认应用截面修改阶段”后才应用。用户拒绝时 discard_section_change 参数{}。当前截面卡片：${JSON.stringify(options.sectionChange ?? null)}。确认后继续已经请求的重算，不能再创建框架或重复变更条件。` },
    { role: "system", content: `前后对比必须绑定两次确定分析：${JSON.stringify(snapshot.context.comparison ?? null)}。先 read_comparison {collection:summary/nodes/members,offset?:0,limit?:50且<=100}，再 read_comparison_result {kind,id,quantity,component,position?:m,beforeId?:所选前分析,afterId?:所选后分析} 核对数值。summary.objects 提供标签到稳定ID的映射，nodes/members集合提供匹配对象的前后值及差值；必须使用实际id，禁止以N2/M1等标签代替id或自行拼接身份。类型和分量沿用read_result。插入其返回的 [[comparison:调用身份]] token，按钮显示本地前值、后值、后一份减前一份的差值，可打开同一对比表。只用本轮真实引用标记。无确定分析对或compatible:false时明确无法比较；不同工况、组合定义或其他输入变化不能解释为单纯截面影响。sectionAndSelfWeightOnly:true 时仍需说明新面积引起的自重荷载变化和截面刚度变化同时作用。计算事实与原因推断分开，不自行计算百分比或新数值，不给安全或规范合格结论。` },
    { role: "system", content: "对比中的前份历史输入是有意保留的基线，不代表当前模型尚未计算。read_comparison.pairMatchesCurrentInput 只说明这两份中是否有与当前输入一致的结果；false时也可能另有第三份当前结果，不能据此要求当前模型重算。当前所选分析的状态另用read_results核查。若后一份current:true，明确当前模型已有重算结果，不因前份current:false要求再次计算。前后数值始终称各自分析的响应。" },
    { role: "system", content: "方案卡片默认展示摘要，完整参数在详情和编辑侧栏。通过工具成功准备或更新方案后，文字回复只用一两句说明本次变化和需要核对的问题，不重复整张卡片参数、对象明细和操作说明；缺失或歧义需简短澄清。自然语言修改作用于当前待确认方案，保留未修改字段。卡片的实际确认按钮名称为：确认建模、确认条件（有续算请求时为确认并计算）、确认修改（有续算请求时为确认并重算）。文字同意仍不能代替按钮确认。" },
    { role: "system", content: "自由数值建模支持任意有限 XYZ，包括负数、非整数、网格外和斜杆。上文正交框架限制仅适用于 propose_frame 或 propose_task.frame 的参数化生成器，不限制正式节点和杆件。自由坐标创建或修改使用 create_node(s)、update_node(s)、create_member(s)、update_member(s) 或 propose_model_edits；创建节点确认后重读其正式身份，再准备引用这些身份的杆件。连续节点更新按最终几何整体校验，可整体平移或交换端点。先用 read_geometry_contract 核对规范单位 m 的独立容差；不因点击范围、相机缩放、单位切换、节点近重合或杆件几何交叉而自动连接、合并或分割。零长或长度不超过 1e-12 m 的杆件拒绝；需要用户确认草案才修改正式模型。" },
    ...(options.history ?? []), { role: "user", content: prompt.trim() },
  ];
  const result = (status: AiStatus, message: string, assistant?: string): AiTaskResult => {
    const explorationStop = exploration?.snapshot().stopReason;
    const stoppedWithEvidence = explorationStop === "budget-exhausted" || explorationStop === "no-progress" || explorationStop === "repeated-failure" || explorationStop === "resource-limit";
    const interrupted = (status === "failed" || status === "cancelled") && !stoppedWithEvidence;
    const hasAgentTools = records.some((record) => record.round > 0);
    const workKind: AiWorkKind = hasAgentTools ? "agent" : "conversation";
    const taskState = status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "failed";
    return { requestId, retryOf: options.retryOf, status, workKind, message, context: taskSnapshot.context, assistant, records: records.slice(),
      proposal: interrupted ? options.proposal : proposal,
      conditions: interrupted ? options.conditions : conditions,
      sectionChange: interrupted ? options.sectionChange : sectionChange,
      modelEdits: interrupted ? options.modelEdits : modelEdits,
      taskDraft: interrupted ? options.taskDraft : taskDraft,
      diagnosticCopy: interrupted ? options.diagnosticCopy : diagnosticCopy,
      diagnosticTrial: interrupted ? undefined : diagnosticTrial,
      diagnosticComparison: interrupted ? undefined : diagnosticComparison,
      draftBaseProject,
      exploration: exploration?.snapshot(),
      lifecycle: { request: { id: requestId, state: "initiated" }, response: { kind: assistant ? "text" : hasAgentTools ? "tool" : "none", state: assistant || hasAgentTools ? "received" : "not-received" }, task: { state: taskState, status } },
      interruption: interrupted ? { phase, round: currentRound, completedTools: records.filter((record) => record.result.status === "completed").length,
        draftsDiscarded: proposal !== options.proposal || conditions !== options.conditions || sectionChange !== options.sectionChange || modelEdits !== options.modelEdits || taskDraft !== options.taskDraft } : undefined };
  };
  const progress = (event: AiProgress) => {
    phase = event.phase; currentRound = event.round;
    options.onProgress?.({ ...event, exploration: exploration?.snapshot() });
    if (exploration) options.onExploration?.(exploration.snapshot());
  };
  const run = async (): Promise<AiTaskResult> => {
    let refreshConflicts: string[] = [];
    if (!cancelled && isCurrent()) {
      const toolResult = executeAiTool(taskSnapshot, initialReadCall);
      records.push({ round: 0, call: initialReadCall, result: toolResult });
      messages.splice(1, 0, { role: "system", content: `任务开始的本地状态读取回执（仅来自当前已应用快照）：${JSON.stringify(toolResult)}` });
    }
    rounds: for (let round = 1; ; round += 1) {
      if (cancelled || !isCurrent()) return result("cancelled", "对话上下文已改变，请基于当前模型重新发送");
      if (exploration && !exploration.beginRound()) return result("failed", explorationStopMessage(exploration.snapshot()));
      if (round > (exploration?.snapshot().maxRounds ?? MAX_ROUNDS)) return result("failed", "工具读取轮次已达上限，请缩小对象范围或分开提问");
      const refresh = () => {
        const live = options.getCurrentSnapshot();
        const current = captureAiSnapshot({ ...live.editProject, activeAnalysisCaseId: snapshot.model.activeAnalysisCaseId, activeLoadCaseId: snapshot.model.activeLoadCaseId, activeLoadCombinationId: snapshot.model.activeLoadCombinationId,
          analysisResults: snapshot.comparison ? [snapshot.comparison.before, snapshot.comparison.after] : [] }, targets, snapshot.analysis, snapshot.context.comparison);
        if (current.snapshotKey === taskSnapshot.snapshotKey) return false;
        const base = draftBaseProject;
        const coordinatedTask = taskDraft ? coordinateTaskDraft(base, current.editProject, taskDraft) : undefined;
        const coordinatedEdits = modelEdits ? coordinateModelEdits(base, current.editProject, modelEdits) : undefined;
        const coordinatedSection = sectionChange ? coordinateSection(base, current.editProject, sectionChange) : undefined;
        const coordinatedConditions = conditions ? validateConditions(base, current.editProject, conditions) : undefined;
        const coordinatedFrame = proposal ? coordinateFrame(base, current.editProject, proposal) : undefined;
        refreshConflicts = [coordinatedTask, coordinatedEdits, coordinatedSection, coordinatedConditions, coordinatedFrame].flatMap((item) => item?.conflicts ?? []);
        if (!refreshConflicts.length) {
          taskDraft = coordinatedTask?.draft ?? taskDraft; modelEdits = coordinatedEdits?.draft ?? modelEdits;
          sectionChange = coordinatedSection?.draft ?? sectionChange; conditions = coordinatedConditions?.draft ?? conditions; proposal = coordinatedFrame?.draft ?? proposal;
          draftBaseProject = current.editProject;
        }
        taskSnapshot = { ...current, context: { ...current.context, goal: prompt.trim(), selection: targets.map((target) => {
          const object = (target.kind === "node" ? current.model.nodes : current.model.members).find((item) => item.id === target.id);
          return { ...target, label: object?.label ?? target.id, exists: Boolean(object) };
        }) } };
        const call: DeepSeekToolCall = { ...initialReadCall, id: `${requestId}_refresh_${round}` };
        const toolResult = executeAiTool(taskSnapshot, call);
        records.push({ round: 0, call, result: toolResult });
        const referenceCurrent = (id: string) => id === current.analysis?.id ? current.analysisCurrent
          : id === current.comparison?.before.id ? current.comparison.beforeCurrent : id === current.comparison?.after.id ? current.comparison.afterCurrent : false;
        for (const record of records) {
          if (record.result.reference) record.result = { ...record.result, reference: { ...record.result.reference, current: referenceCurrent(record.result.reference.analysisId) } };
          if (record.result.comparisonReference) {
            const reference = record.result.comparisonReference;
            record.result = { ...record.result, comparisonReference: { ...reference, before: { ...reference.before, current: referenceCurrent(reference.before.analysisId) }, after: { ...reference.after, current: referenceCurrent(reference.after.analysisId) } } };
          }
        }
        let lastAssistant = -1;
        messages.forEach((message, index) => { if (message.role === "assistant") lastAssistant = index; });
        const previousAssistant = messages[lastAssistant];
        const pendingCalls = previousAssistant?.role === "assistant" ? previousAssistant.tool_calls ?? [] : [];
        for (const pending of pendingCalls) if (!messages.slice(lastAssistant + 1).some((message) => message.role === "tool" && message.tool_call_id === pending.id)) {
          messages.push({ role: "tool", tool_call_id: pending.id, content: JSON.stringify({ status: "cancelled", message: "工程已变化，旧操作未执行，须重新规划" }) });
        }
        messages.push({ role: "system", content: `人工编辑已改变工程。忽略尚未执行的旧响应，重新读取并规划；任务目标仍是发送时的稳定身份。不得覆盖人工修改，意图或同参数冲突须询问用户，新实质修改仍需确认。先前数值属于其冻结输入，过期引用须明确称历史结果。最新状态：${JSON.stringify(toolResult)}。当前草案：${JSON.stringify({ taskDraft, modelEdits, sectionChange, conditions, proposal })}` });
        options.onOutput?.({ assistant: undefined, records: records.slice() });
        return true;
      };
      refresh();
      if (refreshConflicts.length) return result("missing-input", `相关动作暂停：${refreshConflicts.join("；")}`);
      const deletedTargets = targetConflicts(taskSnapshot.editProject, engineeringDraftTargets(draftBaseProject, { taskDraft, modelEdits, sectionChange, conditions, proposal }, targets));
      if (deletedTargets.length) return result("missing-input", `相关动作暂停：${deletedTargets.join("；")}`);
      progress({ phase: "requesting", round });
      if (cancelled || !isCurrent()) return result("cancelled", "对话上下文已改变，请基于当前模型重新发送");
      if (refresh()) continue;
      let response: DeepSeekChatResult | undefined;
      while (!response) {
        if (paused) await waitForResume();
        if (cancelled || !isCurrent()) return result("cancelled", "对话上下文已改变，请基于当前模型重新发送");
        if (refresh()) continue rounds;
        if (exploration && !exploration.recordRequest()) return result("failed", explorationStopMessage(exploration.snapshot()));
        activeRequestId = requestAttempt === 0 ? requestId : `${requestId}_resume_${requestAttempt}`;
        const interruption = new Promise<undefined>((resolve) => { interruptRequest = () => resolve(undefined); });
        let timedOut = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const budgetSnapshot = exploration?.snapshot();
        const remainingMs = budgetSnapshot ? Math.max(1, budgetSnapshot.budgetMs - budgetSnapshot.elapsedMs) : undefined;
        const budgetTimeout = remainingMs === undefined ? undefined : new Promise<undefined>((resolve) => {
          timeout = setTimeout(() => {
            timedOut = true;
            exploration!.stop("budget-exhausted");
            void options.transport.cancelDeepSeekChat(activeRequestId!).catch(() => {});
            resolve(undefined);
          }, remainingMs);
        });
        try {
          response = await Promise.race([options.transport.chatDeepSeek({ requestId: activeRequestId, messages }), interruption, ...(budgetTimeout ? [budgetTimeout] : [])]);
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
          interruptRequest = undefined;
          activeRequestId = undefined;
        }
        if (!response) {
          if (timedOut) return result("failed", explorationStopMessage(exploration!.snapshot()));
          requestAttempt += 1;
        }
      }
      if (paused) await waitForResume();
      if (cancelled) return result("cancelled", "对话已取消");
      if (!isCurrent()) return result("cancelled", "对话上下文已改变，请基于当前模型重新发送");
      if (refresh()) continue;
      if (response.status !== "success" || !response.assistant) {
        if (response.status !== "cancelled" && exploration) exploration.recordOutcome({ failureKey: `${response.status}:${response.message}` });
        return result(response.status === "cancelled" ? "cancelled" : "failed", exploration?.snapshot().phase === "stopped" ? explorationStopMessage(exploration.snapshot()) : response.message);
      }
      const assistant = response.assistant;
      if (!assistant.tool_calls?.length) {
        progress({ phase: "responding", round });
        if (paused) await waitForResume();
        if (cancelled || !isCurrent()) return result("cancelled", "对话上下文已改变，请基于当前模型重新发送");
        if (refresh()) continue;
        const references = records.flatMap((record) => record.result.reference ? [record.result.reference] : []);
        const comparisons = records.flatMap((record) => record.result.comparisonReference ? [record.result.comparisonReference] : []);
        const tokens = assistant.content?.match(/\[\[(?:result|comparison):[^\]\r\n]+\]\]/g) ?? [];
        if (tokens.some((token) => ![...references, ...comparisons].some((reference) => reference.token === token))) return result("failed", "回复含无法核对的结果引用，请重新读取实际结果");
        if (records.some((record) => ["read_results", "read_result"].includes(record.call.function.name)) && !tokens.some((token) => references.some((ref) => ref.token === token))) return result("failed", "结果解释缺少可核对的结果项引用，请重试");
        if (records.some((record) => record.call.function.name === "read_comparison_result" || record.call.function.name === "read_comparison" && (record.result.data as { compatible?: boolean })?.compatible)
          && !tokens.some((token) => comparisons.some((ref) => ref.token === token))) return result("failed", "对比解释缺少可核对的差值引用，请重试");
        // Reveal only validated text. Keep reference tokens and Unicode characters intact.
        if (options.onOutput && assistant.content) {
          const units = assistant.content.match(/\[\[(?:result|comparison):[^\]\r\n]+\]\]|[^]/gu) ?? [];
          let visible = "";
          for (let index = 0; index < units.length; index += 2) {
            if (index > 0) await new Promise<void>((resolve) => setTimeout(resolve, 32));
            if (paused) await waitForResume();
            if (cancelled || !isCurrent()) return result("cancelled", "对话上下文已改变，请基于当前模型重新发送");
            if (refresh()) continue rounds;
            visible += units.slice(index, index + 2).join("");
            options.onOutput({ assistant: visible, records: records.slice() });
          }
          if (paused) await waitForResume();
          if (cancelled || !isCurrent()) return result("cancelled", "对话上下文已改变，请基于当前模型重新发送");
          if (refresh()) continue;
        }
        const agentToolRecords = records.filter((record) => record.round > 0);
        return result("completed", comparisons.length ? "已引用两次确定分析的实际差值" : references.length ? taskSnapshot.analysisCurrent ? "已引用所选分析的实际结果" : "已引用历史输入结果，当前模型需重算"
          : agentToolRecords.length ? "已根据当前已应用模型完成回复" : "AI 回复已接收，未读取模型工具", assistant.content ?? undefined);
      }
      messages.push(assistant);
      for (const call of assistant.tool_calls) {
        if (cancelled || !isCurrent()) return result("cancelled", "对话上下文已改变，请基于当前模型重新发送");
        if (!exploration && records.length >= MAX_TOOL_RECORDS) return result("failed", "工具读取数量已达上限，请缩小对象范围或分开提问");
        progress({ phase: "tool", round, toolCall: call });
        if (paused) await waitForResume();
        if (cancelled || !isCurrent()) return result("cancelled", "对话上下文已改变，请基于当前模型重新发送");
        if (refresh()) continue rounds;
        if (exploration && !exploration.recordToolCall()) return result("failed", explorationStopMessage(exploration.snapshot()));
        const isDiagnosticCall = ["inspect_diagnostics", "run_diagnostic_trial"].includes(call.function.name);
        const isAnalysisCall = Boolean(exploration && (isDiagnosticCall || call.function.name === "request_analysis"));
        let toolResult: AiToolResult | undefined;
        let analysisWithinBudget = true;
        while (!toolResult) {
          if (paused) await waitForResume();
          if (cancelled || !isCurrent()) return result("cancelled", "对话上下文已改变，请基于当前模型重新发送");
          if (isAnalysisCall && !exploration!.beginAnalysis()) return result("failed", explorationStopMessage(exploration!.snapshot()));
          const analysisStartedAt = isAnalysisCall ? explorationNow() : 0;
          let timedOut = false;
          let timeout: ReturnType<typeof setTimeout> | undefined;
          if (isDiagnosticCall) {
            activeDiagnosticTask = startDiagnosticToolTask(taskSnapshot, call, diagnosticCopy ?? undefined, {
              onPhase: (analysisPhase) => progress({ phase: "tool", round, toolCall: call, analysisPhase }),
            });
            const interruption = new Promise<undefined>((resolve) => { interruptRequest = () => resolve(undefined); });
            const budgetSnapshot = exploration?.snapshot();
            const remainingMs = budgetSnapshot ? Math.max(1, budgetSnapshot.budgetMs - budgetSnapshot.elapsedMs) : undefined;
            const budgetTimeout = remainingMs === undefined ? undefined : new Promise<undefined>((resolve) => {
              timeout = setTimeout(() => { timedOut = true; exploration!.stop("budget-exhausted"); activeDiagnosticTask?.cancel(); resolve(undefined); }, remainingMs);
            });
            try { toolResult = await Promise.race([activeDiagnosticTask.promise, interruption, ...(budgetTimeout ? [budgetTimeout] : [])]); }
            finally { interruptRequest = undefined; activeDiagnosticTask = undefined; }
          } else {
            toolResult = executeAiTool(taskSnapshot, call, proposal ?? undefined, conditions ?? undefined, sectionChange ?? undefined, modelEdits ?? undefined, taskDraft ?? undefined, diagnosticCopy ?? undefined);
          }
          if (timeout !== undefined) clearTimeout(timeout);
          if (isAnalysisCall) analysisWithinBudget = exploration!.finishAnalysis(explorationNow() - analysisStartedAt);
          if (!toolResult) {
            if (timedOut) return result("failed", explorationStopMessage(exploration!.snapshot()));
            continue;
          }
        }
        if (exploration && call.function.name === "run_diagnostic_trial" && !exploration.recordCandidate()) return result("failed", explorationStopMessage(exploration.snapshot()));
        if (toolResult.proposal !== undefined) proposal = toolResult.proposal;
        if (toolResult.conditions !== undefined) conditions = toolResult.conditions;
        if (toolResult.sectionChange !== undefined) sectionChange = toolResult.sectionChange;
        if (toolResult.modelEdits !== undefined) modelEdits = toolResult.modelEdits;
        if (toolResult.taskDraft !== undefined) taskDraft = toolResult.taskDraft;
        if (toolResult.diagnosticCopy !== undefined) diagnosticCopy = toolResult.diagnosticCopy;
        if (toolResult.diagnosticTrial) diagnosticTrial = toolResult.diagnosticTrial;
        if (toolResult.diagnosticComparison) diagnosticComparison = toolResult.diagnosticComparison;
        if (toolResult.proposal || toolResult.conditions || toolResult.sectionChange || toolResult.modelEdits || toolResult.taskDraft) draftBaseProject = taskSnapshot.editProject;
        const publicResult = publicDiagnosticResult(toolResult);
        records.push({ round, call, result: publicResult });
        progress({ phase: "tool", round, toolCall: call, toolResult: publicResult });
        if (paused) await waitForResume();
        if (cancelled || !isCurrent()) return result("cancelled", "对话上下文已改变，请基于当前模型重新发送");
        if (refresh()) continue rounds;
        if (!analysisWithinBudget) return result("failed", explorationStopMessage(exploration!.snapshot()));
        if (toolResult.proposal === null || toolResult.conditions === null || toolResult.sectionChange === null || toolResult.modelEdits === null || toolResult.taskDraft === null) return result("completed", toolResult.message);
        if (toolResult.status !== "completed") {
          const prerequisite = toolResult.data && typeof toolResult.data === "object" && "requiredTool" in toolResult.data
            && toolResult.data.requiredTool === "create_diagnostic_copy";
          if (toolResult.status === "missing-input" && prerequisite) {
            if (exploration && !exploration.recordOutcome({ failureKey: `tool-prerequisite:${call.function.name}:create_diagnostic_copy` })) {
              return result("failed", explorationStopMessage(exploration.snapshot()));
            }
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(publicResult) });
            continue;
          }
          if (toolResult.status === "missing-input" || toolResult.status === "awaiting-confirmation") exploration?.waitForUser();
          if (toolResult.status === "failed" && exploration) {
            const canRetry = exploration.recordOutcome(outcomeFingerprint(toolResult));
            if (!canRetry) return result("failed", explorationStopMessage(exploration.snapshot()));
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(publicResult) });
            continue;
          }
          return result(toolResult.status, exploration?.snapshot().phase === "stopped" ? explorationStopMessage(exploration.snapshot()) : toolResult.message);
        }
        if (exploration && !exploration.recordOutcome(outcomeFingerprint(toolResult))) return result("failed", explorationStopMessage(exploration.snapshot()));
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(publicResult) });
      }
    }
  };
  const promise = Promise.race([
    run().catch(() => result(cancelled ? "cancelled" : "failed", cancelled ? "对话已取消" : "对话未完成，请检查连接设置后重试")),
    cancellation,
  ]).then((value) => { settled = true; return value; });
  return { requestId, promise, pause: () => {
    if (settled || cancelled || paused) return false;
    paused = true;
    exploration?.pause();
    if (exploration) options.onExploration?.(exploration.snapshot());
    interruptRequest?.();
    if (activeRequestId) {
      const id = activeRequestId;
      void Promise.resolve().then(() => options.transport.cancelDeepSeekChat(id)).catch(() => {});
    }
    activeDiagnosticTask?.cancel();
    return true;
  }, resume: () => {
    if (!paused || settled || cancelled) return;
    paused = false;
    exploration?.resume();
    if (exploration) options.onExploration?.(exploration.snapshot());
    releasePause?.();
  }, cancel: () => {
    if (settled || cancelled) return;
    cancelled = true;
    exploration?.stop("cancelled");
    releasePause?.();
    interruptRequest?.();
    activeDiagnosticTask?.cancel();
    resolveCancellation(result("cancelled", "对话已取消"));
    const id = activeRequestId ?? requestId;
    void Promise.resolve().then(() => options.transport.cancelDeepSeekChat(id)).catch(() => {});
  } };
}
