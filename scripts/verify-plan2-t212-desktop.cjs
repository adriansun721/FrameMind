const { spawn, execFileSync } = require("node:child_process");
const { mkdir, readFile, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

// Older desktop specs do not all dismiss recovery on startup. Give each case,
// including cases in the same file, a fresh profile through the existing runner.
const files = ["plan2-t2-12-analysis-service", "plan2-t2-11-reliability", "t03-analysis", "t04-analysis", "t05-diagnostics", "t06-analysis-task", "t17-member-process", "t18-analysis-process", "t23-analysis-conditions", "t28-engineering-report", "t29-report-appendix", "t30-report-pdf"].map((name) => `e2e/${name}.spec.ts`);
const directory = "docs/evidence/plan2/T2-12";
async function main() {
  const previous = process.argv.includes("--retry-failed") ? JSON.parse(await readFile(join(directory, "desktop-regression.json"), "utf8")) : undefined;
  const listing = JSON.parse(execFileSync(process.execPath, [require.resolve("@playwright/test/cli"), "test", ...files, "--list", "--reporter=json"], { encoding: "utf8", windowsHide: true }));
  const specs = [];
  const visit = (suite) => { specs.push(...(suite.specs ?? [])); for (const child of suite.suites ?? []) visit(child); };
  for (const suite of listing.suites) visit(suite);
  if (previous) {
    const failedTitles = new Set(previous.results.filter((item) => !item.passed).map((item) => item.title));
    for (let index = specs.length - 1; index >= 0; index--) if (!failedTitles.has(specs[index].title)) specs.splice(index, 1);
  }
  if (!specs.length) throw new Error("No desktop regression cases found");
  await mkdir(directory, { recursive: true });
  const results = [];
  for (const [index, spec] of specs.entries()) {
    const pattern = spec.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const args = ["scripts/run-e2e-isolated.cjs", `e2e/${spec.file}`, "--grep", pattern, "--output", `test-results/t212-per-case/${index}`];
    const startedAt = new Date().toISOString();
    const child = spawn(process.execPath, args, { windowsHide: true, env: process.env });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", (code) => done(code ?? 1)); });
    results.push({ file: spec.file, title: spec.title, startedAt, exitCode: code, passed: code === 0, output });
    console.log(`${index + 1}/${specs.length} ${code === 0 ? "PASS" : "FAIL"} ${spec.title}`);
  }
  const merged = previous ? previous.results.map((item) => results.find((result) => result.title === item.title) ?? item) : results;
  const passed = merged.every((item) => item.passed);
  await writeFile(join(directory, "desktop-regression.json"), JSON.stringify({ generatedAt: new Date().toISOString(), isolation: "one temporary profile per test case", passed, cases: merged.length,
    previousAttempts: previous ? [...(previous.previousAttempts ?? []), { passed: previous.passed, results: previous.results }] : [], results: merged }, null, 2) + "\n");
  if (!passed) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
