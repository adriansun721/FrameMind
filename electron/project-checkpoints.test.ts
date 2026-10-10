// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectCheckpoints } from "./project-checkpoints";
import { createHash } from "node:crypto";
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const projectId = "project_98ec9b5d-5a3b-4024-b8d3-1581ea2658d5";
const content = (revision: number) => JSON.stringify({ format: "framemind-project", id: projectId, revision });

it("compensates a publication when cancellation arrives during Git update-ref", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-checkpoints-")); directories.push(root);
  const store = new ProjectCheckpoints(root);
  const [initial] = await store.record({ projectId, snapshots: [{ kind: "initial", content: content(0) }] });
  let rolledBack = false;
  await expect(store.record({ projectId, snapshots: [{ kind: "merge-before", content: content(0) }, { kind: "merge-after", content: content(1) }] }, {
    beforePublish: async () => undefined, validatePublished: () => { throw new Error("cancelled during publication"); },
    rollback: async () => { rolledBack = true; }, committed: async () => { throw new Error("must not report committed"); },
  })).rejects.toThrow(/cancelled/);
  expect(await store.head(projectId)).toBe(initial.commit); expect(rolledBack).toBe(true);
}, 30_000);

it("compensates a candidate branch publication when its parent guard changes during Git", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-checkpoints-")); directories.push(root);
  const store = new ProjectCheckpoints(root), branch = "candidate/task_00000000-0000-0000-0000-000000000001";
  const [initial] = await store.record({ projectId, snapshots: [{ kind: "initial", content: content(0) }] });
  const [fork] = await store.record({ projectId, snapshots: [{ kind: "candidate", content: content(0) }] }, undefined, { name: branch, parentCommit: initial.commit, guard: () => undefined });
  let checks = 0;
  await expect(store.record({ projectId, snapshots: [{ kind: "candidate", content: content(1) }] }, undefined, {
    name: branch, parentCommit: initial.commit, guard: () => { if (++checks === 2) throw new Error("cancelled during candidate publication"); },
  })).rejects.toThrow(/cancelled/);
  expect((await readFile(join(root, projectId, "refs", "heads", branch), "utf8")).trim()).toBe(fork.commit);
  expect(await store.head(projectId)).toBe(initial.commit);
}, 30_000);

it("rejects persisted evidence with a different hash before publishing either checkpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-checkpoints-")); directories.push(root);
  const store = new ProjectCheckpoints(root);
  const initial = await store.record({ projectId, snapshots: [{ kind: "step-before", content: content(0) }] });
  await expect(store.record({ projectId, snapshots: [{ kind: "step-before", content: content(1) }, { kind: "step-confirmed", content: content(2), evidence: { content: "{}", sha256: "0".repeat(64) } }] })).rejects.toThrow(/回读/);
  expect((await store.list(projectId)).map((r) => r.commit)).toEqual([initial[0].commit]);
}, 30_000);

it("stores a before/after pair atomically in an isolated local Git repository and reads the exact snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-checkpoints-")); directories.push(root);
  const store = new ProjectCheckpoints(root);
  const evidence = JSON.stringify({ entities: [1, 2], verification: { response: "original AI findings" } });
  const sha256 = createHash("sha256").update(evidence).digest("hex");
  const pair = await store.record({ projectId, snapshots: [{ kind: "step-before", content: content(1) }, { kind: "step-confirmed", content: content(2), taskId: "import-1", inputSha256: "a".repeat(64), evidence: { content: evidence, sha256 } }] });
  expect(pair).toHaveLength(2);
  expect(await store.read(projectId, pair[0].commit)).toBe(content(1));
  expect(await store.read(projectId, pair[1].commit)).toBe(content(2));
  expect(await store.readEvidence(projectId, pair[1].commit)).toBe(evidence);
  expect(pair[1].evidenceSha256).toBe(sha256);
  expect((await store.list(projectId)).map((c) => c.kind)).toEqual(["step-confirmed", "step-before"]);
  expect((await store.list(projectId))[0].contentSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(await readFile(join(root, projectId, "config"), "utf8")).not.toContain("remote");
}, 30_000);

it("rejects a mismatched second snapshot without publishing the first, and missing Git cannot report success", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-checkpoints-")); directories.push(root);
  const store = new ProjectCheckpoints(root);
  await store.record({ projectId, snapshots: [{ kind: "step-before", content: content(1) }] });
  await expect(store.record({ projectId, snapshots: [{ kind: "step-before", content: content(2) }, { kind: "step-confirmed", content: JSON.stringify({ format: "framemind-project", id: "other", revision: 3 }) }] })).rejects.toThrow(/身份/);
  expect(await store.list(projectId)).toHaveLength(1);
  await expect(new ProjectCheckpoints(join(root, "missing"), "framemind-missing-git.exe").record({ projectId, snapshots: [{ kind: "step-before", content: content(1) }] })).rejects.toThrow(/Git 不可用/);
}, 30_000);

it("a Git reference lock prevents the entire pair from becoming visible and a new retry succeeds", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-checkpoints-")); directories.push(root);
  const store = new ProjectCheckpoints(root);
  const original = await store.record({ projectId, snapshots: [{ kind: "step-before", content: content(1) }] });
  const lock = join(root, projectId, "refs", "heads", "main.lock"); await writeFile(lock, "fault injection");
  await expect(store.record({ projectId, snapshots: [{ kind: "step-before", content: content(1) }, { kind: "step-confirmed", content: content(2) }] })).rejects.toThrow(/checkpoint 失败/);
  expect((await store.list(projectId)).map((r) => r.commit)).toEqual([original[0].commit]);
  await rm(lock);
  const retried = await store.record({ projectId, snapshots: [{ kind: "step-before", content: content(1) }, { kind: "step-confirmed", content: content(2) }] });
  expect(await store.read(projectId, retried[1].commit)).toBe(content(2));
}, 30_000);
