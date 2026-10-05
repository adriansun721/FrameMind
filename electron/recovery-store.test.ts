// @vitest-environment node
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { RecoveryStore } from "./recovery-store";
import { createProject, addNode } from "../src/domain/project";
import { decodeProject, encodeProject } from "../src/domain/project-file";
import { ModelEditConfirmation, prepareModelEditConfirmation, proposeModelEdits } from "../src/workspace/model-edits";
import { ProjectHistory } from "../src/domain/project-history";
import { persistTaskState, type ConversationHistory } from "../src/workspace/task-persistence";
import { RecoveryAutosave } from "../src/workspace/recovery-autosave";

const directories: string[] = [];
async function directory() { const path = await mkdtemp(join(tmpdir(), "framemind-t210-")); directories.push(path); return path; }
afterEach(async () => {
  vi.restoreAllMocks();
  for (const path of directories.splice(0)) {
    if (!resolve(path).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid test cleanup path");
    await rm(path, { recursive: true, force: true });
  }
});

it("orders generations across restarted stores even when the clock has not advanced", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1_791_158_400_000);
  const path = await directory(); const base = createProject();
  await new RecoveryStore(path).save({ content: encodeProject(base), formalSave: null });
  await new RecoveryStore(path).save({ content: encodeProject(addNode(base, { x: 1, y: 0, z: 0 })), formalSave: null });
  const restarted = new RecoveryStore(path); const listing = await restarted.list();
  expect(decodeProject(await restarted.read(listing.entries[0].id)).nodes).toHaveLength(1);
});

it("detects corruption in recovery provenance as well as model content", async () => {
  const path = await directory(); const store = new RecoveryStore(path);
  await store.save({ content: encodeProject(createProject()), formalSave: null });
  const entry = (await store.list()).entries[0]; const file = join(path, entry.id);
  const damaged = JSON.parse(await readFile(file, "utf8")); damaged.createdAt = "2026-01-01T00:00:00.000Z";
  await writeFile(file, JSON.stringify(damaged));
  const listing = await new RecoveryStore(path).list();
  expect(listing.entries).toHaveLength(0); expect(listing.issues).toHaveLength(1);
});

it("recognizes formally saved content even when supported JSON object keys are reordered", async () => {
  const path = await directory(); const formalPath = join(path, "等价工程.framemind");
  const project = addNode(createProject(), { x: 1, y: 2, z: 3 });
  const reordered = JSON.parse(encodeProject(project)); reordered.nodes[0].position = { z: 3, y: 2, x: 1 };
  await writeFile(formalPath, JSON.stringify(reordered));
  const store = new RecoveryStore(join(path, "recovery"));
  await store.save({ content: encodeProject(decodeProject(JSON.stringify(reordered))), formalSave: { path: formalPath, savedAt: "2026-10-05T00:00:00.000Z" } });
  expect((await store.list()).entries[0].matchesFormalSave).toBe(true);
});

it("retries a failed outgoing project's snapshot after another project's snapshot succeeds", async () => {
  const path = await directory(); const previous = addNode(createProject("旧工程"), { x: 1, y: 0, z: 0 });
  const current = addNode(createProject("新工程"), { x: 2, y: 0, z: 0 }); let diskFull = true;
  const store = new RecoveryStore(path, { write: async (target, content) => {
    if (diskFull && JSON.parse(content).projectId === previous.id) throw new Error("ENOSPC");
    await writeFile(target, content);
  } });
  const notices: boolean[] = []; const autosave = new RecoveryAutosave((request) => store.save(request), (failed) => notices.push(failed));
  autosave.capture(previous.id, { content: encodeProject(previous), formalSave: null });
  autosave.capture(current.id, { content: encodeProject(current), formalSave: null });
  let listing = await store.list(); expect(listing.entries.map((item) => item.projectId)).toEqual([current.id]);
  expect(notices.at(-1)).toBe(true);
  diskFull = false; autosave.retryFailed(); listing = await store.list();
  const recovered = decodeProject(await store.read(listing.entries.find((item) => item.projectId === previous.id)!.id));
  expect(recovered.nodes[0].position.x).toBe(1); expect(notices.at(-1)).toBe(false);
});

it("recovers unsaved Chinese-path projects with model, task intent and receipt in the same generation", async () => {
  const path = join(await directory(), "未保存工程");
  const base = createProject("空间框架");
  const confirmation = prepareModelEditConfirmation(base, proposeModelEdits(base, { operations: [{ type: "create_node", position: { x: -1.5, y: 2, z: 0 } }] }));
  const applied = new ModelEditConfirmation().confirm(base, confirmation).project;
  await new RecoveryStore(path).save({ content: encodeProject(applied), formalSave: null });
  const restarted = new RecoveryStore(path);
  const { entries } = await restarted.list();
  expect(entries[0]).toMatchObject({ projectId: base.id, projectName: "空间框架", source: "automatic-snapshot", formalSave: null });
  const recovered = decodeProject(await restarted.read(entries[0].id));
  expect(recovered.nodes).toHaveLength(1);
  expect(recovered.confirmedOperations).toHaveLength(1);
  expect(new ModelEditConfirmation().confirm(recovered, confirmation).project.nodes).toHaveLength(1);
  const history = new ProjectHistory(); history.record(base, applied);
  await restarted.save({ content: encodeProject(history.undo(applied)!), formalSave: null });
  const undone = decodeProject(await restarted.read((await restarted.list()).entries[0].id));
  expect(new ModelEditConfirmation().confirm(undone, confirmation).project.nodes).toHaveLength(0);
});

for (const stage of ["before-write", "mid-write", "before-rename", "after-rename"] as const) it(`falls back to a complete model + ledger when interrupted ${stage}`, async () => {
  const path = await directory(); const base = createProject();
  await new RecoveryStore(path).save({ content: encodeProject(base), formalSave: null });
  const confirmation = prepareModelEditConfirmation(base, proposeModelEdits(base, { operations: [{ type: "create_node", position: { x: 1, y: 0, z: 0 } }] }));
  const next = new ModelEditConfirmation().confirm(base, confirmation).project;
  const interrupted = new RecoveryStore(path, {
    write: async (target, content) => {
      if (stage === "before-write") throw new Error("exit");
      await writeFile(target, stage === "mid-write" ? content.slice(0, content.length / 2) : content);
      if (stage === "mid-write") throw new Error("exit");
    },
    rename: async (from, to) => {
      if (stage === "before-rename") throw new Error("exit");
      await rename(from, to);
      if (stage === "after-rename") throw new Error("exit");
    },
  });
  await expect(interrupted.save({ content: encodeProject(next), formalSave: null })).rejects.toThrow("exit");
  const restarted = new RecoveryStore(path); const entries = (await restarted.list()).entries;
  const restored = decodeProject(await restarted.read(entries[0].id));
  expect(restored.nodes).toHaveLength(stage === "after-rename" ? 1 : 0);
  expect(restored.confirmedOperations ?? []).toHaveLength(stage === "after-rename" ? 1 : 0);
  expect(new ModelEditConfirmation().confirm(restored, confirmation).project.nodes).toHaveLength(1);
});

it("retains three generations, skips a corrupted latest file and ignores abandoned partial writes", async () => {
  const path = await directory(); const store = new RecoveryStore(path); let project = createProject();
  for (let index = 0; index < 5; index++) {
    project = addNode(project, { x: index, y: 0, z: 0 });
    await store.save({ content: encodeProject(project), formalSave: null });
  }
  const entries = (await store.list()).entries; expect(entries).toHaveLength(3);
  await writeFile(join(path, entries[0].id), "{broken");
  await writeFile(join(path, `${entries[0].id}.tmp`), "{partial");
  const listing = await new RecoveryStore(path).list();
  expect(listing.issues).toHaveLength(1); expect(listing.entries).toHaveLength(2);
  expect(decodeProject(await store.read(listing.entries[0].id)).nodes).toHaveLength(4);
  await expect(store.read("../credentials")).rejects.toThrow("身份");
});

it("preserves formal files and the last generation on disk failure and retries successfully", async () => {
  const path = await directory(); const formalPath = join(path, "正式工程.framemind");
  const project = addNode(createProject(), { x: 1, y: 2, z: 3 });
  const content = encodeProject(project); await writeFile(formalPath, content);
  const request = { content, formalSave: { path: formalPath, savedAt: "2026-10-05T00:00:00.000Z" } };
  const store = new RecoveryStore(join(path, "recovery")); await store.save(request);
  expect((await store.list()).entries[0].matchesFormalSave).toBe(true);
  const next = { ...request, content: encodeProject(addNode(project, { x: 4, y: 5, z: 6 })) };
  const failing = new RecoveryStore(join(path, "recovery"), { write: async () => { throw new Error("ENOSPC"); } });
  await expect(failing.save(next)).rejects.toThrow("ENOSPC");
  expect((await store.list()).entries).toHaveLength(1);
  expect(await readFile(formalPath, "utf8")).toBe(content);
  await store.save(next); expect((await store.list()).entries[0].matchesFormalSave).toBe(false);
});

it("keeps pending drafts, paused and failed status while excluding credentials", async () => {
  const path = await directory(); const project = createProject();
  const conversation: ConversationHistory = { id: "draft", updatedAt: 1, turns: [], requestPrompt: "apiKey=sk-test-secret", calculationRequested: false, sectionSelection: [],
    proposalSource: project, conditionsSource: project, sectionSource: project, modelEditsSource: project, taskDraftSource: project,
    modelEdits: proposeModelEdits(project, { operations: [{ type: "create_node", position: { x: 0, y: 0, z: 0 } }] }) };
  const scheduled = ["paused", "failed"].map((status, index) => ({ id: `task-${index}`, projectId: project.id, kind: "agent" as const, goal: "创建节点", status: status as "paused" | "failed", queuedAt: 1, supplementCount: 0, operationCount: 1 }));
  const content = JSON.stringify({ ...project, apiKey: "sk-test-secret", taskState: persistTaskState(project.id, [conversation], scheduled) });
  const store = new RecoveryStore(path); await store.save({ content, formalSave: null });
  const saved = await store.read((await store.list()).entries[0].id);
  expect(saved).not.toContain("sk-test-secret");
  const recovered = decodeProject(saved); expect(recovered.nodes).toHaveLength(0);
  expect(recovered.taskState?.conversations[0].modelEdits).toBeDefined();
  expect(recovered.taskState?.scheduled.map((task) => task.status)).toEqual(["paused", "failed"]);
  expect((await readdir(path)).filter((name) => name.endsWith(".json"))).toHaveLength(1);
});
