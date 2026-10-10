import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, sep } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { ProjectHistoryStore } = require("../dist-electron/project-history-store.js");
const { ProjectCandidates } = require("../dist-electron/project-candidates.js");
const { candidateInput, candidateDifferences } = require("../dist-electron/candidate-model.js");
const runId = randomUUID(), output = resolve("docs/evidence/plan2/P25-08/runs", runId);
const directory = await mkdtemp(join(tmpdir(), "framemind-p2508-evidence-"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceIdentity = async () => Object.fromEntries(await Promise.all(["HEAD", "refs/heads/main", "index"].map(async (file) => [file, hash(await readFile(join(".git", file)))])));
const git = (repository, args) => { const run = spawnSync("git", [`--git-dir=${repository}`, ...args], { encoding: "utf8", windowsHide: true }); assert.equal(run.status, 0, run.stderr); return run.stdout.trim(); };
await mkdir(output, { recursive: true });
try {
  const before = await sourceIdentity(), history = new ProjectHistoryStore(join(directory, "temporary")), id = `project_${randomUUID()}`, path = join(directory, "project.framemind");
  const initial = JSON.stringify({ format: "framemind-project", id, revision: 1, nodes: [{ id: "node_1", position: { x: 0, y: 0, z: 0 } }], analysisResults: [] });
  const saved = await history.save(path, initial);
  // Explicit protocol fixture: proves the trusted-gate contract, not numerical engineering feasibility.
  const checker = { validate: (content) => { assert.equal(JSON.parse(content).id, id); }, inspect: async ({ candidate: c }) => ({
    candidateId: c.candidateId, commit: c.commit, inputSha256: c.inputSha256, resultSha256: c.resultSha256,
    checks: Object.entries({ source: 1, resources: 1, stiffness: 1, "horizontal-displacement": 15, "force-balance": 1e-7, "moment-balance": 1e-7, mass: 1 }).map(([name, threshold]) => ({ name, threshold, value: ["horizontal-displacement", "force-balance", "moment-balance"].includes(name) ? 0 : 1, passed: true, evidenceSha256: c.resultSha256 })),
  }) };
  const candidates = new ProjectCandidates(history, checker); candidates.sync(1, { content: saved.content, sessionId: "local-evidence" });
  const fork = await candidates.fork(1), mainBefore = git(`${path}.git`, ["rev-parse", "refs/heads/main"]);
  const content = JSON.stringify({ ...JSON.parse(saved.content), revision: 2, nodes: [{ id: "node_1", position: { x: 2, y: 0, z: 0 } }] }), resultContent = JSON.stringify({ fixture: "P25-08 protocol only; numerical inspection is P25-11" });
  const submitted = await candidates.submit(1, { projectId: id, taskId: fork.candidate.taskId, content, inputSha256: hash(candidateInput(content)), resultContent, resultSha256: hash(resultContent), evidenceIndex: ["result.json"] });
  assert.equal(git(`${path}.git`, ["rev-parse", "refs/heads/main"]), mainBefore);
  await assert.rejects(candidates.merge(1, submitted.taskId, submitted.commit), /inspect/);
  assert.equal((await candidates.inspect(1, submitted.taskId)).state, "passed");
  await writeFile(`${path}.git/refs/heads/main.lock`, "controlled fault injection");
  let fault; try { await candidates.merge(1, submitted.taskId, submitted.commit); } catch (cause) { fault = cause.message; }
  assert.ok(fault); assert.equal(git(`${path}.git`, ["rev-parse", "refs/heads/main"]), mainBefore); assert.equal(await readFile(path, "utf8"), saved.content);
  await rm(`${path}.git/refs/heads/main.lock`);
  const merged = await candidates.merge(1, submitted.taskId, submitted.commit); assert.equal(JSON.parse(merged).nodes[0].position.x, 2);
  candidates.sync(1, { content: merged, sessionId: "local-evidence" });
  const restored = await candidates.restore(1, { taskId: submitted.taskId }); assert.equal(JSON.parse(restored).nodes[0].position.x, 0); assert.equal(JSON.parse(restored).revision, 3);
  candidates.sync(1, { content: restored, sessionId: "restored-session", reason: "restore" });
  const old = await candidates.fork(1); await candidates.cancel(1, old.candidate.taskId); const retry = await candidates.fork(1, old.candidate.taskId);
  assert.notEqual(old.candidate.taskId, retry.candidate.taskId); assert.equal(retry.candidate.retryOf, old.candidate.taskId);
  let commandRejection; try { candidates.tool(1, { tool: "powershell", command: "git push" }); } catch (cause) { commandRejection = cause.message; }
  assert.ok(commandRejection);
  const branchGraph = git(`${path}.git`, ["log", "--all", "--graph", "--format=%H %P %s"]), references = git(`${path}.git`, ["for-each-ref", "--format=%(refname) %(objectname)"]);
  const after = await sourceIdentity(); assert.deepEqual(after, before);
  await writeFile(join(output, "validation.json"), JSON.stringify({ mode: "local-real-git-with-explicit-protocol-checker-fixture", numericalInspection: "not-run; P25-11 pending", sourceRepository: { before, after, unchanged: true }, isolatedMainBefore: mainBefore, submitted, fault, faultKeptMainAndFile: true, tasks: await candidates.list(1), commandRejection, differences: candidateDifferences(saved.content, content, saved.content) }, null, 2));
  for (const [name, data] of [["parent.json", saved.content], ["candidate.json", content], ["result.json", resultContent], ["merged.json", merged], ["restored.json", restored], ["branches.txt", `${references}\n\n${branchGraph}\n`]]) await writeFile(join(output, name), data);
  const files = ["validation.json", "parent.json", "candidate.json", "result.json", "merged.json", "restored.json", "branches.txt"];
  const sourceFiles = ["electron/project-candidates.ts", "electron/candidate-model.ts", "electron/project-checkpoints.ts", "electron/project-history-store.ts", "scripts/run-p25-08-candidates.mjs", "dist-electron/project-candidates.js", "dist-electron/project-checkpoints.js"];
  const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, hash(await readFile(file))])));
  const artifacts = Object.fromEntries(await Promise.all(files.map(async (file) => [file, hash(await readFile(join(output, file)))])));
  await writeFile(join(output, "run.json"), JSON.stringify({ task: "P25-08", runId, recordedAt: new Date().toISOString(), mode: "local-real-git-protocol-fixture", status: "passed", numericalInspect: "not-run", inputSha256: hash(saved.content), sourceHashes, artifacts, reverify: "npm run evidence:plan2:p2508" }, null, 2));
  console.log(JSON.stringify({ runId, status: "passed", output }));
} finally {
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid temporary path");
  await rm(directory, { recursive: true, force: true });
}
