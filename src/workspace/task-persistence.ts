import { validateSection, type FrameProject } from "../domain/project";
import type { AnalysisInputSnapshot } from "../domain/analysis";
import { sameInputValue } from "../domain/analysis";
import { captureAiSnapshot, type AiContext, type AiObjectRef, type AiToolResult } from "./ai-tools";
import type { AiProgress, AiTaskResult } from "./ai-task";
import type { ExplorationBudgetSnapshot } from "./exploration-budget";
import { proposeFrame, type FrameProposal } from "./frame-proposal";
import { proposeConditions, type ConditionsProposal } from "./analysis-conditions";
import type { SectionChangeProposal } from "./section-stage";
import { proposeModelEdits, type ModelEditProposal } from "./model-edits";
import { taskEditSources, taskEngineeringPreview, type TaskDraft } from "./task-draft";
import { parseProjectEditOperations } from "./model-edits";
import type { StageResolution } from "../components/AiTaskTimeline";
import type { ScheduledTaskDescriptor } from "./task-scheduler";
import { redactPersistence } from "../../electron/persistence-redaction";
import { engineeringContent, sameEngineeringState, targetConflicts } from "./draft-coordination";

export interface ConversationTurn {
  id: string;
  localOnly?: boolean;
  origin: "chat" | "confirmation" | "analysis";
  prompt: string;
  requestText?: string;
  context: AiContext;
  sourceProject: FrameProject;
  progress?: AiProgress;
  progressEvents?: AiProgress[];
  exploration?: ExplorationBudgetSnapshot;
  workflowId?: string;
  stageResolutions?: Record<string, StageResolution>;
  result?: AiTaskResult;
  output?: Pick<AiTaskResult, "assistant" | "records">;
  continuing?: boolean;
  proposal?: FrameProposal;
  conditions?: ConditionsProposal;
  sectionChange?: SectionChangeProposal;
  modelEdits?: ModelEditProposal;
  taskDraft?: TaskDraft;
  scheduledTaskId?: string;
}
export interface ConversationHistory {
  id: string;
  localOnly?: boolean;
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
  modelEdits?: ModelEditProposal;
  modelEditsSource: FrameProject;
  taskDraft?: TaskDraft;
  taskDraftSource: FrameProject;
  targets?: readonly AiObjectRef[];
  analysisSourceId?: string;
}
export interface PersistedTaskState {
  version: 1;
  projectId: string;
  conversations: ConversationHistory[];
  scheduled: ScheduledTaskDescriptor[];
  analyses: { taskId: string; input: AnalysisInputSnapshot }[];
}
export interface ConfirmedOperation { key: string; result: AiToolResult; engineeringState: string; }

function engineeringState(project: FrameProject): string {
  return JSON.stringify(engineeringContent(project));
}

export function projectInput(project: FrameProject): FrameProject {
  const { taskState: _state, confirmedOperations: _receipts, ...input } = project;
  return input;
}

export function sameProjectInput(left: FrameProject, right: FrameProject): boolean {
  return sameInputValue(projectInput(left), projectInput(right));
}

function taskEvidence(turn: ConversationTurn): AiTaskResult | undefined {
  const result = turn.result ?? (turn.output ? { status: "cancelled" as const, workKind: "agent" as const, message: "应用重启已中断本次操作，已完成的工具证据保留", context: turn.context, records: turn.output.records } : undefined);
  if (!result) return undefined;
  return { ...result, assistant: undefined, draftBaseProject: result.draftBaseProject ? projectInput(result.draftBaseProject) : undefined,
    records: result.records.filter((record) => record.result.status === "applied" || record.result.diagnosticTrial || record.result.diagnosticComparison || record.result.diagnosticCopy || record.result.taskDraft || record.result.proposal || record.result.conditions || record.result.modelEdits || record.result.sectionChange || ["run_analysis", "inspect_diagnostics", "read_diagnostic", "discard_diagnostic_copy"].includes(record.call.function.name)) };
}

/** The project carries engineering goals and tool evidence; prose stays local. */
export function persistTaskState(projectId: string, conversations: ConversationHistory[], scheduled: ScheduledTaskDescriptor[], analyses: PersistedTaskState["analyses"] = []): PersistedTaskState {
  const compact = conversations.filter((conversation) => !conversation.localOnly).map((conversation) => ({ ...conversation,
    proposalSource: projectInput(conversation.proposalSource), conditionsSource: projectInput(conversation.conditionsSource),
    sectionSource: projectInput(conversation.sectionSource), modelEditsSource: projectInput(conversation.modelEditsSource), taskDraftSource: projectInput(conversation.taskDraftSource),
    turns: conversation.turns.filter((turn) => !turn.localOnly).map((turn) => {
      const { requestText: _text, output: _output, progress: _progress, progressEvents: _events, ...saved } = turn;
      const result = taskEvidence(turn);
      return { ...saved, sourceProject: projectInput(turn.sourceProject),
        ...(result ? { result } : {}) };
    }),
  }));
  return redactPersistence({ version: 1, projectId, conversations: compact, scheduled, analyses });
}

export function recoveredTurns(conversation: ConversationHistory): ConversationTurn[] {
  return conversation.turns.map((turn) => turn.result ? turn : { ...turn,
    result: { status: "cancelled", workKind: "agent", message: "应用重启已中断本次操作，等待用户选择继续", context: turn.context, records: turn.output?.records ?? [], assistant: turn.output?.assistant } });
}

function localTurn(project: FrameProject, turn: ConversationTurn): ConversationTurn {
  return { ...turn, localOnly: true, sourceProject: project, proposal: undefined, conditions: undefined, sectionChange: undefined, modelEdits: undefined, taskDraft: undefined, scheduledTaskId: undefined, output: undefined,
    result: { status: "completed", workKind: "conversation", context: turn.context, records: [], message: "本机聊天记录（仅供查看）", assistant: turn.result?.assistant ?? turn.output?.assistant } };
}

/** Only prose can be joined from local history; the saved project owns executable state. */
export function mergeLocalChat(project: FrameProject, saved: ConversationHistory[], local: ConversationHistory[]): ConversationHistory[] {
  return saved.map((item) => {
    const history = local.find((entry) => entry.id === item.id);
    return history ? { ...item, turns: item.turns.map((turn) => {
      const full = history.turns.find((entry) => entry.id === turn.id);
      const assistant = full?.result?.assistant ?? full?.output?.assistant;
      return { ...turn, ...(full?.requestText ? { requestText: full.requestText } : {}),
        ...(assistant !== undefined ? turn.result ? { result: { ...turn.result, assistant } } : { output: { assistant, records: [] } } : {}) };
    }).concat(history.turns.filter((turn) => !item.turns.some((saved) => saved.id === turn.id)).map((turn) => localTurn(project, turn))) } : item;
  }).concat(local.filter((history) => !saved.some((item) => item.id === history.id)).map((history) => ({
    ...history, localOnly: true, proposal: undefined, conditions: undefined, sectionChange: undefined, modelEdits: undefined, taskDraft: undefined,
    calculationRequested: false, targets: [], sectionSelection: [], proposalSource: project, conditionsSource: project, sectionSource: project, modelEditsSource: project, taskDraftSource: project,
    turns: history.turns.map((turn) => localTurn(project, turn)),
  })));
}

export function recoveryIssues(project: FrameProject, conversation: ConversationHistory): string[] {
  const bases = [conversation.proposalSource, conversation.conditionsSource, conversation.sectionSource, conversation.modelEditsSource, conversation.taskDraftSource];
  const issues = bases.some((base) => base.id !== project.id) ? ["任务基础与项目身份不一致"] : [];
  issues.push(...targetConflicts(project, conversation.targets ?? []));
  const hasDraft = Boolean(conversation.proposal || conversation.conditions || conversation.sectionChange || conversation.modelEdits || conversation.taskDraft);
  const applied = conversation.turns.flatMap((turn) => turn.result?.records ?? []).filter((record) => record.result.status === "applied");
  const receipts = applied.map((record) => project.confirmedOperations?.find((entry) => sameInputValue(entry.result, record.result)));
  if (receipts.some((receipt) => !receipt)) issues.push("任务成功记录缺少对应回执，需重新核对");
  const latest = receipts.at(-1);
  const lastTaskTurn = [...conversation.turns].reverse().find((turn) => !turn.localOnly);
  if (!hasDraft && latest && !sameInputValue(JSON.parse(latest.engineeringState), JSON.parse(engineeringState(project)))) issues.push("回执对应模型已撤销或修改，恢复前请重新核对");
  if (!hasDraft && !latest && conversation.calculationRequested && !sameEngineeringState(lastTaskTurn?.sourceProject ?? conversation.taskDraftSource, project)) issues.push("已应用任务的模型已变化或已撤销，需核对后重新请求计算");
  if (conversation.analysisSourceId && ![...project.loadCases, ...project.loadCombinations, ...project.analysisCases].some((item) => item.id === conversation.analysisSourceId)) issues.push("原计算来源已删除");
  return issues;
}

export function savedOperation(project: FrameProject, key: string): AiToolResult | undefined {
  return project.confirmedOperations?.find((entry) => entry.key === key)?.result;
}
export function recordOperation(project: FrameProject, key: string, result: AiToolResult): FrameProject {
  return { ...project, confirmedOperations: [...(project.confirmedOperations ?? []).filter((entry) => entry.key !== key), { key, result: redactPersistence(result), engineeringState: engineeringState(project) }] };
}

export function restoredTaskResult(project: FrameProject, conversation: ConversationHistory): AiToolResult {
  return { status: "completed", message: "已核对项目与任务记录，未提交工程修改", context: captureAiSnapshot(project, conversation.targets ?? []).context };
}

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function assert(valid: unknown): asserts valid { if (!valid) throw new Error("项目任务恢复数据无效，原文件未更改"); }
function refs(value: unknown): void {
  assert(Array.isArray(value) && value.every((item) => object(item) && ["node", "member"].includes(String(item.kind)) && typeof item.id === "string"));
}
function context(value: unknown, projectId: string): void {
  assert(object(value) && value.projectId === projectId && typeof value.projectName === "string" && Number.isSafeInteger(value.modelRevision) && Number(value.modelRevision) >= 0);
  refs(value.selection);
}
function toolResult(value: unknown, projectId: string): void {
  assert(object(value) && ["completed", "applied", "missing-input", "awaiting-confirmation", "failed", "cancelled"].includes(String(value.status)) && typeof value.message === "string");
  context(value.context, projectId);
}

function draftContent(kind: string, draft: Record<string, unknown>, base: FrameProject): void {
  if (kind === "proposal" || kind === "frame") {
    assert(object(draft.parameters) && Array.isArray(draft.changes));
    const parameters = Object.fromEntries(Object.entries(draft.parameters).map(([key, value]) => {
      assert(object(value)); return [key, { value: value.value, source: value.source }];
    }));
    proposeFrame({ parameters });
    for (const [key, value] of Object.entries(draft.parameters)) if (object(value) && value.conflict !== undefined) proposeFrame({ parameters: { [key]: { value: value.conflict, source: "user" } } });
  } else if (kind === "conditions") {
    const { id: _id, version: _version, ...fields } = draft;
    proposeConditions(fields);
  } else if (kind === "modelEdits") {
    // Rebuild the public preview from validated operations, never trust saved UI data.
    draft.preview = proposeModelEdits(base, { operations: draft.operations }).preview;
  } else if (kind === "sectionChange") {
    assert(Array.isArray(draft.memberIds) && draft.memberIds.every((id) => typeof id === "string") && object(draft.section) && ["user", "suggestion"].includes(String(draft.source)));
    validateSection("恢复截面", draft.section as unknown as Parameters<typeof validateSection>[1]);
  } else if (kind === "taskDraft") {
    if (draft.edits !== undefined) {
      assert(object(draft.edits) && ["existing", "user", "catalog", "suggestion", "assumption", "unknown"].includes(String(draft.edits.source)));
      draft.edits.operations = parseProjectEditOperations(draft.edits.operations);
      taskEditSources(draft.edits as unknown as NonNullable<TaskDraft["edits"]>);
      taskEngineeringPreview(captureAiSnapshot(base, []), draft as unknown as TaskDraft);
    }
    assert(draft.goal === undefined || typeof draft.goal === "string");
    if (draft.frame !== undefined) { assert(object(draft.frame)); draftContent("frame", draft.frame, base); }
    if (draft.conditions !== undefined) { assert(object(draft.conditions)); draftContent("conditions", draft.conditions, base); }
    if (draft.analysis !== undefined) assert(object(draft.analysis) && typeof draft.analysis.requested === "boolean" && (draft.analysis.sourceId === undefined || typeof draft.analysis.sourceId === "string") && (draft.analysis.source === undefined || ["existing", "user", "catalog", "suggestion", "assumption", "unknown"].includes(String(draft.analysis.source))));
  }
}
export function decodeConfirmedOperations(value: unknown, projectId: string): ConfirmedOperation[] | undefined {
  if (value === undefined) return undefined;
  assert(Array.isArray(value));
  const keys = new Set<string>();
  for (const entry of value) {
    assert(object(entry) && typeof entry.key === "string" && entry.key.startsWith(`${projectId}:`) && !keys.has(entry.key) && typeof entry.engineeringState === "string");
    keys.add(entry.key); toolResult(entry.result, projectId);
    assert(object(entry.result) && entry.result.status === "applied");
    let input: unknown; try { input = JSON.parse(entry.engineeringState as string); } catch { assert(false); }
    assert(Array.isArray(input) && input[0] === projectId);
  }
  return redactPersistence(value) as ConfirmedOperation[];
}

export function decodeTaskState(value: unknown, project: FrameProject, decode: (source: string) => FrameProject,
  decodeInput: (input: Record<string, unknown>, projectId: string, revision: number) => AnalysisInputSnapshot): PersistedTaskState | undefined {
  if (value === undefined) return undefined;
  assert(object(value) && value.version === 1 && value.projectId === project.id && Array.isArray(value.conversations) && Array.isArray(value.scheduled) && Array.isArray(value.analyses));
  const state = redactPersistence(value) as unknown as PersistedTaskState;
  const ids = new Set<string>();
  const base = (input: unknown): FrameProject => {
    assert(object(input) && input.taskState === undefined && input.confirmedOperations === undefined);
    const decoded = decode(JSON.stringify(input)); assert(decoded.id === project.id); return decoded;
  };
  for (const conversation of state.conversations) {
    assert(object(conversation) && typeof conversation.id === "string" && !ids.has(conversation.id) && Array.isArray(conversation.turns) && typeof conversation.calculationRequested === "boolean" && typeof conversation.requestPrompt === "string" && Number.isFinite(conversation.updatedAt));
    ids.add(conversation.id); refs(conversation.sectionSelection); if (conversation.targets !== undefined) refs(conversation.targets);
    for (const key of ["proposalSource", "conditionsSource", "sectionSource", "modelEditsSource", "taskDraftSource"] as const) conversation[key] = base(conversation[key]);
    for (const key of ["proposal", "conditions", "sectionChange", "modelEdits", "taskDraft"] as const) {
      const draft = conversation[key];
      if (draft === undefined) continue;
      assert(object(draft) && typeof draft.id === "string" && Number.isSafeInteger(draft.version) && draft.version > 0);
      if ("projectId" in draft) assert(draft.projectId === project.id && Number.isSafeInteger(draft.baseRevision));
      const sourceKey = { proposal: "proposalSource", conditions: "conditionsSource", sectionChange: "sectionSource", modelEdits: "modelEditsSource", taskDraft: "taskDraftSource" } as const;
      draftContent(key, draft as unknown as Record<string, unknown>, conversation[sourceKey[key]]);
    }
    for (const turn of conversation.turns) {
      assert(object(turn) && typeof turn.id === "string" && typeof turn.prompt === "string" && ["chat", "confirmation", "analysis"].includes(turn.origin));
      context(turn.context, project.id); turn.sourceProject = base(turn.sourceProject);
      if (turn.result) {
        toolResult(turn.result, project.id); assert(Array.isArray(turn.result.records));
        for (const record of turn.result.records) {
          assert(object(record) && object(record.call) && object(record.call.function) && typeof record.call.function.name === "string" && typeof record.call.function.arguments === "string");
          toolResult(record.result, project.id);
          assert(object(record.result));
          for (const key of ["proposal", "conditions", "sectionChange", "modelEdits", "taskDraft"] as const) {
            const content = record.result[key];
            if (content != null) { assert(object(content) && typeof content.id === "string" && Number.isSafeInteger(content.version) && Number(content.version) > 0); draftContent(key, content, turn.sourceProject); }
          }
        }
        if (turn.result.draftBaseProject) turn.result.draftBaseProject = base(turn.result.draftBaseProject);
      }
    }
  }
  ids.clear();
  for (const task of state.scheduled) {
    assert(object(task) && task.projectId === project.id && typeof task.id === "string" && !ids.has(task.id) && typeof task.goal === "string" && ["agent", "analysis", "diagnostic", "conversation"].includes(task.kind) && ["queued", "running", "waiting-input", "waiting-confirmation", "paused", "failed", "cancelled", "completed"].includes(task.status));
    ids.add(task.id);
    assert(Number.isFinite(task.queuedAt) && Number.isSafeInteger(task.supplementCount) && task.supplementCount >= 0 && Number.isSafeInteger(task.operationCount) && task.operationCount > 0 && (task.lastGoal === undefined || typeof task.lastGoal === "string"));
    // Descriptors retain their saved status as evidence; no executable closure is restored.
  }
  for (const analysis of state.analyses) {
    assert(object(analysis) && typeof analysis.taskId === "string" && ids.has(analysis.taskId) && object(analysis.input));
    assert(Number.isSafeInteger(analysis.input.projectRevision) && analysis.input.projectRevision >= 0 && analysis.input.projectRevision <= project.revision && state.scheduled.find((task) => task.id === analysis.taskId)?.kind === "analysis");
    analysis.input = decodeInput(analysis.input as unknown as Record<string, unknown>, project.id, analysis.input.projectRevision);
  }
  return state;
}
