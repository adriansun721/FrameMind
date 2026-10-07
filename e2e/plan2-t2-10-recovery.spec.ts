import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parameters, replay, send } from "./frame-proposal-actions";
import { createProject, addNode } from "../src/domain/project";
import { encodeProject } from "../src/domain/project-file";
import { decodeProject } from "../src/domain/project-file";
import { ModelEditConfirmation, prepareModelEditConfirmation, proposeModelEdits } from "../src/workspace/model-edits";
import { createNode } from "./modeling-actions";
import { columns } from "../src/workspace/section-stage.fixture";

async function fixture(run: (launch: () => Promise<Page>, crash: () => Promise<void>, directory: string, app: () => ElectronApplication) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t210-desktop-"));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: join(directory, "中文正式工程.framemind") };
  delete env.ELECTRON_RUN_AS_NODE;
  let application: ElectronApplication | undefined;
  const launch = async () => {
    application = await electron.launch({ args: ["."], env }); const page = await application.firstWindow();
    await expect(page.getByRole("main", { name: "启动恢复" }).or(page.getByRole("button", { name: "文件", exact: true }))).toBeVisible({ timeout: 10_000 });
    return page;
  };
  const crash = async () => {
    const process = application!.process();
    const stopped = new Promise<void>((done) => process.once("exit", () => done()));
    if (globalThis.process.platform === "win32") await promisify(execFile)("taskkill", ["/PID", String(process.pid), "/T", "/F"], { windowsHide: true });
    else process.kill();
    await stopped; application = undefined;
  };
  try { await run(launch, crash, directory, () => application!); }
  finally {
    await application?.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid test cleanup path");
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

async function latest(page: Page) {
  return page.evaluate(async () => {
    const listing = await window.frameMind.listRecovery();
    if (!listing.entries[0]) return null;
    return JSON.parse(await window.frameMind.readRecovery(listing.entries[0].id));
  });
}

test("T2-10 recovers an unsaved pending draft after process termination and preserves applied receipts across another crash", async () => {
  await fixture(async (launch, crash, directory, app) => {
    let page = await launch();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "设置", exact: true });
    await settings.getByLabel("DeepSeek API Key").fill("sk-t210-fixture-only");
    await settings.getByRole("button", { name: "保存连接" }).click();
    await expect(settings.getByTestId("deepseek-feedback")).toHaveText("连接设置已保存");
    await settings.getByRole("button", { name: "关闭", exact: true }).click();
    await replay(app(), parameters); await send(page, "准备两层刚架，先等我确认");
    await expect.poll(async () => (await latest(page))?.taskState?.conversations[0]?.proposal?.version).toBe(1);
    const pending = await latest(page); expect(pending.nodes).toHaveLength(0);
    await crash(); page = await launch();
    const gate = page.getByRole("main", { name: "启动恢复" });
    await expect(gate).toContainText(pending.id); await expect(gate).toContainText("尚未手动保存（新项目）");
    await expect(page.getByRole("button", { name: "运行分析", exact: true })).toHaveCount(0);
    await page.keyboard.press("Control+s");
    await expect(gate).toBeVisible();
    await page.getByRole("button", { name: "恢复此快照", exact: true }).click();
    await expect(page.getByTestId("recovery-notice")).toContainText("尚未手动保存");
    await expect(page.getByRole("region", { name: "建模参数卡片" })).toHaveCount(0);
    await page.getByRole("button", { name: "恢复任务", exact: true }).click();
    await expect(page.getByRole("region", { name: "建模参数卡片" })).toBeVisible();
    await page.getByRole("button", { name: "确认建模", exact: true }).dblclick();
    await expect.poll(async () => (await latest(page))?.nodes?.length).toBe(12);
    const applied = await latest(page); expect(applied.confirmedOperations).toHaveLength(1);
    expect(JSON.stringify(applied)).not.toContain("sk-t210");
    await crash(); page = await launch();
    await page.getByRole("button", { name: "恢复此快照", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("12 节点");
    await page.getByRole("button", { name: "恢复任务", exact: true }).click();
    await expect.poll(async () => (await latest(page))?.confirmedOperations?.length).toBe(1);
    expect((await latest(page)).nodes).toHaveLength(12);
    await mkdir("docs/evidence/plan2/T2-10", { recursive: true });
    await page.screenshot({ path: "docs/evidence/plan2/T2-10/recovered-receipt-dark.png" });
    await expect(readFile(join(directory, "中文正式工程.framemind"), "utf8")).rejects.toThrow();
  });
});

test("T2-10 shows formal save provenance, keeps its file intact, and falls back from a corrupted newer snapshot", async () => {
  await fixture(async (launch, crash, directory) => {
    const path = join(directory, "中文正式工程.framemind");
    const project = createProject("中文恢复工程"); const formalContent = encodeProject(project);
    await writeFile(path, formalContent);
    let page = await launch();
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("已打开");
    const content = encodeProject(addNode(project, { x: -1.25, y: 2, z: 3 }));
    const savedAt = (await stat(path)).mtime.toISOString();
    await page.evaluate(async ({ content, path, savedAt }) => window.frameMind.saveRecovery({ content, formalSave: { path, savedAt } }), { content, path, savedAt });
    await page.evaluate(async ({ content, path, savedAt }) => window.frameMind.saveRecovery({ content, formalSave: { path, savedAt } }), { content, path, savedAt });
    const entry = await page.evaluate(async () => (await window.frameMind.listRecovery()).entries[0]);
    await crash(); await writeFile(join(directory, "recovery", entry.id), "{incomplete");
    page = await launch();
    const gate = page.getByRole("main", { name: "启动恢复" });
    await expect(gate).toContainText(path); await expect(gate).toContainText(project.id);
    await expect(gate.getByRole("alert")).toContainText("已跳过");
    await page.screenshot({ path: "docs/evidence/plan2/T2-10/startup-fallback-dark.png" });
    await page.evaluate(() => localStorage.setItem("framemind.theme", "light")); await page.reload();
    await expect(gate).toContainText(path); await expect(gate.getByRole("alert")).toContainText("已跳过");
    await page.screenshot({ path: "docs/evidence/plan2/T2-10/startup-fallback-light.png" });
    await page.getByRole("button", { name: "恢复此快照", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("1 节点");
    expect(await readFile(path, "utf8")).toBe(formalContent);
    await expect(page.getByLabel("未保存修改")).toBeVisible();
    await page.keyboard.press("Control+s"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    await expect(page.getByTestId("recovery-notice")).toHaveCount(0);
    expect(JSON.parse(await readFile(path, "utf8")).nodes).toHaveLength(1);
  });
});

for (const stage of ["before-write", "mid-write", "before-rename", "after-rename"] as const) test(`T2-10 terminates Electron ${stage} and restores one complete confirmation state`, async () => {
  await fixture(async (launch, crash, _directory, app) => {
    let page = await launch();
    await expect(page.getByRole("button", { name: "文件", exact: true })).toBeVisible();
    const base = createProject("提交中断验证");
    const confirmation = prepareModelEditConfirmation(base, proposeModelEdits(base, { operations: [{ type: "create_node", position: { x: -2.5, y: 0, z: 0 } }] }));
    const applied = new ModelEditConfirmation().confirm(base, confirmation).project;
    await page.evaluate((content) => window.frameMind.saveRecovery({ content, formalSave: null }), encodeProject(base));
    await app().evaluate((_electron, stage) => {
      const nodeRequire = process.getBuiltinModule("module")!.createRequire(`${process.cwd()}/dist-electron/main.js`);
      const module = nodeRequire("./recovery-store.js");
      const originalSave = module.RecoveryStore.prototype.save;
      module.RecoveryStore.prototype.save = function (request: unknown) {
        const files = this.files;
        const originalWrite = files.write; const originalRename = files.rename;
        const stop = () => { (globalThis as unknown as { recoveryFaultReached: string }).recoveryFaultReached = stage; return new Promise<void>(() => {}); };
        files.write = async (path: string, content: string) => {
          if (stage === "before-write") return stop();
          if (stage === "mid-write") { await nodeRequire("node:fs/promises").writeFile(path, content.slice(0, content.length / 2)); return stop(); }
          await originalWrite(path, content);
          if (stage === "before-rename") return stop();
        };
        files.rename = async (from: string, to: string) => { await originalRename(from, to); if (stage === "after-rename") return stop(); };
        return originalSave.call(this, request);
      };
    }, stage);
    await page.evaluate((content) => { void window.frameMind.saveRecovery({ content, formalSave: null }).catch(() => {}); }, encodeProject(applied));
    await expect.poll(() => app().evaluate(() => (globalThis as unknown as { recoveryFaultReached: string }).recoveryFaultReached)).toBe(stage);
    await crash(); page = await launch();
    await expect(page.getByRole("main", { name: "启动恢复" })).toContainText(base.id);
    const restored = decodeProject(await page.evaluate(async () => window.frameMind.readRecovery((await window.frameMind.listRecovery()).entries[0].id)));
    expect(restored.nodes).toHaveLength(stage === "after-rename" ? 1 : 0);
    expect(restored.confirmedOperations ?? []).toHaveLength(stage === "after-rename" ? 1 : 0);
    expect(new ModelEditConfirmation().confirm(restored, confirmation).project.nodes).toHaveLength(1);
    await page.getByRole("button", { name: "恢复此快照", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText(`${stage === "after-rename" ? 1 : 0} 节点`);
  });
});

test("T2-10 shows disk failure without losing the previous snapshot, allows edits, and retries", async () => {
  await fixture(async (launch, _crash, _directory, app) => {
    const page = await launch(); await createNode(page, ["1", "0", "0"]);
    await expect.poll(async () => (await latest(page))?.nodes?.length).toBe(1);
    await app().evaluate(() => {
      const nodeRequire = process.getBuiltinModule("module")!.createRequire(`${process.cwd()}/dist-electron/main.js`);
      const store = nodeRequire("./recovery-store.js").RecoveryStore;
      const original = store.prototype.save;
      store.prototype.save = function (request: unknown) {
        const write = this.files.write;
        this.files.write = async () => { throw new Error("ENOSPC"); };
        (globalThis as unknown as { restoreRecoveryDisk: () => void }).restoreRecoveryDisk = () => { this.files.write = write; store.prototype.save = original; };
        store.prototype.save = function (request: unknown) { return original.call(this, request); };
        return original.call(this, request);
      };
    });
    await createNode(page, ["2", "0", "0"]);
    await expect(page.getByTestId("recovery-notice")).toContainText("快照写入失败");
    expect((await latest(page)).nodes).toHaveLength(1);
    await createNode(page, ["3", "0", "0"]);
    await expect(page.locator('footer[role="status"]')).toContainText("3 节点");
    await app().evaluate(() => (globalThis as unknown as { restoreRecoveryDisk: () => void }).restoreRecoveryDisk());
    await expect.poll(async () => (await latest(page))?.nodes?.length).toBe(3);
    await expect(page.getByTestId("recovery-notice")).toHaveCount(0);
  });
});

for (const checkpoint of ["before-model-commit", "after-model-before-receipt", "after-receipt-before-snapshot"] as const) test(`T2-10 terminates the live confirmation ${checkpoint} without publishing a partial state`, async () => {
  await fixture(async (launch, crash, _directory, app) => {
    let page = await launch();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "设置", exact: true });
    await settings.getByLabel("DeepSeek API Key").fill("sk-t210-fixture-only");
    await settings.getByRole("button", { name: "保存连接" }).click();
    await expect(settings.getByTestId("deepseek-feedback")).toHaveText("连接设置已保存");
    await settings.getByRole("button", { name: "关闭", exact: true }).click();
    await replay(app(), parameters); await send(page, "准备两层刚架，先等我确认");
    await expect.poll(async () => (await latest(page))?.taskState?.conversations[0]?.proposal?.version).toBe(1);
    const pending = await latest(page);
    const debuggerSession = await app().context().newCDPSession(page);
    await debuggerSession.send("Debugger.enable");
    await page.evaluate(({ checkpoint, id }) => {
      if (checkpoint === "before-model-commit") {
        document.addEventListener("click", (event) => { if ((event.target as HTMLElement).closest("button")?.textContent === "确认建模") { debugger; } }, { capture: true });
      } else {
        const stringify = JSON.stringify;
        JSON.stringify = function (value, replacer, space) {
          const afterModel = Array.isArray(value) && value[0] === id && Array.isArray(value[2]) && value[2].length === 12;
          const afterReceipt = value && typeof value === "object" && value.id === id && value.confirmedOperations?.length === 1;
          if (checkpoint === "after-model-before-receipt" ? afterModel : afterReceipt) { debugger; }
          return stringify(value, replacer, space);
        } as typeof JSON.stringify;
      }
    }, { checkpoint, id: pending.id });
    const paused = new Promise<void>((done) => debuggerSession.once("Debugger.paused", () => done()));
    void page.getByRole("button", { name: "确认建模", exact: true }).click().catch(() => {});
    await paused; await crash(); page = await launch();
    await expect(page.getByRole("main", { name: "启动恢复" })).toContainText(pending.id);
    const restored = await latest(page); expect(restored.nodes).toHaveLength(0); expect(restored.confirmedOperations ?? []).toHaveLength(0);
    await page.getByRole("button", { name: "恢复此快照", exact: true }).click();
    await page.getByRole("button", { name: "恢复任务", exact: true }).click();
    await page.getByRole("button", { name: "确认建模", exact: true }).dblclick();
    await expect.poll(async () => (await latest(page))?.nodes?.length).toBe(12);
    expect((await latest(page)).confirmedOperations).toHaveLength(1);
  });
});

test("T2-10 restores a crashed local calculation from its automatic frozen-input snapshot offline", async () => {
  await fixture(async (launch, crash, directory, app) => {
    const path = join(directory, "中文正式工程.framemind"); await writeFile(path, encodeProject(columns()));
    let page = await launch();
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("已打开");
    await app().evaluate(({ ipcMain }) => {
      // Hold the production IPC task pending; restart restores the real native handler.
      ipcMain.removeHandler("analysis:native-run");
      ipcMain.handle("analysis:native-run", () => new Promise(() => {}));
    });
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect.poll(async () => (await latest(page))?.taskState?.analyses?.length).toBe(1);
    const interrupted = await latest(page); await crash(); page = await launch();
    await page.getByRole("button", { name: "恢复此快照", exact: true }).click();
    await expect(page.getByRole("button", { name: "取消计算", exact: true })).toHaveCount(0);
    expect((await latest(page)).analysisResults).toHaveLength(1);
    await page.getByRole("button", { name: "继续任务", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    await expect.poll(async () => (await latest(page))?.analysisResults?.length).toBe(2);
    expect((await latest(page)).analysisResults[1].input).toEqual(interrupted.taskState.analyses[0].input);
  });
});
