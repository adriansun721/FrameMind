import { createServer } from "vite";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { numericalEvidenceDirectory } from "./numerical-evidence.mjs";

const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
const checks = [];
try {
  const { decodeAnalysisResult, decodeProject } = await server.ssrLoadModule("/src/domain/project-file.ts");
  const { createAnalysisRequest } = await server.ssrLoadModule("/src/domain/analysis-service.ts");
  const staticReport = JSON.parse(await readFile(resolve(numericalEvidenceDirectory("T2-22"), "native-verification.json"), "utf8"));
  const results = [["static", staticReport.results[0]]];
  for (const [method, task, file] of [["modal", "T2-27", "cantilever.framemind"], ["buckling", "T2-30", "nonzero-fixed.framemind"],
    ["second-order", "T2-31", "baseline.framemind"], ["random", "T2-33", "random.framemind"]]) {
    results.push([method, decodeProject(await readFile(resolve(numericalEvidenceDirectory(task), file), "utf8")).latestAnalysis]);
  }
  const payload = {
    static: (r, value) => { r.nodes[1].displacement.x = value; },
    modal: (r, value) => { r.modal.modes[0].frequencyHz = value; },
    buckling: (r, value) => { r.buckling.modes[0].factor = value; },
    "second-order": (r, value) => { r.nodes[1].displacement.y = value; },
    random: (r, value) => { r.random.rms = value; },
  };
  for (const [method, result] of results) {
    decodeAnalysisResult(result);
    for (const [label, value] of [["nan", NaN], ["infinity", Infinity], ["json-null", null]]) {
      const forged = structuredClone(result); payload[method](forged, value);
      let error;
      try { decodeAnalysisResult(forged); } catch (caught) { error = String(caught); }
      checks.push({ method, name: `nonfinite-result-${label}`, passed: !!error, error });
    }
    const incomplete = structuredClone(result);
    // A success status alone is insufficient; every method needs its actual record.
    if (method === "static") incomplete.members = [];
    else if (method === "modal") incomplete.modal.modes = [];
    else if (method === "buckling") incomplete.buckling.modes = [];
    else if (method === "second-order") incomplete.secondOrder.runs = [];
    else incomplete.random.points = [];
    let error;
    try { decodeAnalysisResult(incomplete); } catch (caught) { error = String(caught); }
    checks.push({ method, name: "incomplete-marked-success", passed: !!error, error });
    for (const [label, modulus] of [["null-input", null], ["overflow-input", 1e308]]) {
      const request = structuredClone(createAnalysisRequest(result.input));
      request.input.materials[0].elasticModulusGPa = modulus;
      const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
      if (child.error) throw child.error;
      const messages = child.stdout.trim().split("\n").map(JSON.parse), terminal = messages.at(-1);
      const passed = child.status === 1 && terminal.kind === "error" && !!terminal.error?.diagnostics?.length && messages.every((m) => m.kind !== "result");
      checks.push({ method, name: label, passed, exitCode: child.status, diagnostics: terminal.error?.diagnostics, publishedResult: messages.some((m) => m.kind === "result") });
    }
  }
  const directory = numericalEvidenceDirectory("T2-40-guards");
  await mkdir(directory, { recursive: true });
  const report = { passed: checks.every((c) => c.passed), checks };
  await writeFile(resolve(directory, "numerics.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: checks.length }));
  assert.equal(report.passed, true, JSON.stringify(checks.filter((c) => !c.passed)));
} finally { await server.close(); }
