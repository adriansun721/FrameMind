// Development probes are never substituted for preregistered acceptance runs.
import { createServer } from "vite";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
try {
  const { PLAN2_PERFORMANCE_MODELS, createPlan2PerformanceModel } = await server.ssrLoadModule("/src/validation/plan2-performance-models.ts");
  const { selectAnalysisCase } = await server.ssrLoadModule("/src/domain/project.ts");
  const { captureAnalysisInput } = await server.ssrLoadModule("/src/domain/analysis.ts");
  const { createAnalysisRequest } = await server.ssrLoadModule("/src/domain/analysis-service.ts");
  const { prepareAnalysisTaskInput } = await server.ssrLoadModule("/src/workspace/analysis-task.ts");
  const { decodeAnalysisResult } = await server.ssrLoadModule("/src/domain/project-file.ts");
  const project = createPlan2PerformanceModel(PLAN2_PERFORMANCE_MODELS.find((m) => m.id === (process.argv[3] ?? "target")));
  for (const method of (process.argv[2] ?? "modal").split(",")) {
    const definition = project.analysisCases.find((c) => c.method === method);
    const started = performance.now();
    const request = createAnalysisRequest(prepareAnalysisTaskInput(captureAnalysisInput(selectAnalysisCase(project, definition.id))));
    const bytes = JSON.stringify(request);
    const child = spawn("native/bin/framemind-core.exe", [], { stdio: "pipe", windowsHide: true });
    const chunks = []; let stderr = "";
    const timer = setTimeout(() => child.kill(), 120000);
    child.stdout.on("data", (data) => chunks.push(data));
    child.stderr.on("data", (data) => { stderr += data; });
    child.stdin.on("error", () => {});
    const exited = new Promise((resolve, reject) => { child.on("close", resolve); child.on("error", reject); });
    child.stdin.end(bytes);
    const exitCode = await exited; clearTimeout(timer);
    const nativeMs = performance.now() - started;
    const output = Buffer.concat(chunks).toString();
    const messages = output.trim().split("\n").filter(Boolean).map(JSON.parse), terminal = messages.at(-1);
    const summary = { formalAcceptance: false, model: process.argv[3] ?? "target", method, inputBytes: bytes.length, exitCode, nativeMs, outputBytes: Buffer.byteLength(output), stderr, error: terminal?.error };
    if (terminal?.kind === "result") {
      const before = performance.now();
      try {\n        await writeFile("pilot-raw.json.gz", gzipSync(JSON.stringify(terminal.result)));\n        const decoded = decodeAnalysisResult(terminal.result);
        summary.decodeMs = performance.now() - before;
        summary.counts = decoded.modal?.counts ?? decoded.buckling?.counts ?? decoded.discretization?.counts;
        summary.convergence = decoded.modal?.convergence ?? decoded.buckling?.convergence ?? decoded.discretization?.status;
        summary.modes = (decoded.modal?.modes ?? decoded.buckling?.modes)?.map((m) => ({ value: m.frequencyHz ?? m.factor, residual: m.residual }));
        if (process.env.T242_PILOT_RESULT) await writeFile(process.env.T242_PILOT_RESULT, gzipSync(JSON.stringify(decoded)));
      } catch (error) { summary.decodeError = String(error); }
    }
    console.log(JSON.stringify(summary, null, 2));
  }
} finally { await server.close(); }

