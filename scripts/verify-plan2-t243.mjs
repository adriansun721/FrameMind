import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
process.chdir(root);
const evidence = resolve("docs/evidence/plan2/T2-43");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const sha256 = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");

const one = await readJson(join(evidence, "mainline-one-replay", "mainline-one-0.json"));
const themes = {};
for (const theme of ["dark", "light"]) themes[theme] = await readJson(join(evidence, "mainline-two-replay", `replay-${theme}`, "validation.json"));

const checks = [
  { name: "mainlineOne", passed: one.status === "passed" && Object.values(one.checks ?? {}).every(Boolean) },
  ...Object.entries(themes).map(([theme, report]) => ({
    name: `mainlineTwo/${theme}`,
    passed: report.outcome === "passed"
      && report.verified?.wordPdfExport === true
      && report.verified?.saveReopen === true
      && report.verified?.actualResultReferences === true
      && String(report.firstUse).includes("Pending real participant"),
  })),
];
const constituent = ["T2-20", "T2-21", "T2-22", "T2-24", "T2-25", "T2-26", "T2-27", "T2-28", "T2-29", "T2-30", "T2-31", "T2-32", "T2-33", "T2-34", "T2-35", "T2-36"];
for (const task of constituent) {
  const path = join("docs/evidence/plan2", task, "desktop.json");
  try {
    const report = await readJson(path);
    checks.push({ name: `constituent/${task}`, passed: report.passed === true, evidence: path });
  } catch {
    checks.push({ name: `constituent/${task}`, passed: false, evidence: path, missing: true });
  }
}

const humanAcceptance = {
  required: true,
  status: "pending",
  reason: "PLAN2.0 explicitly requires a real participant; automated Electron replay is not a substitute.",
};
const dependency = {
  task: "T2-42",
  status: "partial",
  reason: "Target-scale performance acceptance remains failed in the registered v2 measurements.",
  evidence: "docs/evidence/plan2/T2-42/acceptance.md",
};
const report = {
  task: "T2-43",
  generatedAt: new Date().toISOString(),
  automationPassed: checks.slice(0, 3).every((check) => check.passed),
  passed: false,
  checks,
  humanAcceptance,
  dependency,
  sources: {
    mainlineOne: await sha256(join(evidence, "mainline-one-replay", "mainline-one-0.json")),
    mainlineDark: await sha256(join(evidence, "mainline-two-replay", "replay-dark", "validation.json")),
    mainlineLight: await sha256(join(evidence, "mainline-two-replay", "replay-light", "validation.json")),
  },
};
// The public task result stays false until the required human record and the
// T2-42 dependency are accepted. `automationPassed` is the machine-only gate.
report.passed = report.automationPassed && humanAcceptance.status === "accepted" && dependency.status === "passed";
await writeFile(join(evidence, "automation-summary.json"), `${JSON.stringify(report, null, 2)}\n`);
const lines = [
  "# T2-43 自动化桌面验收汇总", "", `自动化结果：${report.automationPassed ? "通过" : "失败"}。`, "",
  "主线一使用实际 Electron、固定工具回放、隔离诊断副本、一次确认、重启恢复和本地求解；主线二使用实际 Electron、本地 Worker、结果引用、前后对比、Word/PDF 导出、保存重开，并分别覆盖深色与浅色主题。", "",
  "| 检查 | 结果 |", "| --- | --- |", ...checks.map((check) => `| ${check.name} | ${check.passed ? "通过" : "失败"} |`), "",
  "自动化证据不等于真人试用。真人参与者、操作记录、干预和问题必须由操作者补入 `human-check.md`；在此之前 T2-43 不登记为全部完成。", "",
  "T2-42 的目标规模性能验收目前仍为部分完成，相关限制见 [T2-42 验收](../T2-42/acceptance.md)。本汇总不会用小模型桌面回放替代目标规模性能门槛。", "",
];
await writeFile(join(evidence, "automation-summary.md"), `${lines.join("\n").trimEnd()}\n`);
console.log(JSON.stringify({ passed: report.passed, automationPassed: report.automationPassed, checks: checks.length, evidence }));
if (!report.automationPassed) process.exitCode = 1;
