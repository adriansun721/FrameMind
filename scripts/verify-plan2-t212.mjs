import { createServer } from "vite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const directory = "docs/evidence/plan2/T2-12";
const bytes = await readFile("src/validation/t31-references.json");
const references = JSON.parse(bytes);
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { captureAnalysisInput } = await server.ssrLoadModule("/src/domain/analysis.ts");
  const { createAnalysisRequest, executeAnalysisRequest } = await server.ssrLoadModule("/src/domain/analysis-service.ts");
  const { runNumericalBenchmark, runInvalidBenchmarks } = await server.ssrLoadModule("/src/validation/numerical-benchmarks.ts");
  const samples = [];
  const solve = (project) => {
    const request = createAnalysisRequest(captureAnalysisInput(project));
    return executeAnalysisRequest(request);
  };
  const cases = references.cases.map((benchmark) => {
    try {
      return runNumericalBenchmark(benchmark, (project) => {
        const request = createAnalysisRequest(captureAnalysisInput(project));
        const response = executeAnalysisRequest(request);
        if (["axial", "bend-y", "bend-z", "torsion", "moment-y", "moment-z", "six-components", "vertical", "skew-rotated-section"].includes(benchmark.id)) {
          samples.push({ id: benchmark.id, request, response });
        }
        return response;
      });
    } catch (error) { return { id: benchmark.id, passed: false, error: String(error) }; }
  });
  const invalid = runInvalidBenchmarks(solve);
  const checks = cases.flatMap((item) => item.checks ?? []);
  const failed = [...cases, ...invalid].filter((item) => !item.passed).map((item) => item.id);
  const report = {
    generatedAt: new Date().toISOString(), baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    environment: { platform: process.platform, arch: process.arch, node: process.version },
    referenceSha256: createHash("sha256").update(bytes).digest("hex"),
    criteria: "ADR-0032 unchanged: abs m/rad=1e-11; kN/kN·m=1e-9; relative=1e-8; equilibrium absolute only",
    passed: failed.length === 0, summary: { cases: cases.length, invalidCases: invalid.length, checks: checks.length, failed }, cases, invalid,
  };
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/numerical-results.json`, JSON.stringify(report, null, 2) + "\n");
  await writeFile(`${directory}/wire-samples.json`, JSON.stringify({ version: "framemind-analysis/1", samples }, null, 2) + "\n");
  console.log(JSON.stringify({ passed: report.passed, ...report.summary }));
  if (!report.passed) process.exitCode = 1;
} finally { await server.close(); }
