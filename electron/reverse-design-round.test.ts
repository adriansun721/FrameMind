// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createProject } from "../src/domain/project";
import { encodeProject, decodeProject } from "../src/domain/project-file";
import { createRequest, inspectResult } from "../scripts/reverse-native-domain";
import { ProjectHistoryStore } from "./project-history-store";
import { ProjectCandidates } from "./project-candidates";
import { ReverseDesignService } from "./reverse-design";
import { ReverseDesignRounds, type ReverseAgentTransport } from "./reverse-design-round";
import { NativeAnalysisHost } from "./native-analysis";
import { ReverseDesignInspector } from "./reverse-design-inspection";
import type { DeepSeekChatResult } from "./contracts";

const directories: string[] = [], hosts: NativeAnalysisHost[] = [];
vi.setConfig({ testTimeout: 60_000 });
afterEach(async () => {
  vi.useRealTimers();
  for (const host of hosts.splice(0)) host.dispose();
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe test directory");
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
let id = 0;
const assistant = (...calls: Array<[string, unknown]>): DeepSeekChatResult => ({ status: "success", message: "replay", assistant: {
  role: "assistant", content: null, tool_calls: calls.map(([name, args]) => ({ id: `call_${++id}`, type: "function", function: { name, arguments: JSON.stringify(args) } })),
} });
function replay(): ReverseAgentTransport {
  return { mode: "replay", model: async () => "deterministic-test-replay", cancel: async () => undefined, chat: async (_id, messages) => {
    const prompt = messages[0].content!;
    const toolMessages = messages.filter((m) => m.role === "tool");
    if (prompt.includes("You are main")) {
      const dispatch = toolMessages.map((m) => JSON.parse(m.content!)).find((m) => m.comparison);
      const selected = dispatch?.comparison.selected;
      if (selected && !toolMessages.some((m) => JSON.parse(m.content!).confirmationRequired)) return assistant(["propose_merge", { taskId: selected.taskId, expectedCommit: selected.commit, inputSha256: selected.inputSha256, resultSha256: selected.resultSha256 }]);
      return assistant([toolMessages.length === 0 ? "read_parent" : toolMessages.length === 1 ? "dispatch_round" : "finish_main", {}]);
    }
    if (prompt.includes("You are independent read-only inspect")) {
      const taskIds = JSON.parse(messages[1].content!).taskIds as string[];
      if (!toolMessages.length) return assistant(...taskIds.map((taskId): [string, unknown] => ["read_candidate_evidence", { taskId }]));
      const reports = toolMessages.map((m) => JSON.parse(m.content!)).filter((r) => r.taskId).map(({ taskId, inputSha256, resultSha256 }) => ({ taskId, inputSha256, resultSha256 }));
      return assistant(["submit_inspection", { reports }]);
    }
    if (!toolMessages.length) {
      await new Promise((resolve) => setTimeout(resolve, 15));
      const beamCatalogId = prompt.includes("distinct") ? "arcelor-ipe200" : "arcelor-ipe100";
      const columnCatalogId = prompt.includes("aggressive") ? "arcelor-ipe100" : prompt.includes("distinct") ? "arcelor-ipe200" : "arcelor-hea200";
      return assistant(["generate_candidate", { beamCatalogId, columnCatalogId }]);
    }
    return assistant([toolMessages.length === 1 ? "solve_candidate" : "finish_work", {}]);
  } };
}
async function fixture(transport = replay()) {
  const directory = await mkdtemp(join(tmpdir(), "framemind-p2510-test-")); directories.push(directory);
  const domain = () => ({ createRequest, inspectResult: (content: string, request: unknown, messages: unknown[]) => inspectResult(content, request as ReturnType<typeof createRequest>, messages), validateProject: (content: string) => { decodeProject(content); } });
  const history = new ProjectHistoryStore(join(directory, "history")), candidates = new ProjectCandidates(history, new ReverseDesignInspector(domain)), service = new ReverseDesignService(history, candidates);
  const initial = encodeProject(createProject());
  service.sync(1, { content: initial, sessionId: "test-session" }); candidates.sync(1, { content: initial, sessionId: "test-session" });
  const draft = service.prepare(1), parent = await service.confirm(1, draft.confirmationId);
  const native = new NativeAnalysisHost(resolve("native/bin/framemind-core.exe")); hosts.push(native);
  const rounds = new ReverseDesignRounds(history, candidates, service, native, transport, async () => "a".repeat(64), domain);
  return { rounds, candidates, history, service, parent, draft, directory };
}

it("runs three isolated agents concurrently from one Git parent with serial real native solves and independent read-only inspect", async () => {
  const { rounds, candidates, history, parent, draft } = await fixture();
  const round = await rounds.run(1, draft.confirmationId);
  expect(round.status).toBe("completed"); expect(round.mode).toBe("replay"); expect(round.apiAttempts).toBe(14); expect(round.apiCalls).toBe(0);
  expect(new Set(round.works.map((w) => w.taskId)).size).toBe(3);
  expect(new Set(round.works.map((w) => w.branch)).size).toBe(3);
  expect(round.works.every((w) => w.candidate?.parentCommit === round.parentCommit && w.candidate.state === "blocked")).toBe(true);
  expect(round.decision).toBe("no-feasible");
  expect(round.comparison?.eligible).toEqual([]);
  expect(round.mergeRequest).toBeUndefined();
  expect(round.works[1].massKg).toBeCloseTo(1337.012, 6); // independent rho A L reference from ADR-0080
  const workIds = new Set(round.works.map((w) => w.agentId));
  const firstEnd = round.timeline.findIndex((e) => e.event === "api-end" && workIds.has(e.agentId));
  expect(round.timeline.slice(0, firstEnd).filter((e) => e.event === "api-start" && workIds.has(e.agentId))).toHaveLength(3);
  const solves = round.timeline.filter((e) => ["solve-start", "solve-end"].includes(e.event));
  expect(solves.map((s) => s.event)).toEqual(["solve-start", "solve-end", "solve-start", "solve-end", "solve-start", "solve-end"]);
  expect(round.inspection?.reports).toHaveLength(3);
  expect(round.inspection?.reports.every((r) => r.checks.length === 7)).toBe(true);
  expect(round.inspection?.reports[0].checks.find((c) => c.name === "horizontal-displacement")?.passed).toBe(false);
  expect(round.inspection?.reports[1].checks.find((c) => c.name === "force-balance")?.value).toBeLessThan(1e-7);
  expect(await history.read(decodeProject(parent).id, round.parentCommit)).toBe(parent);
  for (const work of round.works) await expect(candidates.merge(1, work.taskId, work.candidate!.commit)).rejects.toThrow(/inspect/);
  const repository = history.checkpoints.location(decodeProject(parent).id), runDirectory = join(repository, "rounds", round.runId);
  for (const [name, digest] of Object.entries(round.artifacts)) expect(createHash("sha256").update(await readFile(join(runDirectory, name))).digest("hex")).toBe(digest);
  const context = await readFile(join(runDirectory, "work-independent-context.json"), "utf8");
  expect(context).not.toContain(round.works[0].taskId); expect(context).not.toContain(round.works[1].candidateId);
  expect(context).not.toContain(repository); expect(context).not.toContain("Bearer");
  expect((await readdir(runDirectory)).includes("round.json")).toBe(true);
});

it("forms a version-bound main request for a truly feasible candidate and only merges after explicit confirmation", async () => {
  const transport = replay(), chat = transport.chat;
  transport.chat = async (id, messages, tools) => {
    if (messages[0].content!.includes("distinct") && !messages.some((m) => m.role === "tool")) return assistant(["generate_candidate", { beamCatalogId: "arcelor-hea200", columnCatalogId: "arcelor-hea200" }]);
    return chat(id, messages, tools);
  };
  const { rounds, draft, candidates, history, parent } = await fixture(transport);
  const round = await rounds.run(1, draft.confirmationId);
  expect(round.status).toBe("completed");
  expect(round.decision).toBe("merge-proposed");
  expect(round.comparison?.eligible).toHaveLength(1);
  const selected = round.comparison!.selected!;
  expect(selected.checks.every((c) => c.passed)).toBe(true);
  expect(round.mergeRequest).toMatchObject({ taskId: selected.taskId, expectedCommit: selected.commit, inputSha256: selected.inputSha256, resultSha256: selected.resultSha256, confirmationRequired: true });
  expect((await candidates.read(1, selected.taskId)).candidate.state).toBe("passed");
  const resultBytes = await readFile(join(history.checkpoints.location(decodeProject(parent).id), "candidates", selected.taskId, "result.json"), "utf8");
  const evidence = JSON.parse(resultBytes), snapshot = await candidates.read(1, selected.taskId);
  const forceFault = structuredClone(evidence.messages); forceFault.at(-1).result.nodes[0].reaction.x += 1;
  expect(inspectResult(snapshot.candidateContent, evidence.request, forceFault).checks.find((c) => c.name === "force-balance")?.passed).toBe(false);
  const momentFault = structuredClone(evidence.messages); momentFault.at(-1).result.nodes[0].reactionMoment.z += 1;
  expect(inspectResult(snapshot.candidateContent, evidence.request, momentFault).checks.find((c) => c.name === "moment-balance")?.passed).toBe(false);
  const loadFault = structuredClone(evidence.messages); loadFault.at(-1).result.process.loadVector[0] += 1;
  expect(() => inspectResult(snapshot.candidateContent, evidence.request, loadFault)).toThrow(/冻结荷载/);
  const duplicate = structuredClone(evidence.messages); duplicate.at(-1).result.nodes[1].nodeId = duplicate.at(-1).result.nodes[0].nodeId;
  expect(() => inspectResult(snapshot.candidateContent, evidence.request, duplicate)).toThrow(/对象引用无效|不完整/);
  expect(await history.read(decodeProject(parent).id, round.parentCommit)).toBe(parent);
  await expect(candidates.merge(1, selected.taskId, "0".repeat(40))).rejects.toThrow(/确认版本/);
  const merged = decodeProject(await candidates.merge(1, selected.taskId, selected.commit));
  expect(merged.sections.map((s) => s.provenance.catalogId)).toEqual(["arcelor-hea200", "arcelor-hea200"]);
  expect((await candidates.list(1)).filter((c) => c.state === "merged")).toHaveLength(1);
});

it("rejects inspect prose and forged pass reports without reading independent evidence", async () => {
  const transport = replay(), chat = transport.chat;
  transport.chat = async (requestId, messages, tools) => messages[0].content!.includes("You are independent read-only inspect")
    ? assistant(["submit_inspection", { reports: [{ taskId: "forged", inputSha256: "x", resultSha256: "x" }, {}, {}] }]) : chat(requestId, messages, tools);
  const { rounds, draft, candidates } = await fixture(transport);
  const round = await rounds.run(1, draft.confirmationId);
  expect(round.status).toBe("failed"); expect(round.inspection?.status).toBe("failed");
  expect(round.inspection?.apiAttempts).toBe(3); expect(round.inspection?.reports).toEqual([]);
  expect((await candidates.list(1)).every((c) => c.state === "cancelled")).toBe(true);
});

it("keeps a damaged candidate blocked while retaining independent reports for the other candidates", async () => {
  const transport = replay(), chat = transport.chat;
  let corrupt!: () => Promise<void>, changed = false;
  transport.chat = async (id, messages, tools) => {
    if (!changed && messages[0].content!.includes("You are independent read-only inspect")) { changed = true; await corrupt(); }
    return chat(id, messages, tools);
  };
  const { rounds, candidates, history, parent, draft } = await fixture(transport);
  corrupt = async () => {
    const [task] = await candidates.list(1);
    const path = join(history.checkpoints.location(decodeProject(parent).id), "candidates", task.taskId, "result.json");
    const evidence = JSON.parse(await readFile(path, "utf8")); evidence.massKg = 1;
    await writeFile(path, JSON.stringify(evidence));
  };
  const round = await rounds.run(1, draft.confirmationId);
  expect(round.inspection?.status).toBe("completed"); expect(round.inspection?.reports).toHaveLength(3);
  expect(round.inspection?.reports.filter((r) => r.feasibility === "blocked")).toHaveLength(1);
  expect(round.inspection?.reports.filter((r) => r.feasibility === "infeasible")).toHaveLength(2);
  expect(round.decision).toBe("no-feasible"); expect(round.mergeRequest).toBeUndefined();
  for (const task of await candidates.list(1)) await expect(candidates.merge(1, task.taskId, task.commit)).rejects.toThrow();
});

it("rejects a main merge proposal for a lighter infeasible candidate despite its valid task identity", async () => {
  const transport = replay(), chat = transport.chat;
  transport.chat = async (id, messages, tools) => {
    const dispatch = messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content!)).find((m) => m.works);
    if (messages[0].content!.includes("You are main") && dispatch) {
      const work = dispatch.works[0];
      return assistant(["propose_merge", { taskId: work.taskId, expectedCommit: work.candidate.commit, inputSha256: work.inputSha256, resultSha256: work.resultSha256 }]);
    }
    return chat(id, messages, tools);
  };
  const { rounds, draft, candidates } = await fixture(transport);
  const round = await rounds.run(1, draft.confirmationId);
  expect(round.status).toBe("failed"); expect(round.decision).toBe("blocked"); expect(round.mergeRequest).toBeUndefined();
  expect(round.tools.filter((t) => t.name === "propose_merge" && t.status === "rejected")).toHaveLength(3);
  expect((await candidates.list(1)).every((c) => c.state === "cancelled")).toBe(true);
});

it("revokes a persisted merge request when main fails after proposing a feasible candidate", async () => {
  const transport = replay(), chat = transport.chat;
  transport.chat = async (id, messages, tools) => {
    const prompt = messages[0].content!;
    if (prompt.includes("distinct") && !messages.some((m) => m.role === "tool")) return assistant(["generate_candidate", { beamCatalogId: "arcelor-hea200", columnCatalogId: "arcelor-hea200" }]);
    if (prompt.includes("You are main") && messages.some((m) => m.role === "tool" && JSON.parse(m.content!).confirmationRequired)) return { status: "error", message: "injected final main failure" };
    return chat(id, messages, tools);
  };
  const { rounds, draft, history, parent } = await fixture(transport);
  const round = await rounds.run(1, draft.confirmationId);
  expect(round.status).toBe("failed"); expect(round.decision).toBe("blocked"); expect(round.mergeRequest).toBeUndefined();
  const path = join(history.checkpoints.location(decodeProject(parent).id), "rounds", round.runId, "main-decision.json");
  const final = JSON.parse(await readFile(path, "utf8"));
  expect(final.decision).toBe("blocked"); expect(final.mergeRequest).toBeUndefined();
  expect(createHash("sha256").update(await readFile(path)).digest("hex")).toBe(round.artifacts["main-decision.json"]);
});

it.each(["cancel", "edit", "restore", "switch"] as const)("invalidates %s during online requests and preserves only evidence", async (reason) => {
  let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
  const requests = new Map<string, (value: DeepSeekChatResult) => void>();
  const mainReplay = replay();
  const transport: ReverseAgentTransport = { mode: "online", model: async () => "deepseek-flash", chat: (id, messages, tools) => messages[0].content!.includes("You are main") ? mainReplay.chat(id, messages, tools) : new Promise((resolve) => { requests.set(id, resolve); if (requests.size === 3) entered(); }), cancel: async (id) => { requests.get(id)?.({ status: "cancelled", message: "cancelled" }); } };
  const { rounds, draft, service, candidates, parent } = await fixture(transport);
  const running = rounds.run(1, draft.confirmationId); await started;
  await expect(rounds.run(1, draft.confirmationId)).rejects.toThrow(/已有任务/);
  if (reason === "cancel") rounds.cancel(1);
  else {
    const p = JSON.parse(parent); if (reason === "edit") p.revision++;
    const request = { content: JSON.stringify(p), sessionId: reason === "switch" ? "new-session" : "test-session", reason };
    service.sync(1, request); candidates.sync(1, request); rounds.contextChanged(1);
  }
  const round = await running;
  expect(round.status).toBe(reason === "cancel" ? "cancelled" : "stale");
  expect(round.works.every((w) => w.status !== "completed")).toBe(true);
  expect((await candidates.list(1)).every((c) => ["stale", "cancelled"].includes(c.state))).toBe(true);
});

it("does not accept work text or arbitrary commands as a generated candidate", async () => {
  const transport = replay(), chat = transport.chat; transport.chat = async (id, messages, tools) => messages[0].content!.includes("You are main") ? chat(id, messages, tools) : assistant(["exec", { command: "git push" }]);
  const { rounds, draft, candidates } = await fixture(transport);
  const round = await rounds.run(1, draft.confirmationId);
  expect(round.status).toBe("failed"); expect(round.works.every((w) => w.apiAttempts === 3 && w.status === "failed")).toBe(true);
  expect((await candidates.list(1)).every((c) => !c.resultSha256 && c.state === "cancelled")).toBe(true);
});

it("invalidates a pending inspect when the formal engineering parent changes", async () => {
  const transport = replay(), chat = transport.chat;
  let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
  let pendingId = "", release!: (value: DeepSeekChatResult) => void;
  transport.chat = async (requestId, messages, tools) => {
    if (messages[0].content!.includes("You are independent read-only inspect")) {
      pendingId = requestId; entered(); return new Promise((resolve) => { release = resolve; });
    }
    return chat(requestId, messages, tools);
  };
  transport.cancel = async (id) => { if (id === pendingId) release({ status: "cancelled", message: "cancelled" }); };
  const { rounds, draft, service, candidates, parent } = await fixture(transport);
  const running = rounds.run(1, draft.confirmationId); await started;
  const p = JSON.parse(parent); p.revision++;
  const request = { content: JSON.stringify(p), sessionId: "test-session", reason: "edit" as const };
  service.sync(1, request); candidates.sync(1, request); rounds.contextChanged(1);
  const round = await running;
  expect(round.status).toBe("stale"); expect(round.inspection?.reports).toEqual([]);
  expect((await candidates.list(1)).every((c) => c.state === "stale")).toBe(true);
});
