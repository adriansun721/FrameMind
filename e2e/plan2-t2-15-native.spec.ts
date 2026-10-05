import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { reportFixture } from "../src/domain/engineering-report.fixture";
import { decodeProject, encodeProject } from "../src/domain/project-file";
import { enterWorkbenchWithoutRecovery } from "./electron-app";

test("T2-15 keeps native faults isolated, streams real stages and cancels while the desktop remains usable", async () => {
  test.setTimeout(120000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t215-"));
  const path = join(directory, "production.framemind");
  const initial = decodeProject(encodeProject(reportFixture()));
  await writeFile(path, encodeProject(initial));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path, PATH: `${process.env.SystemRoot}\\System32` };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({ args: ["."], env });
  const records: unknown[] = [];
  try {
    const page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page);
    page.on("dialog", (dialog) => dialog.accept());
    const status = page.locator('footer[role="status"]');
    const open = async () => { await page.keyboard.press("Control+o"); await expect(status).toContainText("已打开"); };
    const saved = async () => { await page.keyboard.press("Control+s"); await expect(status).toContainText("已保存"); return decodeProject(await readFile(path, "utf8")); };
    await open();
    await app.evaluate((_electron, faultExe) => {
      const require = process.getBuiltinModule("module").createRequire(process.cwd() + "/package.json");
      const { NativeAnalysisHost } = require(process.cwd() + "/dist-electron/native-analysis.js");
      const proto = NativeAnalysisHost.prototype, run = proto.run, cancel = proto.cancel;
      const fixture = new NativeAnalysisHost(faultExe);
      const state: { mode: string; release?: () => void } = { mode: "normal" }; (globalThis as any).__t215 = state;
      proto.run = function(owner: number, request: any, phase: any) {
        if (["crash", "truncated", "protocol", "wait"].includes(state.mode)) return run.call(fixture, owner, { ...request, fault: state.mode }, phase);
        return run.call(this, owner, request, phase).then((messages: any[]) => {
          if (state.mode === "late-success") return new Promise((resolve) => { state.release = () => { state.release = undefined; resolve(messages); }; });
          if (state.mode === "nonfinite") {
            const result = messages.at(-1).result; if (result) result.nodes[1].displacement.x = NaN;
          }
          return messages;
        });
      };
      proto.cancel = function(owner: number, id: string) { cancel.call(fixture, owner, id); cancel.call(this, owner, id); };
    }, resolve("native/build/Release/framemind-fault-core.exe"));
    const mode = (value: string) => app.evaluate((_electron, value) => { (globalThis as any).__t215.mode = value; }, value);
    for (const fault of ["crash", "truncated", "protocol", "nonfinite"]) {
      await mode(fault); await page.getByRole("button", { name: "运行分析" }).click();
      await expect(status).toContainText("失败");
      const failed = await saved();
      expect(failed.nodes).toEqual(initial.nodes); expect(failed.members).toEqual(initial.members);
      expect(failed.analysisResults).toEqual(initial.analysisResults);
      records.push({ fault, retainedModel: true, retainedResults: true });
    }
    await mode("wait");
    await page.evaluate(() => {
      const state = { gaps: [] as number[], last: performance.now(), cancelMs: 0 }; (window as any).__t215 = state;
      setInterval(() => { const now = performance.now(); state.gaps.push(now - state.last); state.last = now; }, 20);
    });
    await page.getByRole("button", { name: "运行分析" }).click();
    // The real fixture process remains alive for 10 seconds after solve starts.
    await expect(status).toContainText("正在求解");
    const camera = page.getByLabel("三维模型视图"), before = await camera.getAttribute("data-camera-state");
    const bounds = (await page.locator(".viewport canvas").boundingBox())!;
    await page.mouse.move(bounds.x+bounds.width*.5, bounds.y+bounds.height*.4); await page.mouse.down();
    await page.mouse.move(bounds.x+bounds.width*.5+60, bounds.y+bounds.height*.4+20, { steps: 6 }); await page.mouse.up();
    await expect(camera).not.toHaveAttribute("data-camera-state", before!);
    const cancelMs = await page.evaluate(() => new Promise<number>((resolve, reject) => {
      const started = performance.now(), timer = setTimeout(() => { observer.disconnect(); reject(new Error("Cancellation feedback exceeded 500 ms")); }, 500);
      const observer = new MutationObserver(() => {
        if (document.querySelector('footer[role="status"]')?.textContent?.includes("分析已取消")) { clearTimeout(timer); observer.disconnect(); resolve(performance.now()-started); }
      }); observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      (document.querySelector('button[aria-label="取消计算"]') as HTMLButtonElement).click();
    }));
    expect(cancelMs).toBeLessThan(500);
    const killedAt = performance.now();
    await expect.poll(() => execFileSync(`${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, ["-NoProfile", "-Command", "@(Get-Process -Name framemind-fault-core -ErrorAction SilentlyContinue).Count"], { encoding: "utf8", windowsHide: true }).trim(), { timeout: 2000 }).toBe("0");
    const processTerminationMs = performance.now()-killedAt;
    const cancelled = await saved(); expect(cancelled.analysisResults).toEqual(initial.analysisResults);
    records.push({ cancellationMs: cancelMs, processTerminationMs, cameraChanged: true });
    // Edit during a native run: revision guards reject its old context.
    await mode("late-success"); await page.getByRole("button", { name: "运行分析" }).click();
    await expect.poll(() => app.evaluate(() => Boolean((globalThis as any).__t215.release))).toBe(true);
    await page.getByRole("button", { name: "创建节点" }).click();
    const dialog = page.getByRole("dialog", { name: "创建空间节点" });
    await dialog.getByLabel("X 坐标").fill("8"); await dialog.getByRole("button", { name: "添加到模型" }).click();
    await expect(status).toContainText("已创建");
    await app.evaluate(() => (globalThis as any).__t215.release());
    await expect(page.getByRole("button", { name: "运行分析" })).toBeVisible();
    const edited = await saved(); expect(edited.nodes).toHaveLength(3); expect(edited.analysisResults).toEqual(initial.analysisResults);
    await writeFile(path, encodeProject(initial)); await open();
    await mode("wait"); await page.getByRole("button", { name: "运行分析" }).click(); await expect(status).toContainText("正在求解");
    // Opening another identity cancels old work. No old output is applied there.
    const another = { ...initial, id: "project_t215_another" as typeof initial.id, name: "另一工程", analysisResults: [], latestAnalysis: undefined };
    await writeFile(path, encodeProject(another)); await open();
    await mode("normal"); await page.getByRole("button", { name: "运行分析" }).click(); await expect(status).toContainText("分析完成");
    const result = await saved();
    expect(result.latestAnalysis!.projectId).toBe(another.id);
    expect(result.latestAnalysis!.input.solver!.implementation).toBe("framemind-native/2");
    expect(result.latestAnalysis!.nodes[1].displacement.x).toBeCloseTo(0.00002, 12);
    expect(result.analysisResults).toHaveLength(1);
    const probe = await page.evaluate(() => (window as any).__t215);
    const memory = await app.evaluate(({ app }) => app.getAppMetrics().map(item => ({ type: item.type, workingSetBytes: item.memory.workingSetSize*1024 })));
    await mkdir("docs/evidence/plan2/T2-15", { recursive: true });
    await page.screenshot({ path: "docs/evidence/plan2/T2-15/native-production.png" });
    await writeFile("docs/evidence/plan2/T2-15/desktop-isolation.json", JSON.stringify({ passed: true, records, compilerFreePath: true, editAndProjectSwitchIsolated: true, maxCallbackGapMs: Math.max(...probe.gaps), memory, result: result.latestAnalysis }, null, 2)+"\n");
  } finally { await app.close(); }
});
