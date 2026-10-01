import { expect, test, type Page } from "@playwright/test";
import { launchFrameMind } from "./electron-app";
import { createNode } from "./modeling-actions";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "@playwright/test";

test("T07 edits node coordinates through the table and inspector using one selected object", async () => {
  const { app, page } = await launchFrameMind();
  try {
    await createNode(page, ["0", "0", "0"]);
    await page.getByRole("button", { name: "数据表", exact: true }).click();
    const table = page.getByRole("region", { name: "模型数据表" });
    const properties = page.getByRole("region", { name: "对象属性" });
    await table.getByRole("button", { name: "定位节点 N1" }).click();
    await table.getByLabel("N1 X 坐标").fill("2.5");
    await expect(properties.getByLabel("X 坐标")).toHaveValue("2.5");
    await expect(properties.getByText("0.000 m", { exact: true })).toHaveCount(3);
    await table.getByLabel("N1 X 坐标").press("Enter");
    await expect(properties.getByText("2.500 m", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "项目树" }).locator(".tree-item.selected")).toContainText("2.5, 0, 0");

    await properties.getByLabel("Y 坐标").fill("-3");
    await expect(table.getByLabel("N1 Y 坐标")).toHaveValue("-3");
    await properties.getByRole("button", { name: "保存节点属性" }).click();
    await expect(table.getByRole("row", { name: /定位节点 N1/ })).toContainText("2.5, -3, 0");

    await page.getByRole("button", { name: "选择", exact: true }).click();
    await page.getByRole("button", { name: "适合模型", exact: true }).click();
    const canvas = page.locator(".viewport canvas");
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });
    await expect(table.getByLabel("N1 X 坐标")).toHaveValue("2.5");
    await expect(properties.getByText("node_0001", { exact: true })).toBeVisible();

    await properties.getByLabel("X 坐标").fill("7");
    await page.getByRole("button", { name: "创建节点", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "创建空间节点" });
    await dialog.getByLabel("X 坐标").fill("99");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(table.getByLabel("N1 X 坐标")).toHaveValue("7");
    await table.getByRole("button", { name: "还原 N1 草稿" }).click();
    await expect(properties.getByLabel("X 坐标")).toHaveValue("2.5");
  } finally {
    await app.close();
  }
});

async function expectRenderedSelection(page: Page) {
  const pixels = await page.locator(".viewport canvas").evaluate((element) => new Promise<{ colors: number; highlighted: number }>((resolve) => {
    requestAnimationFrame(() => {
      const canvas = element as HTMLCanvasElement;
      const gl = canvas.getContext("webgl2")!;
      const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
      const colors = new Set<string>();
      let highlighted = 0;
      for (let i = 0; i < data.length; i += 4) {
        colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
        if (Math.abs(data[i] - 120) < 8 && Math.abs(data[i + 1] - 145) < 8 && Math.abs(data[i + 2] - 173) < 8) highlighted += 1;
      }
      resolve({ colors: colors.size, highlighted });
    });
  }));
  expect(pixels.colors).toBeGreaterThan(12);
  expect(pixels.highlighted).toBeGreaterThan(0);
}

test("T07 synchronizes member assignments, rejects invalid drafts and reopens applied edits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t07-"));
  const environment: NodeJS.ProcessEnv = { ...process.env, FRAMEMIND_E2E_PROJECT_PATH: join(directory, "synchronized.framemind") };
  delete environment.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ args: ["."], env: environment });
  try {
    const page = await app.firstWindow();
    for (const coordinates of [["0", "0", "0"], ["4", "0", "0"], ["0", "0", "3"]] as [string, string, string][]) await createNode(page, coordinates);
    for (const name of ["Steel A", "Steel B"]) {
      await page.getByRole("button", { name: "创建材料与截面" }).click();
      const dialog = page.getByRole("dialog", { name: "创建材料与截面" });
      await dialog.getByLabel("材料名称").fill(name);
      await dialog.getByLabel("截面名称").fill(`Section ${name.slice(-1)}`);
      await dialog.getByRole("button", { name: "保存材料与截面" }).click();
    }
    await page.getByRole("button", { name: "创建杆件" }).click();
    await page.getByRole("dialog", { name: "连接空间杆件" }).getByRole("button", { name: "添加杆件" }).click();
    await page.getByRole("button", { name: "数据表", exact: true }).click();
    const table = page.getByRole("region", { name: "模型数据表" });
    const properties = page.getByRole("region", { name: "对象属性" });
    await table.getByRole("button", { name: "定位杆件 M1" }).click();
    await table.getByLabel("M1 终点节点").selectOption("node_0003");
    await table.getByLabel("M1 材料", { exact: true }).selectOption("material_0002");
    await table.getByLabel("M1 截面", { exact: true }).selectOption("section_0002");
    await table.getByLabel("M1 截面转角").fill("45");
    await expect(properties.getByLabel("终点节点")).toHaveValue("node_0003");
    await expect(properties.getByLabel("截面转角（°）")).toHaveValue("45");
    await expect(properties.getByText("4.000 m", { exact: true })).toBeVisible();
    await table.getByRole("button", { name: "保存 M1" }).click();
    await expect(properties.getByText("3.000 m", { exact: true })).toBeVisible();
    await expect(page.getByTestId("viewport-member-details")).toContainText("Steel B");
    await expect(page.getByTestId("viewport-member-details")).toContainText("Section B");
    await expect(page.getByTestId("viewport-member-details")).toContainText("45°");

    await properties.getByLabel("起点节点").selectOption("node_0002");
    await properties.getByLabel("材料", { exact: true }).selectOption("material_0001");
    await properties.getByLabel("截面", { exact: true }).selectOption("section_0001");
    await properties.getByLabel("截面转角（°）").fill("-30");
    await properties.getByRole("button", { name: "保存杆件属性" }).click();
    await expect(table.getByLabel("M1 起点节点")).toHaveValue("node_0002");
    await expect(table.getByLabel("M1 材料", { exact: true })).toHaveValue("material_0001");
    await expect(table.getByLabel("M1 截面", { exact: true })).toHaveValue("section_0001");
    await expect(table.getByLabel("M1 截面转角")).toHaveValue("-30");
    await expect(properties.getByText("5.000 m", { exact: true })).toBeVisible();

    const version = await page.locator(".model-summary strong").textContent();
    await table.getByLabel("M1 截面转角").fill("");
    await table.getByRole("button", { name: "保存 M1" }).click();
    await expect(table.getByRole("alert")).toHaveText("截面转角不能为空");
    await expect(table.getByLabel("M1 截面转角")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByTestId("viewport-member-details")).toContainText("-30°");
    await table.getByRole("button", { name: "还原 M1 草稿" }).click();
    await table.getByLabel("M1 终点节点").selectOption("node_0002");
    await table.getByRole("button", { name: "保存 M1" }).click();
    await expect(table.getByRole("alert")).toContainText("两个节点不能位于同一位置");
    await expect(page.locator(".model-summary strong")).toHaveText(version!);
    await expect(properties.getByText("5.000 m", { exact: true })).toBeVisible();
    await table.getByRole("button", { name: "还原 M1 草稿" }).click();

    await table.getByRole("tab", { name: /节点/ }).click();
    await table.getByRole("button", { name: "定位节点 N3" }).click();
    await table.getByLabel("N3 X 坐标").fill("4");
    await table.getByLabel("N3 Z 坐标").fill("0");
    await table.getByRole("button", { name: "保存 N3" }).click();
    await expect(table.getByRole("alert")).toContainText("零长度");
    await expect(properties.getByText("3.000 m", { exact: true })).toBeVisible();
    await table.getByRole("button", { name: "还原 N3 草稿" }).click();
    await table.getByLabel("N3 X 坐标").fill("");
    await table.getByRole("button", { name: "保存 N3" }).click();
    await expect(table.getByRole("alert")).toHaveText("X 坐标不能为空");
    await expect(table.getByLabel("N3 X 坐标")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator(".model-summary strong")).toHaveText(version!);
    await table.getByRole("button", { name: "还原 N3 草稿" }).click();
    await table.getByLabel("N3 Z 坐标").fill("6");
    await table.getByRole("button", { name: "保存 N3" }).click();
    await page.getByRole("region", { name: "项目树" }).getByText("M1", { exact: true }).click();
    await expect(table.getByRole("tab", { name: /杆件/ })).toHaveAttribute("aria-selected", "true");
    await expect(properties.getByText("7.211 m", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "适合模型", exact: true }).click();
    await expectRenderedSelection(page);
    await page.screenshot({ path: "docs/evidence/T07-synchronized-desktop.png" });
    await page.setViewportSize({ width: 1080, height: 720 });
    await page.getByRole("button", { name: "适合模型", exact: true }).click();
    const layout = await page.evaluate(() => {
      const canvas = document.querySelector(".viewport canvas")!.getBoundingClientRect();
      const tableBounds = document.querySelector(".model-data-table")!.getBoundingClientRect();
      return { canvasBottom: canvas.bottom, tableTop: tableBounds.top, canvasHeight: canvas.height, pageWidth: document.body.scrollWidth };
    });
    expect(layout.canvasBottom).toBeLessThanOrEqual(layout.tableTop);
    expect(layout.canvasHeight).toBeGreaterThan(300);
    expect(layout.pageWidth).toBe(1080);
    await expectRenderedSelection(page);
    await page.screenshot({ path: "docs/evidence/T07-synchronized-compact.png" });

    await page.keyboard.press("Control+S");
    await expect(page.getByRole("status")).toContainText("已保存");
    await app.close();
    app = await electron.launch({ args: ["."], env: environment });
    const reopened = await app.firstWindow();
    await reopened.getByRole("button", { name: "文件", exact: true }).click();
    await reopened.getByRole("menuitem", { name: /打开项目/ }).click();
    await expect(reopened.getByRole("status")).toContainText("已打开");
    await reopened.getByRole("button", { name: "数据表", exact: true }).click();
    const reopenedTable = reopened.getByRole("region", { name: "模型数据表" });
    await reopenedTable.getByRole("button", { name: "定位节点 N3" }).click();
    await expect(reopenedTable.getByLabel("N3 Z 坐标")).toHaveValue("6");
    await expect(reopened.getByRole("region", { name: "对象属性" }).getByText("node_0003", { exact: true })).toBeVisible();
    await reopenedTable.getByRole("tab", { name: /杆件/ }).click();
    await reopenedTable.getByRole("button", { name: "定位杆件 M1" }).click();
    await expect(reopenedTable.getByLabel("M1 起点节点")).toHaveValue("node_0002");
    await expect(reopenedTable.getByLabel("M1 终点节点")).toHaveValue("node_0003");
    await expect(reopenedTable.getByLabel("M1 材料", { exact: true })).toHaveValue("material_0001");
    await expect(reopenedTable.getByLabel("M1 截面", { exact: true })).toHaveValue("section_0001");
    await expect(reopenedTable.getByLabel("M1 截面转角")).toHaveValue("-30");
    await expect(reopened.getByRole("region", { name: "对象属性" }).getByText("member_0001", { exact: true })).toBeVisible();
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
