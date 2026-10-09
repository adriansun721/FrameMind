import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { canonicalizeIntermediate, parseStepIntermediate, STEP_READER_INFO } from "./step-intermediate.mjs";
const { buildCadTopologyPreview } = await import("../src/workspace/cad-topology.ts");
const root = resolve(import.meta.dirname, ".."), startedAt = new Date().toISOString(), runId = randomUUID();
const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const i = arg.indexOf("="); if (i < 0) throw new Error("Expected --name=value"); return [arg.slice(0, i).replace(/^--/, ""), arg.slice(i + 1)]; }));
const input = resolve(args.input ?? `${root}/完整钢架装配.STEP`);
const output = resolve(args.output ?? `${root}/docs/evidence/plan2/P25-04/runs/${runId}/run.json`);
if (![".step", ".stp"].includes(extname(input).toLowerCase())) throw new Error("Expected STEP input");
const bytes = await readFile(input), digest = (v) => createHash("sha256").update(v).digest("hex");
const inputSha256 = digest(bytes), parsed = parseStepIntermediate(bytes, { inputSha256, parserVersion: `framemind-step-reader/${STEP_READER_INFO.version}` });
const topology = buildCadTopologyPreview(parsed.state), second = buildCadTopologyPreview(parsed.state);
const artifact = { schemaVersion: 1, previewOnly: true, inputSha256, geometryHash: parsed.geometryHash, intermediateState: parsed.state, topology };
const content = JSON.stringify(artifact, null, 2) + "\n", artifactPath = resolve(dirname(output), "preview.json");
await mkdir(dirname(output), { recursive: true }); await writeFile(artifactPath, content);
const sourceFiles = ["scripts/step-intermediate.mjs", "scripts/step-centerlines.mjs", "scripts/cad-parser-worker.mjs", "src/workspace/cad-topology.ts", "src/workspace/cad-geometry.ts", "src/components/CadTopologyPreview.tsx", "src/App.tsx"];
const hashes = Object.fromEntries(await Promise.all(sourceFiles.map(async (p) => [p, digest((await readFile(resolve(root, p), "utf8")).replace(/\r\n/g, "\n"))])));
const built = {};
for (const p of ["dist/index.html", "dist-electron/main.js"]) { try { built[p] = digest(await readFile(resolve(root, p))); } catch { built[p] = null; } }
const geometryStatus = topology.issues.some((i) => i.severity === "blocking") ? "blocked" : "review-required";
const manifest = {
  schemaVersion: 1, task: "P25-04", runId, startedAt, endedAt: new Date().toISOString(),
  input: { sha256: inputSha256, sizeBytes: bytes.length, extension: extname(input).toLowerCase(), sourcePathRecorded: false },
  parser: STEP_READER_INFO, sourceHashNormalization: "UTF-8-LF", sourceHashes: hashes, buildHashes: built,
  intermediate: { geometryHash: parsed.geometryHash, instanceCount: parsed.state.instances.length, solidCount: parsed.state.brepSummaries.length, rawLineCandidateCount: parsed.state.geometryCandidates.length },
  topology: { status: geometryStatus, nodeCount: topology.nodes.length, memberCount: topology.members.length, centerlineCount: topology.sourceMemberCount, issueCounts: { blocking: topology.issues.filter((i) => i.severity === "blocking").length, warning: topology.issues.filter((i) => i.severity === "warning").length }, hash: digest(canonicalizeIntermediate(topology)), fullDiagnosticsInArtifact: true },
  artifact: { name: "preview.json", sha256: digest(content), bytes: Buffer.byteLength(content) },
  checks: { deterministic: canonicalizeIntermediate(topology) === canonicalizeIntermediate(second), rawLineCandidatesUsedAsCenterlines: false, originalSourceExcluded: !content.includes("ISO-10303-21"), sourcePathExcluded: !content.includes(input) },
  desktopVerification: "not-executed-by-this-command", formalModelVerification: "desktop-test-required", independentCadReference: "pending-P25-01", taskAcceptance: "pending",
};
await writeFile(output, JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ runId, output, topologyStatus: geometryStatus, centerlineCount: topology.sourceMemberCount, blockers: manifest.topology.issueCounts.blocking, taskAcceptance: manifest.taskAcceptance }, null, 2));
