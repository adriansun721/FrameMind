import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const separator = arg.indexOf("=");
  if (separator < 0) throw new Error(`Expected --name=value, got ${arg}`);
  return [arg.slice(0, separator).replace(/^--/, ""), arg.slice(separator + 1)];
}));
if (!args.input) throw new Error("Usage: node scripts/register-p25-01.mjs --input=<path-to-step-or-stp>");

const inputPath = resolve(args.input);
if (![".step", ".stp"].includes(extname(inputPath).toLowerCase())) throw new Error("Input must have a .step or .stp extension");
const fileStat = await stat(inputPath);
if (!fileStat.isFile()) throw new Error("Input must be a regular file");

const hash = createHash("sha256");
const header = Buffer.alloc(512);
let headerLength = 0;
for await (const chunk of createReadStream(inputPath)) {
  hash.update(chunk);
  const take = Math.min(chunk.length, header.length - headerLength);
  if (take > 0) {
    chunk.copy(header, headerLength, 0, take);
    headerLength += take;
  }
}
const sha256 = hash.digest("hex");
const outputPath = resolve(args.output ?? `${root}/docs/evidence/plan2/P25-01/step-${sha256.slice(0, 16)}.json`);
const manifest = {
  schemaVersion: 1,
  task: "P25-01",
  runId: randomUUID(),
  recordedAt: new Date().toISOString(),
  input: {
    identity: "sha256-of-original-bytes",
    sha256,
    sizeBytes: fileStat.size,
    headerBytesCaptured: headerLength,
    headerHex: header.subarray(0, headerLength).toString("hex"),
    headerUtf8: header.subarray(0, headerLength).toString("utf8"),
    sourcePathRecorded: false,
    originalCopied: false,
  },
  independentReference: {
    status: "not-recorded",
    tool: null,
    toolVersion: null,
    toolBuildOrSourceHash: null,
    method: null,
    reviewedAt: null,
    reviewer: null,
    counts: {
      products: null,
      entityDefinitions: null,
      assemblyInstances: null,
      candidateMembers: null,
      splitEngineeringMembers: null,
    },
    observations: [],
    ignoredCandidates: [],
    unverified: ["independent CAD structure and geometry reference", "instance transforms", "member lengths", "section properties", "connections", "ignored candidates"],
  },
  acceptance: {
    inputIdentityFrozen: true,
    independentReferenceRecorded: false,
    status: "baseline-incomplete",
  },
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ output: outputPath, sha256, sizeBytes: fileStat.size, runId: manifest.runId, status: manifest.acceptance.status }, null, 2)}\n`);
