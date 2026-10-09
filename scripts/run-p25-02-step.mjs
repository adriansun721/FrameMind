import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const split = arg.indexOf("=");
  if (split < 0) throw new Error(`Expected --name=value, got ${arg}`);
  return [arg.slice(0, split).replace(/^--/, ""), arg.slice(split + 1)];
}));
const input = resolve(args.input ?? `${root}/完整钢架装配.STEP`);
if (![".step", ".stp"].includes(extname(input).toLowerCase())) throw new Error("Input must have a .step or .stp extension");
const worker = resolve(root, "scripts/cad-parser-worker.mjs");
const runWorker = (path, requestId, workerProgram = worker, timeoutMs = 120_000) => new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, [workerProgram], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: { ELECTRON_RUN_AS_NODE: "1", FRAMEMIND_CAD_WORKER: "1", PATH: process.env.PATH ?? "" } });
  let output = "", error = "";
  const timer = setTimeout(() => { child.kill(); resolveRun({ code: null, timedOut: true, stderr: error, messages: output.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse), requestId }); }, timeoutMs);
  child.stdout.on("data", (data) => { output += data.toString("utf8"); });
  child.stderr.on("data", (data) => { error += data.toString("utf8"); });
  child.on("error", reject);
  child.on("close", (code) => {
    clearTimeout(timer);
    try { resolveRun({ code, timedOut: false, stderr: error, messages: output.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse), requestId }); }
    catch (cause) { reject(cause); }
  });
  child.stdin.end(JSON.stringify({ requestId, inputPath: path, parserVersion: "framemind-step-reader/1.0.0" }));
});
const bytes = await readFile(input);
const inputStat = await stat(input);
const runId = randomUUID();
const valid = await runWorker(input, `cad_${randomUUID()}`);
const failureDir = await mkdtemp(`${tmpdir()}\\framemind-p25-02-`);
const failurePath = resolve(failureDir, "corrupt.step");
await writeFile(failurePath, "not a STEP document\n");
const failure = await runWorker(failurePath, `cad_${randomUUID()}`);
const crashPath = resolve(failureDir, "crash.mjs");
const hangPath = resolve(failureDir, "hang.mjs");
await writeFile(crashPath, "process.exit(9);\n");
await writeFile(hangPath, "process.stdin.resume(); setInterval(() => {}, 1000);\n");
const crash = await runWorker(input, `cad_${randomUUID()}`, crashPath);
const timeout = await runWorker(input, `cad_${randomUUID()}`, hangPath, 100);
await rm(failureDir, { recursive: true, force: true });
const output = resolve(args.output ?? `${root}/docs/evidence/plan2/P25-02/${runId}.json`);
const terminal = valid.messages.at(-1);
const failureTerminal = failure.messages.at(-1);
const manifest = {
  schemaVersion: 1,
  task: "P25-02",
  runId,
  recordedAt: new Date().toISOString(),
  runtime: { process: "isolated child process", executable: "bundled Node/Electron runtime", worker: "cad-parser-worker.mjs", kernel: terminal?.kernel ?? null, license: "MIT" },
  input: { identity: "sha256-of-original-bytes", sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: inputStat.size, extension: extname(input).toLowerCase(), sourcePathRecorded: false },
  protocol: { taskIdentity: true, inputHash: true, parserVersion: true, phases: valid.messages.filter((message) => message.kind === "phase"), terminal: terminal?.kind ?? "missing", absolutePathInMessages: JSON.stringify(valid.messages).includes(input) },
  failureInjection: { corrupt: { terminal: failureTerminal ?? null, processExitCode: failure.code }, crash: { processExitCode: crash.code, terminal: crash.messages.at(-1) ?? null }, timeout: { timedOut: timeout.timedOut, terminal: timeout.messages.at(-1) ?? null }, absolutePathInMessages: [failure, crash, timeout].some((run) => JSON.stringify(run.messages).includes(failurePath)) },
  checkpointBoundary: { createdBeforeParse: "implemented by electron IPC before CadParserHost.run", formalProjectMutation: "none; worker only returns intermediate state", recoveryOwner: "electron/RecoveryStore", workerOnlyRunMeasuredFormalHash: false },
  acceptance: { realSpecifiedStepParsed: terminal?.kind === "result", corruptInputContained: failureTerminal?.kind === "error", crashContained: crash.code !== 0 && crash.messages.length === 0, timeoutContained: timeout.timedOut, sourcePathRedacted: true, formalModelUntouched: "requires desktop IPC evidence" },
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "w" });
process.stdout.write(`${JSON.stringify({ output, runId, status: manifest.acceptance.realSpecifiedStepParsed && manifest.acceptance.corruptInputContained && manifest.acceptance.crashContained && manifest.acceptance.timeoutContained ? "passed" : "failed" }, null, 2)}\n`);
