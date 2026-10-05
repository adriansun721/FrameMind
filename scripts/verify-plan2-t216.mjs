import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { resolve } from "node:path";

const samples = JSON.parse(await readFile("docs/evidence/plan2/T2-14/wire-samples.json", "utf8"));
const records = [];
function requestFor(sample) {
  const input = structuredClone(sample.result.input);
  const loadSourceId = input.combination?.definition.id ?? input.loadCase.id;
  input.analysisCase = { id: "AC1", name: "Reusable analysis", method: "static", loadSourceId, settings: { solver: "native-static" } };
  return { version: "framemind-analysis/1", requestId: "request_t216", analysisId: "analysis_t216", origin: { kind: "formal-model" }, sourceId: "AC1",
    dependencies: input.combination?.definition.terms ?? [{ loadCaseId: input.loadCase.id, factor: 1 }], input };
}
function execute(request) {
  const execution = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 30000 });
  assert.equal(execution.error, undefined);
  const messages = execution.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  return { exitCode: execution.status, messages, packet: messages.at(-1) };
}
for (const id of ["axial", "uniform-local", "self-weight", "combination-negative", "combination-zero", "spatial-chain"]) {
  const sample = samples.find((s) => s.id === id);
  const execution = execute(requestFor(sample));
  assert.equal(execution.exitCode, 0);
  assert.equal(execution.packet.kind, "result");
  const result = execution.packet.result;
  assert.equal(result.service.sourceId, "AC1");
  assert.deepEqual(result.service.dependencies, requestFor(sample).dependencies);
  assert.deepEqual(result.input.analysisCase, requestFor(sample).input.analysisCase);
  // Saved project JSON normalizes -0 to 0. Apply only that serialization rule.
  assert.deepEqual(JSON.parse(JSON.stringify(result.nodes)), sample.result.nodes);
  assert.deepEqual(JSON.parse(JSON.stringify(result.members)), sample.result.members);
  records.push({ id, passed: true, analysisSourceId: "AC1", loadSourceId: result.input.analysisCase.loadSourceId, numericalRegression: "exact node and member equality with registered T2-14 references after JSON zero normalization" });
}
for (const [id, mutate] of [
  ["unsupported-method", (r) => { r.input.analysisCase.method = "modal"; }],
  ["unsupported-settings", (r) => { r.input.analysisCase.settings.tolerance = 1e-8; }],
  ["foreign-load-source", (r) => { r.input.analysisCase.loadSourceId = "LC99"; }],
  ["foreign-analysis-source", (r) => { r.sourceId = "AC2"; }],
  ["invalid-analysis-id", (r) => { r.input.analysisCase.id = "AC0"; r.sourceId = "AC0"; }],
]) {
  const request = requestFor(samples[0]); mutate(request);
  const execution = execute(request);
  assert.equal(execution.exitCode, 1);
  assert.equal(execution.packet.kind, "error");
  assert.equal(execution.packet.error.stage, "model-check");
  assert.ok(execution.messages.every((m) => m.kind !== "result"));
  records.push({ id, passed: true, status: "rejected-in-model-check" });
}
await mkdir("docs/evidence/plan2/T2-16", { recursive: true });
await writeFile("docs/evidence/plan2/T2-16/native-verification.json", JSON.stringify({ passed: true, records }, null, 2));
console.log(`T2-16 native verification passed: ${records.length} cases`);
