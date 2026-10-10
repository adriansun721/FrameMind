import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { candidateInput, canonicalJson } = require("../dist-electron/candidate-model.js");
const { createRequest, inspectResult } = require("../dist-electron/reverse-native-domain.cjs");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const root = resolve("docs/evidence/plan2/P25-10/runs");
const runs = await Promise.all((await readdir(root)).map(async (name) => {
  try { return { directory: join(root, name), manifest: JSON.parse(await readFile(join(root, name, "run.json"), "utf8")) }; } catch { return null; }
}));
const run = runs.filter((r) => r?.manifest.mode === "online" && r.manifest.onlineAcceptance && r.manifest.status === "passed").sort((a, b) => b.manifest.recordedAt.localeCompare(a.manifest.recordedAt))[0];
assert.ok(run, "No passed online P25-10 run; run npm run evidence:plan2:p2510:online");
for (const [file, digest] of Object.entries(run.manifest.artifacts)) assert.equal(hash(await readFile(join(run.directory, file))), digest, `artifact: ${file}`);
for (const [file, digest] of Object.entries(run.manifest.sourceHashes)) assert.equal(hash(await readFile(file)), digest, `source/build changed: ${file}; create a new run`);
const round = JSON.parse(await readFile(join(run.directory, "round.json"), "utf8"));
assert.equal(round.status, "completed"); assert.equal(round.mode, "online"); assert.equal(round.decision, "awaiting-P25-11");
assert.equal(round.works.length, 3); assert.equal(new Set(round.works.map((w) => w.taskId)).size, 3);
assert.equal(new Set(round.works.map((w) => w.branch)).size, 3);
assert.equal(round.inspection.status, "completed"); assert.equal(round.inspection.reports.length, 3);
assert.equal(round.apiCalls, round.works.reduce((n, w) => n + w.apiCalls, 0) + round.inspection.apiCalls);
const firstApiEnd = round.timeline.findIndex((e) => e.event === "api-end");
assert.equal(round.timeline.slice(0, firstApiEnd).filter((e) => e.event === "api-start").length, 3, "three requests really overlap");
assert.deepEqual(round.timeline.filter((e) => ["solve-start", "solve-end"].includes(e.event)).map((e) => e.event), ["solve-start", "solve-end", "solve-start", "solve-end", "solve-start", "solve-end"]);
for (const [name, digest] of Object.entries(round.artifacts)) assert.equal(hash(await readFile(join(run.directory, name))), digest);
for (const work of round.works) {
  assert.equal(work.status, "completed"); assert.equal(work.candidate.state, "submitted"); assert.equal(work.candidate.parentCommit, round.parentCommit);
  assert.equal(work.candidate.parentInputSha256, round.parentInputSha256);
  assert.ok(Date.parse(work.endedAt) - Date.parse(work.startedAt) <= 120_500);
  const content = await readFile(join(run.directory, `${work.taskId}.framemind`), "utf8");
  const bytes = await readFile(join(run.directory, `${work.taskId}-result.json`), "utf8");
  const evidence = JSON.parse(bytes);
  assert.equal(hash(bytes), work.resultSha256); assert.equal(hash(candidateInput(content)), work.inputSha256);
  assert.equal(hash(content), evidence.candidateContentSha256);
  assert.equal(canonicalJson(createRequest(content).input), canonicalJson(evidence.request.input));
  assert.equal(hash(canonicalJson(evidence.request.input)), work.frozenInputSha256);
  assert.equal(hash(canonicalJson(evidence.messages.at(-1))), work.nativeResultSha256);
  const observed = inspectResult(content, evidence.request, evidence.messages);
  assert.equal(observed.massKg, work.massKg);
  const report = round.inspection.reports.find((r) => r.taskId === work.taskId);
  assert.equal(report.inputSha256, work.inputSha256); assert.equal(report.resultSha256, work.resultSha256);
  assert.equal(canonicalJson(report.checks), canonicalJson(observed.checks.map((c) => ({ ...c, evidenceSha256: work.resultSha256 }))));
}
const independent = await readFile(join(run.directory, "work-independent-context.json"), "utf8");
for (const work of round.works.filter((w) => w.strategy !== "independent")) assert.ok(!independent.includes(work.taskId) && !independent.includes(work.candidateId));
assert.ok(!/[A-Z]:\\|Bearer\s|\bsk-[A-Za-z0-9_-]+/i.test(independent));
console.log(`P25-10 online evidence verified: ${run.manifest.runId}; 3 isolated work, queued native solves, independent inspect. Decision awaits P25-11.`);
