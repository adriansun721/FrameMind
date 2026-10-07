import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";

export const evidenceRoot = resolve("docs/evidence/plan2/T2-42");
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const protocol = JSON.parse(await readFile("src/validation/t242-protocol.json", "utf8"));

export function environment() {
  return {
    platform: process.platform, arch: process.arch, release: os.release(),
    cpu: os.cpus()[0].model, logicalProcessors: os.cpus().length, totalMemoryBytes: os.totalmem(),
    node: process.version,
    windows: execFileSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber | ConvertTo-Json -Compress"], { encoding: "utf8", windowsHide: true }).trim(),
    gpu: execFileSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion | ConvertTo-Json -Compress"], { encoding: "utf8", windowsHide: true }).trim(),
    powerPlan: execFileSync("powercfg", ["/getactivescheme"], { encoding: "utf8", windowsHide: true }).trim(),
    nativeMemoryMiB: process.env.FRAMEMIND_NATIVE_MEMORY_MIB ?? "512",
  };
}

/** Include dirty source, scripts and exact built bytes, independently of HEAD. */
export async function buildHashes() {
  const files = [];
  const walk = async (directory) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${item.name}`;
      if (item.isDirectory()) await walk(path); else files.push(path);
    }
  };
  for (const directory of ["src", "electron", "native/src", "dist", "dist-electron"]) await walk(directory);
  files.push("native/bin/framemind-core.exe", "package.json", "package-lock.json", "scripts/verify-plan2-t242.mjs", "scripts/plan2-performance-evidence.mjs", "scripts/plan2-performance-desktop.mjs", "scripts/summarize-plan2-t242.mjs");
  return Object.fromEntries(await Promise.all(files.sort().map(async (file) => [file, hash(await readFile(file))])));
}

export function recordMetric(metrics, failures, name, ms, limitMs, probe) {
  const metric = { ms, limitMs, passed: Number.isFinite(ms) && ms <= limitMs, ...probe };
  if (!metric.passed) failures.push(`${name}: ${ms.toFixed(1)} ms > ${limitMs} ms`);
  if (probe && probe.maxCallbackGapMs > protocol.maxCallbackGapMs) {
    metric.passed = false;
    failures.push(`${name}: callback gap ${probe.maxCallbackGapMs.toFixed(1)} ms`);
  }
  metrics[name] = metric;
  return metric;
}
