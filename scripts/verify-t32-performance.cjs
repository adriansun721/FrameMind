const { _electron: electron, expect } = require("@playwright/test");
const { mkdtemp, mkdir, readFile, readdir, writeFile, rm } = require("node:fs/promises");
const os = require("node:os");
const { join, resolve, sep } = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");

async function run() {
  const repetitions = Number(process.env.T32_REPETITIONS || 3);
  const label = process.env.T32_LABEL || "final";
  const directory = await mkdtemp(join(os.tmpdir(), "framemind-t32-"));
  const { createServer } = await import("vite");
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
  const report = { generatedAt: new Date().toISOString(), label, repetitions, criteria: "docs/decisions/0033-t32-performance-contract.md", commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), environment: { platform: process.platform, release: os.release(), cpu: os.cpus()[0].model, logicalProcessors: os.cpus().length, totalMemory: os.totalmem(), node: process.version, electron: require("electron/package.json").version }, builds: {}, models: [], runs: [], passed: false };
  for (const file of ["dist/index.html", "dist-electron/main.js", "dist-electron/report-pdf.js", "src/domain/analysis.ts", "scripts/verify-t32-performance.cjs", "docs/decisions/0033-t32-performance-contract.md", ...(await readdir("dist/assets")).map(name => `dist/assets/${name}`)]) report.builds[file] = createHash("sha256").update(await readFile(file)).digest("hex");
  await mkdir("docs/evidence", { recursive: true });
  const save = () => writeFile(`docs/evidence/T32-${label}-results.json`, JSON.stringify(report, null, 2) + "\n");
  try {
    const { PERFORMANCE_MODELS, createPerformanceModel } = await server.ssrLoadModule("/src/validation/performance-models.ts");
    const { solveFrame } = await server.ssrLoadModule("/src/domain/analysis.ts");
    const { attachAnalysisResult, selectLoadCase } = await server.ssrLoadModule("/src/domain/project.ts");
    const { encodeProject } = await server.ssrLoadModule("/src/domain/project-file.ts");
    const models = process.env.T32_MODEL ? PERFORMANCE_MODELS.filter(spec => spec.id === process.env.T32_MODEL) : PERFORMANCE_MODELS;
    for (const spec of models) {
      console.log(`Preparing ${spec.id}: ${spec.members} members`);
      let project = createPerformanceModel(spec);
      const started = performance.now();
      project = attachAnalysisResult(project, solveFrame(selectLoadCase(project, "LC1")));
      project = attachAnalysisResult(project, solveFrame(project));
      const content = encodeProject(project);
      const projectPath = join(directory, `${spec.id}.framemind`);
      await writeFile(projectPath, content);
      await writeFile(`docs/evidence/T32-${spec.id}.framemind`, content);
      report.models.push({ id: spec.id, members: project.members.length, nodes: project.nodes.length, supports: project.supports.length, nodalLoads: project.nodalLoads.length, uniformLoads: project.uniformLoads.length, dofs: project.nodes.length * 6, results: project.analysisResults.length, inputSha256: createHash("sha256").update(JSON.stringify(project.analysisResults.at(-1).input)).digest("hex"), bytes: Buffer.byteLength(content), preparationMs: performance.now() - started });
      for (let repeat = 1; repeat <= repetitions; repeat++) {
        console.log(`Measuring ${spec.id} repetition ${repeat}`);
        const entry = { model: spec.id, repeat, metrics: {}, failures: [], memorySamples: [] }; report.runs.push(entry);
        const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: join(directory, `${spec.id}-${repeat}`), FRAMEMIND_E2E_PROJECT_PATH: projectPath, FRAMEMIND_E2E_REPORT_PATH: resolve(`docs/evidence/T32-${spec.id}.docx`), FRAMEMIND_E2E_REPORT_PDF_PATH: resolve(`docs/evidence/T32-${spec.id}.pdf`) }; delete env.ELECTRON_RUN_AS_NODE;
        const app = await electron.launch({ args: ["."], env }); const page = await app.firstWindow();
        const button = (name) => page.locator(`button[aria-label=${JSON.stringify(name)}]`);
        const status = page.locator('footer[role="status"]');
        let sampling = false;
        const sample = setInterval(async () => {
          if (sampling) return; sampling = true;
          try { entry.memorySamples.push({ atMs: performance.now(), processes: await app.evaluate(({ app }) => app.getAppMetrics().map(item => ({ type: item.type, pid: item.pid, workingSetBytes: item.memory.workingSetSize * 1024 }))) }); } catch {} finally { sampling = false; }
        }, 100);
        try {
          report.environment.chromium = await app.evaluate(() => process.versions.chrome);
          await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(1440, 900); window.webContents.setBackgroundThrottling(false); window.focus(); });
          await button("文件").waitFor();
          await page.evaluate(() => {
            window.__t32 = { gaps: [], frames: [], last: performance.now(), frame: performance.now(), dragging: false };
            document.querySelector('.viewport canvas').addEventListener('pointerdown', () => { window.__t32.dragging = true; window.__t32.frame = performance.now(); });
            document.addEventListener('pointerup', () => { window.__t32.dragging = false; });
            setInterval(() => { const now = performance.now(); window.__t32.gaps.push(now - window.__t32.last); window.__t32.last = now; }, 20);
            const tick = (now) => { if (window.__t32.dragging) window.__t32.frames.push(now - window.__t32.frame); window.__t32.frame = now; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
          });
          const measure = async (name, limit, action) => {
            await page.evaluate(() => { window.__t32.gaps = []; window.__t32.frames = []; window.__t32.last = performance.now(); window.__t32.frame = performance.now(); });
            const before = performance.now(); await action();
            await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
            const ms = performance.now() - before;
            const probe = await page.evaluate(() => ({ gaps: window.__t32.gaps, frames: window.__t32.frames }));
            entry.metrics[name] = { ms, limitMs: limit, maxCallbackGapMs: Math.max(0, ...probe.gaps), frameP95Ms: probe.frames.sort((a,b) => a-b)[Math.floor(probe.frames.length * .95)] || 0, maxFrameMs: Math.max(0, ...probe.frames) };
            if (ms > limit) entry.failures.push(`${name}: ${ms.toFixed(1)} > ${limit} ms`);
            if (["solve", "process", "word", "pdf"].includes(name) && entry.metrics[name].maxCallbackGapMs > 500) entry.failures.push(`${name}: callback gap ${entry.metrics[name].maxCallbackGapMs.toFixed(1)} > 500 ms`);
            console.log(`${spec.id}/${repeat} ${name}: ${ms.toFixed(0)} ms, gap ${entry.metrics[name].maxCallbackGapMs.toFixed(0)}`);
          };
          await measure("open", 5000, async () => { await button("文件").click(); await page.getByRole("menuitem", { name: /打开项目/ }).click(); await expect(page.locator('input[aria-label="选择杆件 M1"] + button')).toBeVisible({ timeout: 45000 }); await expect(page.getByTestId('viewport-member-count')).toHaveText(`${spec.members} 根杆件`); });
          const rotate = async () => {
            const canvas = page.locator(".viewport canvas"); const b = await canvas.boundingBox(); const before = await page.locator('[aria-label="三维模型视图"]').getAttribute("data-camera-state");
            await page.mouse.move(b.x+b.width*.55, b.y+b.height*.35); await page.mouse.down();
            for (let i=1;i<=10;i++) { await page.mouse.move(b.x+b.width*.55+i*6, b.y+b.height*.35+i*2); await new Promise(done => setTimeout(done, 10)); }
            await page.mouse.up(); await expect(page.locator('[aria-label="三维模型视图"]')).not.toHaveAttribute("data-camera-state", before);
          };
          await measure("rotate", 1000, rotate);
          if (entry.metrics.rotate.frameP95Ms > 100 || entry.metrics.rotate.maxFrameMs > 500) entry.failures.push("rotate: frame interval exceeds contract");
          await measure("select", 1000, async () => { await page.locator('input[aria-label="选择杆件 M1"] + button').click(); await expect(page.locator('input[aria-label="截面转角（°）"]')).toBeVisible(); });
          for (let n=1;n<=20;n++) await page.locator(`input[aria-label="选择杆件 M${n}"]`).check();
          await page.getByRole("group", { name: "选中杆件操作" }).getByRole("button", { name: "批量修改", exact: true }).click();
          await page.getByLabel("统一截面转角").fill("5");
          await measure("batch", 1000, async () => { await page.locator('.dialog-actions button[type="submit"]').click(); await expect(status).toContainText("已批量修改 20 个杆件"); });
          await button("撤销").click();
          await measure("cancel", 500, async () => {
            // Observe the real task's cancel control as soon as React commits it,
            // before a short calculation can complete between automation round trips.
            await page.evaluate(() => new Promise((done, reject) => {
              const timer = setTimeout(() => { observer.disconnect(); reject(new Error("Cancel control did not appear")); }, 5000);
              const observer = new MutationObserver(() => {
                const button = document.querySelector('button[aria-label="取消计算"]');
                if (button) { observer.disconnect(); clearTimeout(timer); button.click(); done(); }
              });
              observer.observe(document.body, { childList: true, subtree: true, attributes: true });
              document.querySelector('button[aria-label="运行分析"]').click();
            }));
            await expect(status).toContainText("分析已取消");
          });
          await expect(button("计算结果")).toContainText("2");
          await measure("solve", spec.solveLimitMs, async () => { await button("运行分析").click(); await rotate(); await expect(button("取消计算")).toHaveCount(0, { timeout: 45000 }); await expect(status).toContainText(/分析完成|计算完成/); });
          await expect(button("计算结果")).toContainText("3");
          await button("查看分析结果").click();
          await measure("deformation", 1000, async () => { await page.locator(".result-view-tabs button").filter({ hasText: "变形图" }).click(); await expect(page.locator('[aria-label="视图结果图例"]')).toContainText("变形"); });
          await measure("forces", 1000, async () => { await page.locator(".result-view-tabs button").filter({ hasText: "内力图" }).click(); await expect(page.locator('[aria-label="视图结果图例"]')).toContainText("N"); });
          await measure("sourceCase", 1000, async () => { await button("查看 LC1 结果").click(); await expect(page.locator("#property-panel")).toContainText("LC1"); });
          await measure("sourceCombination", 1000, async () => { await button("查看 CB1 结果").click(); await expect(page.locator("#property-panel")).toContainText("CB1"); });
          await measure("process", 1000, async () => { const processPanel = page.locator('[aria-label="整体求解过程"]'); await processPanel.locator("summary").filter({ hasText: "节点自由度与约束状态" }).click(); await processPanel.locator("summary").filter({ hasText: "单元组装条目" }).click(); await processPanel.locator("summary").filter({ hasText: /^M1 ·/ }).click(); await expect(processPanel.getByRole("table", { name: "M1整体自由度映射", exact: true })).toBeVisible(); });
          await page.locator(".tree-item.resource").filter({ hasText: "工程计算书" }).click(); const dialog = page.getByRole("dialog", { name: "工程计算书", exact: true });
          for (const name of [/杆件过程（/, "整体自由度映射", "整体约束处理与荷载向量"]) await dialog.getByRole("checkbox", { name, exact: typeof name === "string" }).check();
          await dialog.getByRole("checkbox", { name: /附录杆件 M1 ·/ }).check();
          await measure("word", 60000, async () => { await dialog.locator(".dialog-actions button").nth(1).click(); await expect(status).toContainText("已导出 Word 计算书", { timeout: 90000 }); });
          await measure("pdf", 60000, async () => { await dialog.locator(".dialog-actions button").nth(2).click(); await expect(status).toContainText("已导出 PDF 计算书", { timeout: 90000 }); });
          entry.outputBytes = { word: (await readFile(env.FRAMEMIND_E2E_REPORT_PATH)).length, pdf: (await readFile(env.FRAMEMIND_E2E_REPORT_PDF_PATH)).length };
          if (repeat === repetitions) { await dialog.getByRole("button", { name: "关闭", exact: true }).last().click(); await page.screenshot({ path: `docs/evidence/T32-${spec.id}-results.png` }); }
        } catch (error) { entry.failures.push(String(error)); await page.screenshot({ path: `docs/evidence/T32-${label}-${spec.id}-${repeat}-failure.png` }).catch(() => {}); }
        finally { clearInterval(sample); entry.peakWorkingSetBytes = Math.max(0, ...entry.memorySamples.map(item => item.processes.reduce((sum,p) => sum+p.workingSetBytes, 0))); if (entry.peakWorkingSetBytes > 2*1024**3) entry.failures.push("memory > 2 GiB"); await app.close(); await save(); }
      }
    }
    report.passed = report.runs.length === models.length * repetitions && report.runs.every(item => item.failures.length === 0);
    report.measuredModels = models.map(spec => spec.id);
    report.summary = Object.fromEntries(models.map(spec => {
      const runs = report.runs.filter(item => item.model === spec.id);
      return [spec.id, Object.fromEntries(Object.keys(runs[0]?.metrics ?? {}).map(metric => { const values = runs.map(item => item.metrics[metric]?.ms).filter(Number.isFinite).sort((a,b) => a-b); return [metric, { samples: values.length, medianMs: values[Math.floor(values.length/2)], maxMs: Math.max(...values) }]; }))];
    }));
    await save(); console.log(JSON.stringify({ passed: report.passed, failures: report.runs.map(item => ({ model: item.model, repeat: item.repeat, failures: item.failures })) }, null, 2));
    if (!report.passed) process.exitCode = 1;
  } finally { await server.close(); if (!resolve(directory).startsWith(resolve(os.tmpdir())+sep)) throw new Error("Invalid cleanup path"); await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
