// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { ProjectCandidates, type CandidateInspector } from "./project-candidates";
import { ProjectHistoryStore } from "./project-history-store";
import { candidateInput, candidateDifferences } from "./candidate-model";
import { createProject, addNode, updateNode } from "../src/domain/project";
import { encodeProject, decodeProject } from "../src/domain/project-file";
import type { CandidateSnapshot, CandidateInspection } from "./contracts";
const directories: string[] = [];
const hash = (content: string) => createHash("sha256").update(content).digest("hex");
afterEach(async () => { for (const directory of directories.splice(0)) { if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid fixture directory"); await rm(directory, { recursive: true, force: true }); } });
// The injected checker tests the P25-08 protocol, not P25-11 numerical feasibility.
function protocolReport(snapshot: CandidateSnapshot): CandidateInspection {
  const c = snapshot.candidate;
  return { candidateId: c.candidateId, commit: c.commit, inputSha256: c.inputSha256!, resultSha256: c.resultSha256!, checks: Object.entries({ source: 1, resources: 1, stiffness: 1, "horizontal-displacement": 15, "force-balance": 1e-7, "moment-balance": 1e-7, mass: 1 }).map(([name, threshold]) => ({ name, threshold, value: ["horizontal-displacement", "force-balance", "moment-balance"].includes(name) ? 0 : 1, passed: true, evidenceSha256: c.resultSha256! })) };
}
const checker: CandidateInspector = { inspect: async (snapshot) => protocolReport(snapshot), validate: (content) => { decodeProject(content); } };
async function fixture(inspector?: CandidateInspector) {
  const directory = await mkdtemp(join(tmpdir(), "framemind-p2508-")); directories.push(directory);
  const root = join(directory, "temporary"), path = join(directory, "项目.framemind"), history = new ProjectHistoryStore(root);
  const parent = decodeProject((await history.save(path, encodeProject(addNode(createProject(), { x: 0, y: 0, z: 0 })))).content);
  const candidates = new ProjectCandidates(history, inspector);
  candidates.sync(1, { content: encodeProject(parent), sessionId: "session-1" });
  return { directory, path, root, history, parent, candidates };
}
async function submit(candidates: ProjectCandidates, snapshot: CandidateSnapshot) {
  const p = decodeProject(snapshot.parentContent), proposal = updateNode(p, p.nodes[0].id, { x: 2, y: 0, z: 0 });
  const content = encodeProject(proposal), resultContent = JSON.stringify({ fixture: "P25-08 protocol only" });
  return candidates.submit(1, { projectId: p.id, taskId: snapshot.candidate.taskId, content, inputSha256: hash(candidateInput(content)), resultContent, resultSha256: hash(resultContent), evidenceIndex: ["result.json"] });
}

it("keeps real candidate commits off main, checks parent/candidate/current fields and denies unchecked merge", async () => {
  const { candidates, history, parent, path } = await fixture();
  const snapshot = await candidates.fork(1), main = await history.checkpoints.head(parent.id);
  const task = await submit(candidates, snapshot);
  expect(await readFile(`${path}.git/refs/heads/${task.branch}`, "utf8")).toContain(task.commit);
  expect(await history.checkpoints.head(parent.id)).toBe(main);
  await expect(history.read(parent.id, task.commit)).rejects.toThrow();
  await expect(candidates.merge(1, task.taskId, task.commit)).rejects.toThrow(/inspect/);
  const evidence = await candidates.read(1, task.taskId);
  const current = updateNode(parent, parent.nodes[0].id, { x: 3, y: 0, z: 0 });
  expect(candidateDifferences(evidence.parentContent, evidence.candidateContent, encodeProject(current))).toContainEqual({ collection: "nodes", id: parent.nodes[0].id, field: "position.x", parent: 0, candidate: 2, current: 3, conflict: true });
  candidates.sync(1, { content: encodeProject(current), sessionId: "session-1" });
  expect((await candidates.list(1))[0].state).toBe("stale");
  await expect(candidates.merge(1, task.taskId, task.commit)).rejects.toThrow(/stale/);
  expect((await candidates.read(1, task.taskId)).candidateContent).toBe(evidence.candidateContent);
}, 30_000);

it("rejects arbitrary tools, paths, force flags, wrong hashes and forged project/history changes", async () => {
  const { candidates, parent } = await fixture();
  expect(() => candidates.tool(1, JSON.parse('{"tool":"powershell","command":"git push"}'))).toThrow(/拒绝/);
  expect(() => candidates.tool(1, JSON.parse('{"tool":"fork","path":"D:/FrameMind"}'))).toThrow(/拒绝/);
  const snapshot = await candidates.fork(1), proposal = updateNode(parent, parent.nodes[0].id, { x: 2, y: 0, z: 0 }), content = encodeProject(proposal), resultContent = "{}";
  const request = { projectId: parent.id, taskId: snapshot.candidate.taskId, content, inputSha256: hash(candidateInput(content)), resultContent, resultSha256: hash(resultContent), evidenceIndex: ["result.json"] };
  await expect(candidates.submit(1, { ...request, inputSha256: "a".repeat(64) })).rejects.toThrow(/哈希/);
  await expect(candidates.submit(1, { ...request, evidenceIndex: ["../secret"] })).rejects.toThrow(/相对/);
  await expect(candidates.submit(1, { ...request, content: JSON.stringify({ ...proposal, projectHistory: { id: "history_00000000-0000-0000-0000-000000000000" } }) })).rejects.toThrow(/身份/);
  await expect(candidates.submit(1, JSON.parse(JSON.stringify({ ...request, force: true })))).rejects.toThrow(/未知/);
  const submitted = await candidates.submit(1, request), blocked = await candidates.inspect(1, submitted.taskId);
  expect(blocked.state).toBe("blocked"); expect(blocked.diagnostic).toContain("P25-11");
  const retry = await candidates.fork(1, blocked.taskId); expect(retry.candidate.taskId).not.toBe(blocked.taskId); expect(retry.candidate.retryOf).toBe(blocked.taskId);
  await expect(candidates.submit(1, request)).rejects.toThrow(/已提交/);
}, 30_000);

it.each(["cancel", "edit", "switch", "restore"] as const)("invalidates %s during a pending inspect and retains late output only as evidence", async (reason) => {
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>((r) => { started = r; }), pending = new Promise<void>((r) => { release = r; });
  const { candidates, parent } = await fixture({ ...checker, inspect: async (snapshot) => { started(); await pending; return protocolReport(snapshot); } });
  const task = await submit(candidates, await candidates.fork(1));
  const inspection = candidates.inspect(1, task.taskId); await entered;
  let cancellation: Promise<unknown> | undefined;
  if (reason === "cancel") cancellation = candidates.cancel(1, task.taskId);
  else candidates.sync(1, { content: encodeProject(reason === "edit" ? updateNode(parent, parent.nodes[0].id, { x: 5, y: 0, z: 0 }) : parent), sessionId: reason === "switch" ? "session-2" : "session-1", reason });
  release(); const report = await inspection; await cancellation;
  expect(report.state).toBe(reason === "cancel" ? "cancelled" : "stale");
  await expect(candidates.merge(1, task.taskId, task.commit)).rejects.toThrow(/cancelled|stale/);
  const retry = await candidates.fork(1, task.taskId); expect(retry.candidate.retryOf).toBe(task.taskId); expect(retry.candidate.taskId).not.toBe(task.taskId);
}, 30_000);

it("merges exactly one locally checked version with before/after checkpoints and restores by task or commit", async () => {
  const { candidates, history, parent, path } = await fixture(checker);
  const task = await submit(candidates, await candidates.fork(1));
  expect((await candidates.inspect(1, task.taskId)).state).toBe("passed");
  await expect(candidates.merge(1, task.taskId, task.parentCommit)).rejects.toThrow(/版本/);
  const main = await history.checkpoints.head(parent.id);
  await writeFile(`${path}.git/refs/heads/main.lock`, "controlled fault");
  await expect(candidates.merge(1, task.taskId, task.commit)).rejects.toThrow(/checkpoint/);
  expect(await history.checkpoints.head(parent.id)).toBe(main); expect(decodeProject(await readFile(path, "utf8")).nodes[0].position.x).toBe(0);
  await rm(`${path}.git/refs/heads/main.lock`);
  const merged = decodeProject(await candidates.merge(1, task.taskId, task.commit)); expect(merged.nodes[0].position.x).toBe(2);
  expect((await history.list(parent.id)).slice(0, 2).map((r) => r.kind)).toEqual(["merge-after", "merge-before"]);
  await expect(candidates.merge(1, task.taskId, task.commit)).rejects.toThrow(/merged/);
  candidates.sync(1, { content: encodeProject(merged), sessionId: "session-1" });
  const restored = decodeProject(await candidates.restore(1, { taskId: task.taskId })); expect(restored.nodes[0].position.x).toBe(0); expect(restored.revision).toBeGreaterThan(merged.revision);
  expect(restored.projectHistory?.id).toBe(parent.projectHistory?.id);
  candidates.sync(1, { content: encodeProject(restored), sessionId: "session-2", reason: "restore" });
  expect(decodeProject(await candidates.restore(1, { snapshot: task.parentCommit })).nodes[0].position.x).toBe(0);
}, 30_000);

it.each(["wrong-source", "nonfinite", "over-limit", "missing-check"])("blocks %s inspection instead of accepting a passed string", async (failure) => {
  const { candidates } = await fixture({ ...checker, inspect: async (snapshot) => {
    const report = protocolReport(snapshot);
    if (failure === "wrong-source") report.commit = "0".repeat(40);
    if (failure === "nonfinite") report.checks[3].value = NaN;
    if (failure === "over-limit") report.checks[3].value = 16;
    if (failure === "missing-check") report.checks.pop();
    return report;
  } });
  const task = await submit(candidates, await candidates.fork(1)); expect((await candidates.inspect(1, task.taskId)).state).toBe("blocked");
  await expect(candidates.merge(1, task.taskId, task.commit)).rejects.toThrow(/inspect/);
}, 30_000);

it("cannot resurrect saved candidates in a new process or a copied history", async () => {
  const { candidates, history, parent, path, root, directory } = await fixture(checker);
  const task = await submit(candidates, await candidates.fork(1)); await candidates.inspect(1, task.taskId);
  const reopened = new ProjectHistoryStore(root); await reopened.open(path);
  const restarted = new ProjectCandidates(reopened, checker); restarted.sync(2, { content: encodeProject(parent), sessionId: "new-process" });
  expect((await restarted.list(2))[0].state).toBe("stale"); await expect(restarted.merge(2, task.taskId, task.commit)).rejects.toThrow(/stale/);
  const copy = await history.save(join(directory, "copy.framemind"), encodeProject(parent));
  candidates.sync(1, { content: copy.content, sessionId: "copy-session", reason: "switch" });
  expect((await candidates.list(1))[0].state).toBe("stale");
}, 30_000);

it("preserves cancelled late submissions as evidence without changing the candidate branch or main", async () => {
  const { candidates, parent, history, path } = await fixture(checker), snapshot = await candidates.fork(1);
  const branchBefore = await readFile(`${path}.git/refs/heads/${snapshot.candidate.branch}`, "utf8"), mainBefore = await history.checkpoints.head(parent.id);
  await candidates.cancel(1, snapshot.candidate.taskId);
  const late = await submit(candidates, snapshot);
  expect(late.state).toBe("cancelled"); expect(late.evidenceIndex?.[0]).toMatch(/^late-/);
  const evidence = JSON.parse(await readFile(join(`${path}.git`, "candidates", late.taskId, late.evidenceIndex![0]), "utf8"));
  expect(decodeProject(evidence.content).nodes[0].position.x).toBe(2);
  expect(await readFile(`${path}.git/refs/heads/${snapshot.candidate.branch}`, "utf8")).toBe(branchBefore);
  expect(await history.checkpoints.head(parent.id)).toBe(mainBefore);
}, 30_000);

it("rechecks the actual Git parent under the write lock instead of trusting the renderer's old state", async () => {
  const { candidates, history, parent } = await fixture(checker), task = await submit(candidates, await candidates.fork(1));
  await candidates.inspect(1, task.taskId);
  await history.record({ projectId: parent.id, snapshots: [{ kind: "confirmation-after", content: encodeProject(updateNode(parent, parent.nodes[0].id, { x: 9, y: 0, z: 0 })) }] });
  const before = await history.checkpoints.head(parent.id);
  await expect(candidates.merge(1, task.taskId, task.commit)).rejects.toThrow(/父快照/);
  expect(await history.checkpoints.head(parent.id)).toBe(before); expect((await candidates.list(1))[0].state).toBe("stale");
}, 30_000);
