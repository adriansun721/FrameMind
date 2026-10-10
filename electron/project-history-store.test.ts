// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectHistoryStore } from "./project-history-store";
import { ProjectFileStore } from "./project-files";
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const id = "project_98ec9b5d-5a3b-4024-b8d3-1581ea2658d5";
const content = (revision: number) => JSON.stringify({ format: "framemind-project", id, revision, nodes: [{ id: "node_1", position: { x: revision, y: 0, z: 0 } }] });
async function fixture(files?: ProjectFileStore) {
  const directory = await mkdtemp(join(tmpdir(), "p2507-")); directories.push(directory);
  const root = join(directory, "temporary"), path = join(directory, "中文项目.framemind");
  return { directory, root, path, store: new ProjectHistoryStore(root, files) };
}

it("moves temporary confirmation history into the sidecar and reopens the saved state in a fresh session", async () => {
  const { root, path, store } = await fixture();
  const pair = await store.record({ projectId: id, snapshots: [{ kind: "confirmation-before", content: content(0), taskId: "task-1" }, { kind: "confirmation-after", content: content(1), taskId: "task-1", candidateId: "candidate-1", inputSha256: "a".repeat(64), resultSha256: "b".repeat(64), evidenceIndex: ["runs/run-1/report.json"] }] });
  const saved = await store.save(path, content(1));
  expect(await readFile(path, "utf8")).toBe(saved.content);
  expect(JSON.parse(await readFile(`${path}.git/saved.json`, "utf8")).contentSha256).toMatch(/^[a-f0-9]{64}$/);
  const reopened = new ProjectHistoryStore(root);
  expect((await reopened.open(path)).historyWarning).toBeUndefined();
  expect((await reopened.list(id)).map((r) => r.kind)).toEqual(["copied-from", "confirmation-after", "confirmation-before"]);
  expect(await reopened.read(id, pair[0].commit)).toBe(content(0));
  expect((await reopened.list(id))[1]).toMatchObject({ taskId: "task-1", candidateId: "candidate-1", resultSha256: "b".repeat(64), evidenceIndex: ["runs/run-1/report.json"] });
  expect(await readFile(`${path}.git/config`, "utf8")).not.toContain("remote");
}, 30_000);

it("Save As copies history by default with a distinct lineage, or starts an explicit new history", async () => {
  const { directory, path, root, store } = await fixture();
  const first = await store.save(path, content(0));
  const originalHistory = JSON.parse(first.content).projectHistory.id;
  const originalCommits = (await store.list(id)).map((r) => r.commit);
  const copyPath = join(directory, "copy.framemind");
  const copy = await store.save(copyPath, first.content);
  expect(JSON.parse(copy.content).projectHistory.id).not.toBe(originalHistory);
  expect((await store.list(id))[0].copiedFrom).toEqual({ historyId: originalHistory, commit: originalCommits[0] });
  expect((await store.list(id))[1].commit).toBe(originalCommits[0]);
  const newPath = join(directory, "new.framemind");
  await store.save(newPath, copy.content, "new");
  expect((await store.list(id)).map((r) => r.kind)).toEqual(["initial"]);
  const original = new ProjectHistoryStore(root); await original.open(path);
  expect((await original.list(id)).map((r) => r.commit)).toEqual(originalCommits);
}, 30_000);

it("opens a moved file without borrowing cached history and refuses an unrelated sidecar", async () => {
  const { directory, root, path, store } = await fixture();
  const saved = await store.save(path, content(0));
  const moved = join(directory, "moved.framemind"); await writeFile(moved, saved.content);
  const reopened = new ProjectHistoryStore(root);
  expect((await reopened.open(moved)).historyWarning).toContain("目录缺失");
  expect(await reopened.list(id)).toEqual([]);
  await mkdir(`${moved}.git`);
  await writeFile(`${moved}.git/history.json`, JSON.stringify({ schemaVersion: 1, projectId: id, historyId: "history_00000000-0000-0000-0000-000000000000" }));
  expect((await reopened.open(moved)).historyWarning).toContain("不一致");
  await expect(reopened.list(id)).rejects.toThrow(/不一致/);
  await expect(reopened.save(moved, saved.content)).rejects.toThrow(/不一致/);
  expect(await readFile(moved, "utf8")).toBe(saved.content);
  await reopened.save(join(directory, "recovered.framemind"), saved.content, "new");
  expect(await reopened.list(id)).toHaveLength(1);
}, 30_000);

for (const fault of ["project-file", "saved-index", "git-reference"] as const) it(`keeps file, main reference and saved index unchanged after ${fault} failure; retry succeeds`, async () => {
  let blocked = false;
  const files = new ProjectFileStore({ rename: async (from, to) => {
    if (blocked && from.endsWith(".tmp") && ((fault === "project-file" && to.endsWith(".framemind")) || (fault === "saved-index" && to.endsWith("saved.json")))) { blocked = false; throw new Error("injected write failure"); }
    await rename(from, to);
  } });
  const { path, store } = await fixture(files);
  const saved = await store.save(path, content(0));
  const commits = (await store.list(id)).map((r) => r.commit), index = await readFile(`${path}.git/saved.json`, "utf8");
  blocked = true;
  if (fault === "git-reference") await writeFile(`${path}.git/refs/heads/main.lock`, "injected reference lock");
  await expect(store.save(path, JSON.stringify({ ...JSON.parse(saved.content), revision: 1 }))).rejects.toThrow(/失败/);
  expect(await readFile(path, "utf8")).toBe(saved.content);
  expect(await readFile(`${path}.git/saved.json`, "utf8")).toBe(index);
  expect((await store.list(id)).map((r) => r.commit)).toEqual(commits);
  if (fault === "git-reference") await rm(`${path}.git/refs/heads/main.lock`);
  await store.save(path, JSON.stringify({ ...JSON.parse(saved.content), revision: 1 }));
  expect((await store.list(id))[0].revision).toBe(1);
}, 30_000);

it("recovers an interrupted file/index replacement according to the published reference", async () => {
  const { root, path, store } = await fixture();
  const old = await store.save(path, content(0)), original = (await store.list(id))[0].commit;
  const oldIndex = await readFile(`${path}.git/saved.json`, "utf8");
  const nextContent = JSON.stringify({ ...JSON.parse(old.content), revision: 1 });
  const unpublished = await store.record({ projectId: id, snapshots: [{ kind: "save", content: nextContent }] });
  const newIndex = JSON.stringify({ ...JSON.parse(oldIndex), commit: unpublished[0].commit, contentSha256: unpublished[0].contentSha256 });
  const journal = { schemaVersion: 1, projectId: id, before: old.content, after: nextContent, original, commit: unpublished[0].commit, beforeIndex: oldIndex, afterIndex: newIndex };
  await writeFile(`${path}.git/save-transaction.json`, JSON.stringify(journal));
  // A process may die after the original file is moved aside and before replacement.
  await rename(path, `${path}.interrupted-backup`);
  const reopened = new ProjectHistoryStore(root);
  expect((await reopened.open(path)).historyWarning).toBeUndefined();
  expect(await readFile(path, "utf8")).toBe(nextContent);
  expect(await readFile(`${path}.git/saved.json`, "utf8")).toBe(newIndex);
  // If publication never happened, the journal must restore the previous bytes instead.
  await writeFile(`${path}.git/save-transaction.json`, JSON.stringify({ ...journal, original: journal.commit, commit: "f".repeat(40) }));
  expect((await reopened.open(path)).historyWarning).toBeUndefined();
  expect(await readFile(path, "utf8")).toBe(old.content);
}, 30_000);

it("refuses an unknown nonempty sidecar and a live writer without changing the model or history", async () => {
  const { directory, path, store } = await fixture();
  await mkdir(`${path}.git`); await writeFile(`${path}.git/unrelated.txt`, "another application owns this");
  await expect(store.save(path, content(0))).rejects.toThrow(/失败/);
  expect(await readFile(`${path}.git/unrelated.txt`, "utf8")).toBe("another application owns this");
  const safePath = join(directory, "safe.framemind"), saved = await store.save(safePath, content(0));
  const before = (await store.list(id)).map((r) => r.commit);
  await writeFile(`${safePath}.git/framemind.lock`, JSON.stringify({ pid: process.pid }));
  await expect(store.save(safePath, saved.content)).rejects.toThrow(/写锁/);
  expect(await readFile(safePath, "utf8")).toBe(saved.content);
  expect((await store.list(id)).map((r) => r.commit)).toEqual(before);
  await rm(`${safePath}.git/framemind.lock`);
}, 30_000);
