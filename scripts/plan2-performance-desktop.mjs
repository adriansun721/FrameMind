import { _electron as electron, expect } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { protocol, hash, recordMetric } from "./plan2-performance-evidence.mjs";
import { gzipSync } from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } };
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function bounded(operation, ms, label) {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })]); }
  finally { clearTimeout(timer); }
}

async function terminateTestTree(mainPid, nativePids) {
  if (alive(mainPid)) {
    if (process.platform === "win32") {
      try { await runFile("taskkill.exe", ["/PID", String(mainPid), "/T", "/F"], { windowsHide: true, timeout: 10000 }); }
      catch (error) { if (alive(mainPid)) throw error; } // It may exit naturally between probe and taskkill.
    }
    else process.kill(mainPid, "SIGKILL");
  }
  const pids = [mainPid, ...nativePids];
  const deadline = Date.now() + 10000;
  while (pids.some(alive) && Date.now() < deadline) await delay(100);
  const survivingPids = pids.filter(alive);
  if (survivingPids.length) throw new Error(`Test process isolation failed; surviving PIDs: ${survivingPids.join(",")}`);
  return { checkedAt: new Date().toISOString(), mainPid, nativePids, survivingPids };
}

/** Real production Electron/IPC/core. Instrumentation observes spawn/exit; it never substitutes a solver. */
export async function measureDesktop({ model, repeat, mode, runDirectory, modeling }) {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t242-"));
  const prefix = `${model.spec.id}-${mode}-${repeat}`;
  const path = join(directory, "target.framemind");
  const output = join(runDirectory, prefix); await mkdir(output);
  await writeFile(path, model.content);
  const entry = { model: model.spec.id, repeat, mode, inputSha256: model.sha256,
    memoryDefinition: "Maximum of 100 ms samples of summed Electron per-process working sets (shared pages may be counted more than once); native child commitment measured separately. Samples are a lower bound on transient aggregate peaks.",
    coverage: { randomDisplayAndExport: false },
    metrics: structuredClone(modeling.metrics), failures: [...modeling.failures], memorySamples: [], nativeProcesses: [], rendererErrors: [] };
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path,
    FRAMEMIND_E2E_REPORT_PATH: join(output, "static.docx"), FRAMEMIND_E2E_REPORT_PDF_PATH: join(output, "static.pdf") };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  let app, page, sampler, watchdog, sampling = false, mainPid, termination, isolationError;
  try {
    app = await electron.launch({ args: ["."], env }); page = await app.firstWindow();
    // Windows app.process() is Playwright's shell wrapper, not Electron's main process.
    mainPid = await app.evaluate(() => process.pid);
    entry.mainPid = mainPid;
    let rejectDeadline;
    const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
    watchdog = setTimeout(() => {
      entry.failures.push("Desktop watchdog expired; remaining measurements missing, acceptance failed");
      termination = terminateTestTree(mainPid, entry.nativeProcesses.filter((p) => p.closedAt === null).map((p) => p.pid))
        .then((record) => { entry.processExit = record; })
        .catch((error) => { isolationError = error; entry.failures.push(String(error)); });
      rejectDeadline(new Error("Desktop round deadline reached"));
    }, protocol.desktopWatchdogMs);
    await Promise.race([deadline, (async () => {
    page.on("dialog", (dialog) => void dialog.accept());
    page.on("pageerror", (error) => entry.rendererErrors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(1440, 900); window.webContents.setBackgroundThrottling(false); window.focus(); });
    const button = (name) => page.getByRole("button", { name, exact: true });
    const skip = button("暂不恢复，进入工作台");
    await expect(skip.or(button("文件"))).toBeVisible(); if (await skip.isVisible()) await skip.click();
    await app.evaluate(() => {
      const require = process.getBuiltinModule("module").createRequire(process.cwd() + "/package.json");
      const cp = require("node:child_process"), original = cp.spawn;
      globalThis.__t242 = [];
      cp.spawn = function(file, ...args) {
        const child = original.call(this, file, ...args);
        if (String(file).endsWith("framemind-core.exe")) {
          const record = { pid: child.pid, startedAt: Date.now(), closedAt: null, stages: [], resources: null };
          globalThis.__t242.push(record); let pending = "", stderr = "";
          child.stdout.on("data", (data) => {
            pending += data.toString(); let end;
            while ((end = pending.indexOf("\n")) >= 0) {
              const line = pending.slice(0, end); pending = pending.slice(end + 1);
              try {
                if (line.length > 8192) { if (line.slice(0, 256).includes('"kind":"result"')) record.terminalKind = "result"; }
                else { const message = JSON.parse(line); if (message.kind === "phase") record.stages.push(message.record); else record.terminalKind = message.kind; }
              } catch {}
            }
          });
          child.stderr.on("data", (data) => { stderr += data.toString(); });
          child.on("close", (code, signal) => {
            record.closedAt = Date.now(); record.exitCode = code; record.signal = signal;
            for (const line of stderr.trim().split("\n")) { try { const message = JSON.parse(line); if (message.kind === "native-resources") record.resources = message; } catch {} }
          });
        }
        return child;
      };
    });
    sampler = setInterval(async () => {
      if (sampling) return; sampling = true;
      try {
        const snapshot = await app.evaluate(({ app }) => ({ processes: app.getAppMetrics().map((p) => ({ pid: p.pid, type: p.type, workingSetBytes: p.memory.workingSetSize * 1024 })), nativeProcesses: globalThis.__t242 }));
        entry.nativeProcesses = snapshot.nativeProcesses;
        entry.memorySamples.push({ at: Date.now(), processes: snapshot.processes });
      } catch {} finally { sampling = false; }
    }, 100);
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
      window.__t242 = { last: performance.now(), gaps: [], frames: [], dragging: false, frame: performance.now() };
      document.addEventListener("pointerdown", (event) => { if (event.target.tagName === "CANVAS") { window.__t242.dragging = true; window.__t242.frame = performance.now(); } });
      document.addEventListener("pointerup", () => { window.__t242.dragging = false; });
      setInterval(() => { const now = performance.now(); window.__t242.gaps.push(now - window.__t242.last); window.__t242.last = now; }, 20);
      const tick = (now) => { if (window.__t242.dragging) window.__t242.frames.push(now - window.__t242.frame); window.__t242.frame = now; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    });
    const measure = async (name, action, limit = protocol.limitsMs[name], observedDuration) => {
      await page.evaluate(() => { const probe = window.__t242; probe.gaps = []; probe.frames = []; probe.last = performance.now(); probe.frame = performance.now(); });
      const started = performance.now(); let failure;
      try { await action(); } catch (error) { failure = String(error); entry.failures.push(`${name}: ${failure}`); }
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const automationMs = performance.now() - started;
      const ms = observedDuration ? await observedDuration() : automationMs;
      const probe = await page.evaluate(() => {
        const p = window.__t242, frames = p.frames.sort((a, b) => a - b);
        return { maxCallbackGapMs: Math.max(0, ...p.gaps), frameSamples: frames.length,
          frameP95Ms: frames[Math.floor(frames.length * .95)] ?? 0, maxFrameMs: Math.max(0, ...frames) };
      });
      const metric = recordMetric(entry.metrics, entry.failures, name, ms, limit, probe);
      metric.actionError = failure ?? null;
      if (observedDuration) metric.automationMs = automationMs;
      if (failure) metric.passed = false;
      console.log(`${prefix}/${name}: ${ms.toFixed(0)} ms, gap ${probe.maxCallbackGapMs.toFixed(0)} ms`);
      return metric;
    };
    const status = page.locator('footer[role="status"]'), viewport = page.getByLabel("三维模型视图", { exact: true });
    const controls = page.getByRole("group", { name: "构件显示" });
    await expect(controls.getByRole("button", { name: "实体", exact: true })).toHaveAttribute("aria-pressed", "true");
    if (mode === "line") await controls.getByRole("button", { name: "分析线", exact: true }).click();
    const open = async () => {
      await button("文件").click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
      await expect(status).toContainText("已打开", { timeout: 45000 });
      await expect(page.getByTestId("viewport-member-count")).toHaveText(`${model.spec.members} 根杆件`);
      await expect(page.getByTestId("viewport-node-count")).toHaveText(`${model.spec.nodes} 个节点`);
      await expect(controls.getByRole("button", { name: mode === "solid" ? "实体" : "分析线", exact: true })).toHaveAttribute("aria-pressed", "true");
    };
    await measure("open", open);
    const rotate = async () => {
      const canvas = viewport.locator("canvas"), box = await canvas.boundingBox(), before = await viewport.getAttribute("data-camera-state");
      await page.mouse.move(box.x + box.width * .6, box.y + box.height * .3); await page.mouse.down();
      for (let i = 1; i <= 12; i++) { await page.mouse.move(box.x + box.width * .6 + i * 5, box.y + box.height * .3 + i * 2); await new Promise((done) => setTimeout(done, 15)); }
      await page.mouse.up(); await expect(viewport).not.toHaveAttribute("data-camera-state", before);
    };
    const rotation = await measure("rotate", rotate);
    if (!rotation.frameSamples || rotation.frameP95Ms > protocol.maxFrameP95Ms || rotation.maxFrameMs > protocol.maxFrameMs) entry.failures.push("Rotation frame budget exceeded or no frame samples");
    await measure("select", async () => {
      await page.locator('input[aria-label="选择杆件 M1"] + button').click();
      await expect(page.getByLabel("截面转角（°）", { exact: true })).toBeVisible();
    });
    await page.getByLabel("截面转角（°）", { exact: true }).fill("5");
    await measure("edit", async () => { await button("保存杆件属性").click(); await expect(page.getByTestId("viewport-member-details")).toContainText(/5\s*°/); });
    await button("撤销").click();
    const save = async () => {
      await page.keyboard.press("Control+s"); await expect(status).toContainText("已保存", { timeout: 45000 });
      await expect(page.getByLabel("未保存修改", { exact: true })).toHaveCount(0);
    };
    // Cancel only after an observed real native phase, then require actual child close.
    await button("运行分析").click();
    await expect.poll(() => app.evaluate(() => globalThis.__t242.at(-1)?.stages.some((s) => s.stage === "assembly")), { timeout: 45000, intervals: [10] }).toBe(true);
    let cancelStarted;
    await measure("cancel", async () => {
      cancelStarted = await page.evaluate(() => {
        const p = window.__t242;
        p.cancelAt = performance.now(); p.cancelDate = Date.now(); p.cancelAcknowledgedMs = null;
        const observer = new MutationObserver(() => {
          if (document.querySelector('footer[role="status"]').textContent.includes("分析已取消")) {
            p.cancelAcknowledgedMs = performance.now() - p.cancelAt; observer.disconnect();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        document.querySelector('button[aria-label="取消计算"]').click();
        return p.cancelDate;
      });
      await expect(status).toContainText("分析已取消");
      await expect.poll(() => app.evaluate(() => globalThis.__t242.at(-1)?.closedAt !== null), { timeout: 5000, intervals: [10] }).toBe(true);
    }, protocol.limitsMs.cancel, async () => {
      const acknowledged = await page.evaluate(() => window.__t242.cancelAcknowledgedMs);
      const closed = await app.evaluate(() => globalThis.__t242.at(-1).closedAt);
      if (acknowledged === null || closed === null) return Infinity;
      return Math.max(acknowledged, closed - cancelStarted);
    });
    const cancelled = await app.evaluate(() => globalThis.__t242.at(-1));
    entry.cancel = { nativeSpawned: !!cancelled.pid, stages: cancelled.stages, childClosed: cancelled.closedAt !== null, terminalKind: cancelled.terminalKind ?? null, observedCloseMs: cancelled.closedAt - cancelStarted };
    if (cancelled.terminalKind === "result") entry.failures.push("Cancellation occurred after native success");
    await new Promise((done) => setTimeout(done, 550)); await expect(status).toContainText("分析已取消");
    await save();
    let saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.analysisResults).toHaveLength(0); expect(saved.nodes).toEqual(model.project.nodes); expect(saved.members).toEqual(model.project.members);
    // Advanced failure checks are genuine formal requests, not forged result packets.
    for (const [id, method] of [["AC2", "second-order"], ["AC3", "buckling"], ["AC4", "modal"]]) {
      await page.getByLabel("当前分析工况", { exact: true }).selectOption(id);
      await measure(method, async () => {
        await button("运行分析").click();
        await expect(button("取消计算")).toHaveCount(0, { timeout: 125000 });
        const text = await status.textContent();
        entry[method] = { statusText: text, completed: /分析完成|计算完成/.test(text), diagnosticText: await page.locator(".analysis-diagnostics").allTextContents() };
        if (!entry[method].completed) entry.failures.push(`Required ${method} desktop solve failed: ${text}`);
      });
      await rotate();
    }
    await page.getByLabel("当前分析工况", { exact: true }).selectOption("AC1");
    await measure("static", async () => {
      await button("运行分析").click(); await rotate();
      await expect(button("取消计算")).toHaveCount(0, { timeout: 125000 });
      await expect(status).toContainText(/分析完成|计算完成/);
    });
    entry.static = { statusText: await status.textContent(), diagnostics: await page.locator(".analysis-diagnostics").allTextContents() };
    await measure("save", save);
    saved = JSON.parse(await readFile(path, "utf8"));
    entry.saved = { bytes: Buffer.byteLength(await readFile(path)), results: saved.analysisResults.length };
    expect(saved.nodes).toEqual(model.project.nodes); expect(saved.members).toEqual(model.project.members);
    const savedBytes = await readFile(path);
    await writeFile(join(output, "saved.framemind.gz"), gzipSync(savedBytes));
    entry.saved.sha256 = hash(savedBytes);
    if (saved.analysisResults.length) {
      await measure("reopen", open);
      await measure("result", async () => {
        await button("查看分析结果").click();
        await page.locator(".result-view-tabs button").filter({ hasText: "变形图" }).click();
        await expect(page.getByLabel("视图结果图例", { exact: true })).toContainText("变形");
      });
      await page.screenshot({ path: join(output, "deformation.png") });
      await measure("forces", async () => {
        await page.locator(".result-view-tabs button").filter({ hasText: "内力图" }).click();
        await expect(page.getByLabel("视图结果图例", { exact: true })).toContainText("N");
      }, protocol.limitsMs.result);
      await page.screenshot({ path: join(output, "forces.png") });
      await button("工程计算书").click(); const dialog = page.getByRole("dialog", { name: "工程计算书", exact: true });
      await measure("word", async () => { await dialog.getByRole("button", { name: "导出 Word", exact: true }).click(); await expect(status).toContainText("已导出 Word 计算书", { timeout: 90000 }); });
      await measure("pdf", async () => { await dialog.getByRole("button", { name: "导出 PDF", exact: true }).click(); await expect(status).toContainText("已导出 PDF 计算书", { timeout: 90000 }); });
      entry.exports = { wordBytes: (await readFile(env.FRAMEMIND_E2E_REPORT_PATH)).length, pdfBytes: (await readFile(env.FRAMEMIND_E2E_REPORT_PDF_PATH)).length };
      expect((await readFile(env.FRAMEMIND_E2E_REPORT_PDF_PATH)).subarray(0, 5).toString()).toBe("%PDF-");
      await dialog.getByRole("button", { name: "关闭", exact: true }).last().click();
    } else {
      entry.failures.push("Missing target static result: result display, reopen and export not measured");
    }
    // Low commitment budget must preserve the same real target model and old result.
    await app.evaluate(() => { process.env.FRAMEMIND_NATIVE_MEMORY_MIB = "16"; });
    await measure("resourceFailure", async () => {
      await button("运行分析").click(); await expect(button("取消计算")).toHaveCount(0, { timeout: 30000 });
      await expect(status).toContainText("失败");
    });
    await rotate(); await save();
    const failed = JSON.parse(await readFile(path, "utf8"));
    expect(failed.nodes).toEqual(saved.nodes); expect(failed.members).toEqual(saved.members); expect(failed.analysisResults).toEqual(saved.analysisResults);
    entry.resourceFailure = { preservedModel: true, preservedResults: true, diagnostics: await page.locator(".analysis-diagnostics").allTextContents() };
    await page.screenshot({ path: join(output, "resource-failure.png") });
    entry.nativeProcesses = await app.evaluate(() => globalThis.__t242);
    entry.coverage.random = { status: "not-measured", reason: "Target modal dependency not available; no fabricated or small-model random result substituted" };
    entry.failures.push("Target random desktop solve, PSD/RMS and export not measured");
    entry.build = await app.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome }));
    entry.gpu = await app.evaluate(({ app }) => app.getGPUFeatureStatus());
    if (entry.rendererErrors.length) entry.failures.push(...entry.rendererErrors);
    })()]);
  } catch (error) {
    entry.failures.push(String(error));
    if (page) await bounded(page.screenshot({ path: join(output, "failure.png") }), 3000, "Failure screenshot timeout").catch(() => {});
    if (app && mainPid && alive(mainPid)) entry.nativeProcesses = await bounded(app.evaluate(() => globalThis.__t242 ?? []), 1000, "Failure process snapshot timeout").catch(() => entry.nativeProcesses);
  } finally {
    clearInterval(sampler);
    clearTimeout(watchdog);
    entry.peakAppWorkingSetBytes = Math.max(0, ...entry.memorySamples.map((s) => s.processes.reduce((sum, p) => sum + p.workingSetBytes, 0)));
    if (!entry.peakAppWorkingSetBytes || entry.peakAppWorkingSetBytes > protocol.maxAppWorkingSetBytes) entry.failures.push("Missing app working-set measurement or exceeds 2 GiB");
    if (termination) await termination;
    if (app && !termination) {
      try { await bounded(app.close(), 5000, "Desktop close timeout"); }
      catch (error) { entry.failures.push(String(error)); }
    }
    if (mainPid) {
      try { entry.processExit = await terminateTestTree(mainPid, entry.nativeProcesses.filter((p) => p.closedAt === null).map((p) => p.pid)); }
      catch (error) { isolationError = error; entry.failures.push(String(error)); }
    }
    await writeFile(join(output, "desktop.json"), JSON.stringify(entry, null, 2));
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid performance profile cleanup path");
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
  // Do not start another sample after an unconfirmed process-tree exit.
  if (isolationError) throw isolationError;
  return entry;
}
