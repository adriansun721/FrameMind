import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { inspectResult } = require("../dist-electron/reverse-native-domain.cjs");
const { candidateInput, canonicalJson } = require("../dist-electron/candidate-model.js");
const { compareReverseDesignCandidates } = require("../dist-electron/reverse-design-comparison.js");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const root = resolve("docs/evidence/plan2/P25-11/runs");
const runs = await Promise.all((await readdir(root)).map(async (name) => { try { const directory = join(root, name); return { directory, manifest: JSON.parse(await readFile(join(directory, "run.json"), "utf8")) }; } catch { return null; } }));
const run = runs.filter((r) => r?.manifest.status === "passed" && r.manifest.mode === "local-native-with-agent-replay").sort((a, b) => b.manifest.recordedAt.localeCompare(a.manifest.recordedAt))[0];
assert.ok(run, "Run npm run evidence:plan2:p2511 first");
for (const [name, digest] of Object.entries(run.manifest.sourceHashes)) assert.equal(hash(await readFile(name)), digest, `source/build changed: ${name}; create new evidence`);
for (const [name, digest] of Object.entries(run.manifest.artifacts)) assert.equal(hash(await readFile(join(run.directory, name))), digest, name);
const read = async (name) => JSON.parse(await readFile(join(run.directory, name), "utf8"));
for (const label of ["infeasible", "feasible"]) {
  const round = await read(`${label}-round.json`);
  assert.equal(round.status, "completed"); assert.equal(round.mode, "replay"); assert.equal(round.apiCalls, 0);
  assert.equal(round.inspection.status, "completed");
  for (const [name, digest] of Object.entries(round.artifacts)) assert.equal(hash(await readFile(join(run.directory, label, name))), digest);
  for (const work of round.works) {
    const content = await readFile(join(run.directory, `${work.taskId}.framemind`), "utf8"), evidenceBytes = await readFile(join(run.directory, `${work.taskId}-result.json`), "utf8"), evidence = JSON.parse(evidenceBytes);
    assert.equal(hash(candidateInput(content)), work.inputSha256); assert.equal(hash(content), evidence.candidateContentSha256); assert.equal(hash(evidenceBytes), work.resultSha256);
    const actual = inspectResult(content, evidence.request, evidence.messages), report = round.inspection.reports.find((r) => r.taskId === work.taskId);
    assert.equal(actual.massKg, report.massKg);
    assert.equal(canonicalJson(report.checks), canonicalJson(actual.checks.map((c) => ({ ...c, evidenceSha256: work.resultSha256 }))));
    const gate = await read(`${work.taskId}-inspect.json`);
    assert.equal(canonicalJson(gate.checks), canonicalJson(report.checks));
    assert.equal(work.candidate.state, actual.checks.every((c) => c.passed) ? "passed" : "blocked");
  }
  assert.equal(canonicalJson(compareReverseDesignCandidates(round.inspection.reports)), canonicalJson(round.comparison));
  if (label === "infeasible") { assert.equal(round.decision, "no-feasible"); assert.equal(round.mergeRequest, undefined); }
  else {
    assert.equal(round.decision, "merge-proposed");
    const selected = round.comparison.selected, request = round.mergeRequest, receipt = await read("merge-receipt.json");
    assert.equal(request.taskId, selected.taskId); assert.equal(request.expectedCommit, selected.commit); assert.equal(request.inputSha256, selected.inputSha256); assert.equal(request.resultSha256, selected.resultSha256);
    assert.equal(receipt.state, "merged"); assert.equal(receipt.taskId, selected.taskId); assert.ok(receipt.mergedCommit);
    assert.equal(candidateInput(await readFile(join(run.directory, "merged.framemind"), "utf8")), candidateInput(await readFile(join(run.directory, `${selected.taskId}.framemind`), "utf8")));
  }
}
assert.equal((await read("rejected-merges.json")).length, 5);
console.log(`P25-11 verified: ${run.manifest.runId}; real native results, failed merges rejected, feasible comparison and confirmed commit. AI replay; no online acceptance claim.`);
