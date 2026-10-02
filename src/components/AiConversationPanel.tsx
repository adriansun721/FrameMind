import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Send, Settings2, Square, Trash2, X } from "lucide-react";
import type { FrameProject } from "../domain/project";
import { captureAiSnapshot, type AiContext, type AiObjectRef, type AiStatus, type AiToolResult } from "../workspace/ai-tools";
import { startAiTask, type AiProgress, type AiTaskResult } from "../workspace/ai-task";
import { FrameProposalCard } from "./FrameProposalCard";
import { buildFramePreview, type FramePreview, type FrameProposal } from "../workspace/frame-proposal";
import { prepareFrameConfirmation, type FrameConfirmation } from "../workspace/frame-confirmation";

interface ConversationTurn {
  id: string;
  origin: "chat" | "confirmation";
  prompt: string;
  context: AiContext;
  sourceProject: FrameProject;
  progress?: AiProgress;
  result?: AiTaskResult;
}
interface Props {
  project: FrameProject;
  sessionId: number;
  selection: readonly AiObjectRef[];
  open: boolean;
  onClose(): void;
  onSettings(): void;
  onPreview(preview: FramePreview | null): void;
  onConfirm(confirmation: FrameConfirmation): AiToolResult;
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
};

export function AiConversationPanel({ project, sessionId, selection, open, onClose, onSettings, onPreview, onConfirm }: Props) {
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<FrameProposal | undefined>();
  const [proposalDirty, setProposalDirty] = useState(false);
  const proposalRef = useRef(proposal); proposalRef.current = proposal;
  const [proposalSource, setProposalSource] = useState(project);
  const proposalCurrent = proposalSource === project;
  const confirmation = useMemo(() => proposal ? prepareFrameConfirmation(proposalSource, proposal) : undefined, [proposalSource, proposal]);
  const previewCallback = useRef(onPreview); previewCallback.current = onPreview;
  const taskRef = useRef<ReturnType<typeof startAiTask> | null>(null);
  const generationRef = useRef(0);
  const selectionKey = JSON.stringify(selection);
  const snapshot = useMemo(() => captureAiSnapshot(project, JSON.parse(selectionKey)), [project, selectionKey]);
  const currentRef = useRef({ project, sessionId, selectionKey });
  currentRef.current = { project, sessionId, selectionKey };
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    previewCallback.current(proposal && proposalCurrent && !proposalDirty ? buildFramePreview(snapshot, proposal) : null);
  }, [proposal, proposalCurrent, proposalDirty, snapshot]);
  useEffect(() => () => previewCallback.current(null), []);
  const rejectProposal = () => { proposalRef.current = undefined; taskRef.current?.cancel(); setProposal(undefined); setProposalDirty(false); };
  const changeProposal = (next: FrameProposal) => { proposalRef.current = next; taskRef.current?.cancel(); setProposal(next); setProposalSource(project); setProposalDirty(false); };
  const confirmProposal = () => {
    if (!confirmation || busy || proposalDirty || !proposalCurrent || proposalRef.current !== proposal) return;
    const result = onConfirm(confirmation);
    setTurns((previous) => [...previous.slice(-19), { id: crypto.randomUUID(), origin: "confirmation", prompt: "确认应用建模阶段",
      context: confirmation.context, sourceProject: confirmation.baseProject,
      result: { ...result, records: [{ round: 0, call: { id: confirmation.requestId, type: "function",
        function: { name: "confirm_frame_stage", arguments: JSON.stringify({ proposalId: confirmation.proposal.id,
          proposalVersion: confirmation.proposal.version, baseRevision: confirmation.context.modelRevision }) } }, result }] } }]);
    if (result.status === "applied") rejectProposal();
  };

  useEffect(() => {
    taskRef.current?.cancel();
  }, [project, sessionId, selectionKey]);
  useEffect(() => () => {
    generationRef.current += 1;
    taskRef.current?.cancel();
  }, []);
  useEffect(() => {
    if (open && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [turns, open]);

  const submit = async (prompt = draft) => {
    if (!prompt.trim() || busy || proposalDirty) return;
    const text = prompt.trim();
    const id = crypto.randomUUID();
    const generation = generationRef.current;
    const context = snapshot.context;
    const history = turns.filter((turn) => turn.result?.status === "completed"
      && turn.sourceProject === project && JSON.stringify(turn.context.selection) === JSON.stringify(context.selection))
      .slice(-4).flatMap((turn) => [
        { role: "user" as const, content: turn.prompt },
        { role: "assistant" as const, content: turn.result!.assistant ?? turn.result!.message },
      ]);
    setDraft("");
    setBusy(true);
    setTurns((previous) => [...previous.slice(-19), { id, origin: "chat", prompt: text, context, sourceProject: project }]);
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
    const task = startAiTask(snapshot, text, {
      transport: window.frameMind,
      history,
      proposal,
      isCurrent: () => currentRef.current.project === project && currentRef.current.sessionId === sessionId
        && currentRef.current.selectionKey === selectionKey && generationRef.current === generation && proposalRef.current === proposal,
      onProgress: (progress) => update({ progress }),
    });
    taskRef.current = task;
    try {
      const result = await task.promise;
      update({ result });
      if (result.proposal !== undefined && result.status !== "cancelled" && result.status !== "failed"
        && result.records.some((record) => record.result.proposal !== undefined)
        && currentRef.current.project === project && generationRef.current === generation && proposalRef.current === proposal) {
        setProposal(result.proposal ?? undefined); setProposalSource(project); setProposalDirty(false);
      }
    } catch {
      update({ result: { status: "failed", message: "对话未完成，请检查连接设置后重试。", context, records: [] } });
    } finally {
      if (taskRef.current === task) {
        taskRef.current = null;
        setBusy(false);
      }
    }
  };

  return <aside id="assistant-panel" className="assistant-panel" aria-label="AI 对话" hidden={!open}>
    <div className="panel-heading"><span>AI 对话</span><div className="ai-heading-actions">
      <button className="icon-button" aria-label="清空对话" title="清空对话" disabled={busy || turns.length === 0} onClick={() => { setTurns([]); rejectProposal(); }}><Trash2 size={14} /></button>
      <button className="icon-button" aria-label="收起 AI 对话" title="收起 AI 对话" onClick={onClose}><X size={15} /></button>
    </div></div>
    <div className="assistant-messages" ref={logRef} role="log" aria-label="对话消息" aria-live="polite">
      {turns.map((turn) => <article className="ai-turn" key={turn.id}>
        <div className="ai-user-message"><p>{turn.prompt}</p></div>
        <div className="ai-turn-context"><span>R{turn.context.modelRevision}</span><span>{turn.context.selection.map((object) => object.label).join("、") || "整个项目"}</span>
          {turn.sourceProject !== project && <span className="ai-stale">历史版本</span>}
        </div>
        <details className="ai-context-details"><summary>对象上下文</summary><pre>{JSON.stringify(turn.context, null, 2)}</pre></details>
        {turn.result ? <>
          <div className={`ai-turn-status ${turn.result.status}`} data-testid="ai-turn-status">{STATUS_LABELS[turn.result.status]} · {turn.result.message}</div>
          {turn.result.records.map((record, index) => <details className="ai-tool-record" key={`${record.call.id}:${index}`}>
            <summary>{TOOL_LABELS[record.call.function.name] ?? record.call.function.name} · {STATUS_LABELS[record.result.status]}</summary>
            <p>{record.result.message}</p>
            <details><summary>工具输入</summary><pre>{record.call.function.arguments}</pre></details>
            <details><summary>工具输出</summary><pre className="ai-tool-output">{JSON.stringify(record.result, null, 2)}</pre></details>
          </details>)}
          {turn.result.assistant && <p className="ai-assistant-message">{turn.result.assistant}</p>}
          {turn.origin === "chat" && turn.result.status !== "completed" && turn.result.status !== "applied" && <div className="ai-recovery-actions">
            <button className="icon-button" aria-label="重试消息" title="重新读取当前模型并重试" disabled={busy} onClick={() => void submit(turn.prompt)}><RotateCcw size={14} /></button>
            {turn.result.status === "failed" && <button className="icon-button" aria-label="打开连接设置" title="打开连接设置" onClick={onSettings}><Settings2 size={14} /></button>}
          </div>}
        </> : <div className="ai-turn-status" data-testid="ai-turn-status">{turn.progress?.phase === "tool"
          ? `正在${TOOL_LABELS[turn.progress.toolCall?.function.name ?? ""] ?? "读取模型"}`
          : turn.progress?.phase === "responding" ? "正在整理回复" : "正在请求 DeepSeek"}</div>}
      </article>)}
      {proposal && <>
        {!proposalCurrent && <p className="frame-draft-notice">正式模型已变化，原预览已失效。更新参数或重新生成后核对当前模型。</p>}
        <FrameProposalCard key={`${proposal.id}:${proposal.version}`} snapshot={snapshot} proposal={proposal} busy={busy} current={proposalCurrent}
          baseRevision={confirmation!.context.modelRevision} onConfirm={confirmProposal} onChange={changeProposal} onDirty={setProposalDirty} onReject={rejectProposal} />
      </>}
    </div>
    <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <textarea aria-label="AI 消息草稿" placeholder="输入消息…" rows={1} maxLength={8000} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) event.stopPropagation();
      }} />
      <div className="assistant-composer-actions">
        {busy ? <button type="button" className="icon-button" aria-label="取消对话" title="取消对话" onClick={() => taskRef.current?.cancel()}><Square size={14} /></button>
          : <button className="icon-button" type="submit" aria-label="发送消息" title="发送消息" disabled={!draft.trim() || proposalDirty}><Send size={15} /></button>}
      </div>
    </form>
  </aside>;
}
