import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { ProjectCandidates } = require("../dist-electron/project-candidates.js");
const { ProjectHistoryStore } = require("../dist-electron/project-history-store.js");
const { ReverseDesignService } = require("../dist-electron/reverse-design.js");
const { ReverseDesignRounds } = require("../dist-electron/reverse-design-round.js");
const { ReverseDesignInspector } = require("../dist-electron/reverse-design-inspection.js");
const { NativeAnalysisHost } = require("../dist-electron/native-analysis.js");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const runId = randomUUID(), directory = resolve("docs/evidence/plan2/P25-11/runs", `${runId}-local-native`);
await mkdir(directory, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "framemind-p2511-"));
const native = new NativeAnalysisHost(resolve("native/bin/framemind-core.exe"));
let feasible = false, calls = 0, status = "failed";
const response = (...entries) => ({ status: "success", message: "explicit replay", assistant: { role: "assistant", content: null,
  tool_calls: entries.map(([name, args]) => ({ id: `replay_${++calls}`, type: "function", function: { name, arguments: JSON.stringify(args) } })) } });
const transport = { mode: "replay", model: async () => "deterministic-evidence-replay", cancel: async () => {}, chat: async (_id, messages) => {
  const prompt = messages[0].content, tools = messages.filter((m) => m.role === "tool"), outputs = tools.map((m) => JSON.parse(m.content));
  if (prompt.includes("You are main")) {
    const selected = outputs.find((m) => m.comparison)?.comparison.selected;
    if (selected && !outputs.some((m) => m.confirmationRequired)) return response(["propose_merge", { taskId: selected.taskId, expectedCommit: selected.commit, inputSha256: selected.inputSha256, resultSha256: selected.resultSha256 }]);
    return response([!tools.length ? "read_parent" : tools.length === 1 ? "dispatch_round" : "finish_main", {}]);
  }
  if (prompt.includes("You are independent read-only inspect")) {
    if (!tools.length) return response(...JSON.parse(messages[1].content).taskIds.map((taskId) => ["read_candidate_evidence", { taskId }]));
    return response(["submit_inspection", { reports: outputs.map(({ taskId, inputSha256, resultSha256 }) => ({ taskId, inputSha256, resultSha256 })) }]);
  }
  if (!tools.length) return response(["generate_candidate", { beamCatalogId: feasible && prompt.includes("distinct") ? "arcelor-hea200" : "arcelor-ipe100", columnCatalogId: prompt.includes("aggressive") ? "arcelor-ipe100" : "arcelor-hea200" }]);
  return response([tools.length === 1 ? "solve_candidate" : "finish_work", {}]);
} };
const save = (name, value) => writeFile(join(directory, name), typeof value === "string" ? value : JSON.stringify(value, null, 2));
try {
  const history = new ProjectHistoryStore(join(temporary, "history")), candidates = new ProjectCandidates(history, new ReverseDesignInspector()), service = new ReverseDesignService(history, candidates);
  // A fresh empty public project fixture, with no old run evidence or solver output.
  const empty = { format: "framemind-project", formatVersion: 2, id: `project_${randomUUID()}`, name: "P25-11 evidence", revision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), units: { length: "m", force: "kN", moment: "kN·m" }, nodes: [], members: [], materials: [], sections: [], supports: [], nodalLoads: [], uniformLoads: [], analysisResults: [], loadCases: [{ id: "LC1", name: "默认工况", description: "" }], activeLoadCaseId: "LC1", selfWeight: { enabled: false, loadCaseId: "LC1", gravity: { x: 0, y: 0, z: -9.81 } }, loadCombinations: [], analysisCases: [], psdSpectra: [], nextLoadCaseNumber: 2,
    ...Object.fromEntries(["Node", "Member", "Material", "Section", "Support", "Load", "UniformLoad", "LoadCombination", "AnalysisCase", "Psd"].map((kind) => [`next${kind}Number`, 1])) };
  const initial = JSON.stringify(empty);
  candidates.sync(1, { content: initial, sessionId: runId }); service.sync(1, { content: initial, sessionId: runId });
  const draft = service.prepare(1), parent = await service.confirm(1, draft.confirmationId);
  await save("parent.framemind", parent);
  const rounds = new ReverseDesignRounds(history, candidates, service, native, transport, async () => hash(await readFile("dist-electron/reverse-design-round.js")));
  const records = [];
  for (const label of ["infeasible", "feasible"]) {
    feasible = label === "feasible";
    const round = await rounds.run(1, draft.confirmationId); assert.equal(round.status, "completed");
    assert.equal(round.decision, feasible ? "merge-proposed" : "no-feasible");
    assert.equal(round.apiCalls, 0);
    await save(`${label}-round.json`, round);
    const roundDirectory = join(history.checkpoints.location(JSON.parse(parent).id), "rounds", round.runId);
    await mkdir(join(directory, label));
    for (const name of Object.keys(round.artifacts)) await writeFile(join(directory, label, name), await readFile(join(roundDirectory, name)));
    for (const work of round.works) {
      const snapshot = await candidates.read(1, work.taskId);
      await save(`${work.taskId}.framemind`, snapshot.candidateContent);
      const candidateDirectory = join(history.checkpoints.location(work.candidate.projectId), "candidates", work.taskId);
      for (const name of ["result.json", "inspect.json", "task.json"]) await writeFile(join(directory, `${work.taskId}-${name}`), await readFile(join(candidateDirectory, name)));
      if (work.candidate.state !== "passed") {
        await assert.rejects(candidates.merge(1, work.taskId, work.candidate.commit));
        records.push({ taskId: work.taskId, decision: "merge-rejected", state: work.candidate.state });
      }
    }
    assert.equal(await history.read(JSON.parse(parent).id, round.parentCommit), parent);
    if (round.mergeRequest) {
      await assert.rejects(candidates.merge(1, round.mergeRequest.taskId, "0".repeat(40)));
      const merged = await candidates.merge(1, round.mergeRequest.taskId, round.mergeRequest.expectedCommit);
      await save("merged.framemind", merged);
      await save("merge-receipt.json", (await candidates.list(1)).find((c) => c.taskId === round.mergeRequest.taskId));
    }
  }
  await save("rejected-merges.json", records); status = "passed";
} finally {
  native.dispose();
  const sources = ["electron/reverse-design-inspection.ts", "electron/reverse-design-comparison.ts", "electron/reverse-design-round.ts", "electron/reverse-design-round-contract.ts", "electron/project-candidates.ts", "electron/main.ts", "scripts/reverse-native-domain.ts", "src/components/ReverseDesignDialog.tsx", "scripts/run-p25-11.mjs", "scripts/verify-p25-11.mjs", "dist-electron/reverse-design-round.js", "dist-electron/reverse-native-domain.cjs", "native/bin/framemind-core.exe"];
  const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async (name) => [name, hash(await readFile(name))])));
  async function files(root, prefix = "") {
    const output = [];
    for (const entry of await readdir(root, { withFileTypes: true })) { const name = `${prefix}${entry.name}`; if (entry.isDirectory()) output.push(...await files(join(root, entry.name), `${name}/`)); else if (name !== "run.json") output.push(name); }
    return output;
  }
  const artifacts = Object.fromEntries(await Promise.all((await files(directory)).map(async (name) => [name, hash(await readFile(join(directory, name)))])));
  await save("run.json", { task: "P25-11", runId, recordedAt: new Date().toISOString(), status, mode: "local-native-with-agent-replay", onlineAcceptance: false, artifacts, sourceHashes, reverify: "node scripts/verify-p25-11.mjs" });
  if (!resolve(temporary).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary directory");
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
console.log(`P25-11 real native gates, comparison and controlled merge: ${runId} (${status}); AI explicitly replay.`);
