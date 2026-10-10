import { SectionEditImpact } from "./SectionEditImpact";
import { useUnits } from "./UnitPresentation";
import { TopologyImpact } from "./TopologyImpact";
import { NodeMergeImpact } from "./NodeMergeImpact";
import { CANONICAL_UNITS } from "../domain/units";
import { convertToolQuantities } from "../workspace/unit-tools";
import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, History, RotateCcw, Settings2, SquarePen, Trash2, X } from "lucide-react";
import type { FrameProject } from "../domain/project";
import { captureAiSnapshot, type AiObjectRef, type AiToolResult } from "../workspace/ai-tools";
import { startAiTask, type AiTaskResult } from "../workspace/ai-task";
import { FrameProposalCard } from "./FrameProposalCard";
import { frameResourceOptions, type FramePreview, type FrameProposal } from "../workspace/frame-proposal";
import { prepareFrameConfirmation, type FrameConfirmation } from "../workspace/frame-confirmation";
import { prepareModelEditConfirmation, type ModelEditProposal, type PreparedModelEditConfirmation } from "../workspace/model-edits";
import { AnalysisConditionsCard } from "./AnalysisConditionsCard";
import { prepareConditionsConfirmation, type ConditionsConfirmation, type ConditionsProposal } from "../workspace/analysis-conditions";
import { calculationIntent } from "../workspace/analysis-intent";
import type { AnalysisInputSnapshot, AnalysisResult } from "../domain/analysis";
import type { ResultReference } from "../workspace/ai-results";
import { SectionChangeCard } from "./SectionChangeCard";
import { prepareSectionConfirmation, proposeSectionChange, type SectionChangeProposal, type SectionConfirmation } from "../workspace/section-stage";
import type { AnalysisPairIds } from "../workspace/ai-comparison";
import { AiResultExplanation } from "./AiResultReferences";
import { AiComposer } from "./AiComposer";
import { AiTaskTimeline, type StageResolution } from "./AiTaskTimeline";
import { conditionSummaries } from "./condition-summary";
import { TaskDraftCard } from "./TaskDraftCard";
import { prepareTaskDraftConfirmation, type TaskDraftConfirmation } from "../workspace/task-confirmation";
import type { TaskDraft } from "../workspace/task-draft";
import { coordinateFrame, coordinateModelEdits, coordinateSection, coordinateTaskDraft, engineeringDraftTargets, sameEngineeringState, targetConflicts, validateConditions } from "../workspace/draft-coordination";
import { TaskScheduler, type ScheduledTaskDescriptor, type TaskSchedulerSnapshot } from "../workspace/task-scheduler";
import type { ExplorationMode } from "../workspace/exploration-budget";
import { projectInput, persistTaskState, recoveredTurns, recoveryIssues, mergeLocalChat, sameProjectInput, type ConversationTurn, type ConversationHistory, type PersistedTaskState } from "../workspace/task-persistence";
import { redactPersistence } from "../../electron/persistence-redaction";

// Full conversation history is local; engineering task summaries travel with the project.
interface Props {
  project: FrameProject;
  sessionId: number;
  selection: readonly AiObjectRef[];
  analysis?: AnalysisResult;
  onLocateResult(reference: ResultReference): void;
  onLocateTargets(targets: readonly AiObjectRef[]): void;
  comparison?: AnalysisPairIds;
  onComparison(pair: AnalysisPairIds, open: boolean): void;
  onSectionConfirm(confirmation: SectionConfirmation): AiToolResult | Promise<AiToolResult>;
  open: boolean;
  onClose(): void;
  onSettings(): void;
  onPreview(preview: FramePreview | null): void;
  onConfirm(confirmation: FrameConfirmation): AiToolResult | Promise<AiToolResult>;
  onEditsConfirm(confirmation: PreparedModelEditConfirmation): AiToolResult | Promise<AiToolResult>;
  onTaskConfirm(confirmation: TaskDraftConfirmation): AiToolResult | Promise<AiToolResult>;
  onConditionsConfirm(confirmation: ConditionsConfirmation): AiToolResult | Promise<AiToolResult>;
  onAnalyze(sourceId?: string): Promise<AiToolResult>;
  onResumeAnalysis(input: AnalysisInputSnapshot): Promise<AiToolResult>;
  onCancelAnalysis(): void;
  analysisBusy: boolean;
  scheduler: TaskScheduler<unknown, unknown>;
  onTaskStateChange(state: PersistedTaskState): void;
  onPersistenceError(message: string): void;
}

export function AiConversationPanel({ project: persistedProject, sessionId, selection, analysis, comparison, onComparison, onSectionConfirm, onLocateResult, onLocateTargets, open, onClose, onSettings, onPreview, onConfirm, onEditsConfirm, onTaskConfirm, onConditionsConfirm, onAnalyze, onResumeAnalysis, onCancelAnalysis, analysisBusy, scheduler, onTaskStateChange, onPersistenceError }: Props) {
  const projectRef = useRef(projectInput(persistedProject));
  if (!sameProjectInput(projectRef.current, persistedProject)) projectRef.current = projectInput(persistedProject);
  const project = projectRef.current;
  const localViewRef = useRef(false);
  const units = useUnits();
  const editPreviewText = (value: unknown) => JSON.stringify(convertToolQuantities(value, (number, dimension) => units.value(number, CANONICAL_UNITS[dimension])));
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [taskTargets, setTaskTargets] = useState<readonly AiObjectRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [queueSnapshot, setQueueSnapshot] = useState<TaskSchedulerSnapshot>(() => scheduler.snapshot(project.id));
  const [paused, setPaused] = useState(false);
  const [explorationMode, setExplorationMode] = useState<ExplorationMode>("normal");
  const [showHome, setShowHome] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [conversationId, setConversationId] = useState<string>(() => crypto.randomUUID());
  const [conversations, setConversations] = useState(() => persistedProject.taskState?.conversations ?? []);
  const [restoring, setRestoring] = useState(Boolean(persistedProject.taskState?.conversations.length));
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [chatLoaded, setChatLoaded] = useState(false);
  const savedTasks = useRef(persistedProject.taskState?.scheduled ?? []);
  const [remainingSavedTasks, setRemainingSavedTasks] = useState(savedTasks.current.filter((task) => ["queued", "running", "paused", "waiting-input", "waiting-confirmation", "failed"].includes(task.status)));
  const [proposal, setProposal] = useState<FrameProposal | undefined>();
  const [proposalDirty, setProposalDirty] = useState(false);
  const [sectionChange, setSectionChange] = useState<SectionChangeProposal>();
  const sectionRef = useRef(sectionChange); sectionRef.current = sectionChange;
  const [sectionSource, setSectionSource] = useState(project);
  const [sectionSelection, setSectionSelection] = useState<readonly AiObjectRef[]>(selection);
  const [sectionDirty, setSectionDirty] = useState(false);
  const [sectionError, setSectionError] = useState("");
  const [modelEdits, setModelEdits] = useState<ModelEditProposal>();
  const modelEditsRef = useRef(modelEdits); modelEditsRef.current = modelEdits;
  const [modelEditsSource, setModelEditsSource] = useState(project);
  const modelEditsCurrent = modelEditsSource === project;
  const [taskDraft, setTaskDraft] = useState<TaskDraft>();
  const taskDraftRef = useRef(taskDraft); taskDraftRef.current = taskDraft;
  const [taskDraftSource, setTaskDraftSource] = useState(project);
  const taskDraftCurrent = taskDraftSource === project;
  const taskDraftConfirmation = useMemo(() => taskDraft ? prepareTaskDraftConfirmation(taskDraftSource, taskDraft) : undefined, [taskDraftSource, taskDraft]);
  const baselineRef = useRef<string | undefined>(undefined);
  const sectionCurrent = sectionSource === project;
  const sectionConfirmation = useMemo(() => sectionChange ? prepareSectionConfirmation(sectionSource, sectionSelection, sectionChange) : undefined, [sectionSource, sectionSelection, sectionChange]);
  const modelEditsConfirmation = useMemo(() => modelEdits ? prepareModelEditConfirmation(modelEditsSource, modelEdits) : undefined, [modelEditsSource, modelEdits]);
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
  const analysisSourceRef = useRef<string | undefined>(undefined);
  const continuationRef = useRef<"analyze" | "conditions" | "explain" | null>(null);
  const conditionsCurrent = conditionsSource === project;
  const conditionsConfirmation = useMemo(() => conditions ? prepareConditionsConfirmation(conditionsSource, conditions) : undefined, [conditionsSource, conditions]);
  const proposalRef = useRef(proposal); proposalRef.current = proposal;
  const [proposalSource, setProposalSource] = useState(project);
  const proposalCurrent = proposalSource === project;
  const confirmation = useMemo(() => proposal ? prepareFrameConfirmation(proposalSource, proposal) : undefined, [proposalSource, proposal]);
  const previewCallback = useRef(onPreview); previewCallback.current = onPreview;
  const taskRef = useRef<{ requestId: string; promise: Promise<AiTaskResult>; cancel(): void; pause(): boolean; resume(): void } | null>(null);
  const generationRef = useRef(0);
  const selectionKey = JSON.stringify(selection);
  const comparisonKey = JSON.stringify(comparison);
  const snapshot = useMemo(() => captureAiSnapshot(project, JSON.parse(selectionKey), analysis, comparison), [project, selectionKey, analysis, comparisonKey]);
  const currentRef = useRef({ project, sessionId, selectionKey, analysis, comparisonKey });
  currentRef.current = { project, sessionId, selectionKey, analysis, comparisonKey };
  useEffect(() => {
    const refresh = () => setQueueSnapshot(scheduler.snapshot(project.id));
    refresh();
    return scheduler.subscribe((event) => { if (event.ownership.projectId === project.id) refresh(); });
  }, [scheduler, project.id]);
  const logRef = useRef<HTMLDivElement>(null);
  const followOutputRef = useRef(true);
  const coordination = useMemo(() => ({
    task: taskDraft && taskDraftSource !== project ? coordinateTaskDraft(taskDraftSource, project, taskDraft) : undefined,
    edits: modelEdits && modelEditsSource !== project ? coordinateModelEdits(modelEditsSource, project, modelEdits) : undefined,
    section: sectionChange && sectionSource !== project ? coordinateSection(sectionSource, project, sectionChange) : undefined,
    conditions: conditions && conditionsSource !== project ? validateConditions(conditionsSource, project, conditions) : undefined,
    frame: proposal && proposalSource !== project ? coordinateFrame(proposalSource, project, proposal) : undefined,
  }), [project, taskDraft, taskDraftSource, modelEdits, modelEditsSource, sectionChange, sectionSource, conditions, conditionsSource, proposal, proposalSource]);
  const hasPendingAction = busy || Boolean(taskDraft || modelEdits || sectionChange || conditions || proposal);
  const actionTargets = engineeringDraftTargets(taskDraft ? taskDraftSource : conditionsSource, { taskDraft, sectionChange, conditions, modelEdits, proposal }, taskTargets);
  const conflicts = [...(hasPendingAction ? targetConflicts(project, actionTargets) : []), ...Object.values(coordination).flatMap((item) => item?.conflicts ?? [])];
  const adoptCoordination = (includeConflicts = false) => {
    if (coordination.task && (includeConflicts || !coordination.task.conflicts.length)) { taskDraftRef.current = coordination.task.draft; setTaskDraft(coordination.task.draft); setTaskDraftSource(project); }
    if (coordination.edits && (includeConflicts || !coordination.edits.conflicts.length)) { modelEditsRef.current = coordination.edits.draft; setModelEdits(coordination.edits.draft); setModelEditsSource(project); }
    if (coordination.section && !sectionDirty && (includeConflicts || !coordination.section.conflicts.length)) { sectionRef.current = coordination.section.draft; setSectionChange(coordination.section.draft); setSectionSource(project); }
    if (coordination.conditions && !conditionsDirty && (includeConflicts || !coordination.conditions.conflicts.length)) { conditionsRef.current = coordination.conditions.draft; setConditions(coordination.conditions.draft); setConditionsSource(project); }
    if (coordination.frame && !proposalDirty && (includeConflicts || !coordination.frame.conflicts.length)) { proposalRef.current = coordination.frame.draft; setProposal(coordination.frame.draft); setProposalSource(project); }
  };
  useEffect(() => { if (!busy) adoptCoordination(); }, [coordination, busy, sectionDirty, conditionsDirty, proposalDirty]);

  useEffect(() => {
    if (!turns.length || localViewRef.current) return;
    setConversations((previous) => {
      const next = [{ id: conversationId, turns, updatedAt: Date.now(), proposal, proposalSource,
        conditions, conditionsSource, sectionChange, sectionSource, sectionSelection, calculationRequested,
        requestPrompt: requestPromptRef.current, baselineId: baselineRef.current, modelEdits, modelEditsSource, taskDraft, taskDraftSource, targets: taskTargets, analysisSourceId: analysisSourceRef.current },
      ...previous.filter((item) => item.id !== conversationId)];
      return next;
    });
  }, [turns, conversationId, project.id, proposal, proposalSource, conditions, conditionsSource, sectionChange, sectionSource, sectionSelection, calculationRequested, modelEdits, modelEditsSource, taskDraft, taskDraftSource, taskTargets]);

  useEffect(() => {
    const scheduled = [...savedTasks.current, ...scheduler.exportProject(project.id)];
    const analyses = (persistedProject.taskState?.analyses ?? []).filter((item) => scheduled.some((task) => task.id === item.taskId && !["completed", "cancelled"].includes(task.status)));
    onTaskStateChange(persistTaskState(project.id, conversations, [...new Map(scheduled.map((task) => [task.id, task])).values()], analyses));
    if (!chatLoaded || restoring) return;
    void window.frameMind.saveChatHistory({ projectId: project.id, content: JSON.stringify(redactPersistence(conversations)) }).catch(() => onPersistenceError("本机聊天记录写入失败，工程仍可保存"));
  }, [conversations, queueSnapshot, restoring, remainingSavedTasks, chatLoaded]);

  useEffect(() => {
    let current = true;
    void window.frameMind.loadChatHistory(project.id).then((content) => {
      if (!current) return;
      if (!content) { setChatLoaded(true); return; }
      const histories: ConversationHistory[] = JSON.parse(content);
      setConversations((previous) => mergeLocalChat(persistedProject, previous, histories));
      setChatLoaded(true);
    }).catch(() => onPersistenceError("本机聊天记录读取失败，项目任务记录仍可恢复"));
    return () => { current = false; };
  }, []);

  const newConversation = () => {
    localViewRef.current = false;
    if (busy || analysisBusy || proposalDirty || conditionsDirty || sectionDirty || modelEdits || taskDraft) return;
    rejectProposal(); rejectConditions(); rejectSection(); rejectModelEdits(); rejectTaskDraft();
    baselineRef.current = undefined;
    setTaskTargets([]); analysisSourceRef.current = undefined;
    setConversationId(crypto.randomUUID()); setTurns([]); setDraft(""); setShowHome(true);
    followOutputRef.current = true;
  };
  const openConversation = (conversation: ConversationHistory) => {
    if (busy || analysisBusy || proposalDirty || conditionsDirty || sectionDirty || modelEdits || taskDraft) return;
    followOutputRef.current = true;
    rejectProposal(); rejectConditions(); rejectSection(); rejectModelEdits(); rejectTaskDraft();
    baselineRef.current = undefined;
    localViewRef.current = Boolean(conversation.localOnly);
    const issues = conversation.localOnly ? ["仅查看本机聊天，工程任务状态以保存的项目为准"] : recoveryIssues(persistedProject, conversation);
    setRecoveryMessage(issues.join("；"));
    setRestoring(false);
    setConversationId(conversation.id); setTurns(recoveredTurns(conversation)); setDraft(""); setShowHome(false);
    proposalRef.current = conversation.proposal; setProposal(conversation.proposal); setProposalSource(conversation.proposalSource);
    conditionsRef.current = conversation.conditions; setConditions(conversation.conditions); setConditionsSource(conversation.conditionsSource);
    sectionRef.current = conversation.sectionChange; setSectionChange(conversation.sectionChange); setSectionSource(conversation.sectionSource); setSectionSelection(conversation.sectionSelection);
    setCalculationRequested(conversation.calculationRequested && !issues.length); requestPromptRef.current = conversation.requestPrompt; baselineRef.current = conversation.baselineId;
    modelEditsRef.current = conversation.modelEdits; setModelEdits(conversation.modelEdits); setModelEditsSource(conversation.modelEditsSource ?? project);
    taskDraftRef.current = conversation.taskDraft; setTaskDraft(conversation.taskDraft); setTaskDraftSource(conversation.taskDraftSource ?? project);
    setTaskTargets(conversation.targets ?? conversation.turns.at(-1)?.context.selection ?? []); analysisSourceRef.current = conversation.analysisSourceId;
  };

  // Drafts are presented in the card dock; they do not draw a coloured scene overlay.
  useEffect(() => { previewCallback.current(null); }, []);
  useEffect(() => () => previewCallback.current(null), []);
  const stageWorkflow = (draftId: string) => {
    const owner = [...turns].reverse().find((turn) => !turn.stageResolutions?.[draftId] && turn.result?.records.some((record) =>
      [record.result.taskDraft?.id, record.result.proposal?.id, record.result.conditions?.id, record.result.sectionChange?.id].includes(draftId)));
    return owner?.workflowId ?? owner?.id ?? turns.at(-1)?.workflowId ?? turns.at(-1)?.id;
  };
  const releaseWaitingTask = (draftId: string, completed: boolean) => {
    const owner = [...turns].reverse().find((turn) => turn.scheduledTaskId && turn.result?.records.some((record) =>
      [record.result.taskDraft?.id, record.result.proposal?.id, record.result.conditions?.id, record.result.sectionChange?.id, record.result.modelEdits?.id].includes(draftId)));
    if (!owner?.scheduledTaskId) return;
    const scheduled = scheduler.get(owner.scheduledTaskId);
    if (!scheduled && savedTasks.current.some((task) => task.id === owner.scheduledTaskId)) {
      savedTasks.current = savedTasks.current.map((task) => task.id === owner.scheduledTaskId ? { ...task, status: completed ? "completed" : "cancelled", finishedAt: Date.now() } : task);
      setRemainingSavedTasks((tasks) => tasks.filter((task) => task.id !== owner.scheduledTaskId));
    }
    if (!scheduled || (scheduled.status !== "waiting-input" && scheduled.status !== "waiting-confirmation" && scheduled.status !== "paused")) return;
    if (completed) scheduler.complete(owner.scheduledTaskId);
    else scheduler.cancel(owner.scheduledTaskId);
  };
  const resolveStage = (draft: StageResolution["draft"], status: StageResolution["status"], exceptTurnId?: string) => {
    if (!draft) return;
    const resourceNames = "parameters" in draft ? Object.fromEntries([
      ...frameResourceOptions(snapshot, "material"), ...frameResourceOptions(snapshot, "beamSection"),
    ].map((option) => [option.value, option.label.split(" · ")[0]])) : undefined;
    let parameters: string | undefined;
    if ("projectId" in draft) {
      parameters = `任务目标：${draft.goal ?? "未填写"}\n草案版本：V${draft.version} · 基础 R${draft.baseRevision}`;
    } else if (!("parameters" in draft) && !("memberIds" in draft)) {
      const sourceId = draft.analysisSourceId ?? project.activeAnalysisCaseId ?? project.activeLoadCombinationId ?? project.activeLoadCaseId;
      const sourceName = [...(draft.loadCases ?? []), ...(draft.loadCombinations ?? [])].find((item) => item.ref === sourceId || item.id === sourceId)?.name
        ?? [...project.loadCases, ...project.loadCombinations, ...project.analysisCases].find((item) => item.id === sourceId)?.name ?? sourceId;
      parameters = conditionSummaries(project, draft).flatMap((summary) => summary.groups.map((group) => `${summary.label} · ${group.objects.join("、")}：${group.setting}`)).join("\n");
      parameters += `\n计算来源：${sourceName}`;
    }
    setTurns((previous) => previous.map((turn) => turn.id !== exceptTurnId && !turn.stageResolutions?.[draft.id]
      && turn.result?.records.some((record) => [record.result.taskDraft?.id, record.result.proposal?.id, record.result.conditions?.id, record.result.sectionChange?.id].includes(draft.id))
      ? { ...turn, stageResolutions: { ...turn.stageResolutions, [draft.id]: { status, draft, resourceNames, parameters } } } : turn));
  };
  const rejectProposal = (status: StageResolution["status"] = "cancelled") => { const draft = proposalRef.current; if (draft) releaseWaitingTask(draft.id, status === "confirmed"); resolveStage(draft, status); proposalRef.current = undefined; taskRef.current?.cancel(); setProposal(undefined); setProposalDirty(false); };
  const changeProposal = (next: FrameProposal) => { proposalRef.current = next; taskRef.current?.cancel(); setProposal(next); setProposalSource(project); setProposalDirty(false); };
  const rejectConditions = () => { const draft = conditionsRef.current; if (draft) releaseWaitingTask(draft.id, false); resolveStage(draft, "cancelled"); conditionsRef.current = undefined; taskRef.current?.cancel(); setConditions(undefined); setConditionsDirty(false); setCalculationRequested(false); continuationRef.current = null; };
  const changeConditions = (next: ConditionsProposal) => {
    const coordinated = validateConditions(conditionsSource, project, next);
    const updated = coordinated.conflicts.length ? next : coordinated.draft;
    previousConditionsRef.current = conditionsRef.current; conditionsRef.current = updated; taskRef.current?.cancel(); setConditions(updated);
    if (!coordinated.conflicts.length) setConditionsSource(project);
    setConditionsDirty(false);
  };
  const rejectSection = () => { const draft = sectionRef.current; if (draft) releaseWaitingTask(draft.id, false); resolveStage(draft, "cancelled"); sectionRef.current = undefined; taskRef.current?.cancel(); setSectionChange(undefined); setSectionDirty(false); setSectionError(""); setCalculationRequested(false); continuationRef.current = null; };
  const changeSection = (next: SectionChangeProposal) => {
    const coordinated = coordinateSection(sectionSource, project, next);
    const updated = coordinated.conflicts.length ? next : coordinated.draft;
    previousSectionRef.current = sectionRef.current; sectionRef.current = updated; taskRef.current?.cancel(); setSectionChange(updated);
    if (!coordinated.conflicts.length) setSectionSource(project);
    setSectionDirty(false); setSectionError("");
  };
  const rejectModelEdits = (completed = false) => { const draft = modelEditsRef.current; if (draft) releaseWaitingTask(draft.id, completed); modelEditsRef.current = undefined; taskRef.current?.cancel(); setModelEdits(undefined); setModelEditsSource(project); };
  const rejectTaskDraft = (completed = false) => { const draft = taskDraftRef.current; if (draft) releaseWaitingTask(draft.id, completed); resolveStage(draft, completed ? "confirmed" : "cancelled"); taskDraftRef.current = undefined; taskRef.current?.cancel(); setTaskDraft(undefined); setTaskDraftSource(project); };
  const confirmModelEdits = async () => {
    if (!modelEditsConfirmation || busy || analysisBusy || conflicts.length || !modelEditsCurrent || modelEditsRef.current !== modelEdits || proposal || conditions || sectionChange || taskDraft) return;
    const result = await onEditsConfirm(modelEditsConfirmation);
    const draft = modelEdits!;
    setTurns((previous) => [...previous, { id: crypto.randomUUID(), origin: "confirmation", prompt: "确认应用基础编辑", context: modelEditsConfirmation.baseProject === project ? snapshot.context : captureAiSnapshot(modelEditsSource, []).context, sourceProject: modelEditsSource,
      result: { ...result, workKind: "agent", records: [{ round: 0, call: { id: modelEditsConfirmation.requestId, type: "function", function: { name: "confirm_model_edits", arguments: JSON.stringify({ proposalId: draft.id, proposalVersion: draft.version, baseRevision: draft.baseRevision }) } }, result }] } }]);
    if (result.status === "applied") rejectModelEdits(true);
  };
  const confirmTaskDraft = async () => {
    if (!taskDraftConfirmation || busy || analysisBusy || conflicts.length || !taskDraftCurrent || taskDraftRef.current !== taskDraft || proposal || conditions || sectionChange || modelEdits) return;
    const result = await onTaskConfirm(taskDraftConfirmation);
    const draft = taskDraft!;
    setTurns((previous) => [...previous, { id: crypto.randomUUID(), origin: "confirmation", prompt: "确认应用完整任务草案", context: taskDraftConfirmation.context, sourceProject: taskDraftConfirmation.baseProject,
      result: { ...result, workKind: "agent", records: [{ round: 0, call: { id: taskDraftConfirmation.requestId, type: "function", function: { name: "confirm_task_draft", arguments: JSON.stringify({ taskId: draft.id, taskVersion: draft.version, baseRevision: taskDraftConfirmation.context.modelRevision }) } }, result }] } }]);
    if (result.status === "applied") {
      // A complete task owns its analysis intent. Once the atomic receipt has
      // been verified, continue directly with the formal model now on screen.
      if (draft.analysis?.requested) setCalculationRequested(true);
      analysisSourceRef.current = (result.data as { analysis?: { sourceId?: string } } | undefined)?.analysis?.sourceId ?? analysisSourceRef.current;
      if (draft.analysis?.requested || calculationRequestedRef.current) continuationRef.current = "analyze";
      resolveStage(taskDraftRef.current, "confirmed"); rejectTaskDraft(true);
    }
  };
  const confirmSection = async () => {
    if (!sectionConfirmation || busy || analysisBusy || conflicts.length || sectionDirty || !sectionCurrent || sectionRef.current !== sectionChange || proposal || conditions || taskDraft) return;
    const result = await onSectionConfirm(sectionConfirmation);
    setTurns((previous) => [...previous, { id: crypto.randomUUID(), workflowId: stageWorkflow(sectionChange!.id), origin: "confirmation", prompt: "确认应用截面修改阶段", context: snapshot.context, sourceProject: project,
      result: { ...result, workKind: "agent", records: [{ round: 0, call: { id: sectionConfirmation.requestId, type: "function", function: { name: "confirm_section_change", arguments: JSON.stringify({ proposalId: sectionChange!.id, memberIds: sectionChange!.memberIds, baseRevision: project.revision }) } }, result }] } }]);
    if (result.status === "applied") {
      releaseWaitingTask(sectionChange!.id, true);
      resolveStage(sectionRef.current, "confirmed");
      baselineRef.current = snapshot.analysisCurrent ? snapshot.analysis?.id : undefined;
      sectionRef.current = undefined; setSectionChange(undefined); setSectionDirty(false);
      if (calculationRequestedRef.current) continuationRef.current = "analyze";
    }
  };
  const analyze = async (workflowId?: string) => {
    if (busy || analysisBusy || proposalRef.current || conditionsRef.current || sectionRef.current || modelEditsRef.current || taskDraftRef.current) return;
    setCalculationRequested(false);
    const id = crypto.randomUUID();
    const context = snapshot.context;
    const generation = generationRef.current;
    setTurns((previous) => [...previous, { id, workflowId: workflowId ?? previous.at(-1)?.workflowId ?? previous.at(-1)?.id, origin: "analysis", prompt: "继续已请求的本地分析", context, sourceProject: project }]);
    const savedAnalysis = persistedProject.taskState?.analyses.find((item) => savedTasks.current.some((task) => task.id === item.taskId && task.kind === "analysis"));
    if (savedAnalysis) {
      savedTasks.current = savedTasks.current.filter((task) => task.id !== savedAnalysis.taskId);
      setRemainingSavedTasks((items) => items.filter((task) => task.id !== savedAnalysis.taskId));
    }
    const result = savedAnalysis ? await onResumeAnalysis(savedAnalysis.input) : await onAnalyze(analysisSourceRef.current);
    if (generationRef.current !== generation || currentRef.current.project.id !== context.projectId || currentRef.current.sessionId !== sessionId) return;
    const afterId = (result.data as { analysisId?: string } | undefined)?.analysisId;
    if (result.status === "completed" && baselineRef.current && afterId) {
      onComparison({ beforeId: baselineRef.current, afterId }, false);
      baselineRef.current = undefined;
      continuationRef.current = "explain";
    }
    setTurns((previous) => previous.map((turn) => turn.id === id ? { ...turn, result: { ...result, workKind: "agent", records: [{ round: 0,
      call: { id, type: "function", function: { name: "run_analysis", arguments: JSON.stringify({ projectId: context.projectId, modelRevision: context.modelRevision }) } }, result }] } } : turn));
  };
  const confirmConditions = async () => {
    if (!conditionsConfirmation || busy || analysisBusy || conflicts.length || conditionsDirty || !conditionsCurrent || conditionsRef.current !== conditions || proposal || sectionChange || taskDraft) return;
    const result = await onConditionsConfirm(conditionsConfirmation);
    setTurns((previous) => [...previous, { id: crypto.randomUUID(), workflowId: stageWorkflow(conditions!.id), origin: "confirmation", prompt: "确认应用分析条件阶段",
      context: conditionsConfirmation.context, sourceProject: conditionsConfirmation.baseProject, result: { ...result, workKind: "agent", records: [{ round: 0,
        call: { id: conditionsConfirmation.requestId, type: "function", function: { name: "confirm_analysis_conditions", arguments: JSON.stringify({ proposalId: conditions!.id, proposalVersion: conditions!.version, baseRevision: conditionsConfirmation.context.modelRevision }) } }, result }] } }]);
    if (result.status === "applied") {
      releaseWaitingTask(conditions!.id, true);
      analysisSourceRef.current = (result.data as { analysisSourceId?: string } | undefined)?.analysisSourceId ?? analysisSourceRef.current;
      resolveStage(conditionsRef.current, "confirmed");
      conditionsRef.current = undefined; setConditions(undefined); setConditionsDirty(false);
      if (calculationRequestedRef.current) continuationRef.current = "analyze";
    }
  };
  const confirmProposal = async () => {
    if (!confirmation || busy || analysisBusy || conflicts.length || proposalDirty || !proposalCurrent || proposalRef.current !== proposal || sectionChange || taskDraft) return;
    const result = await onConfirm(confirmation);
    setTurns((previous) => [...previous, { id: crypto.randomUUID(), workflowId: stageWorkflow(proposal!.id), origin: "confirmation", prompt: "确认应用建模阶段",
      context: confirmation.context, sourceProject: confirmation.baseProject,
       result: { ...result, workKind: "agent", records: [{ round: 0, call: { id: confirmation.requestId, type: "function",
        function: { name: "confirm_frame_stage", arguments: JSON.stringify({ proposalId: confirmation.proposal.id,
          proposalVersion: confirmation.proposal.version, baseRevision: confirmation.context.modelRevision }) } }, result }] } }]);
    if (result.status === "applied") {
      rejectProposal("confirmed");
      // Conditions reference formal identities, so prepare them only after geometry is applied.
      setConditions(undefined); conditionsRef.current = undefined; setConditionsDirty(false);
      if (calculationRequestedRef.current) continuationRef.current = "conditions";
    }
  };

  useEffect(() => {
    taskRef.current?.cancel();
  }, [project.id, sessionId]);
  useEffect(() => () => {
    generationRef.current += 1;
    taskRef.current?.cancel();
  }, []);
  useEffect(() => {
    if (open && !showHome && followOutputRef.current && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [turns, open, showHome]);

  const submit = async (prompt = draft, continuing = false, retryOf?: string, requestText?: string, taskDraftRevision = false, restoredTargets?: readonly AiObjectRef[]) => {
    if (!prompt.trim() || taskRef.current || busy || analysisBusy || proposalDirty || conditionsDirty || sectionDirty || modelEdits || taskDraft && !taskDraftRevision) return;
    if (localViewRef.current) { localViewRef.current = false; setConversationId(crypto.randomUUID()); setTurns([]); }
    const text = prompt.trim();
    const taskText = requestText ?? text;
    const retryTurn = retryOf ? turns.find((turn) => turn.result?.requestId === retryOf) : undefined;
    const intent = continuing ? undefined : calculationIntent(text);
    if (intent === "cancel") { setCalculationRequested(false); continuationRef.current = null; }
    else if (intent === "request") { setCalculationRequested(true); requestPromptRef.current = text; analysisSourceRef.current = retryTurn ? retryTurn.sourceProject.activeAnalysisCaseId ?? retryTurn.sourceProject.activeLoadCombinationId ?? retryTurn.sourceProject.activeLoadCaseId : project.activeAnalysisCaseId ?? project.activeLoadCombinationId ?? project.activeLoadCaseId; }
    const id = crypto.randomUUID();
    const generation = generationRef.current;
    const submittedSnapshot = captureAiSnapshot(project, restoredTargets ?? retryTurn?.context.selection ?? (sectionChange ? sectionSelection : continuing || taskDraftRevision || proposal || conditions ? taskTargets : selection),
      retryTurn ? project.analysisResults.find((item) => item.id === retryTurn.context.analysisId) : analysis, retryTurn?.context.comparison ?? comparison);
    const context = submittedSnapshot.context;
    setTaskTargets(context.selection);
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
    setTurns((previous) => [...previous, { id, workflowId: continuing ? previous.at(-1)?.workflowId ?? previous.at(-1)?.id : id, origin: "chat", prompt: text, requestText, context, sourceProject: project, continuing, proposal, conditions, sectionChange, modelEdits, taskDraft }]);
    const update = (changes: Partial<ConversationTurn>) => {
      if (generationRef.current === generation) {
        setTurns((previous) => previous.map((turn) => turn.id === id ? { ...turn, ...changes } : turn));
      }
    };
    if (!window.frameMind) {
      update({ result: { status: "failed", workKind: "conversation", message: "桌面连接不可用，请在 FrameMind 桌面应用中打开项目。", context, records: [] } });
      setBusy(false);
      return;
    }
    let underlying: ReturnType<typeof startAiTask> | null = null;
    const supplementingActiveTask = (taskDraftRevision || continuing || Boolean(proposal || conditions || sectionChange || modelEdits || taskDraft))
      && scheduler.snapshot(project.id).active.some((task) => task.kind === "agent");
    const handle = scheduler.submit({
      projectId: project.id, kind: "agent", relation: supplementingActiveTask ? "supplement" : "new",
      goal: text, queuedRevision: project.revision,
      getInput: () => captureAiSnapshot(currentRef.current.project, context.selection, currentRef.current.analysis, comparison),
      execute: async (liveInput, taskContext) => {
        underlying = startAiTask(liveInput as ReturnType<typeof captureAiSnapshot>, taskText, {
          transport: window.frameMind,
          retryOf,
          history,
          proposal,
          conditions,
          sectionChange,
          modelEdits,
          taskDraft,
          isCurrent: () => currentRef.current.project.id === project.id && currentRef.current.sessionId === sessionId
            && generationRef.current === generation && proposalRef.current === proposal && conditionsRef.current === conditions && sectionRef.current === sectionChange && modelEditsRef.current === modelEdits && taskDraftRef.current === taskDraft,
          getCurrentSnapshot: () => captureAiSnapshot(currentRef.current.project, context.selection, analysis, comparison),
          onProgress: (progress) => {
            taskContext.reportPhase(progress.analysisPhase ?? progress.phase);
            if (generationRef.current === generation) setTurns((previous) => previous.map((turn) => turn.id === id
              ? { ...turn, progress, exploration: progress.exploration, progressEvents: [...(turn.progressEvents ?? []), progress] } : turn));
          },
          exploration: { mode: explorationMode },
          onExploration: (snapshot) => {
            if (snapshot.phase === "paused") taskContext.setStatus("paused");
            else if (snapshot.phase === "running") taskContext.setStatus("running");
            if (generationRef.current === generation) setTurns((previous) => previous.map((turn) => turn.id === id ? { ...turn, exploration: snapshot } : turn));
          },
          onOutput: (output) => update({ output }),
        });
        taskContext.signal.addEventListener("abort", () => underlying?.cancel(), { once: true });
        try {
          const result = await underlying.promise;
          taskContext.setKind(result.workKind);
          if (result.status === "missing-input") taskContext.setStatus("waiting-input");
          else if (result.status === "awaiting-confirmation") taskContext.setStatus("waiting-confirmation");
          else if (result.status === "failed") taskContext.setStatus("failed");
          else if (result.status === "cancelled") taskContext.setStatus("cancelled");
          return result;
        }
        finally { underlying = null; }
      },
    });
    const task = {
      requestId: handle.taskId,
      promise: handle.promise as Promise<AiTaskResult>,
      cancel: () => { if (underlying) underlying.cancel(); else handle.cancel(); },
      pause: () => underlying?.pause() ?? false,
      resume: () => { underlying?.resume(); },
    };
    taskRef.current = task;
    update({ scheduledTaskId: handle.taskId });
    try {
          const result = await task.promise;
          update({ result, output: undefined });
      if (result.proposal !== undefined && result.status !== "cancelled" && result.status !== "failed"
        && result.records.some((record) => record.result.proposal !== undefined)
        && currentRef.current.project.id === project.id && generationRef.current === generation && proposalRef.current === proposal) {
        if (result.proposal) resolveStage(proposal, "updated", id);
        setProposal(result.proposal ?? undefined); setProposalSource(result.draftBaseProject ?? currentRef.current.project); setProposalDirty(false);
        if (result.proposal === null) { resolveStage(proposal, "cancelled"); setCalculationRequested(false); }
      }
      if (result.conditions !== undefined && result.status !== "cancelled" && result.status !== "failed"
        && result.records.some((record) => record.result.conditions !== undefined)
        && currentRef.current.project.id === project.id && generationRef.current === generation && conditionsRef.current === conditions) {
        if (result.conditions) resolveStage(conditions, "updated", id);
        previousConditionsRef.current = conditions; setConditions(result.conditions ?? undefined); setConditionsSource(result.draftBaseProject ?? currentRef.current.project); setConditionsDirty(false);
        if (result.conditions === null) { resolveStage(conditions, "cancelled"); setCalculationRequested(false); }
      }
      if (result.sectionChange !== undefined && result.status !== "cancelled" && result.status !== "failed"
        && result.records.some((record) => record.result.sectionChange !== undefined)
        && currentRef.current.project.id === project.id && generationRef.current === generation && sectionRef.current === sectionChange) {
        if (result.sectionChange) { resolveStage(sectionChange, "updated", id); sectionRef.current = result.sectionChange; setSectionChange(result.sectionChange); setSectionSource(result.draftBaseProject ?? currentRef.current.project); setSectionSelection(context.selection); } else rejectSection();
      }
      if (result.modelEdits !== undefined && result.status !== "cancelled" && result.status !== "failed"
        && result.records.some((record) => record.result.modelEdits !== undefined)
        && currentRef.current.project.id === project.id && generationRef.current === generation && modelEditsRef.current === modelEdits) {
        if (result.modelEdits) { modelEditsRef.current = result.modelEdits; setModelEdits(result.modelEdits); setModelEditsSource(result.draftBaseProject ?? currentRef.current.project); }
        else rejectModelEdits();
      }
      if (result.taskDraft !== undefined && result.status !== "cancelled" && result.status !== "failed"
        && result.records.some((record) => record.result.taskDraft !== undefined)
        && currentRef.current.project.id === project.id && generationRef.current === generation && taskDraftRef.current === taskDraft) {
        setTaskDraft(result.taskDraft ?? undefined); setTaskDraftSource(result.draftBaseProject ?? currentRef.current.project);
        if (result.taskDraft === null) rejectTaskDraft();
      }
      if (result.status === "completed" && !result.proposal && !result.conditions && !result.sectionChange && !result.modelEdits && !result.taskDraft && result.sectionChange !== null && result.conditions !== null && result.proposal !== null && result.modelEdits !== null && result.taskDraft !== null
        && !continuing && result.records.some((record) => record.result.analysisRequested)
        && calculationRequestedRef.current && intent !== "cancel") continuationRef.current = "analyze";
    } catch {
      const cancelled = scheduler.get(handle.taskId)?.status === "cancelled";
      update({ result: { requestId: handle.taskId, status: cancelled ? "cancelled" : "failed", workKind: "conversation", message: cancelled ? "任务已取消，已确认工程和已有证据保留" : "对话未完成，请检查连接设置后重试。", context, records: [] }, output: undefined });
    } finally {
      if (taskRef.current === task) {
        taskRef.current = null;
        setPaused(false);
        setBusy(false);
      }
    }
  };

  const sameDraft = (left: { id: string; version: number } | undefined, right: { id: string; version: number } | undefined) => left === right || Boolean(left && right && left.id === right.id && left.version === right.version);
  const canRetry = (turn: ConversationTurn) => turn === [...turns].reverse().find((entry) => !entry.localOnly) && sameEngineeringState(turn.sourceProject, project)
    && !targetConflicts(project, turn.context.selection).length
    && sameDraft(turn.proposal, proposal) && sameDraft(turn.conditions, conditions) && sameDraft(turn.sectionChange, sectionChange) && sameDraft(turn.modelEdits, modelEdits) && sameDraft(turn.taskDraft, taskDraft);

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

  const workflows = new Map<string, ConversationTurn[]>();
  const dismissSavedTask = (taskId: string) => {
    savedTasks.current = savedTasks.current.filter((task) => task.id !== taskId);
    setRemainingSavedTasks((items) => items.filter((task) => task.id !== taskId));
  };
  const resumeSavedTask = async (task: ScheduledTaskDescriptor) => {
    const owner = conversations.find((item) => item.turns.some((turn) => turn.scheduledTaskId === task.id));
    const targets = owner?.targets ?? owner?.turns.find((turn) => turn.scheduledTaskId === task.id)?.context.selection ?? [];
    const issues = owner ? recoveryIssues(persistedProject, owner) : targetConflicts(project, targets);
    if (issues.length) { setRecoveryMessage(issues.join("；")); return; }
    const input = persistedProject.taskState?.analyses.find((item) => item.taskId === task.id)?.input;
    dismissSavedTask(task.id);
    if (task.kind === "analysis") {
      const result = input ? await onResumeAnalysis(input) : await onAnalyze(task.analysisSourceId);
      setRecoveryMessage(result.message);
    } else {
      const goal = task.lastGoal && task.lastGoal !== task.goal ? `${task.goal}\n补充要求：${task.lastGoal}` : task.goal;
      await submit(goal, false, undefined, undefined, false, targets);
    }
  };
  for (const turn of turns) {
    const id = turn.workflowId ?? turn.id;
    const workflow = workflows.get(id) ?? [];
    workflow.push(turn);
    workflows.set(id, workflow);
  }

  return <aside id="assistant-panel" className="assistant-panel" aria-label="AI 对话" hidden={!open}>
    <div className="panel-heading"><span>Framer</span><div className="ai-heading-actions">
         <button className="icon-button" aria-label="历史对话" title="历史对话" aria-pressed={showHome} disabled={busy || analysisBusy || Boolean(taskDraft)} onClick={() => setShowHome((value) => !value)}><History size={15} /></button>
      <button className="icon-button" aria-label="新建对话" title="新建对话" disabled={busy || analysisBusy || proposalDirty || conditionsDirty || sectionDirty || Boolean(taskDraft)} onClick={newConversation}><SquarePen size={15} /></button>
      {busy && <button className="icon-button" aria-label="取消对话" title="结束本次对话请求" onClick={() => { taskRef.current?.cancel(); setCalculationRequested(false); continuationRef.current = null; }}><X size={14} /></button>}
      <button className="icon-button" aria-label="清空对话" title="清空对话" disabled={busy || analysisBusy || proposalDirty || conditionsDirty || sectionDirty || Boolean(taskDraft) || turns.length === 0} onClick={() => {
        const next = conversations.filter((item) => item.id !== conversationId);
        setConversations(next); newConversation();
      }}><Trash2 size={14} /></button>
      <button className="icon-button" aria-label="收起 AI 对话" title="收起 AI 对话" onClick={onClose}><X size={15} /></button>
    </div></div>
    {restoring && <section className="ai-recovery-actions" aria-label="重启任务恢复"><span>项目任务已载入，待核对与继续</span><button type="button" onClick={() => { const conversation = conversations[0]; if (conversation) openConversation(conversation); }}>恢复任务</button><button type="button" onClick={() => setRestoring(false)}>稍后处理</button></section>}
    {recoveryMessage && <p role="alert">{recoveryMessage}</p>}
    {remainingSavedTasks.filter((task) => task.kind === "analysis" || task.status === "queued" || !conversations.some((item) => item.turns.some((turn) => turn.scheduledTaskId === task.id))).map((task) => <div className="ai-recovery-actions" key={task.id}><span>{task.goal} · 已暂停</span><button type="button" disabled={busy || analysisBusy || hasPendingAction} onClick={() => void resumeSavedTask(task)}>继续任务</button><button type="button" onClick={() => dismissSavedTask(task.id)}>取消恢复</button></div>)}
    {showHome && <section className="ai-conversation-home" aria-label="历史对话列表">
      <div className="ai-history-list">{(historyExpanded ? conversations : conversations.slice(0, 3)).map((conversation) => <button type="button" className="ai-history-item" key={conversation.id}
         disabled={busy || analysisBusy || proposalDirty || conditionsDirty || sectionDirty || Boolean(taskDraft)} onClick={() => openConversation(conversation)}>
        <span>{conversation.turns.find((turn) => turn.origin === "chat")?.prompt ?? "对话"}</span><time dateTime={new Date(conversation.updatedAt).toISOString()}>{new Date(conversation.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Taipei" })}</time>
      </button>)}</div>
      {conversations.length > 3 && <button type="button" className="ai-history-expand" aria-expanded={historyExpanded} onClick={() => setHistoryExpanded((value) => !value)}>{historyExpanded ? "收起历史记录" : `查看全部（${conversations.length} 个）`}</button>}
    </section>}
    <div className="assistant-messages" ref={logRef} role="log" aria-label="对话消息" aria-live="polite" hidden={showHome}
      onScroll={(event) => { const log = event.currentTarget; followOutputRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48; }}>
      {queueSnapshot.queued.length > 0 && <div className="ai-queue-notice" role="status">等待中的工程任务：{queueSnapshot.queued.length} · 启动时读取最新模型</div>}
      {[...workflows].map(([id, workflow]) => <article className="ai-workflow ai-turn" key={id}>
        <div className="ai-user-message"><p>{workflow[0].origin === "chat" && !workflow[0].continuing ? workflow[0].prompt : "继续处理已确认任务"}</p><div className="ai-message-context">{workflow[0].context.selection.length > 0 && <button className="icon-button" aria-label="定位任务目标" title="定位发送时目标" onClick={() => onLocateTargets(workflow[0].context.selection)}><Crosshair size={14} /></button>}{workflow.some((turn) => !sameEngineeringState(turn.sourceProject, project)) && <span className="ai-stale">历史版本</span>}</div></div>
        <AiTaskTimeline turns={workflow} paused={paused && (turns.at(-1)?.workflowId ?? turns.at(-1)?.id) === id} />
        {(turns.at(-1)?.workflowId ?? turns.at(-1)?.id) === id && !workflow.at(-1)?.result && <>
          <span className="ai-turn-status" data-testid="ai-turn-status">{paused ? "已暂停输出" : "处理中 · 正在读取当前模型"}</span>
          {workflow.at(-1)?.exploration && <span className="ai-exploration-status" role="status">{workflow.at(-1)!.exploration!.mode === "deep" ? "深度探索" : "正常探索"} · 活动 {Math.floor(workflow.at(-1)!.exploration!.elapsedMs / 1000)} 秒 · 轮次 {workflow.at(-1)!.exploration!.rounds} · 调用 {workflow.at(-1)!.exploration!.toolCalls}</span>}
        </>}
        {workflow.map((turn) => (turn.result || turn.output) && <AiResultExplanation key={turn.id} project={project} result={(turn.result ?? turn.output)!} onLocate={onLocateResult} onCompare={(pair) => onComparison(pair, true)} />)}
        {workflow.map((turn) => turn.result && <div key={turn.id}>
          <span className="ai-turn-status" data-testid="ai-turn-status">{{ completed: "已完成", applied: "已应用", "missing-input": "缺少输入", "awaiting-confirmation": "等待确认", failed: "处理失败", cancelled: "已取消" }[turn.result.status]} · {turn.result.message}</span>
          {turn.result.exploration && <span className="ai-exploration-status" role="status">{turn.result.exploration.mode === "deep" ? "深度探索" : "正常探索"} · 预算 {Math.round(turn.result.exploration.budgetMs / 1000)} 秒 · 活动 {Math.floor(turn.result.exploration.elapsedMs / 1000)} 秒 · 等待 {Math.floor(turn.result.exploration.waitingMs / 1000)} 秒 · 轮次 {turn.result.exploration.rounds} · 调用 {turn.result.exploration.toolCalls} · 候选 {turn.result.exploration.candidates} · 分析 {turn.result.exploration.analyses}{turn.result.exploration.stopReason ? ` · ${turn.result.exploration.stopReason}` : ""}</span>}
          {turn.origin === "chat" && (turn.result.status === "failed" || turn.result.status === "cancelled") && <>
            <p className="frame-draft-notice">已确认模型和成功结果保留，本地编辑与计算可继续。
              {turn.result.interruption?.draftsDiscarded ? "本次中断生成的草案未应用，需要重新准备。" : proposal || conditions || sectionChange || taskDraft ? "已有草案仍需在卡片中核对并确认。" : "本次任务未提交模型修改。"}
              {!canRetry(turn) && "上下文或阶段已变化，请基于当前模型发送新消息；已提交阶段无需重做。"}</p>
            <div className="ai-recovery-actions">
            <button className="icon-button" aria-label="重试消息" title="重新读取当前模型并重试" disabled={busy || analysisBusy || proposalDirty || conditionsDirty || sectionDirty || Boolean(modelEdits) || Boolean(taskDraft) || !canRetry(turn)} onClick={() => { if (canRetry(turn)) void submit(turn.prompt, turn.continuing, turn.result?.requestId, turn.requestText); }}><RotateCcw size={14} /></button>
            {turn.result.status === "failed" && <button className="icon-button" aria-label="打开连接设置" title="打开连接设置" onClick={onSettings}><Settings2 size={14} /></button>}
          </div></>}
          {turn.origin === "analysis" && (turn.result.status === "failed" || turn.result.status === "cancelled") && <button disabled={busy || analysisBusy || Boolean(proposal) || Boolean(conditions) || Boolean(sectionChange) || Boolean(taskDraft)} onClick={() => void analyze(turn.workflowId ?? turn.id)}>继续本地计算</button>}
        </div>)}
      </article>)}
      {comparison && <button className="button ghost compact-button" onClick={() => onComparison(comparison, true)}>查看本次前后对比</button>}
      {calculationRequested && <p className="frame-draft-notice">已请求本地计算，等待必要阶段确认；未确认建议不会进入求解。{!hasPendingAction && <button disabled={busy || analysisBusy} onClick={() => void analyze()}>继续本地计算</button>}<button onClick={() => { setCalculationRequested(false); continuationRef.current = null; }}>取消后续计算</button></p>}
    </div>
    {(proposal || conditions || sectionChange || modelEdits || taskDraft || sectionError || conflicts.length > 0) && <section className="ai-card-dock" aria-label="待确认参数" hidden={showHome}>
      {actionTargets.length > 0 && <div className="ai-card-targets"><span>目标 · {new Set(actionTargets.map((target) => `${target.kind}:${target.id}`)).size}</span><button className="icon-button" aria-label="定位草案目标" title="定位草案涉及对象" onClick={() => onLocateTargets(actionTargets)}><Crosshair size={14} /></button></div>}
      {conflicts.length > 0 && <div className="frame-draft-notice" role="alert"><strong>任务动作已暂停</strong><ul>{[...new Set(conflicts)].map((conflict) => <li key={conflict}>{conflict}</li>)}</ul>{Object.values(coordination).some(Boolean) && <button disabled={busy || analysisBusy || proposalDirty || conditionsDirty || sectionDirty} onClick={() => adoptCoordination(true)}>以当前工程重新核对草案</button>}</div>}
      {taskDraft && <TaskDraftCard snapshot={captureAiSnapshot(taskDraftSource, [])} draft={taskDraft} busy={busy || analysisBusy} current={taskDraftCurrent && !conflicts.length} onConfirm={confirmTaskDraft} onReject={rejectTaskDraft} onRevise={(prompt) => { if (taskDraftCurrent) void submit(prompt, false, undefined, undefined, true); }} />}
      {proposal && <>
        {!proposalCurrent && <p className="frame-draft-notice">正式模型已变化，原预览已失效。更新参数或重新生成后核对当前模型。</p>}
        <FrameProposalCard key={`${proposal.id}:${proposal.version}`} snapshot={snapshot} proposal={proposal} busy={busy || analysisBusy} current={proposalCurrent && !sectionChange && !conflicts.length}
          visible={open && !showHome}
          baseRevision={confirmation!.context.modelRevision} onConfirm={confirmProposal} onChange={changeProposal} onDirty={setProposalDirty} onReject={() => { rejectProposal(); setCalculationRequested(false); continuationRef.current = null; }} />
      </>}
      {conditions && <>
        {!conditionsCurrent && <p className="frame-draft-notice">正式模型已变化，分析条件预览已失效。更新并重新核对后确认。</p>}
        <AnalysisConditionsCard key={`${conditions.id}:${conditions.version}`} project={project} proposal={conditions} busy={busy || analysisBusy} current={conditionsCurrent && !proposal && !sectionChange && !conflicts.length}
          visible={open && !showHome} calculate={calculationRequested}
          previous={previousConditionsRef.current}
          baseRevision={conditionsConfirmation!.context.modelRevision} onDirty={setConditionsDirty} onChange={changeConditions} onConfirm={confirmConditions} onReject={rejectConditions} />
      </>}
      {sectionChange && <SectionChangeCard key={`${sectionChange.id}:${sectionChange.version}`} snapshot={captureAiSnapshot(sectionSource, sectionSelection)} proposal={sectionChange}
        visible={open && !showHome} calculate={calculationRequested}
        previous={previousSectionRef.current}
        current={sectionCurrent && !proposal && !conditions && !conflicts.length} busy={busy || analysisBusy} onChange={changeSection} onDirty={setSectionDirty} onConfirm={confirmSection} onReject={rejectSection}
        onRegenerate={() => {
          try {
            const exists = project.sections.some((item) => item.id === sectionChange.section.id);
            const sectionId = exists ? sectionChange.section.id : sectionChange.section.provenance.catalogId;
            const { name, areaM2, secondMomentYM4, secondMomentZM4, torsionalConstantM4 } = sectionChange.section;
            changeSection(proposeSectionChange(captureAiSnapshot(project, sectionSelection), { ...(sectionId ? { sectionId } : { section: { name, areaM2, secondMomentYM4, secondMomentZM4, torsionalConstantM4 } }), source: sectionChange.source }, sectionChange));
          } catch (error) { setSectionError(error instanceof Error ? error.message : "请重新选择柱"); }
        }} />}
      {modelEdits && <section className="frame-proposal-card proposal-summary-card" aria-label="基础编辑草案">
        <div className="frame-proposal-heading"><strong>节点与杆件基础编辑</strong><span>{modelEditsCurrent ? "待确认" : "已失效"}</span></div>
        <dl className="proposal-summary">
          <div><dt>操作</dt><dd>{modelEdits.operations.length} 项</dd></div>
          <div><dt>对象变化</dt><dd>{modelEdits.preview.changes.length} 项</dd></div>
          <div><dt>新身份</dt><dd>{modelEdits.preview.created.length ? modelEdits.preview.created.map((item) => item.id).join("、") : "无"}</dd></div>
          {modelEdits.preview.affectedMemberIds.length > 0 && <div><dt>关联杆件</dt><dd>{modelEdits.preview.affectedMemberIds.join("、")}</dd></div>}
        </dl>
        <p className="frame-draft-notice">草案仅来自当前项目修订 R{modelEdits.baseRevision}；确认后形成一个可撤销的整体历史项。节点删除会级联其支座、节点荷载、关联杆件及均布荷载。</p>
        <details className="proposal-details"><summary>查看逐项变化</summary><p>坐标 {units.unit("m")} · 截面转角 {units.unit("°")} · 点质量 {units.unit("kg")} · 线质量 {units.unit("kg/m")}</p><ol>{modelEdits.preview.changes.map((change) => <li key={`${change.kind}:${change.id}`}><span>{change.kind} · {change.id}</span><code>{editPreviewText(change.before ?? null)} -&gt; {editPreviewText(change.after ?? null)}</code></li>)}</ol></details>
        {(modelEdits.preview.changes.some((c) => c.kind === "section") || modelEdits.operations.some((o) => o.type === "assign_section")) && <SectionEditImpact project={modelEditsSource} receipt={modelEdits.preview} />}
        {modelEdits.preview.topology && <TopologyImpact receipts={modelEdits.preview.topology} />}
        {modelEdits.preview.nodeMerges?.map((impact, index) => <NodeMergeImpact key={index} impact={impact} />)}
        {!modelEditsCurrent && <p className="frame-draft-notice">正式模型已变化，请重新生成草案。</p>}
        <div className="proposal-card-actions"><button type="button" onClick={() => rejectModelEdits()}>取消编辑</button><button type="button" className="proposal-confirm" disabled={busy || analysisBusy || conflicts.length > 0 || !modelEditsCurrent || Boolean(proposal) || Boolean(conditions) || Boolean(sectionChange)} onClick={confirmModelEdits}>确认编辑</button></div>
      </section>}
      {sectionError && <p role="alert">{sectionError}</p>}
    </section>}
    <AiComposer key={conversationId} draft={draft} onDraft={setDraft} busy={busy} paused={paused} analysisBusy={analysisBusy} explorationMode={explorationMode} onExplorationMode={setExplorationMode}
      blocked={proposalDirty || conditionsDirty || sectionDirty || Boolean(modelEdits) || Boolean(taskDraft)} onSend={(prompt, requestText) => { void submit(prompt, false, undefined, requestText); }}
      onPause={() => { if (taskRef.current?.pause()) setPaused(true); }} onResume={() => { taskRef.current?.resume(); setPaused(false); }}
      onCancelAnalysis={onCancelAnalysis} onSettings={onSettings} />
  </aside>;
}
