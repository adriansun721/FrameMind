import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNode } from "./modeling-actions";
import { launchFrameMind } from "./electron-app";

async function fileAction(page: Page, name: string) {
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(name) }).click();
}
async function createCase(page: Page, name: string) {
  await page.getByRole("button", { name: "管理工况" }).click();
  const dialog = page.getByRole("dialog", { name: "荷载工况管理" });
  await dialog.getByRole("button", { name: "新建工况" }).click();
  await dialog.getByLabel("工况名称").fill(name);
  await dialog.getByRole("button", { name: "创建工况", exact: true }).click();
  await dialog.getByRole("button", { name: "关闭工况管理" }).click();
}
async function solve(page: Page) {
  await page.getByRole("button", { name: "运行分析" }).click();
  await expect(page.getByRole("status")).toContainText("分析完成");
}

test("T11 manages, solves, compares and reopens two independent load cases", async () => {
  test.setTimeout(90000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t11-"));
  const path = join(directory, "two-cases.framemind");
  const env = { ...process.env, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await createNode(page, ["0", "0", "0"]); await createNode(page, ["4", "0", "0"]);
    await page.getByRole("button", { name: "创建材料与截面" }).click(); await page.getByRole("button", { name: "保存材料与截面" }).click();
    await page.getByRole("button", { name: "创建杆件" }).click(); await page.getByRole("button", { name: "添加杆件" }).click();
    await page.getByRole("toolbar", { name: "建模工具" }).getByRole("button", { name: "支座", exact: true }).click(); await page.getByRole("button", { name: "添加支座" }).click();
    await page.getByRole("button", { name: "荷载", exact: true }).click(); await page.getByRole("menuitem", { name: "创建荷载", exact: true }).click();
    const nodal = page.getByRole("dialog", { name: "创建节点集中荷载" });
    await nodal.getByLabel("FX").fill("10"); await nodal.getByRole("button", { name: "添加节点荷载" }).click();
    await solve(page);
    await expect(page.locator(".analysis-result-panel")).toContainText("LC1 · 默认工况");
    await createCase(page, "横向风");
    await expect(page.getByLabel("当前工况")).toHaveValue("LC2");
    await expect(page.getByRole("button", { name: "查看分析结果" })).toBeDisabled();
    await expect(page.locator(".analysis-result-panel")).toHaveCount(0);
    await page.getByRole("button", { name: "荷载", exact: true }).click(); await page.getByRole("menuitem", { name: "创建均布荷载" }).click();
    const uniform = page.getByRole("dialog", { name: "创建杆件均布荷载" });
    await expect(uniform.getByLabel("所属工况")).toHaveValue("LC2");
    await uniform.getByLabel("qy").fill("-3"); await uniform.getByRole("button", { name: "添加均布荷载" }).click();
    await solve(page);
    await expect(page.locator(".analysis-result-panel")).toContainText("LC2 · 横向风");
    await expect(page.locator(".analysis-row").first()).toContainText("反力 (0.000, 12.000, 0.000)");
    await page.getByRole("button", { name: "管理工况" }).click();
    const manager = page.getByRole("dialog", { name: "荷载工况管理" });
    await expect(manager.getByRole("region", { name: "工况响应比较" }).getByRole("row")).toHaveCount(3);
    await manager.getByLabel("工况名称").fill("横向风（复核）");
    await manager.getByLabel("工况说明").fill("全局 Y 方向 -3 kN/m");
    await manager.getByRole("button", { name: "保存工况", exact: true }).click();
    await expect(manager.getByRole("listitem").filter({ hasText: "LC2" })).toContainText("已过期");
    await expect(manager.getByRole("listitem").filter({ hasText: "LC1" })).toContainText("结果当前");
    await manager.getByRole("button", { name: "关闭工况管理" }).click();
    await solve(page);
    await fileAction(page, "保存项目"); await expect(page.getByRole("status")).toContainText("已保存");
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.analysisResults).toHaveLength(3); expect(saved.nodalLoads[0].loadCaseId).toBe("LC1"); expect(saved.uniformLoads[0].loadCaseId).toBe("LC2");
    await app.close(); app = await electron.launch({ args: ["."], env }); page = await app.firstWindow();
    await fileAction(page, "打开项目"); await expect(page.getByLabel("当前工况")).toHaveValue("LC2");
    await page.getByRole("button", { name: "查看分析结果" }).click();
    await expect(page.locator(".analysis-result-panel")).toContainText("LC2 · 横向风（复核）");
    for (const [width, height] of [[1440, 900], [1080, 680]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
      await page.getByRole("button", { name: "适合模型" }).click();
      await expect(page.locator(".viewport canvas")).toBeVisible();
      const canvasImage = await page.locator(".viewport canvas").screenshot();
      const pixels = await page.evaluate(async (encoded) => {
        const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
        const target = document.createElement("canvas"); target.width = 100; target.height = 60;
        const context = target.getContext("2d")!; context.drawImage(image, 0, 0, 100, 60);
        const data = context.getImageData(0, 0, 100, 60).data;
        const colors = new Set<string>(); for (let i = 0; i < data.length; i += 4) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
        return colors.size;
      }, canvasImage.toString("base64"));
      expect(pixels).toBeGreaterThan(8);
      const camera = await page.getByLabel("三维模型视图").getAttribute("data-camera-state");
      const canvas = await page.locator(".viewport canvas").boundingBox();
      await page.mouse.move(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2); await page.mouse.wheel(0, 80);
      await expect(page.getByLabel("三维模型视图")).not.toHaveAttribute("data-camera-state", camera!);
      await page.screenshot({ path: `docs/evidence/T11-cases-${width}.png` });
      await page.getByRole("button", { name: "管理工况" }).click();
      await expect(page.getByRole("dialog", { name: "荷载工况管理" })).toBeVisible();
      await page.screenshot({ path: `docs/evidence/T11-comparison-${width}.png` });
      await page.getByRole("button", { name: "关闭工况管理" }).click();
    }
    await page.getByLabel("当前工况").selectOption("LC1");
    await expect(page.locator(".analysis-result-panel")).toContainText("反力 (-10.000, 0.000, 0.000)");
    await expect(page.getByLabel("视图工况来源")).toContainText("LC1");
    await expect(page.getByRole("region", { name: "项目树" }).getByText("Q1 · M1", { exact: true })).toHaveCount(0);
    await page.getByLabel("当前工况").selectOption("LC2");
    await page.getByRole("region", { name: "项目树" }).getByText("Q1 · M1", { exact: true }).click();
    await expect(page.getByTestId("viewport-load-details")).toContainText("LC2");
    await page.getByLabel("所属工况").selectOption("LC1"); await page.getByRole("button", { name: "保存均布荷载属性" }).click();
    await expect(page.getByLabel("当前工况")).toHaveValue("LC1");
    await page.getByLabel("当前工况").selectOption("LC2");
    await page.getByRole("button", { name: "管理工况" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "删除工况" }).click(); await page.getByRole("button", { name: "关闭工况管理" }).click();
    await expect(page.getByLabel("当前工况")).toHaveValue("LC1");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(page.getByLabel("当前工况")).toHaveValue("LC2");
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("T11 switching cases cancels a pending worker and prevents a late result from appearing", async () => {
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
    await page.reload(); await createCase(page, "第二工况");
    await page.getByLabel("当前工况").selectOption("LC1"); await page.getByRole("button", { name: "运行分析" }).click();
    await expect(page.getByRole("button", { name: "取消计算" })).toBeVisible();
    await page.getByLabel("当前工况").selectOption("LC2");
    await expect(page.getByRole("button", { name: "运行分析" })).toBeVisible();
    await expect(page.getByRole("button", { name: "查看分析结果" })).toBeDisabled();
    await page.getByLabel("当前工况").selectOption("LC1");
    await expect(page.getByRole("button", { name: "查看分析结果" })).toBeDisabled();
  } finally { await app.close(); }
});
