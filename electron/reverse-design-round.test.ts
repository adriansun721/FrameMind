// @vitest-environment node
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
import type { DeepSeekChatResult } from "./contracts";

const directories: string[] = [], hosts: NativeAnalysisHost[] = [];
vi.setConfig({ testTimeout: 60_000 });
afterEach(async () => {
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
    if (prompt.includes("read-only inspect")) {
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
  const history = new ProjectHistoryStore(join(directory, "history")), candidates = new ProjectCandidates(history), service = new ReverseDesignService(history, candidates);
  const initial = encodeProject(createProject());
  service.sync(1, { content: initial, sessionId: "test-session" }); candidates.sync(1, { content: initial, sessionId: "test-session" });
  const draft = service.prepare(1), parent = await service.confirm(1, draft.confirmationId);
  const native = new NativeAnalysisHost(resolve("native/bin/framemind-core.exe")); hosts.push(native);
  const rounds = new ReverseDesignRounds(history, candidates, service, native, transport, async () => "a".repeat(64), () => ({ createRequest, inspectResult: (content, request, messages) => inspectResult(content, request as ReturnType<typeof createRequest>, messages) }));
  return { rounds, candidates, history, service, parent, draft, directory };
}

it("runs three isolated agents concurrently from one Git parent with serial real native solves and independent read-only inspect", async () => {
  const { rounds, candidates, history, parent, draft } = await fixture();
  const round = await rounds.run(1, draft.confirmationId);
  expect(round.status).toBe("completed"); expect(round.mode).toBe("replay"); expect(round.apiCalls).toBe(11);
  expect(new Set(round.works.map((w) => w.taskId)).size).toBe(3);
  expect(new Set(round.works.map((w) => w.branch)).size).toBe(3);
  expect(round.works.every((w) => w.candidate?.parentCommit === round.parentCommit && w.candidate.state === "submitted")).toBe(true);
  expect(round.works[1].massKg).toBeCloseTo(1337.012, 6); // independent rho A L reference from ADR-0080
  const firstEnd = round.timeline.findIndex((e) => e.event === "api-end");
  expect(round.timeline.slice(0, firstEnd).filter((e) => e.event === "api-start")).toHaveLength(3);
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

it("rejects inspect prose and forged pass reports without reading independent evidence", async () => {
  const transport = replay(), chat = transport.chat;
  transport.chat = async (requestId, messages, tools) => messages[0].content!.includes("read-only inspect")
    ? assistant(["submit_inspection", { reports: [{ taskId: "forged", inputSha256: "x", resultSha256: "x" }, {}, {}] }]) : chat(requestId, messages, tools);
  const { rounds, draft, candidates } = await fixture(transport);
  const round = await rounds.run(1, draft.confirmationId);
  expect(round.status).toBe("failed"); expect(round.inspection?.status).toBe("failed");
  expect(round.inspection?.apiCalls).toBe(3); expect(round.inspection?.reports).toEqual([]);
  expect((await candidates.list(1)).every((c) => c.state === "cancelled")).toBe(true);
});

it.each(["cancel", "edit", "restore", "switch"] as const)("invalidates %s during online requests and preserves only evidence", async (reason) => {
  let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
  const requests = new Map<string, (value: DeepSeekChatResult) => void>();
  const transport: ReverseAgentTransport = { mode: "online", model: async () => "deepseek-flash", chat: (id) => new Promise((resolve) => { requests.set(id, resolve); if (requests.size === 3) entered(); }), cancel: async (id) => { requests.get(id)?.({ status: "cancelled", message: "cancelled" }); } };
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
  const transport = replay(); transport.chat = async () => assistant(["exec", { command: "git push" }]);
  const { rounds, draft, candidates } = await fixture(transport);
  const round = await rounds.run(1, draft.confirmationId);
  expect(round.status).toBe("failed"); expect(round.works.every((w) => w.apiCalls === 3 && w.status === "failed")).toBe(true);
  expect((await candidates.list(1)).every((c) => !c.resultSha256 && c.state === "cancelled")).toBe(true);
});
