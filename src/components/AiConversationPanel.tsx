import { useEffect, useMemo, useRef, useState } from "react";
import { History, RotateCcw, Settings2, SquarePen, Trash2, X } from "lucide-react";
import type { FrameProject } from "../domain/project";
import { captureAiSnapshot, type AiContext, type AiObjectRef, type AiStatus, type AiToolResult } from "../workspace/ai-tools";
import { startAiTask, type AiProgress, type AiTaskResult } from "../workspace/ai-task";
import { FrameProposalCard } from "./FrameProposalCard";
import { buildFramePreview, type FramePreview, type FrameProposal } from "../workspace/frame-proposal";
import { prepareFrameConfirmation, type FrameConfirmation } from "../workspace/frame-confirmation";
import { AnalysisConditionsCard } from "./AnalysisConditionsCard";
import { buildConditionsPreview, conditionsIssues, prepareConditionsConfirmation, type ConditionsConfirmation, type ConditionsProposal } from "../workspace/analysis-conditions";
import { calculationIntent } from "../workspace/analysis-intent";
import type { AnalysisResult } from "../domain/analysis";
import type { ResultReference } from "../workspace/ai-results";
import { SectionChangeCard } from "./SectionChangeCard";
import { buildSectionPreview, prepareSectionConfirmation, proposeSectionChange, type SectionChangeProposal, type SectionConfirmation } from "../workspace/section-stage";
import type { AnalysisPairIds } from "../workspace/ai-comparison";
import { AiResultExplanation } from "./AiResultReferences";
import { AiComposer } from "./AiComposer";

interface ConversationTurn {
  id: string;
  origin: "chat" | "confirmation" | "analysis";
  prompt: string;
  requestText?: string;
  context: AiContext;
  sourceProject: FrameProject;
  progress?: AiProgress;
  result?: AiTaskResult;
  output?: Pick<AiTaskResult, "assistant" | "records">;
  continuing?: boolean;
  proposal?: FrameProposal;
  conditions?: ConditionsProposal;
  sectionChange?: SectionChangeProposal;
}
interface ConversationHistory {
  id: string;
  turns: ConversationTurn[];
  updatedAt: number;
  proposal?: FrameProposal;
  proposalSource: FrameProject;
  conditions?: ConditionsProposal;
  conditionsSource: FrameProject;
  sectionChange?: SectionChangeProposal;
  sectionSource: FrameProject;
  sectionSelection: readonly AiObjectRef[];
  calculationRequested: boolean;
  requestPrompt: string;
  baselineId?: string;
}
// Chat stays in the application session and is never written into project files.
const sessionHistories = new Map<string, ConversationHistory[]>();
interface Props {
  project: FrameProject;
  sessionId: number;
  selection: readonly AiObjectRef[];
  analysis?: AnalysisResult;
  onLocateResult(reference: ResultReference): void;
  comparison?: AnalysisPairIds;
  onComparison(pair: AnalysisPairIds, open: boolean): void;
  onSectionConfirm(confirmation: SectionConfirmation): AiToolResult;
  open: boolean;
  onClose(): void;
  onSettings(): void;
  onPreview(preview: FramePreview | null): void;
  onConfirm(confirmation: FrameConfirmation): AiToolResult;
  onConditionsConfirm(confirmation: ConditionsConfirmation): AiToolResult;
  onAnalyze(): Promise<AiToolResult>;
  onCancelAnalysis(): void;
  analysisBusy: boolean;
}

const STATUS_LABELS: Record<AiStatus, string> = {
  completed: "已完成", applied: "已应用", "missing-input": "缺少输入", "awaiting-confirmation": "等待确认",
  failed: "失败", cancelled: "已取消",
};
const TOOL_LABELS: Record<string, string> = {
  read_model: "读取模型", read_selection: "读取选中对象", read_objects: "读取指定对象",
  propose_frame: "准备建模方案",
  discard_frame_proposal: "拒绝建模方案",
  confirm_frame_stage: "确认建模阶段",
  propose_analysis_conditions: "准备分析条件",
  discard_analysis_conditions: "拒绝分析条件",
  confirm_analysis_conditions: "确认分析条件阶段",
  run_analysis: "本地空间刚架分析",
  request_analysis: "准备本地分析请求",
  read_results: "读取分析结果",
  read_result: "核对结果引用",
  propose_section_change: "准备选柱截面修改", discard_section_change: "拒绝截面方案", confirm_section_change: "确认截面修改阶段",
  read_comparison: "读取前后分析对比", read_comparison_result: "核对前后差值引用",
};

export function AiConversationPanel({ project, sessionId, selection, analysis, comparison, onComparison, onSectionConfirm, onLocateResult, open, onClose, onSettings, onPreview, onConfirm, onConditionsConfirm, onAnalyze, onCancelAnalysis, analysisBusy }: Props) {
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showHome, setShowHome] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [conversationId, setConversationId] = useState<string>(() => crypto.randomUUID());
  const [conversations, setConversations] = useState(() => sessionHistories.get(project.id) ?? []);
  const [proposal, setProposal] = useState<FrameProposal | undefined>();
  const [proposalDirty, setProposalDirty] = useState(false);
  const [sectionChange, setSectionChange] = useState<SectionChangeProposal>();
  const sectionRef = useRef(sectionChange); sectionRef.current = sectionChange;
  const [sectionSource, setSectionSource] = useState(project);
  const [sectionSelection, setSectionSelection] = useState<readonly AiObjectRef[]>(selection);
  const [sectionDirty, setSectionDirty] = useState(false);
  const [sectionError, setSectionError] = useState("");
  const baselineRef = useRef<string | undefined>(undefined);
  const sectionCurrent = sectionSource === project && JSON.stringify(sectionSelection) === JSON.stringify(selection);
  const sectionConfirmation = useMemo(() => sectionChange ? prepareSectionConfirmation(sectionSource, sectionSelection, sectionChange) : undefined, [sectionSource, sectionSelection, sectionChange]);
  const [conditions, setConditions] = useState<ConditionsProposal>();
  const conditionsRef = useRef(conditions); conditionsRef.current = conditions;
  const previousConditionsRef = useRef<ConditionsProposal | undefined>(undefined);
  const previousSectionRef = useRef<SectionChangeProposal | undefined>(undefined);
  const [conditionsSource, setConditionsSource] = useState(project);
  const [conditionsDirty, setConditionsDirty] = useState(false);
  const [calculationRequested, setCalculationState] = useState(false);
  const calculationRequestedRef = useRef(false);
  const setCalculationRequested = (requested: boolean) => { calculationRequestedRef.current = requested; setCalculationState(requested); };
  const requestPromptRef = useRef("");
  const continuationRef = useRef<"analyze" | "conditions" | "explain" | null>(null);
  const conditionsCurrent = conditionsSource === project;
  const conditionsConfirmation = useMemo(() => conditions ? prepareConditionsConfirmation(conditionsSource, conditions) : undefined, [conditionsSource, conditions]);
  const proposalRef = useRef(proposal); proposalRef.current = proposal;
  const [proposalSource, setProposalSource] = useState(project);
  const proposalCurrent = proposalSource === project;
  const confirmation = useMemo(() => proposal ? prepareFrameConfirmation(proposalSource, proposal) : undefined, [proposalSource, proposal]);
  const previewCallback = useRef(onPreview); previewCallback.current = onPreview;
  const taskRef = useRef<ReturnType<typeof startAiTask> | null>(null);
  const generationRef = useRef(0);
  const selectionKey = JSON.stringify(selection);
  const comparisonKey = JSON.stringify(comparison);
  const snapshot = useMemo(() => captureAiSnapshot(project, JSON.parse(selectionKey), analysis, comparison), [project, selectionKey, analysis, comparisonKey]);
  const currentRef = useRef({ project, sessionId, selectionKey, analysis, comparisonKey });
  currentRef.current = { project, sessionId, selectionKey, analysis, comparisonKey };
  const logRef = useRef<HTMLDivElement>(null);
  const followOutputRef = useRef(true);

  useEffect(() => {
    if (!turns.length) return;
    setConversations((previous) => {
      const next = [{ id: conversationId, turns, updatedAt: Date.now(), proposal, proposalSource,
        conditions, conditionsSource, sectionChange, sectionSource, sectionSelection, calculationRequested,
        requestPrompt: requestPromptRef.current, baselineId: baselineRef.current },
      ...previous.filter((item) => item.id !== conversationId)].slice(0, 30);
      sessionHistories.set(project.id, next);
      return next;
    });
  }, [turns, conversationId, project.id, proposal, proposalSource, conditions, conditionsSource, sectionChange, sectionSource, sectionSelection, calculationRequested]);

  const newConversation = () => {
    if (busy || analysisBusy || proposalDirty || conditionsDirty || sectionDirty) return;
    rejectProposal(); rejectConditions(); rejectSection();
    baselineRef.current = undefined;
    setConversationId(crypto.randomUUID()); setTurns([]); setDraft(""); setShowHome(true);
    followOutputRef.current = true;
  };
  const openConversation = (conversation: ConversationHistory) => {
    if (busy || analysisBusy || proposalDirty || conditionsDirty || sectionDirty) return;
    followOutputRef.current = true;
    rejectProposal(); rejectConditions(); rejectSection();
    baselineRef.current = undefined;
    setConversationId(conversation.id); setTurns(conversation.turns.map((turn) => turn.result ? turn : {
      ...turn, result: { status: "cancelled", message: "会话切换已中断本次请求，请基于当前模型重新发送。", context: turn.context, records: [] },
    })); setDraft(""); setShowHome(false);
    proposalRef.current = conversation.proposal; setProposal(conversation.proposal); setProposalSource(conversation.proposalSource);
    conditionsRef.current = conversation.conditions; setConditions(conversation.conditions); setConditionsSource(conversation.conditionsSource);
    sectionRef.current = conversation.sectionChange; setSectionChange(conversation.sectionChange); setSectionSource(conversation.sectionSource); setSectionSelection(conversation.sectionSelection);
    setCalculationRequested(conversation.calculationRequested); requestPromptRef.current = conversation.requestPrompt; baselineRef.current = conversation.baselineId;
  };

  useEffect(() => {
    if (sectionChange && sectionCurrent) {
      previewCallback.current(buildSectionPreview(snapshot, sectionChange));
    } else if (conditions && conditionsCurrent && !conditionsIssues(project, conditions).length) {
      previewCallback.current(buildConditionsPreview(project, conditions));
    } else previewCallback.current(proposal && proposalCurrent ? buildFramePreview(snapshot, proposal) : null);
  }, [proposal, proposalCurrent, proposalDirty, snapshot, conditions, conditionsCurrent, conditionsDirty, project, sectionChange, sectionCurrent, sectionDirty]);
  useEffect(() => () => previewCallback.current(null), []);
  const rejectProposal = () => { proposalRef.current = undefined; taskRef.current?.cancel(); setProposal(undefined); setProposalDirty(false); };
  const changeProposal = (next: FrameProposal) => { proposalRef.current = next; taskRef.current?.cancel(); setProposal(next); setProposalSource(project); setProposalDirty(false); };
  const rejectConditions = () => { conditionsRef.current = undefined; taskRef.current?.cancel(); setConditions(undefined); setConditionsDirty(false); setCalculationRequested(false); continuationRef.current = null; };
  const changeConditions = (next: ConditionsProposal) => { previousConditionsRef.current = conditionsRef.current; conditionsRef.current = next; taskRef.current?.cancel(); setConditions(next); setConditionsSource(project); setConditionsDirty(false); };
  const rejectSection = () => { sectionRef.current = undefined; taskRef.current?.cancel(); setSectionChange(undefined); setSectionDirty(false); setSectionError(""); setCalculationRequested(false); continuationRef.current = null; };
  const changeSection = (next: SectionChangeProposal) => { previousSectionRef.current = sectionRef.current; sectionRef.current = next; taskRef.current?.cancel(); setSectionChange(next); setSectionSource(project); setSectionSelection(selection); setSectionDirty(false); setSectionError(""); };
  const confirmSection = () => {
    if (!sectionConfirmation || busy || analysisBusy || sectionDirty || !sectionCurrent || sectionRef.current !== sectionChange || proposal || conditions) return;
    const result = onSectionConfirm(sectionConfirmation);
    setTurns((previous) => [...previous.slice(-19), { id: crypto.randomUUID(), origin: "confirmation", prompt: "确认应用截面修改阶段", context: snapshot.context, sourceProject: project,
      result: { ...result, records: [{ round: 0, call: { id: sectionConfirmation.requestId, type: "function", function: { name: "confirm_section_change", arguments: JSON.stringify({ proposalId: sectionChange!.id, memberIds: sectionChange!.memberIds, baseRevision: project.revision }) } }, result }] } }]);
    if (result.status === "applied") {
      baselineRef.current = snapshot.analysisCurrent ? snapshot.analysis?.id : undefined;
      sectionRef.current = undefined; setSectionChange(undefined); setSectionDirty(false);
      if (calculationRequestedRef.current) continuationRef.current = "analyze";
    }
  };
  const analyze = async () => {
    if (busy || analysisBusy || proposalRef.current || conditionsRef.current || sectionRef.current) return;
    setCalculationRequested(false);
    const id = crypto.randomUUID();
    const context = snapshot.context;
    setTurns((previous) => [...previous.slice(-19), { id, origin: "analysis", prompt: "继续已请求的本地分析", context, sourceProject: project }]);
    const result = await onAnalyze();
    const afterId = (result.data as { analysisId?: string } | undefined)?.analysisId;
    if (result.status === "completed" && baselineRef.current && afterId) {
      onComparison({ beforeId: baselineRef.current, afterId }, false);
      baselineRef.current = undefined;
      continuationRef.current = "explain";
    }
    setTurns((previous) => previous.map((turn) => turn.id === id ? { ...turn, result: { ...result, records: [{ round: 0,
      call: { id, type: "function", function: { name: "run_analysis", arguments: JSON.stringify({ projectId: context.projectId, modelRevision: context.modelRevision }) } }, result }] } } : turn));
  };
  const confirmConditions = () => {
    if (!conditionsConfirmation || busy || analysisBusy || conditionsDirty || !conditionsCurrent || conditionsRef.current !== conditions || proposal || sectionChange) return;
    const result = onConditionsConfirm(conditionsConfirmation);
    setTurns((previous) => [...previous.slice(-19), { id: crypto.randomUUID(), origin: "confirmation", prompt: "确认应用分析条件阶段",
      context: conditionsConfirmation.context, sourceProject: conditionsConfirmation.baseProject, result: { ...result, records: [{ round: 0,
        call: { id: conditionsConfirmation.requestId, type: "function", function: { name: "confirm_analysis_conditions", arguments: JSON.stringify({ proposalId: conditions!.id, proposalVersion: conditions!.version, baseRevision: conditionsConfirmation.context.modelRevision }) } }, result }] } }]);
    if (result.status === "applied") {
      conditionsRef.current = undefined; setConditions(undefined); setConditionsDirty(false);
      if (calculationRequestedRef.current) continuationRef.current = "analyze";
    }
  };
  const confirmProposal = () => {
    if (!confirmation || busy || analysisBusy || proposalDirty || !proposalCurrent || proposalRef.current !== proposal || sectionChange) return;
    const result = onConfirm(confirmation);
    setTurns((previous) => [...previous.slice(-19), { id: crypto.randomUUID(), origin: "confirmation", prompt: "确认应用建模阶段",
      context: confirmation.context, sourceProject: confirmation.baseProject,
      result: { ...result, records: [{ round: 0, call: { id: confirmation.requestId, type: "function",
        function: { name: "confirm_frame_stage", arguments: JSON.stringify({ proposalId: confirmation.proposal.id,
          proposalVersion: confirmation.proposal.version, baseRevision: confirmation.context.modelRevision }) } }, result }] } }]);
    if (result.status === "applied") {
      rejectProposal();
      // Conditions reference formal identities, so prepare them only after geometry is applied.
      setConditions(undefined); conditionsRef.current = undefined; setConditionsDirty(false);
      if (calculationRequestedRef.current) continuationRef.current = "conditions";
    }
  };

  useEffect(() => {
    taskRef.current?.cancel();
  }, [project, sessionId, selectionKey, analysis, comparisonKey]);
  useEffect(() => () => {
    generationRef.current += 1;
    taskRef.current?.cancel();
  }, []);
  useEffect(() => {
    if (open && !showHome && followOutputRef.current && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [turns, open, showHome]);

  const submit = async (prompt = draft, continuing = false, retryOf?: string, requestText?: string) => {
    if (!prompt.trim() || taskRef.current || busy || analysisBusy || proposalDirty || conditionsDirty || sectionDirty) return;
    const text = prompt.trim();
    const taskText = requestText ?? text;
    const intent = continuing ? undefined : calculationIntent(text);
    if (intent === "cancel") { setCalculationRequested(false); continuationRef.current = null; }
    else if (intent === "request") { setCalculationRequested(true); requestPromptRef.current = text; }
    const id = crypto.randomUUID();
    const generation = generationRef.current;
    const context = snapshot.context;
    const history = turns.filter((turn) => turn.result?.status === "completed"
      && turn.sourceProject === project && JSON.stringify(turn.context.selection) === JSON.stringify(context.selection))
      .filter((turn) => turn.context.analysisId === context.analysisId && JSON.stringify(turn.context.comparison) === comparisonKey && !turn.result!.records.some((record) => record.result.reference || record.result.comparisonReference))
      .slice(-4).flatMap((turn) => [
        { role: "user" as const, content: turn.requestText ?? turn.prompt },
        { role: "assistant" as const, content: turn.result!.assistant ?? turn.result!.message },
      ]);
    setDraft("");
    followOutputRef.current = true;
    setShowHome(false);
    setPaused(false);
    setBusy(true);
    setTurns((previous) => [...previous.slice(-19), { id, origin: "chat", prompt: text, requestText, context, sourceProject: project, continuing, proposal, conditions, sectionChange }]);
    const update = (changes: Partial<ConversationTurn>) => {
      if (generationRef.current === generation) {
        setTurns((previous) => previous.map((turn) => turn.id === id ? { ...turn, ...changes } : turn));
      }
    };
    if (!window.frameMind) {
      update({ result: { status: "failed", message: "桌面连接不可用，请在 FrameMind 桌面应用中打开项目。", context, records: [] } });
      setBusy(false);
      return;
    }
    const task = startAiTask(snapshot, taskText, {
      transport: window.frameMind,
      retryOf,
      history,
      proposal,
      conditions,
      sectionChange,
      isCurrent: () => currentRef.current.project === project && currentRef.current.sessionId === sessionId
        && currentRef.current.selectionKey === selectionKey && currentRef.current.analysis === analysis && currentRef.current.comparisonKey === comparisonKey && generationRef.current === generation && proposalRef.current === proposal && conditionsRef.current === conditions && sectionRef.current === sectionChange,
      onProgress: (progress) => update({ progress }),
      onOutput: (output) => update({ output }),
    });
    taskRef.current = task;
    try {
      const result = await task.promise;
      update({ result, output: undefined });
      if (result.proposal !== undefined && result.status !== "cancelled" && result.status !== "failed"
        && result.records.some((record) => record.result.proposal !== undefined)
        && currentRef.current.project === project && generationRef.current === generation && proposalRef.current === proposal) {
        setProposal(result.proposal ?? undefined); setProposalSource(project); setProposalDirty(false);
        if (result.proposal === null) setCalculationRequested(false);
      }
      if (result.conditions !== undefined && result.status !== "cancelled" && result.status !== "failed"
        && result.records.some((record) => record.result.conditions !== undefined)
        && currentRef.current.project === project && generationRef.current === generation && conditionsRef.current === conditions) {
        previousConditionsRef.current = conditions; setConditions(result.conditions ?? undefined); setConditionsSource(project); setConditionsDirty(false);
        if (result.conditions === null) setCalculationRequested(false);
      }
      if (result.sectionChange !== undefined && result.status !== "cancelled" && result.status !== "failed"
        && result.records.some((record) => record.result.sectionChange !== undefined)
        && currentRef.current.project === project && generationRef.current === generation && sectionRef.current === sectionChange) {
        if (result.sectionChange) changeSection(result.sectionChange); else rejectSection();
      }
      if (result.status === "completed" && !result.proposal && !result.conditions && !result.sectionChange && result.sectionChange !== null && result.conditions !== null && result.proposal !== null
        && !continuing && result.records.some((record) => record.result.analysisRequested)
        && calculationRequestedRef.current && intent !== "cancel") continuationRef.current = "analyze";
    } catch {
      update({ result: { status: "failed", message: "对话未完成，请检查连接设置后重试。", context, records: [] }, output: undefined });
    } finally {
      if (taskRef.current === task) {
        taskRef.current = null;
        setPaused(false);
        setBusy(false);
      }
    }
  };

  const canRetry = (turn: ConversationTurn) => turn === turns.at(-1) && turn.sourceProject === project
    && JSON.stringify(turn.context) === JSON.stringify(snapshot.context)
    && turn.proposal === proposal && turn.conditions === conditions && turn.sectionChange === sectionChange;

  useEffect(() => {
    const continuation = continuationRef.current;
    if (!continuation || busy || analysisBusy) return;
    continuationRef.current = null;
    if (continuation === "explain") {
      void submit("截面修改已确认且本地重算已完成。请读取当前绑定的两次分析对比，用 read_comparison 和 read_comparison_result 引用关键节点位移和柱杆端内力前值、后值及差值，解释输入变化和自重影响，区分计算事实与原因推断。不要修改模型或重新计算，300字以内。", true);
      return;
    }
    if (!calculationRequestedRef.current) return;
    if (continuation === "analyze") void analyze();
    else void submit(`原请求：${requestPromptRef.current}。建模阶段已确认。请读取当前正式节点、杆件、材料截面、支座、荷载和工况，用 propose_analysis_conditions 准备必要分析条件、荷载、自重、工况和用户自定义组合；未知条件保留缺失或标明建议，不要再次创建框架。`, true);
  }, [project, busy, analysisBusy, conditions, proposal, sectionChange, comparisonKey]);

  return <aside id="assistant-panel" className="assistant-panel" aria-label="AI 对话" hidden={!open}>
    <div className="panel-heading"><span>AI 对话</span><div className="ai-heading-actions">
      <button className="icon-button" aria-label="历史对话" title="历史对话" aria-pressed={showHome} disabled={busy || analysisBusy} onClick={() => setShowHome((value) => !value)}><History size={15} /></button>
      <button className="icon-button" aria-label="新建对话" title="新建对话" disabled={busy || analysisBusy || proposalDirty || conditionsDirty || sectionDirty} onClick={newConversation}><SquarePen size={15} /></button>
      {busy && <button className="icon-button" aria-label="取消对话" title="结束本次对话请求" onClick={() => { taskRef.current?.cancel(); setCalculationRequested(false); continuationRef.current = null; }}><X size={14} /></button>}
      <button className="icon-button" aria-label="清空对话" title="清空对话" disabled={busy || analysisBusy || proposalDirty || conditionsDirty || sectionDirty || turns.length === 0} onClick={() => {
        const next = conversations.filter((item) => item.id !== conversationId);
        setConversations(next); sessionHistories.set(project.id, next); newConversation();
      }}><Trash2 size={14} /></button>
      <button className="icon-button" aria-label="收起 AI 对话" title="收起 AI 对话" onClick={onClose}><X size={15} /></button>
    </div></div>
    {showHome && <section className="ai-conversation-home" aria-label="历史对话列表">
      <div className="ai-history-list">{(historyExpanded ? conversations : conversations.slice(0, 3)).map((conversation) => <button type="button" className="ai-history-item" key={conversation.id}
        disabled={busy || analysisBusy || proposalDirty || conditionsDirty || sectionDirty} onClick={() => openConversation(conversation)}>
        <span>{conversation.turns.find((turn) => turn.origin === "chat")?.prompt ?? "对话"}</span><time dateTime={new Date(conversation.updatedAt).toISOString()}>{new Date(conversation.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Taipei" })}</time>
      </button>)}</div>
      {conversations.length > 3 && <button type="button" className="ai-history-expand" aria-expanded={historyExpanded} onClick={() => setHistoryExpanded((value) => !value)}>{historyExpanded ? "收起历史记录" : `查看全部（${conversations.length} 个）`}</button>}
    </section>}
    <div className="assistant-messages" ref={logRef} role="log" aria-label="对话消息" aria-live="polite" hidden={showHome}
      onScroll={(event) => { const log = event.currentTarget; followOutputRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48; }}>
      {turns.map((turn) => <article className="ai-turn" key={turn.id}>
        <div className="ai-user-message"><p>{turn.prompt}</p></div>
        <div className="ai-turn-context"><span>R{turn.context.modelRevision}</span><span>{turn.context.selection.map((object) => object.label).join("、") || "整个项目"}</span>
          {(turn.sourceProject !== project || turn.context.analysisId !== snapshot.context.analysisId) && <span className="ai-stale">历史版本</span>}
        </div>
        <details className="ai-context-details"><summary>对象上下文</summary><pre>{JSON.stringify(turn.context, null, 2)}</pre></details>
        {turn.result ? <>
          <div className={`ai-turn-status ${turn.result.status}`} data-testid="ai-turn-status">{STATUS_LABELS[turn.result.status]} · {turn.result.message}</div>
          {turn.result.requestId && <details className="ai-context-details"><summary>任务与恢复记录</summary><pre>{JSON.stringify({ requestId: turn.result.requestId, retryOf: turn.result.retryOf, interruption: turn.result.interruption }, null, 2)}</pre></details>}
          <details className="ai-context-details"><summary>{turn.origin === "confirmation" ? "操作详情" : "执行详情"} · {turn.result.records.length} 项</summary>
          {turn.origin === "confirmation" && turn.result.status === "applied" && <p>本地提交回执已保留，重试不会再次应用此阶段。撤销后可使用重做恢复。</p>}
          {turn.result.records.map((record, index) => <details className="ai-tool-record" key={`${record.call.id}:${index}`}>
            <summary>{TOOL_LABELS[record.call.function.name] ?? record.call.function.name} · {STATUS_LABELS[record.result.status]}</summary>
            <p>{record.result.message}</p>
            <details><summary>工具输入</summary><pre>{record.call.function.arguments}</pre></details>
            <details><summary>工具输出</summary><pre className="ai-tool-output">{JSON.stringify(record.result, null, 2)}</pre></details>
          </details>)}
          </details>
          <AiResultExplanation result={turn.result} onLocate={onLocateResult} onCompare={(pair) => onComparison(pair, true)} />
          {turn.origin === "chat" && (turn.result.status === "failed" || turn.result.status === "cancelled") && <>
            <p className="frame-draft-notice">已确认模型和成功结果保留，本地编辑与计算可继续。
              {turn.result.interruption?.draftsDiscarded ? "本次中断生成的草案未应用，需要重新准备。" : proposal || conditions || sectionChange ? "已有草案仍需在卡片中核对并确认。" : "本次任务未提交模型修改。"}
              {!canRetry(turn) && "上下文或阶段已变化，请基于当前模型发送新消息；已提交阶段无需重做。"}</p>
            <div className="ai-recovery-actions">
            <button className="icon-button" aria-label="重试消息" title="重新读取当前模型并重试" disabled={busy || analysisBusy || proposalDirty || conditionsDirty || sectionDirty || !canRetry(turn)} onClick={() => { if (canRetry(turn)) void submit(turn.prompt, turn.continuing, turn.result?.requestId, turn.requestText); }}><RotateCcw size={14} /></button>
            {turn.result.status === "failed" && <button className="icon-button" aria-label="打开连接设置" title="打开连接设置" onClick={onSettings}><Settings2 size={14} /></button>}
          </div></>}
          {turn.origin === "analysis" && (turn.result.status === "failed" || turn.result.status === "cancelled") && <button disabled={busy || analysisBusy || Boolean(proposal) || Boolean(conditions) || Boolean(sectionChange)} onClick={() => void analyze()}>继续本地计算</button>}
        </> : <><div className="ai-turn-status" data-testid="ai-turn-status">{turn.origin === "analysis" ? "正在检查并计算已确认模型" : paused && turn === turns.at(-1) ? "已暂停输出" : turn.progress?.phase === "tool"
          ? `正在${TOOL_LABELS[turn.progress.toolCall?.function.name ?? ""] ?? "读取模型"}`
          : turn.output ? "正在输出回复" : turn.progress?.phase === "responding" ? "正在整理回复" : "正在请求 DeepSeek"}</div>
          {turn.output && <AiResultExplanation result={turn.output} onLocate={onLocateResult} onCompare={(pair) => onComparison(pair, true)} />}</>}
      </article>)}
      {proposal && <>
        {!proposalCurrent && <p className="frame-draft-notice">正式模型已变化，原预览已失效。更新参数或重新生成后核对当前模型。</p>}
        <FrameProposalCard key={`${proposal.id}:${proposal.version}`} snapshot={snapshot} proposal={proposal} busy={busy || analysisBusy} current={proposalCurrent && !sectionChange}
          visible={open && !showHome}
          baseRevision={confirmation!.context.modelRevision} onConfirm={confirmProposal} onChange={changeProposal} onDirty={setProposalDirty} onReject={() => { rejectProposal(); setCalculationRequested(false); continuationRef.current = null; }} />
      </>}
      {conditions && <>
        {!conditionsCurrent && <p className="frame-draft-notice">正式模型已变化，分析条件预览已失效。更新并重新核对后确认。</p>}
        <AnalysisConditionsCard key={`${conditions.id}:${conditions.version}`} project={project} proposal={conditions} busy={busy || analysisBusy} current={conditionsCurrent && !proposal && !sectionChange}
          visible={open && !showHome} calculate={calculationRequested}
          previous={previousConditionsRef.current}
          baseRevision={conditionsConfirmation!.context.modelRevision} onDirty={setConditionsDirty} onChange={changeConditions} onConfirm={confirmConditions} onReject={rejectConditions} />
      </>}
      {sectionChange && <SectionChangeCard key={`${sectionChange.id}:${sectionChange.version}`} snapshot={captureAiSnapshot(sectionSource, sectionSelection)} proposal={sectionChange}
        visible={open && !showHome} calculate={calculationRequested}
        previous={previousSectionRef.current}
        current={sectionCurrent && !proposal && !conditions} busy={busy || analysisBusy} onChange={changeSection} onDirty={setSectionDirty} onConfirm={confirmSection} onReject={rejectSection}
        onRegenerate={() => {
          try {
            const exists = project.sections.some((item) => item.id === sectionChange.section.id);
            const sectionId = exists ? sectionChange.section.id : sectionChange.section.provenance.catalogId;
            const { name, areaM2, secondMomentYM4, secondMomentZM4, torsionalConstantM4 } = sectionChange.section;
            changeSection(proposeSectionChange(snapshot, { ...(sectionId ? { sectionId } : { section: { name, areaM2, secondMomentYM4, secondMomentZM4, torsionalConstantM4 } }), source: sectionChange.source }, sectionChange));
          } catch (error) { setSectionError(error instanceof Error ? error.message : "请重新选择柱"); }
        }} />}
      {sectionError && <p role="alert">{sectionError}</p>}
      {comparison && <button className="button ghost compact-button" onClick={() => onComparison(comparison, true)}>查看本次前后对比</button>}
      {calculationRequested && <p className="frame-draft-notice">已请求本地计算，等待必要阶段确认；未确认建议不会进入求解。<button onClick={() => { setCalculationRequested(false); continuationRef.current = null; }}>取消后续计算</button></p>}
    </div>
    <AiComposer key={conversationId} draft={draft} onDraft={setDraft} busy={busy} paused={paused} analysisBusy={analysisBusy}
      blocked={proposalDirty || conditionsDirty || sectionDirty} onSend={(prompt, requestText) => { void submit(prompt, false, undefined, requestText); }}
      onPause={() => { if (taskRef.current?.pause()) setPaused(true); }} onResume={() => { taskRef.current?.resume(); setPaused(false); }}
      onCancelAnalysis={onCancelAnalysis} onSettings={onSettings} />
  </aside>;
}
