import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { canonicalizeIntermediate, hashAudit, parseStepIntermediate, STEP_READER_INFO } from "./step-intermediate.mjs";

const root = resolve(import.meta.dirname, "..");
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const split = arg.indexOf("=");
  if (split < 0) throw new Error(`Expected --name=value, got ${arg}`);
  return [arg.slice(0, split).replace(/^--/, ""), arg.slice(split + 1)];
}));
const input = resolve(args.input ?? `${root}/完整钢架装配.STEP`);
if (![".step", ".stp"].includes(extname(input).toLowerCase())) throw new Error("Input must have a .step or .stp extension");
const bytes = await readFile(input);
const inputSha256 = createHash("sha256").update(bytes).digest("hex");
let parameters = {};
if (args.parameters) parameters = JSON.parse(args.parameters);
const parsed = parseStepIntermediate(bytes, { inputSha256, parserVersion: `framemind-step-reader/${STEP_READER_INFO.version}`, parameters });
const second = parseStepIntermediate(bytes, { inputSha256, parserVersion: `framemind-step-reader/${STEP_READER_INFO.version}`, parameters });
const runId = randomUUID();
const audit = { ...parsed.audit, runId, recordedAt: new Date().toISOString() };
const requiresAssembly = !args.input || input.endsWith("完整钢架装配.STEP");
const realAssemblyParsed = parsed.state.instances.length > 0;
const blockingIssuesClear = parsed.state.diagnostics.blockingIssues.length === 0;
const coverageKeys = ["entities", "geometryCandidates", "instanceGeometryCandidates", "candidateNodes", "candidateMembers", "sectionBasis", "sourceMappings"];
const coverage = Object.fromEntries(coverageKeys.map((key) => [key, { count: parsed.state[key].length, hash: createHash("sha256").update(canonicalizeIntermediate(parsed.state[key])).digest("hex") }]));
const stateForManifest = args.summaryOnly === "true" ? {
  schemaVersion: parsed.state.schemaVersion,
  normalization: parsed.state.normalization,
  units: parsed.state.units,
  diagnostics: parsed.state.diagnostics,
  anomalies: parsed.state.anomalies,
  products: parsed.state.products,
  assemblyTree: parsed.state.assemblyTree,
  instances: parsed.state.instances,
  brepSummaries: parsed.state.brepSummaries,
  coverage,
  geometryCandidates: parsed.state.geometryCandidates.slice(0, 32),
  instanceGeometryCandidates: parsed.state.instanceGeometryCandidates.slice(0, 32),
  candidateNodes: parsed.state.candidateNodes.slice(0, 64),
  candidateMembers: parsed.state.candidateMembers.slice(0, 64),
  sectionBasis: parsed.state.sectionBasis.slice(0, 64),
  sourceMappings: parsed.state.sourceMappings.slice(0, 64),
  warnings: parsed.state.warnings,
  ignoredEntities: parsed.state.ignoredEntities,
  entitySummary: { count: parsed.state.entities.length, first: parsed.state.entities.slice(0, 16), last: parsed.state.entities.slice(-16) },
} : parsed.state;
const output = resolve(args.output ?? `${root}/docs/evidence/plan2/P25-03/${randomUUID()}.json`);
const manifest = {
  schemaVersion: 1,
  task: "P25-03",
  recordedAt: new Date().toISOString(),
  input: { identity: "sha256-of-original-bytes", sha256: inputSha256, sizeBytes: bytes.length, extension: extname(input).toLowerCase(), sourcePathRecorded: false },
  parser: parsed.audit.parserVersion,
  runtime: STEP_READER_INFO,
  intermediate: { schemaVersion: parsed.state.schemaVersion, geometryHash: parsed.geometryHash, auditHash: hashAudit(audit), state: stateForManifest },
  audit,
  aiSummary: parsed.aiSummary,
  acceptance: { deterministic: parsed.geometryHash === second.geometryHash && parsed.state.schemaVersion === 2, realAssemblyParsed, blockingIssuesClear, canonicalHashSeparatedFromAudit: parsed.geometryHash !== parsed.auditHash, exportedJson: true, completeCollectionsHashed: true, sourcePathRedacted: !JSON.stringify(parsed).includes(input), rawSourceExcluded: !JSON.stringify(parsed.state).includes("ISO-10303-21") },
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
const status = manifest.acceptance.deterministic && blockingIssuesClear && (!requiresAssembly || realAssemblyParsed) ? "passed" : "failed";
process.stdout.write(`${JSON.stringify({ output, geometryHash: parsed.geometryHash, status }, null, 2)}\n`);
