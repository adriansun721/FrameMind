import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNode } from "./modeling-actions";
import { launchFrameMind } from "./electron-app";

test("T12 edits, solves, switches and reopens user combinations with traceable sources", async () => {
  test.setTimeout(90000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t12-"));
  const path = join(directory, "combinations.framemind");
  const env = { ...process.env, FRAMEMIND_E2E_PROJECT_PATH: path }; delete env.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await createNode(page, ["0", "0", "0"]); await createNode(page, ["4", "0", "0"]);
    await page.getByRole("button", { name: "创建材料与截面" }).click(); await page.getByRole("button", { name: "保存材料与截面" }).click();
    await page.getByRole("button", { name: "创建杆件" }).click(); await page.getByRole("button", { name: "添加杆件" }).click();
    await page.getByRole("button", { name: "设置支座" }).click(); await page.getByRole("button", { name: "添加支座" }).click();
    await page.getByRole("button", { name: "荷载", exact: true }).click(); await page.getByRole("menuitem", { name: "创建荷载", exact: true }).click();
    await page.getByRole("dialog").getByLabel("FX").fill("10"); await page.getByRole("button", { name: "添加节点荷载" }).click();
    await page.getByRole("button", { name: "运行分析" }).click(); await expect(page.getByRole("status")).toContainText("分析完成");
    await page.getByRole("button", { name: "管理工况" }).click();
    let dialog = page.getByRole("dialog", { name: "荷载工况管理" });
    await dialog.getByRole("button", { name: "新建工况" }).click(); await dialog.getByLabel("工况名称").fill("横向风");
    await dialog.getByRole("button", { name: "创建工况", exact: true }).click(); await dialog.getByRole("button", { name: "关闭工况管理" }).click();
    await page.getByRole("button", { name: "荷载", exact: true }).click(); await page.getByRole("menuitem", { name: "创建均布荷载" }).click();
    await page.getByRole("dialog").getByLabel("qy").fill("-3"); await page.getByRole("button", { name: "添加均布荷载" }).click();
    await page.getByRole("button", { name: "管理组合" }).click();
    dialog = page.getByRole("dialog", { name: "自定义荷载组合" });
    await dialog.getByLabel("组合名称").fill("恒载与反向风");
    await dialog.getByLabel("包含 LC1", { exact: true }).check(); await dialog.getByLabel("LC1 系数", { exact: true }).fill("1.5");
    await dialog.getByLabel("包含 LC2", { exact: true }).check(); await dialog.getByLabel("LC2 系数", { exact: true }).fill("-0.5");
    await dialog.getByRole("button", { name: "创建组合", exact: true }).click();
    await expect(page.getByLabel("当前组合")).toHaveValue("CB1");
    await dialog.getByRole("button", { name: "关闭组合管理" }).click();
    await page.getByRole("button", { name: "荷载", exact: true }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "创建荷载", exact: true })).toBeDisabled();
    await expect(page.getByRole("menuitem", { name: "创建均布荷载" })).toBeDisabled();
    await expect(page.getByRole("menuitem", { name: "工况", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "荷载工况管理" })).toBeVisible();
    await page.getByRole("button", { name: "关闭工况管理" }).click();
    await expect(page.getByLabel("当前组合")).toHaveValue("CB1");
    await page.getByRole("button", { name: "运行分析" }).click(); await expect(page.getByRole("status")).toContainText("分析完成");
    await expect(page.locator(".analysis-result-panel")).toContainText("用户定义");
    await expect(page.locator(".analysis-result-panel")).toContainText("LC2 · 横向风 × -0.5");
    await expect(page.locator(".analysis-row").first()).toContainText("反力 (-15.000, -6.000, 0.000)");
    await expect(page.getByLabel("视图工况来源")).toContainText("CB1");
    await page.getByRole("button", { name: "管理组合" }).click();
    dialog = page.getByRole("dialog", { name: "自定义荷载组合" });
    await dialog.getByRole("button", { name: "新建组合" }).click(); await dialog.getByLabel("组合名称").fill("零响应");
    await dialog.getByLabel("包含 LC1", { exact: true }).check(); await dialog.getByLabel("LC1 系数", { exact: true }).fill("0");
    await dialog.getByRole("button", { name: "创建组合", exact: true }).click(); await dialog.getByRole("button", { name: "关闭组合管理" }).click();
    await page.getByRole("button", { name: "运行分析" }).click(); await expect(page.getByRole("status")).toContainText("分析完成");
    await expect(page.locator(".analysis-row").first()).toContainText("反力 (0.000, 0.000, 0.000)");
    await page.getByLabel("当前组合").selectOption("CB1");
    await expect(page.locator(".analysis-row").first()).toContainText("反力 (-15.000, -6.000, 0.000)");
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /保存项目/ }).click();
    await expect(page.getByRole("status")).toContainText("已保存");
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.loadCombinations).toHaveLength(2); expect(saved.analysisResults).toHaveLength(3);
    expect(saved.analysisResults[1].input.combination.cases[1].uniformLoads[0].intensity.y).toBe(-3);
    await app.close(); app = await electron.launch({ args: ["."], env }); page = await app.firstWindow();
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await expect(page.getByLabel("当前组合")).toHaveValue("CB1"); await page.getByRole("button", { name: "查看分析结果" }).click();
    await expect(page.locator(".analysis-result-panel")).toContainText("当前");
    for (const [width, height] of [[1440, 900], [1080, 680]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
      await page.getByRole("button", { name: "适合模型" }).click();
      for (const row of await page.locator(".combination-case").all()) {
        const text = await row.locator("span").boundingBox();
        expect(text!.width).toBeGreaterThan(100); expect(text!.height).toBeLessThan(25);
      }
      const png = await page.locator(".viewport canvas").screenshot();
      const colors = await page.evaluate(async (encoded) => {
        const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = 100; canvas.height = 60;
        const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0, 100, 60);
        const data = context.getImageData(0, 0, 100, 60).data; const unique = new Set<string>();
        for (let i = 0; i < data.length; i += 4) unique.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
        return unique.size;
      }, png.toString("base64"));
      expect(colors).toBeGreaterThan(8);
      const camera = await page.getByLabel("三维模型视图").getAttribute("data-camera-state");
      const box = await page.locator(".viewport canvas").boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.wheel(0, 80);
      await expect(page.getByLabel("三维模型视图")).not.toHaveAttribute("data-camera-state", camera!);
      await page.screenshot({ path: `docs/evidence/T12-results-${width}.png` });
      await page.getByRole("button", { name: "管理组合" }).click();
      await page.screenshot({ path: `docs/evidence/T12-editor-${width}.png` }); await page.getByRole("button", { name: "关闭组合管理" }).click();
    }
    await page.getByLabel("当前工况").selectOption("LC1");
    await expect(page.getByLabel("当前组合")).toHaveValue(""); await expect(page.locator(".analysis-row").first()).toContainText("反力 (-10.000, 0.000, 0.000)");
    await page.getByLabel("当前组合").selectOption("CB1"); await page.getByRole("button", { name: "管理组合" }).click();
    dialog = page.getByRole("dialog", { name: "自定义荷载组合" });
    await dialog.getByLabel("LC2 系数", { exact: true }).fill("-1"); await dialog.getByRole("button", { name: "保存组合", exact: true }).click();
    await expect(dialog.getByRole("listitem").filter({ hasText: "CB1" })).toContainText("已过期");
    await dialog.getByRole("button", { name: "关闭组合管理" }).click(); await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(page.locator(".analysis-result-panel")).toContainText("LC2 · 横向风 × -0.5");
    await page.getByRole("button", { name: "管理工况" }).click();
    dialog = page.getByRole("dialog", { name: "荷载工况管理" });
    await dialog.getByRole("listitem").filter({ hasText: "LC2" }).click();
    page.once("dialog", async (confirmation) => { expect(confirmation.message()).toContain("CB1"); await confirmation.accept(); });
    await dialog.getByRole("button", { name: "删除工况" }).click(); await dialog.getByRole("button", { name: "关闭工况管理" }).click();
    await expect(page.getByLabel("当前组合").locator("option[value='CB1']")).toHaveCount(0);
    await page.getByRole("button", { name: "撤销", exact: true }).click(); await expect(page.getByLabel("当前组合")).toHaveValue("CB1");
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("T12 switching combinations cancels a pending worker and rejects late results", async () => {
  const { app, page } = await launchFrameMind();
  try {
    await page.addInitScript(() => {
      class PendingWorker {
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        postMessage(): void {}
        terminate(): void { this.onmessage?.({ data: { kind: "result", result: { id: "late" } } } as MessageEvent); }
      }
      Object.defineProperty(window, "Worker", { configurable: true, writable: true, value: PendingWorker });
    });
    await page.reload(); await page.getByRole("button", { name: "管理组合" }).click();
    const dialog = page.getByRole("dialog", { name: "自定义荷载组合" });
    for (const name of ["First", "Second"]) {
      await dialog.getByRole("button", { name: "新建组合" }).click();
      await dialog.getByLabel("组合名称").fill(name); await dialog.getByLabel("包含 LC1", { exact: true }).check();
      await dialog.getByRole("button", { name: "创建组合", exact: true }).click();
    }
    await dialog.getByRole("button", { name: "关闭组合管理" }).click();
    await page.getByLabel("当前组合").selectOption("CB1"); await page.getByRole("button", { name: "运行分析" }).click();
    await expect(page.getByRole("button", { name: "取消计算" })).toBeVisible();
    await page.getByLabel("当前组合").selectOption("CB2");
    await expect(page.getByRole("button", { name: "运行分析" })).toBeVisible();
    await expect(page.getByRole("button", { name: "查看分析结果" })).toBeDisabled();
    await page.getByLabel("当前组合").selectOption("CB1");
    await expect(page.getByRole("button", { name: "查看分析结果" })).toBeDisabled();
  } finally { await app.close(); }
});
