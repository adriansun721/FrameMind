import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, sep } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { ProjectHistoryStore } = require("../dist-electron/project-history-store.js");
const runId = randomUUID(), output = resolve("docs/evidence/plan2/P25-07/runs", runId);
const directory = await mkdtemp(join(tmpdir(), "framemind-p2507-evidence-"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceIdentity = async () => ({ head: hash(await readFile(".git/HEAD")), branch: hash(await readFile(".git/refs/heads/main")), index: hash(await readFile(".git/index")) });
const git = (repository, args) => {
  const run = spawnSync("git", [`--git-dir=${repository}`, ...args], { encoding: "utf8", windowsHide: true });
  assert.equal(run.status, 0, run.stderr); return run.stdout.trim();
};
await mkdir(output, { recursive: true });
try {
  const before = await sourceIdentity(), store = new ProjectHistoryStore(join(directory, "temporary"));
  const id = `project_${randomUUID()}`, path = join(directory, "project.framemind");
  const content = (revision) => JSON.stringify({ format: "framemind-project", id, revision, nodes: [{ id: "node_1", position: { x: revision, y: 0, z: 0 } }], analysisResults: [] });
  await store.record({ projectId: id, snapshots: [{ kind: "confirmation-before", content: content(0), taskId: "confirm-1" }, { kind: "confirmation-after", content: content(1), taskId: "confirm-1" }] });
  const saved = await store.save(path, content(1));
  const oldIndex = await readFile(`${path}.git/saved.json`, "utf8"), oldHistory = await store.list(id);
  await writeFile(`${path}.git/refs/heads/main.lock`, "P25-07 controlled fault injection");
  let diagnostic;
  try { await store.save(path, JSON.stringify({ ...JSON.parse(saved.content), revision: 2 })); } catch (error) { diagnostic = error.message; }
  assert.ok(diagnostic);
  assert.equal(await readFile(path, "utf8"), saved.content);
  assert.equal(await readFile(`${path}.git/saved.json`, "utf8"), oldIndex);
  assert.deepEqual((await store.list(id)).map((r) => r.commit), oldHistory.map((r) => r.commit));
  await rm(`${path}.git/refs/heads/main.lock`);
  await store.save(path, JSON.stringify({ ...JSON.parse(saved.content), revision: 2 }));
  const copyPath = join(directory, "copy.framemind"), copy = await store.save(copyPath, await readFile(path, "utf8"));
  const copyHistory = await store.list(id);
  assert.ok(copyHistory[0].copiedFrom);
  const newPath = join(directory, "new.framemind"); await store.save(newPath, copy.content, "new");
  assert.equal((await store.list(id)).length, 1);
  const movedPath = join(directory, "moved.framemind"); await writeFile(movedPath, await readFile(newPath, "utf8"));
  const moved = await store.open(movedPath); assert.match(moved.historyWarning, /缺失/); assert.equal((await store.list(id)).length, 0);
  const inspection = { bare: git(`${path}.git`, ["rev-parse", "--is-bare-repository"]), branch: git(`${path}.git`, ["symbolic-ref", "HEAD"]), remotes: git(`${path}.git`, ["remote"]), commits: git(`${path}.git`, ["log", "--format=%H"]).split("\n") };
  assert.equal(inspection.bare, "true"); assert.equal(inspection.branch, "refs/heads/main"); assert.equal(inspection.remotes, "");
  const after = await sourceIdentity(); assert.deepEqual(after, before);
  await writeFile(join(output, "validation.json"), JSON.stringify({ independentGitInspection: inspection, sourceRepository: { before, after, unchanged: true }, referenceLockFault: { diagnostic, filePreserved: true, indexPreserved: true, historyPreserved: true, retrySucceeded: true }, missingHistory: moved.historyWarning, copiedFrom: copyHistory[0].copiedFrom }, null, 2));
  await writeFile(join(output, "history.json"), JSON.stringify(copyHistory, null, 2));
  await writeFile(join(output, "snapshot.json"), saved.content);
  const sourceFiles = ["electron/project-history-store.ts", "electron/project-checkpoints.ts", "electron/contracts.ts", "scripts/run-p25-07-history.mjs", "dist-electron/project-history-store.js"];
  const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, hash(await readFile(file))])));
  const artifacts = Object.fromEntries(await Promise.all(["validation.json", "history.json", "snapshot.json"].map(async (file) => [file, hash(await readFile(join(output, file)))])));
  await writeFile(join(output, "run.json"), JSON.stringify({ task: "P25-07", runId, recordedAt: new Date().toISOString(), mode: "local-real-git", status: "passed", inputSha256: hash(content(0)), sourceHashes, artifacts, reverify: "npm run evidence:plan2:p2507" }, null, 2));
  console.log(JSON.stringify({ runId, status: "passed", output }));
} finally {
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid temporary path");
  await rm(directory, { recursive: true, force: true });
}
