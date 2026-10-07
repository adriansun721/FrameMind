import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { gzipSync } from "node:zlib";
import { collectMeasurements, summarizeAcceptance } from "./numerical-acceptance.mjs";

const root = resolve(import.meta.dirname, "..");
process.chdir(root);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const protocolBytes = await readFile("src/validation/t240-protocol.json"), protocol = JSON.parse(protocolBytes);
const startedAt = new Date().toISOString(), runId = startedAt.replaceAll(/[:.]/g, "-");
const evidence = resolve("docs/evidence/plan2/T2-40", runId);
await mkdir(evidence, { recursive: true });
await mkdir(".scratch", { recursive: true });
const scratch = await mkdtemp(resolve(".scratch/t240-"));
const registration = { startedAt, commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  environment: { platform: process.platform, arch: process.arch, node: process.version },
  executableSha256: hash(await readFile("native/bin/framemind-core.exe")), protocolSha256: hash(protocolBytes), protocol,
  sources: [] };
for (const path of new Set(["src/validation/t31-references.json", "src/validation/section-fixtures.ts", "scripts/generate-t31-references.py",
  "scripts/numerical-acceptance.mjs", "scripts/numerical-evidence.mjs", "scripts/verify-plan2-t240.mjs", ...protocol.suites.flatMap((s) => [s.script, s.basis])])) {
  registration.sources.push({ path, sha256: hash(await readFile(path)) });
}
// Write the criteria and input identities BEFORE any numerical run.
await writeFile(join(evidence, "registration.json"), JSON.stringify(registration, null, 2) + "\n");
const suites = [], checks = [], reports = new Map();
function execute(script) {
  return new Promise((accept) => {
    const child = spawn(process.execPath, [script], { cwd: root, windowsHide: true,
      env: { ...process.env, FRAMEMIND_NUMERICAL_EVIDENCE_ROOT: scratch }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", error, timedOut = false;
    // Suites spawn synchronous native children, each with its own 30/120 s limit.
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 600000);
    child.stdout.on("data", (data) => { stdout = (stdout + data).slice(-65536); });
    child.stderr.on("data", (data) => { stderr = (stderr + data).slice(-65536); });
    child.on("error", (caught) => { error = String(caught); });
    child.on("close", (exitCode, signal) => { clearTimeout(timeout); accept({ exitCode, signal, timedOut, error, stdout: stdout.trim(), stderr: stderr.trim() }); });
  });
}
for (const suite of protocol.suites) {
  const start = performance.now();
  console.log(`Running ${suite.task}`);
  const execution = await execute(suite.script), entry = { task: suite.task, basis: suite.basis, coverage: suite.coverage,
    elapsedMs: performance.now() - start, execution, passed: false };
  try {
    const bytes = await readFile(join(scratch, suite.task, suite.artifact)), report = JSON.parse(bytes);
    const filename = `${suite.task}-${suite.artifact}.gz`;
    await writeFile(join(evidence, filename), gzipSync(bytes));
    entry.artifact = filename; entry.artifactSha256 = hash(bytes);
    const rawChecks = suite.task === "T2-14" ? report.cases.flatMap((c) => c.checks ?? []) : report.checks;
    if (!Array.isArray(rawChecks) || rawChecks.length < suite.minimumChecks) throw new Error(`Missing registered checks: ${rawChecks?.length} < ${suite.minimumChecks}`);
    entry.sourceChecks = rawChecks.length;
    if (suite.task === "T2-14" && (report.cases.length !== 22 || report.failures.length !== 7)) throw new Error("Incomplete static regression coverage");
    if (report.passed !== true) throw new Error("Suite reports failure");
    if (execution.exitCode !== 0 || execution.error || execution.timedOut) throw new Error("Suite process failed");
    reports.set(suite.task, report);
    if (suite.task !== "T2-40-guards") {
      const quantities = collectMeasurements(suite.task, report);
      if (!quantities.length) throw new Error("No independently evaluated quantities");
      checks.push(...quantities);
      entry.quantities = quantities.length;
      entry.failedQuantities = quantities.filter((q) => (q.required || q.failure) && !q.passed).map((q) => q.name);
      if (entry.failedQuantities.length) throw new Error("Independent acceptance limits failed");
    } else if (report.checks.some((c) => c.passed !== true)) throw new Error("Failure guard did not reject false success");
    entry.passed = true;
  } catch (caught) { entry.failure = String(caught); }
  suites.push(entry);
  console.log(`${suite.task}: ${entry.passed ? "PASS" : entry.failure}`);
}

const convergence = { mesh: [], modal: [], frequency: [], integration: [] };
const failureCases = [];
for (const [task, report] of reports) {
  for (const [index, record] of [...(report.failures ?? []), ...(report.protocolFailures ?? []), ...(report.checks ?? []).filter((c) => c.diagnostics || task === "T2-40-guards")].entries()) {
    failureCases.push({ task, name: record.name ?? record.id ?? `failure-${index}`, evidence: record });
  }
  for (const c of report.cases ?? []) {
    const mesh = task === "T2-26" ? { status: c.status, reason: c.reason, runs: c.runs }
      : task === "T2-27" || task === "T2-30" ? c.convergence : task === "T2-28" ? c.modal?.convergence
      : task === "T2-31" ? { status: "converged", runs: c.runs } : undefined;
    if (mesh) convergence.mesh.push({ task, name: c.id ?? c.name, ...mesh });
    if (task === "T2-31") for (const run of c.runs) for (const iteration of run.iterations) {
      checks.push({ name: `${task}/${c.name}/${run.divisions}/${iteration.step}/${iteration.iteration}/residual`, unit: "1", actual: iteration.residual,
        reference: 0, required: true, absoluteError: iteration.residual, relativeError: null, tolerance: 1e-8, nearZeroReference: true,
        passed: Number.isFinite(iteration.residual) && iteration.residual >= 0 && iteration.residual <= 1e-8 });
    }
  }
  for (const c of report.checks ?? []) {
    if (c.errors || c.relativeErrors || "initialError" in c) convergence.mesh.push({ task, name: c.name, analyticalErrors: c.errors ?? c.relativeErrors ?? [c.initialError, c.finalError] });
    if (c.convergence?.modal) convergence.modal.push({ task, name: c.name, ...c.convergence.modal });
    if (c.modeCounts) convergence.modal.push({ task, name: c.name, modeCounts: c.modeCounts, rmsM: c.rmsM, relativeChange: c.relativeChange, tolerance: c.tolerance });
    if (c.convergence?.runs) {
      convergence.frequency.push({ task, name: c.name, tolerance: .005, runs: c.convergence.runs.map(({ points, curveError }) => ({ points, curveError })) });
      convergence.integration.push({ task, name: c.name, type: "native-trapezoidal", tolerance: .005, runs: c.convergence.runs.map(({ points, variance, rms, varianceError, rmsError }) => ({ points, varianceM2: variance, rmsM: rms, varianceError, rmsError })) });
    }
    if (c.independentIntegration) convergence.integration.push({ task, name: c.name, type: "independent-simpson", tolerance: task === "T2-33" ? 1e-5 : 1e-8, ...c.independentIntegration });
  }
}
// Each refinement axis must have measured progress; a single close value cannot pass.
const finiteSequence = (values) => values.length >= 2 && values.every(Number.isFinite);
const increasing = (values) => finiteSequence(values) && values.every((v, i) => i === 0 || v > values[i - 1]);
const convergenceChecks = {
  mesh: ["T2-26", "T2-27", "T2-28", "T2-30", "T2-31"].every((task) => convergence.mesh.some((c) => c.task === task && c.status === "converged" && increasing(c.runs.map((r) => r.divisions))))
    && convergence.mesh.some((c) => finiteSequence(c.analyticalErrors ?? []) && c.analyticalErrors.at(-1) < c.analyticalErrors[0]),
  modal: convergence.modal.some((c) => c.upperModeCount > c.lowerModeCount && c.status === "converged" && Number.isFinite(c.curveError) && c.curveError <= .005 && Number.isFinite(c.rmsError) && c.rmsError <= .005)
    && convergence.modal.some((c) => increasing(c.modeCounts ?? []) && finiteSequence(c.rmsM ?? []) && c.relativeChange <= c.tolerance),
  frequency: convergence.frequency.length > 0 && convergence.frequency.every((c) => increasing(c.runs.map((r) => r.points)) && Number.isFinite(c.runs.at(-1).curveError) && c.runs.at(-1).curveError <= c.tolerance),
  integration: convergence.integration.some((c) => c.type === "native-trapezoidal") && convergence.integration.some((c) => c.type === "independent-simpson")
    && convergence.integration.every((c) => c.type === "independent-simpson"
      ? c.fineIntervals > c.coarseIntervals && Number.isFinite(c.coarseVarianceM2) && Number.isFinite(c.fineVarianceM2) && Number.isFinite(c.relativeChange) && c.relativeChange <= c.tolerance
      : increasing(c.runs.map((r) => r.points)) && c.runs.every((r) => Number.isFinite(r.varianceM2) && Number.isFinite(r.rmsM))
        && Number.isFinite(c.runs.at(-1).varianceError) && c.runs.at(-1).varianceError <= c.tolerance && Number.isFinite(c.runs.at(-1).rmsError) && c.runs.at(-1).rmsError <= c.tolerance),
};
const summary = summarizeAcceptance(checks);
const quantitiesBytes = Buffer.from(JSON.stringify(checks, null, 2));
const report = { task: "T2-40", startedAt, completedAt: new Date().toISOString(), runId, registration: "registration.json", ...summary,
  passed: summary.passed && suites.every((s) => s.passed) && Object.values(convergenceChecks).every(Boolean),
  suites, convergenceChecks, convergenceCounts: Object.fromEntries(Object.entries(convergence).map(([key, values]) => [key, values.length])),
  quantities: "quantities.json.gz", quantitiesSha256: hash(quantitiesBytes), convergence: "convergence.json", failureCases: "failures.json", failureCaseCount: failureCases.length, limitsChanged: false };
await writeFile(join(evidence, "quantities.json.gz"), gzipSync(quantitiesBytes));
await writeFile(join(evidence, "convergence.json"), JSON.stringify(convergence, null, 2) + "\n");
await writeFile(join(evidence, "failures.json"), JSON.stringify(failureCases, null, 2) + "\n");
await writeFile(join(evidence, "summary.json"), JSON.stringify(report, null, 2) + "\n");
const lines = ["# T2-40 全分析独立数值验收", "", `运行：${runId}；结果：${report.passed ? "通过" : "失败"}。`, "",
  `复跑 ${suites.length} 个基准组；独立核对 ${checks.length} 个量及残差。参考与门槛未修改。`, "",
  "| 基准 | 结果 | 原始检查数 | 数值与残差数 |", "| --- | --- | ---: | ---: |",
  ...suites.map((s) => `| ${s.task} | ${s.passed ? "通过" : "失败"} | ${s.sourceChecks ?? 0} | ${s.quantities ?? "守卫检查"} |`), "",
  "| 量纲 | 必须通过 | 最大绝对误差 | 最大相对误差（近零除外） | 最大误差／容差 |", "| --- | ---: | ---: | ---: | ---: |",
  ...Object.entries(report.byUnit).map(([unit, s]) => `| ${unit} | ${s.required} | ${s.maxAbsoluteError.toExponential(4)} | ${s.maxRelativeError?.toExponential(4) ?? "—"} | ${s.worstToleranceRatio.toExponential(4)} |`), "",
  "`1` 为归一化残差、相关系数、投影子空间或屈曲因子的无量纲量；这些量的绝对误差不作力误差解释。PSD 使用独立参考峰值归一化，逐点相对误差在零谱附近不适用。", "",
  ...Object.entries(convergenceChecks).map(([key, passed]) => `- ${key}：${passed ? "通过" : "失败"}，${report.convergenceCounts[key]} 份实际记录。`), "",
  `四类加密数据见 [convergence.json](convergence.json)，${failureCases.length} 项失败分支核查记录见 [failures.json](failures.json)。逐量绝对／相对误差、近零标记和容差见 quantities.json.gz；各原始基准报告保留为 gzip JSON，解压内容的 SHA-256 见 [summary.json](summary.json)，按量纲的最差项也可在该文件定位。参考、脚本、原生程序和运行前登记见 [registration.json](registration.json)。`, "",
  "预算耗尽的静力／模态样本保留明确未收敛状态，不算收敛结果。模态／屈曲形态允许符号及幅值差异，重复根核对整个投影子空间。失败诊断及错误成功／非有限数守卫保留在原始基准中。本次不代表真实 AI、目标规模性能或干净 Windows 验收。", ""];
if (!report.passed) lines.push("失败项：", ...suites.filter((s) => !s.passed).map((s) => `- ${s.task}: ${s.failure}`), ...summary.failed.map((name) => `- ${name}`), "");
await writeFile(join(evidence, "report.md"), lines.join("\n"));
console.log(JSON.stringify({ passed: report.passed, suites: suites.length, checks: checks.length, convergenceChecks, evidence }));
if (!report.passed) process.exitCode = 1;
