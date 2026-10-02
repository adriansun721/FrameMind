import { createServer } from "vite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const referenceBytes = await readFile(new URL("../src/validation/t31-references.json", import.meta.url));
const references = JSON.parse(referenceBytes);
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { runNumericalBenchmark, runInvalidBenchmarks } = await server.ssrLoadModule("/src/validation/numerical-benchmarks.ts");
  const cases = references.cases.map((benchmark) => {
    try { return runNumericalBenchmark(benchmark); }
    catch (error) { return { id: benchmark.id, source: benchmark.source, passed: false, input: benchmark.input, error: error instanceof Error ? error.message : String(error) }; }
  });
  const invalid = runInvalidBenchmarks();
  const checks = cases.flatMap((item) => item.checks ?? []);
  const summary = {
    cases: cases.length, invalidCases: invalid.length, checks: checks.length,
    failedCases: [...cases, ...invalid].filter((item) => !item.passed).map((item) => item.id),
    byUnit: Object.fromEntries(["m", "rad", "kN", "kN·m"].map((unit) => {
      const rows = checks.filter((item) => item.unit === unit);
      const worst = rows.reduce((a,b) => a.absoluteError / a.tolerance >= b.absoluteError / b.tolerance ? a : b);
      return [unit, { checks: rows.length, maxAbsoluteError: Math.max(...rows.map((r) => r.absoluteError)), worstToleranceRatio: worst.absoluteError / worst.tolerance, worstQuantity: worst.quantity }];
    })),
  };
  const report = {
    generatedAt: new Date().toISOString(), commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    environment: { platform: process.platform, arch: process.arch, node: process.version },
    referenceSha256: createHash("sha256").update(referenceBytes).digest("hex"),
    criteria: "ADR-0032: absolute m/rad=1e-11, kN/kN·m=1e-9; relative=1e-8; balance absolute only",
    passed: summary.failedCases.length === 0, summary, cases, invalid,
  };
  await mkdir("docs/evidence", { recursive: true });
  await writeFile("docs/evidence/T31-numerical-results.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ passed: report.passed, ...summary }, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  await server.close();
}
