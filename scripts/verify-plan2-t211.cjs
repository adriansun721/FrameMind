const { spawn, execFileSync } = require("node:child_process");
const { access, mkdir, readFile, writeFile } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { createHash } = require("node:crypto");
const { redactPersistence } = require("../dist-electron/persistence-redaction.js");

const root = resolve(__dirname, "..");
const online = process.argv.includes("--online");
const mode = online ? "online" : "replay";
const extended = process.argv.includes("--t241");
const task = extended ? "T2-41" : "T2-11";
const prefix = extended ? "FRAMEMIND_T241" : "FRAMEMIND_T211";
let recordRunnerFailure;

async function run() {
  const protocolText = await readFile(join(root, `docs/evidence/plan2/${task}/protocol.json`), "utf8");
  const protocol = JSON.parse(protocolText);
  const startedAt = new Date().toISOString();
  const output = join(root, `docs/evidence/plan2/${task}/runs`, `${startedAt.replace(/[:.]/g, "-")}-${mode}`);
  await mkdir(output, { recursive: true });
  const report = { mode, startedAt, protocolHash: createHash("sha256").update(protocolText).digest("hex"),
    revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    changedFiles: execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" }).trim().split("\n"),
    environment: { platform: process.platform, arch: process.arch, node: process.version, electron: require("electron/package.json").version },
    status: "running", executions: [], coverage: {}, metrics: {}, samples: [], failures: [] };
  report.sourceHashes = {};
  for (const file of [...new Set([...Object.values(protocol.unitCoverage).flat(), ...protocol.desktopFiles, ...(protocol.inputs?.project ? [protocol.inputs.project, "e2e/agent-integration.ts", "src/workspace/task-confirmation.ts", "src/workspace/task-draft.ts", "electron/model-edit-schema.ts"] : []), "src/workspace/ai-task.ts", "src/workspace/ai-tools.ts", "electron/deepseek.ts", "scripts/verify-plan2-t211.cjs", "package-lock.json"])]) {
    report.sourceHashes[file] = createHash("sha256").update(await readFile(join(root, file))).digest("hex");
  }
  const persist = async () => writeFile(join(output, "summary.json"), JSON.stringify(redactPersistence(report), null, 2) + "\n");
  recordRunnerFailure = async () => { report.status = "failed"; report.failures.push({ reason: "runner-exception" }); report.endedAt = new Date().toISOString(); await persist(); };
  // This immutable protocol copy is written before any measured execution.
  await writeFile(join(output, "protocol.json"), protocolText);
  await persist();
  console.log(`${task} ${mode}: ${output}`);
  if (online) {
    try { for (const name of ["deepseek.credentials", "Local State"]) await access(join(process.env.APPDATA, "framemind", name)); }
    catch { report.status = "blocked"; report.failures.push({ reason: "encrypted-credential-profile-unavailable" }); await persist(); process.exitCode = 1; return; }
  }
  async function execute(label, args, env = {}) {
    console.log(`${task} ${label}`);
    const code = await new Promise((done) => {
      const child = spawn(process.execPath, args, { cwd: root, stdio: ["ignore", "ignore", "ignore"], env: { ...process.env, ...env } });
      child.once("error", () => { report.failures.push({ label, reason: "process-launch-failed" }); done(1); });
      child.once("exit", (value) => done(value ?? 1));
    });
    report.executions.push({ label, code }); await persist();
  }
  const units = [...new Set(Object.values(protocol.unitCoverage).flat())];
  if (!online) for (let repeat = 0; repeat < protocol.repetitions; repeat++) {
    await execute(`contracts repetition ${repeat + 1}/${protocol.repetitions}`, [join(root, "node_modules/vitest/vitest.mjs"), "run", ...units,
      "--maxWorkers=4", "--reporter=json", `--outputFile=${join(output, `contracts-${repeat}.json`)}`]);
  }
  await execute(`desktop ${protocol.repetitions} repetitions`, [join(root, "scripts/run-e2e-isolated.cjs"),
    ...(online ? (protocol.onlineFiles ?? ["e2e/plan2-t2-11-reliability.spec.ts"]) : protocol.desktopFiles),
    `--repeat-each=${protocol.repetitions}`, "--workers=1", "--retries=0", "--reporter=json", `--output=${join(output, "artifacts")}`], {
    [prefix + "_ONLINE"]: online ? "1" : "0", [prefix + "_OUTPUT"]: output,
    PLAYWRIGHT_JSON_OUTPUT_NAME: join(output, "desktop.json"),
  });
  if (!online) {
    for (const [ac, files] of Object.entries(protocol.unitCoverage)) {
      const results = [];
      for (let repeat = 0; repeat < protocol.repetitions; repeat++) {
        try {
          const data = JSON.parse(await readFile(join(output, `contracts-${repeat}.json`), "utf8"));
          for (const file of files) {
            const suite = data.testResults.find((s) => s.name.replace(/\\/g, "/").endsWith(`/${file}`));
            if (!suite?.assertionResults.length) results.push({ file, repeat, status: "missing" });
            else for (const assertion of suite.assertionResults) results.push({ file, repeat, name: assertion.fullName, status: assertion.status });
          }
        } catch { results.push({ repeat, status: "missing-reporter" }); }
      }
      report.coverage[ac] = { passed: results.filter((r) => r.status === "passed").length, total: results.length,
        failures: results.filter((r) => r.status !== "passed") };
    }
  }
  for (const [id, expected] of Object.entries(protocol.scenarios)) for (let repeat = 0; repeat < protocol.repetitions; repeat++) {
    let sample;
    try { sample = JSON.parse(await readFile(join(output, `${id}-${repeat}.json`), "utf8")); }
    catch { sample = { id, repeat, status: "missing", checks: {} }; }
    report.samples.push({ id, repeat, status: sample.status });
    for (const name of expected) {
      const metric = name.split(":").at(-1);
      report.metrics[metric] ??= { passed: 0, failed: 0, missing: 0, total: 0 };
      const counts = report.metrics[metric]; counts.total++;
      if (sample.checks[name] === true) counts.passed++;
      else { counts[sample.checks[name] === false ? "failed" : "missing"]++; report.failures.push({ id, repeat, check: name, status: sample.checks[name] === false ? "failed" : "missing" }); }
    }
  }
  for (const value of Object.values(report.metrics)) value.rate = value.passed / value.total;
  // Retain structured desktop failure names; do not infer success from process exit alone.
  try {
    const data = JSON.parse(await readFile(join(output, "desktop.json"), "utf8"));
    report.desktopStats = data.stats;
    function visit(suite, parents = []) {
      for (const spec of suite.specs ?? []) for (const test of spec.tests) {
        if (test.status !== "expected") report.failures.push({ desktop: [...parents, spec.title].join(" > "), status: test.status,
          errors: test.results.flatMap((r) => r.errors ?? []) });
      }
      for (const child of suite.suites ?? []) visit(child, [...parents, child.title]);
    }
    for (const suite of data.suites) visit(suite);
    if (data.errors?.length) report.failures.push(...data.errors.map((error) => ({ runnerError: error })));
    if (!data.stats.expected || data.stats.skipped) report.failures.push({ reason: "missing-or-skipped-desktop-tests" });
  } catch { report.failures.push({ reason: "missing-desktop-reporter" }); }
  const covered = online || Object.values(report.coverage).every((c) => c.total > 0 && c.passed / c.total >= protocol.gates.contractPassRate);
  for (const file of ["desktop.json", ...(!online ? Array.from({ length: protocol.repetitions }, (_, i) => `contracts-${i}.json`) : [])]) {
    try {
      const data = JSON.parse(await readFile(join(output, file), "utf8"));
      await writeFile(join(output, file), JSON.stringify(redactPersistence(data), null, 2) + "\n");
    } catch { report.failures.push({ reason: "reporter-read-redaction-or-write-failed", file }); }
  }
  report.status = covered && report.executions.every((e) => e.code === 0) && report.samples.every((s) => s.status === "passed") && !report.failures.length ? "passed" : "failed";
  report.endedAt = new Date().toISOString(); await persist();
  console.log(JSON.stringify({ mode, status: report.status, metrics: report.metrics, failures: report.failures.length, output }));
  if (report.status !== "passed") process.exitCode = 1;
}
run().catch(async () => {
  try { await recordRunnerFailure?.(); } catch { /* A failed evidence disk cannot be reported as a pass. */ }
  console.error("T2-11 runner failed; inspect the run directory. No provider/environment error body is logged."); process.exitCode = 1;
});
