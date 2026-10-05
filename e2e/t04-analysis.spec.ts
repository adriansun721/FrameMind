import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNode } from "./modeling-actions";
import { enterWorkbenchWithoutRecovery } from "./electron-app";

async function fileAction(page: Page, action: "保存项目" | "打开项目") {
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(action) }).click();
}

test("T04 manually builds, solves, reads and reopens a spatial multi-member frame", async ({}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t04-"));
  const environment: NodeJS.ProcessEnv = { ...process.env, FRAMEMIND_E2E_PROJECT_PATH: join(directory, "空间刚架.framemind") };
  delete environment.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ args: ["."], env: environment });
  try {
    let page = await app.firstWindow();
    await enterWorkbenchWithoutRecovery(page);
    for (const coordinates of [["0", "0", "0"], ["4", "0", "0"], ["4", "3", "0"], ["4", "3", "2"]] as [string, string, string][]) await createNode(page, coordinates);
    await page.getByRole("button", { name: "创建材料与截面" }).click();
    await page.getByLabel("弹性模量 E").fill("200");
    await page.getByLabel("惯性矩 Iy").fill("0.0002");
    await page.getByLabel("惯性矩 Iz").fill("0.0001");
    await page.getByLabel("扭转常数 J").fill("0.00015");
    await page.getByRole("button", { name: "保存材料与截面" }).click();
    for (const [start, end] of [[1, 2], [2, 3], [3, 4]]) {
      await page.getByRole("button", { name: "创建杆件" }).click();
      const dialog = page.getByRole("dialog", { name: "连接空间杆件" });
      await dialog.getByLabel("起点节点").selectOption(`node_${String(start).padStart(4, "0")}`);
      await dialog.getByLabel("终点节点").selectOption(`node_${String(end).padStart(4, "0")}`);
      await dialog.getByRole("button", { name: "添加杆件" }).click();
    }
    await page.getByRole("toolbar", { name: "建模工具" }).getByRole("button", { name: "支座", exact: true }).click();
    await page.getByRole("button", { name: "添加支座" }).click();
    await page.getByRole("button", { name: "荷载", exact: true }).click(); await page.getByRole("menuitem", { name: "创建荷载" }).click();
    const load = page.getByRole("dialog", { name: "创建节点集中荷载" });
    for (const [label, value] of [["FX", "8"], ["FY", "5"], ["FZ", "-3"], ["MX", "2"], ["MY", "1.5"], ["MZ", "-1.25"]]) await load.getByLabel(label).fill(value);
    await load.getByRole("button", { name: "添加节点荷载" }).click();
    await page.getByRole("button", { name: "运行分析" }).click();
    await expect(page.getByRole("status")).toContainText("分析完成 · 4 个节点结果，3 根杆件结果");
    await expect(page.getByTestId("viewport-member-count")).toHaveText("3 根杆件");
    await expect(page.getByText("位移 (0.028, 0.009, -0.024) m", { exact: true })).toBeVisible();
    await expect(page.getByText("反力矩 (17.000, -29.500, 5.250) kN·m", { exact: true })).toBeVisible();
    await expect(page.getByText("终点 Fx -3.000 kN · Fy 8.000 kN · Fz 5.000 kN · Mx -1.250 kN·m · My 2.000 kN·m · Mz 1.500 kN·m", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1480, height: 920 });
    await page.getByRole("button", { name: "适合模型" }).click();
    await page.screenshot({ path: testInfo.outputPath("T04-spatial-frame.png") });
    await page.getByRole("region", { name: "项目树" }).getByText("N4", { exact: true }).click();
    await page.getByLabel("Z 坐标").fill("3");
    await page.getByRole("button", { name: "保存节点属性" }).click();
    await page.getByRole("button", { name: "查看分析结果" }).click();
    await expect(page.getByText(/R\d+ · 已过期/)).toBeVisible();
    await expect(page.getByText("位移 (0.028, 0.009, -0.024) m", { exact: true })).toBeVisible();
    await fileAction(page, "保存项目");
    await expect(page.getByRole("status")).toContainText("已保存");
    await app.close();
    app = await electron.launch({ args: ["."], env: environment });
    page = await app.firstWindow();
    await enterWorkbenchWithoutRecovery(page);
    await fileAction(page, "打开项目");
    await expect(page.getByText("位移 (0.028, 0.009, -0.024) m", { exact: true })).toBeVisible();
    await expect(page.getByText(/R\d+ · 已过期/)).toBeVisible();
    await page.setViewportSize({ width: 1480, height: 920 });
    await page.screenshot({ path: testInfo.outputPath("T04-reopened-desktop.png") });
    const canvas = page.locator(".viewport canvas");
    const pixels = await canvas.screenshot();
    const brightPixels = await app.evaluate(({ nativeImage }, png) => {
      const bitmap = nativeImage.createFromBuffer(Buffer.from(png, "base64")).toBitmap();
      let count = 0;
      for (let index = 0; index < bitmap.length; index += 4) if (Math.max(bitmap[index], bitmap[index + 1], bitmap[index + 2]) > 110) count += 1;
      return count;
    }, pixels.toString("base64"));
    expect(brightPixels).toBeGreaterThan(100);
    const cameraBefore = await page.getByLabel("三维模型视图").getAttribute("data-camera-state");
    const bounds = await canvas.boundingBox();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + bounds!.width / 2 + 80, bounds!.y + bounds!.height / 2 - 40, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByLabel("三维模型视图")).not.toHaveAttribute("data-camera-state", cameraBefore!);
    await page.setViewportSize({ width: 1080, height: 680 });
    await page.screenshot({ path: testInfo.outputPath("T04-reopened-compact.png") });
    await page.getByRole("button", { name: "运行分析" }).click();
    await expect(page.getByRole("status")).toContainText("分析完成");
    await expect(page.getByText(/R\d+ · 当前/)).toBeVisible();
    await expect(page.getByText("位移 (0.028, 0.009, -0.024) m", { exact: true })).toHaveCount(0);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
