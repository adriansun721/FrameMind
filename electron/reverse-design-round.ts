import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { candidateInput, canonicalJson, CANDIDATE_INPUT_FIELDS, parseCandidateProject } from "./candidate-model";
import { ProjectFileStore } from "./project-files";
import { ProjectCandidates } from "./project-candidates";
import { ProjectHistoryStore } from "./project-history-store";
import { ReverseDesignService } from "./reverse-design";
import { redactPersistence } from "./persistence-redaction";
import { generateReverseDesignCandidate, REVERSE_DESIGN_RULES, reverseDesignCatalog } from "./reverse-design-model";
import { MAIN_TOOLS, MAIN_PROMPT, INSPECT_TOOLS, WORK_TOOLS, WORK_STRATEGIES, STRATEGY_PROMPTS, WORK_PROMPT, INSPECT_PROMPT, REVERSE_AGENT_PROMPT, REVERSE_AGENT_SCHEMA, type ReverseDesignRound, type RoundWork, type RoundInspection } from "./reverse-design-round-contract";
import type { CandidateSnapshot, DeepSeekChatMessage, DeepSeekChatResult } from "./contracts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const now = () => new Date().toISOString();
export interface ReverseAgentTransport {
  mode: "online" | "replay";
  model(): Promise<string>;
  chat(requestId: string, messages: DeepSeekChatMessage[], tools: unknown[], expectedModel?: string, onDispatch?: () => void): Promise<DeepSeekChatResult>;
  cancel(requestId: string): Promise<void>;
}
export interface ReverseNativeTransport {
  runQueued(owner: number, request: unknown, signal: AbortSignal, onStart?: () => void, onFinish?: () => void): Promise<unknown[]>;
}
interface NativeDomain {
  createRequest(content: string): { requestId: string; input: unknown; analysisId: string };
  inspectResult(content: string, request: unknown, messages: unknown[]): { massKg: number; checks: Array<{ name: string; value: number; threshold: number; passed: boolean }> };
}
interface ActiveRound { controller: AbortController; guard(): void; round: ReverseDesignRound; taskIds: string[]; pending: Set<Promise<unknown>>; }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function exactKeys(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).length !== keys.length || keys.some((k) => !Object.hasOwn(value, k))) throw new Error("工具参数不符合白名单 schema");
}
function agentBudget(parent: AbortSignal, seconds: number) {
  const controller = new AbortController(), abort = () => controller.abort();
  if (parent.aborted) abort(); else parent.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, seconds * 1000);
  return { signal: controller.signal, close: () => { clearTimeout(timer); controller.abort(); parent.removeEventListener("abort", abort); } };
}
async function bounded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("agent 超时或取消"));
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([operation, cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}
function sanitized(value: unknown): unknown {
  return JSON.parse(JSON.stringify(redactPersistence(value), (key, item) => {
    if (key === "arguments" && typeof item === "string") {
      try { return redactPersistence(JSON.parse(item)); } catch { return "[INVALID_ARGUMENTS]"; }
    }
    return typeof item === "string" ? item.replace(/\b[A-Za-z]:[\\/][^\s"<>]+/g, "[LOCAL_PATH]").replace(/\/(?:Users|home|tmp|var)\/[^\s"<>]+/g, "[LOCAL_PATH]") : item;
  }));
}

/** Main owns parent identity, budgets, tool dispatch and evidence. AI never owns project paths or merge. */
export class ReverseDesignRounds {
  private readonly active = new Map<number, ActiveRound>();
  private readonly files = new ProjectFileStore();
  constructor(private readonly history: ProjectHistoryStore, private readonly candidates: ProjectCandidates,
    private readonly service: ReverseDesignService, private readonly native: ReverseNativeTransport,
    private readonly agents: ReverseAgentTransport, private readonly buildHash: () => Promise<string>,
    private readonly domain: () => NativeDomain = () => require("./reverse-native-domain.cjs")) {}

  contextChanged(owner: number): void {
    const active = this.active.get(owner);
    if (active) try { active.guard(); } catch { active.round.status = "stale"; active.controller.abort(); }
  }
  cancel(owner: number): void {
    const active = this.active.get(owner);
    if (active) { if (active.round.status !== "stale") active.round.status = "cancelled"; active.controller.abort(); }
  }
  async run(owner: number, confirmationId: string): Promise<ReverseDesignRound> {
    if (typeof confirmationId !== "string" || this.active.has(owner)) throw new Error("反向设计轮次身份无效或已有任务在运行");
    const parent = this.service.confirmedParent(owner, confirmationId), controller = new AbortController();
    const round: ReverseDesignRound = {
      schemaVersion: 1, runId: `round_${randomUUID()}`, round: 1, mode: this.agents.mode, status: "running", parentCommit: "", parentInputSha256: hash(candidateInput(parent.content)),
      model: "pending", buildSha256: "", promptVersion: REVERSE_AGENT_PROMPT, promptSha256: hash(canonicalJson({ REVERSE_AGENT_PROMPT, MAIN_PROMPT, STRATEGY_PROMPTS, WORK_PROMPT, INSPECT_PROMPT })), schemaVersionId: REVERSE_AGENT_SCHEMA,
      toolsSha256: hash(canonicalJson([MAIN_TOOLS, WORK_TOOLS, INSPECT_TOOLS])), sampling: { temperature: 0, thinking: "disabled", maxTokens: 2048 },
      startedAt: now(), apiCalls: 0, apiAttempts: 0, main: { agentId: `main_${randomUUID()}`, apiCalls: 0, apiAttempts: 0, status: "pending", startedAt: now() }, works: [], timeline: [], tools: [], artifacts: {}, decision: "awaiting-P25-11",
    };
    const active: ActiveRound = { controller, guard: parent.guard, round, taskIds: [], pending: new Set() };
    this.active.set(owner, active);
    const started = performance.now();
    const mainBudget = agentBudget(controller.signal, REVERSE_DESIGN_RULES.maxDurationSeconds);
    let directory: string | undefined;
    const check = () => { parent.guard(); if (controller.signal.aborted) throw new Error("轮次已取消"); };
    const event = (agentId: string, name: string) => { round.timeline.push({ agentId, event: name, at: now() }); };
    const save = async (name: string, value: unknown) => {
      if (!directory) throw new Error("轮次证据目录未建立");
      const bytes = JSON.stringify(value); await this.files.save(join(directory, name), bytes); round.artifacts[name] = hash(bytes);
    };
    try {
      round.model = await this.agents.model(); round.buildSha256 = await this.buildHash(); check();
      directory = await this.history.access(String(parseCandidateProject(parent.content).id), parent.content, async (repository) => join(repository, "rounds", round.runId)); check();
      await mkdir(directory, { recursive: true }); check();
      let readParent = false, dispatched = false;
      const mainMessages: DeepSeekChatMessage[] = [{ role: "system", content: `${REVERSE_AGENT_PROMPT}. ${MAIN_PROMPT}` },
        { role: "user", content: JSON.stringify({ runId: round.runId, parentInputSha256: round.parentInputSha256, rules: REVERSE_DESIGN_RULES }) }];
      await bounded(save("main-context.json", mainMessages), mainBudget.signal);
      event(round.main.agentId, "main-start");
      await this.loop(active, round.main, mainMessages, MAIN_TOOLS, mainBudget.signal, async (name, args) => {
        exactKeys(args, []); check();
        if (name === "read_parent") { readParent = true; return { data: { input: JSON.parse(candidateInput(parent.content)), catalog: reverseDesignCatalog(), rules: REVERSE_DESIGN_RULES } }; }
        if (name === "finish_main" && dispatched) return { done: true, data: { status: "completed", decision: round.decision } };
        if (name !== "dispatch_round" || !readParent || dispatched) throw new Error("main 必须读取父状态且只能派发一次");
        dispatched = true;
        const snapshots: CandidateSnapshot[] = [];
        for (const strategy of WORK_STRATEGIES) {
          check();
          const snapshot = await this.candidates.fork(owner, undefined, "reverse-design-v1", snapshots[0]);
          snapshots.push(snapshot); active.taskIds.push(snapshot.candidate.taskId);
          round.works.push({ strategy, agentId: `work_${randomUUID()}`, taskId: snapshot.candidate.taskId, candidateId: snapshot.candidate.candidateId, branch: snapshot.candidate.branch,
            outputId: `candidates/${snapshot.candidate.taskId}`, apiCalls: 0, apiAttempts: 0, status: "pending", feasibility: "blocked", unresolved: [] });
        }
        round.parentCommit = snapshots[0].candidate.parentCommit;
        if (snapshots.some((s) => s.candidate.parentCommit !== round.parentCommit || s.candidate.parentInputSha256 !== round.parentInputSha256)) throw new Error("同轮父身份不一致");
        await save("parent.json", JSON.parse(candidateInput(parent.content))); check();
        await Promise.all(round.works.map((work, i) => this.work(owner, active, work, snapshots[i], check, event, save)));
        check();
        round.inspection = await this.inspect(owner, active, check, event, save);
        check();
        return { data: { works: round.works, inspection: round.inspection, decision: round.decision } };
      }, event, save);
      round.main.status = "completed";
      round.status = round.works.length === 3 && round.works.every((w) => w.status === "completed") && round.inspection?.status === "completed" ? "completed" : "failed";
      round.diagnostic = round.status === "completed" ? "编排完成；候选比较与受控合并尚未开放。" : "work 或 inspect 未完成；禁止合并。";
    } catch {
      round.main.status = "failed";
      if (round.status === "running") round.status = controller.signal.aborted ? "cancelled" : "failed";
      round.diagnostic = round.status === "stale" ? "父状态已变化；旧输出仅保留为证据，禁止合并。" : "本轮未完成，禁止合并；请检查连接、求解或重新确认后使用新任务重试。";
    } finally {
      mainBudget.close(); round.main.endedAt = now(); event(round.main.agentId, "main-end");
      controller.abort();
      await Promise.allSettled([...active.pending]);
      if (round.status !== "completed") await Promise.allSettled(active.taskIds.map((id) => this.candidates.cancel(owner, id)));
      round.endedAt = now(); round.elapsedMs = performance.now() - started;
      round.apiCalls = round.main.apiCalls + round.works.reduce((n, w) => n + w.apiCalls, 0) + (round.inspection?.apiCalls ?? 0);
      round.apiAttempts = round.main.apiAttempts + round.works.reduce((n, w) => n + w.apiAttempts, 0) + (round.inspection?.apiAttempts ?? 0);
      try { if (directory) await this.files.save(join(directory, "round.json"), JSON.stringify(round)); }
      finally { this.active.delete(owner); }
    }
    return structuredClone(round);
  }

  private async loop(active: ActiveRound, agent: { agentId: string; apiCalls: number; apiAttempts: number }, messages: DeepSeekChatMessage[], tools: unknown[], signal: AbortSignal,
    dispatch: (name: string, args: unknown) => Promise<{ data: unknown; done?: boolean }>, event: (id: string, name: string) => void, save: (name: string, value: unknown) => Promise<void>): Promise<void> {
    let requestId: string | undefined;
    const cancel = () => { if (requestId) void this.agents.cancel(requestId); };
    signal.addEventListener("abort", cancel);
    const transcript: unknown[] = [];
    const persist = () => save(`${agent.agentId}-calls.json`, sanitized(transcript));
    try {
      let toolErrors = 0;
      for (let call = 0; call < 8; call++) {
        active.guard(); if (active.controller.signal.aborted || signal.aborted) throw new Error("agent 已取消");
        requestId = `agent_${randomUUID()}`; agent.apiAttempts++; event(agent.agentId, "api-start");
        const entry: { requestId: string; model: string; request: DeepSeekChatMessage[]; response?: DeepSeekChatResult; receipts: unknown[] } = { requestId, model: active.round.model, request: structuredClone(messages), receipts: [] };
        transcript.push(entry);
        const response = await bounded(this.agents.chat(requestId, structuredClone(messages), tools, active.round.model, () => { agent.apiCalls++; event(agent.agentId, "api-dispatch"); }), signal);
        entry.response = response; await bounded(persist(), signal);
        event(agent.agentId, "api-end");
        event(agent.agentId, `api-status-${response.status}`);
        if (response.status !== "success") throw new Error(`AI 请求未完成：${response.status}`);
        if (!response.assistant?.tool_calls?.length) throw new Error("agent 未返回白名单工具调用");
        messages.push(response.assistant);
        let done = false;
        for (const tool of response.assistant.tool_calls) {
          if (done) throw new Error("结束工具后不允许继续操作");
          let output: unknown;
          try {
            active.guard(); if (signal.aborted) throw new Error("agent 已取消");
            const operation = dispatch(tool.function.name, JSON.parse(tool.function.arguments));
            active.pending.add(operation);
            void operation.then(() => active.pending.delete(operation), () => active.pending.delete(operation));
            const result = await bounded(operation, signal);
            if (signal.aborted) throw new Error("agent 已取消");
            output = result.data; done = !!result.done;
            active.round.tools.push({ agentId: agent.agentId, name: tool.function.name, at: now(), status: "completed", evidenceSha256: hash(JSON.stringify(output)) });
          } catch {
            const knownTool = tools.some((definition) => (definition as { function: { name: string } }).function.name === tool.function.name);
            active.round.tools.push({ agentId: agent.agentId, name: knownTool ? tool.function.name : "unknown-tool", at: now(), status: "rejected" });
            if (signal.aborted || ++toolErrors > REVERSE_DESIGN_RULES.maxToolRetries) throw new Error("工具失败或重试预算耗尽");
            output = { status: "rejected", diagnostic: "工具不在白名单、参数/来源无效或执行失败；请依据工具 schema 重试。每个 work 本轮只生成并求解一个候选；已求解后即使检查失败，也必须使用空参数 {} 调用 finish_work，下一轮才修改。inspect 必须先读取三个证据再提交对应哈希。" };
          }
          messages.push({ role: "tool", tool_call_id: tool.id, content: JSON.stringify(output) });
          entry.receipts.push({ tool_call_id: tool.id, name: tool.function.name, arguments: tool.function.arguments, output });
          await bounded(persist(), signal);
        }
        if (done) return;
      }
      throw new Error("agent API 调用预算耗尽");
    } finally {
      event(agent.agentId, "agent-stopped");
      if (signal.aborted) cancel();
      signal.removeEventListener("abort", cancel);
      await persist();
    }
  }

  private async work(owner: number, active: ActiveRound, work: RoundWork, snapshot: CandidateSnapshot, check: () => void,
    event: (id: string, name: string) => void, save: (name: string, value: unknown) => Promise<void>): Promise<void> {
    work.startedAt = now(); event(work.agentId, "work-start");
    const budget = agentBudget(active.controller.signal, REVERSE_DESIGN_RULES.workTimeoutSeconds);
    const prefix = `work-${work.strategy}`;
    let generated: ReturnType<typeof generateReverseDesignCandidate> | undefined, solved = false;
    const project = JSON.parse(candidateInput(snapshot.parentContent));
    const summary = { parentCommit: active.round.parentCommit, parentInputSha256: active.round.parentInputSha256, input: Object.fromEntries(CANDIDATE_INPUT_FIELDS.map((k) => [k, project[k]])), catalog: reverseDesignCatalog(), rules: REVERSE_DESIGN_RULES };
    const messages: DeepSeekChatMessage[] = [
      { role: "system", content: `${REVERSE_AGENT_PROMPT}. ${STRATEGY_PROMPTS[work.strategy]} ${WORK_PROMPT}` },
      { role: "user", content: JSON.stringify(summary) },
    ];
    try {
      await bounded(save(`${prefix}-context.json`, messages), budget.signal);
      await this.loop(active, work, messages, WORK_TOOLS, budget.signal, async (name, args) => {
        check(); if (budget.signal.aborted) throw new Error("work 已取消");
        if (name === "generate_candidate") {
          exactKeys(args, ["beamCatalogId", "columnCatalogId"]);
          if (solved) throw new Error("求解后不允许修改候选");
          generated = generateReverseDesignCandidate(snapshot.parentContent, args as unknown as { beamCatalogId: string; columnCatalogId: string });
          work.changes = generated.report.changes;
          return { data: { status: "generated", taskId: work.taskId, inputSha256: hash(candidateInput(generated.content)), massKg: generated.report.afterMassKg, changes: work.changes } };
        }
        exactKeys(args, []);
        if (name === "solve_candidate") {
          if (!generated || solved) throw new Error("请先生成新候选");
          const request = this.domain().createRequest(generated.content); event(work.agentId, "solve-queued");
          await save(`${prefix}-request.json`, request);
          const messages = await this.native.runQueued(owner, request, budget.signal, () => event(work.agentId, "solve-start"), () => event(work.agentId, "solve-end"));
          check(); if (budget.signal.aborted) throw new Error("work 已取消");
          await save(`${prefix}-native.json`, messages);
          const observations = this.domain().inspectResult(generated.content, request, messages);
          const evidence = { schemaVersion: REVERSE_AGENT_SCHEMA, runId: active.round.runId, taskId: work.taskId, candidateId: work.candidateId, parentCommit: snapshot.candidate.parentCommit,
            parentInputSha256: snapshot.candidate.parentInputSha256, inputSha256: hash(candidateInput(generated.content)), candidateContentSha256: hash(generated.content), frozenInputSha256: hash(canonicalJson(request.input)), nativeResultSha256: hash(canonicalJson(messages.at(-1))), request, messages, changes: generated.report.changes, massKg: observations.massKg };
          const resultContent = JSON.stringify(evidence);
          work.candidate = await this.candidates.submit(owner, { projectId: snapshot.candidate.projectId, taskId: work.taskId, content: generated.content, inputSha256: evidence.inputSha256,
            resultContent, resultSha256: hash(resultContent), evidenceIndex: ["result.json"] }); check();
          if (work.candidate.state !== "submitted") throw new Error("候选已失效");
          solved = true; work.inputSha256 = evidence.inputSha256; work.resultSha256 = hash(resultContent); work.massKg = observations.massKg;
          work.frozenInputSha256 = evidence.frozenInputSha256; work.nativeResultSha256 = evidence.nativeResultSha256;
          work.checks = observations.checks.map((c) => ({ ...c, evidenceSha256: work.resultSha256! }));
          work.feasibility = work.checks.every((c) => c.passed) ? "feasible" : "infeasible";
          work.unresolved = work.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.value} > ${c.threshold}`);
          return { data: { status: "solved", taskId: work.taskId, inputSha256: work.inputSha256, resultSha256: work.resultSha256, massKg: work.massKg, checks: work.checks } };
        }
        if (name === "finish_work" && solved) return { done: true, data: { taskId: work.taskId, status: "completed" } };
        throw new Error("未知工具或 work 尚未求解");
      }, event, save);
      work.status = "completed";
    } catch (cause) { work.status = budget.signal.aborted || active.controller.signal.aborted ? "cancelled" : "failed"; work.feasibility = "blocked"; work.unresolved.push(cause instanceof Error ? cause.message : "work 未完成生成、真实求解和结构化回执，不能合并。"); }
    finally {
      budget.close();
      work.endedAt = now(); event(work.agentId, "work-end"); await save(`${prefix}-output.json`, work);
    }
  }

  private async inspect(owner: number, active: ActiveRound, check: () => void, event: (id: string, name: string) => void, save: (name: string, value: unknown) => Promise<void>): Promise<RoundInspection> {
    const inspection: RoundInspection = { agentId: `inspect_${randomUUID()}`, status: "failed", apiCalls: 0, apiAttempts: 0, startedAt: now(), endedAt: "", reports: [] };
    active.round.inspection = inspection;
    const budget = agentBudget(active.controller.signal, REVERSE_DESIGN_RULES.inspectTimeoutSeconds);
    const receipts = new Map<string, RoundInspection["reports"][number]>();
    const messages: DeepSeekChatMessage[] = [
      { role: "system", content: `${REVERSE_AGENT_PROMPT}. ${INSPECT_PROMPT}` },
      { role: "user", content: JSON.stringify({ runId: active.round.runId, parentCommit: active.round.parentCommit, parentInputSha256: active.round.parentInputSha256, taskIds: active.taskIds }) },
    ];
    event(inspection.agentId, "inspect-start");
    try {
      await bounded(save("inspect-context.json", messages), budget.signal);
      await this.loop(active, inspection, messages, INSPECT_TOOLS, budget.signal, async (name, args) => {
        check();
        if (name === "read_candidate_evidence") {
          exactKeys(args, ["taskId"]);
          if (typeof args.taskId !== "string" || !active.taskIds.includes(args.taskId)) throw new Error("不属于同轮候选");
          const snapshot = await this.candidates.read(owner, args.taskId); check();
          const task = snapshot.candidate;
          if (task.state !== "submitted" || task.parentCommit !== active.round.parentCommit || task.parentInputSha256 !== active.round.parentInputSha256) throw new Error("候选未提交或父身份变化");
          const bytes = await this.history.access(task.projectId, snapshot.parentContent, async (repository) => readFile(join(repository, "candidates", task.taskId, "result.json"), "utf8")); check();
          if (hash(bytes) !== task.resultSha256) throw new Error("结果证据哈希无效");
          const evidence = JSON.parse(bytes);
          if (evidence.runId !== active.round.runId || evidence.taskId !== task.taskId || evidence.candidateId !== task.candidateId || evidence.parentCommit !== task.parentCommit || evidence.parentInputSha256 !== task.parentInputSha256 || evidence.candidateContentSha256 !== hash(snapshot.candidateContent) || evidence.inputSha256 !== task.inputSha256) throw new Error("求解来源无效");
          const expectedRequest = this.domain().createRequest(snapshot.candidateContent);
          if (canonicalJson(expectedRequest.input) !== canonicalJson(evidence.request.input) || hash(canonicalJson(evidence.request.input)) !== evidence.frozenInputSha256 || hash(canonicalJson(evidence.messages.at(-1))) !== evidence.nativeResultSha256) throw new Error("冻结输入或结果哈希不匹配候选");
          const observed = this.domain().inspectResult(snapshot.candidateContent, evidence.request, evidence.messages);
          if (observed.massKg !== evidence.massKg) throw new Error("质量来源不一致");
          const report: RoundInspection["reports"][number] = { taskId: task.taskId, candidateId: task.candidateId, commit: task.commit, parentCommit: task.parentCommit, inputSha256: task.inputSha256!, resultSha256: task.resultSha256!, checks: observed.checks.map((c) => ({ ...c, evidenceSha256: task.resultSha256! })),
            severity: observed.checks.every((c) => c.passed) ? "info" : "error", recommendations: observed.checks.filter((c) => !c.passed).map((c) => `请依据 ${c.name} 的失败证据重新派发；禁止合并本候选。`) };
          receipts.set(task.taskId, report);
          return { data: { ...report, massKg: observed.massKg, commit: task.commit } };
        }
        if (name === "submit_inspection") {
          exactKeys(args, ["reports"]);
          if (!Array.isArray(args.reports) || args.reports.length !== 3 || receipts.size !== 3) throw new Error("inspect 必须独立读取全部同轮证据");
          const ids = new Set<string>();
          for (const report of args.reports) {
            exactKeys(report, ["taskId", "inputSha256", "resultSha256"]);
            const receipt = receipts.get(String(report.taskId));
            if (!receipt || ids.has(receipt.taskId) || report.inputSha256 !== receipt.inputSha256 || report.resultSha256 !== receipt.resultSha256) throw new Error("inspect 引用无效");
            ids.add(receipt.taskId);
          }
          inspection.reports = [...receipts.values()];
          return { done: true, data: { status: "completed", reports: inspection.reports, decision: "awaiting-P25-11" } };
        }
        throw new Error("inspect 只允许读取证据和提交报告");
      }, event, save);
      inspection.status = "completed";
    } catch { inspection.status = active.controller.signal.aborted ? "cancelled" : "failed"; inspection.diagnostic = "独立只读 inspect 未完成；候选禁止合并。"; }
    finally { budget.close(); inspection.endedAt = now(); event(inspection.agentId, "inspect-end"); await save("inspect-output.json", inspection); }
    return inspection;
  }
}
