import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { evidenceRoot } from "./plan2-performance-evidence.mjs";

const latest = JSON.parse(await readFile(join(evidenceRoot, "latest.json"), "utf8"));
const report = JSON.parse(await readFile(join(latest.directory, "results.json"), "utf8"));
const registration = JSON.parse(await readFile(join(evidenceRoot, report.registration.path), "utf8"));
const fmt = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? `${sorted.length} / ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} / ${sorted.at(-1).toFixed(1)}` : "未测量";
};
const lines = ["# T2-42 正式测量汇总", "", `登记：${registration.registeredAt}；运行：${report.generatedAt}（ISO UTC；用户时区 Asia/Taipei）。`, "",
  `整体性能验收：**${report.passed ? "通过" : "未通过"}**。源码／构建运行前后匹配：${report.finalHashesMatch}。`, "",
  `环境：${registration.environment.cpu}，${registration.environment.logicalProcessors} 逻辑处理器，${(registration.environment.totalMemoryBytes / 1024 ** 3).toFixed(1)} GiB RAM，${registration.environment.release}。GPU/驱动、Windows 版本、电源方案和全部源文件／构建哈希见 [正式登记](${report.registration.path})。`, "",
  "下表格式为 `样本数 / 中位数 / 最大值`。耗时单位 ms；每个模型／显示模式固定三次，不移除慢样本。未执行的求解不算零耗时。", "",
  "| 模型 | 工程节点 / 杆件 | 初始自由度 / 约束 / 方程 |", "| --- | --- | --- |",
  ...registration.models.map((m) => `| ${m.id} | ${m.nodes} / ${m.members} | ${m.totalDofs} / ${m.constrainedDofs} / ${m.initialEquations} |`), "",
  "| 模型 | 分析 | 完成 / 计划 | 端到端原生请求耗时 | 原生峰值提交内存 MiB | 状态／限制 |", "| --- | --- | --- | --- | --- | --- |",
];
if (report.runnerError) lines.push("", `测量执行错误：${report.runnerError}`, "");
for (const m of registration.models) for (const method of registration.protocol.methods) {
  const runs = report.native.filter((r) => r.model === m.id && r.method === method);
  lines.push(`| ${m.id} | ${method} | ${runs.filter((r) => r.status === "complete").length} / ${registration.protocol.repetitions} | ${fmt(runs.map((r) => r.metrics[method]?.ms))} | ${fmt(runs.map((r) => r.resources?.peakCommittedBytes ? r.resources.peakCommittedBytes / 1024 ** 2 : NaN))} | ${[...new Set(runs.flatMap((r) => [r.status, ...(r.meshConvergence ? [r.meshConvergence.status + "/" + r.meshConvergence.reason] : [])]))].join("；")} |`);
}
lines.push("", "随机依赖失败耗时只表示依赖检查／失败反馈成本；随机真正求解、模态与频点数、PSD/RMS 及导出没有证据时单独保留待验收。静力 `complete` 表示实际保留初始网格结果，若 `budget-exhausted` 不计为收敛通过。", "",
  "| 模型 / 模式 | 打开 | 旋转 | 选取 | 编辑 | 静力桌面 | 取消实际响应 | 保存 | 重开 | 结果显示 | Word | PDF | Electron 工作集 MiB |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
);
for (const m of registration.models) for (const mode of registration.protocol.displayModes) {
  const runs = report.desktop.filter((r) => r.model === m.id && r.mode === mode);
  const cells = ["open", "rotate", "select", "edit", "static", "cancel", "save", "reopen", "result", "word", "pdf"].map((metric) => fmt(runs.map((r) => r.metrics[metric]?.ms)));
  lines.push(`| ${m.id} / ${mode} | ${cells.join(" | ")} | ${fmt(runs.map((r) => r.peakAppWorkingSetBytes / 1024 ** 2))} |`);
}
lines.push("", "Electron 工作集是每 100 ms 采样的各 Electron 进程工作集之和的最大观测值，可能重复计入共享页，不能视作精确瞬时全应用峰值；原生子进程单独使用 Windows Job 的 peak committed bytes。没有强制 GC 或关闭正常快照／过程功能。取消计时从真实点击到界面确认和原生子进程退出的较晚者；自动化耗时另列。", "", "## 未通过／缺失记录", "");
for (const run of report.native) if (run.method === "resourceFailure" ? !run.passed : run.failures.length) {
  lines.push(`- ${run.model}/${run.repeat}/${run.method}：${(run.failures ?? ["Resource-failure guard did not pass"]).join("；").replaceAll("\n", " ")}`);
}
for (const run of report.desktop) if (run.failures.length) lines.push(`- ${run.model}/${run.mode}/${run.repeat}：${run.failures.join("；").replaceAll("\n", " ")}`);
lines.push("", `原始结果与各输入／诊断／桌面截图在 [本轮目录](${relative(evidenceRoot, latest.directory).replaceAll("\\", "/")}/results.json)。压缩项目／请求保留完整 JSON，可通过 gzip 解压复核。`, "");
await writeFile(join(evidenceRoot, "measurements.md"), lines.join("\n"));
console.log(`T2-42 summary generated; full acceptance passed=${report.passed}`);
