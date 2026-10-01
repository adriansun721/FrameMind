import { expect, test, type Page } from "@playwright/test";
import { launchFrameMind } from "./electron-app";

async function createNode(page: Page, coordinates: [string, string, string]) {
  await page.getByRole("button", { name: "创建节点" }).click();
  const dialog = page.getByRole("dialog", { name: "创建空间节点" });
  for (const [label, value] of [["X 坐标", coordinates[0]], ["Y 坐标", coordinates[1]], ["Z 坐标", coordinates[2]]] as const) {
    await dialog.getByLabel(label).fill(value);
  }
  await dialog.getByRole("button", { name: "添加到模型" }).click();
}

test("UI04 keeps the Three.js canvas alive while selection changes", async () => {
  const { app, page } = await launchFrameMind();

  await createNode(page, ["0", "0", "0"]);
  await createNode(page, ["4", "0", "0"]);
  await expect(page.getByTestId("viewport-node-count")).toHaveText("2 个节点");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  await page.locator(".viewport canvas").evaluate((canvas) => {
    (window as Window & { ui04Canvas?: Element }).ui04Canvas = canvas;
  });
  await page.getByRole("region", { name: "项目树" }).getByText("N1", { exact: true }).click();

  const keptCanvas = await page.evaluate(() =>
    document.querySelector(".viewport canvas") === (window as Window & { ui04Canvas?: Element }).ui04Canvas,
  );
  expect(keptCanvas).toBe(true);
  await expect(page.getByRole("region", { name: "对象属性" })).toContainText("N1");

  await app.close();
});

test("UI04 presents members as an analysis-line model without rebuilding the viewport", async () => {
  const { app, page } = await launchFrameMind();

  await createNode(page, ["0", "0", "0"]);
  await createNode(page, ["4", "0", "2"]);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.locator(".viewport canvas").evaluate((canvas) => {
    (window as Window & { ui04Canvas?: Element }).ui04Canvas = canvas;
  });

  await page.getByRole("button", { name: "创建材料与截面" }).click();
  await page.getByRole("button", { name: "保存材料与截面" }).click();
  await page.getByRole("button", { name: "创建杆件" }).click();
  await page.getByRole("dialog", { name: "连接空间杆件" }).getByRole("button", { name: "添加杆件" }).click();

  await expect(page.getByTestId("viewport-member-count")).toHaveText("1 根杆件");
  await expect(page.locator(".view-chip")).toHaveText("分析线 · 透视");
  await expect(page.getByTestId("viewport-member-details")).toContainText("分析线模型");
  await expect(page.getByTestId("viewport-member-details")).not.toContainText("等效面积轮廓");
  const keptCanvas = await page.evaluate(() =>
    document.querySelector(".viewport canvas") === (window as Window & { ui04Canvas?: Element }).ui04Canvas,
  );
  expect(keptCanvas).toBe(true);

  await app.close();
});
