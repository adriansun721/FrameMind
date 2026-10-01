import { expect, test, type Locator, type Page } from "@playwright/test";
import { launchFrameMind } from "./electron-app";
import { createNode } from "./modeling-actions";

async function settledCameraState(viewport: Locator): Promise<string> {
  let previous = ""; let stableReads = 0;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const current = await viewport.getAttribute("data-camera-state");
    if (current && current === previous) stableReads += 1; else stableReads = 0;
    if (current && stableReads >= 2) return current;
    previous = current ?? "";
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("相机阻尼未在预期时间内稳定");
}

async function rememberViewportCanvas(page: Page): Promise<void> {
  await page.locator(".viewport canvas").evaluate((canvas) => {
    (window as Window & { ui04Canvas?: Element }).ui04Canvas = canvas;
  });
}

async function expectViewportCanvasPreserved(page: Page): Promise<void> {
  const keptCanvas = await page.evaluate(() =>
    document.querySelector(".viewport canvas") === (window as Window & { ui04Canvas?: Element }).ui04Canvas,
  );
  expect(keptCanvas).toBe(true);
}

test("UI04 keeps the Three.js canvas alive while selection changes", async () => {
  const { app, page } = await launchFrameMind();

  await createNode(page, ["0", "0", "0"]);
  await createNode(page, ["4", "0", "0"]);
  await expect(page.getByTestId("viewport-node-count")).toHaveText("2 个节点");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await rememberViewportCanvas(page);
  await page.getByRole("region", { name: "项目树" }).getByText("N1", { exact: true }).click();

  await expectViewportCanvasPreserved(page);
  await expect(page.getByRole("region", { name: "对象属性" })).toContainText("N1");

  await app.close();
});

test("UI04 preserves the rotated and zoomed camera across consecutive tree selections", async () => {
  const { app, page } = await launchFrameMind();

  await createNode(page, ["0", "0", "0"]);
  await createNode(page, ["4", "2", "1"]);
  const viewport = page.getByLabel("三维模型视图");
  const canvas = viewport.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const center = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 110, center.y - 55, { steps: 8 });
  await page.mouse.up();
  await page.mouse.wheel(0, -420);
  const cameraBeforeSelection = await settledCameraState(viewport);

  const tree = page.getByRole("region", { name: "项目树" });
  await tree.getByText("N1", { exact: true }).click();
  await expect(page.getByRole("region", { name: "对象属性" })).toContainText("N1");
  await expect(page.getByRole("status")).toContainText("当前选择 N1");
  await tree.getByText("N2", { exact: true }).click();
  await expect(page.getByRole("region", { name: "对象属性" })).toContainText("N2");
  await expect(page.getByRole("status")).toContainText("当前选择 N2");

  await expect(viewport).toHaveAttribute("data-camera-state", cameraBeforeSelection);
  await app.close();
});

test("UI04 presents members as an analysis-line model without rebuilding the viewport", async () => {
  const { app, page } = await launchFrameMind();

  await createNode(page, ["0", "0", "0"]);
  await createNode(page, ["4", "0", "2"]);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await rememberViewportCanvas(page);

  await page.getByRole("button", { name: "创建材料与截面" }).click();
  await page.getByRole("button", { name: "保存材料与截面" }).click();
  await page.getByRole("button", { name: "创建杆件" }).click();
  await page.getByRole("dialog", { name: "连接空间杆件" }).getByRole("button", { name: "添加杆件" }).click();

  await expect(page.getByTestId("viewport-member-count")).toHaveText("1 根杆件");
  await expect(page.locator(".view-chip")).toHaveText("分析线 · 透视");
  await expect(page.getByTestId("viewport-member-details")).toContainText("分析线模型");
  await expect(page.getByTestId("viewport-member-details")).not.toContainText("等效面积轮廓");
  await expectViewportCanvasPreserved(page);

  await app.close();
});

test("UI04 reframes the first model object after starting a new project", async () => {
  const { app, page } = await launchFrameMind();

  await createNode(page, ["0", "0", "0"]);
  page.once("dialog", (dialog) => dialog.accept());
  await page.keyboard.press("Control+N");
  await createNode(page, ["100", "100", "100"]);
  await page.getByRole("button", { name: "选择" }).click();

  const canvas = page.locator(".viewport canvas");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await canvas.click({ position: { x: canvasBox!.width / 2, y: canvasBox!.height / 2 } });

  await expect(page.getByRole("region", { name: "项目树" }).locator(".tree-item.selected")).toHaveText(/N1/);
  await app.close();
});
