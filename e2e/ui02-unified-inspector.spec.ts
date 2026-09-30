import { expect, test, type Locator, type Page } from "@playwright/test";
import { launchFrameMind } from "./electron-app";

async function createNode(page: Page, coordinates: [string, string, string]) {
  await page.getByRole("button", { name: "创建节点" }).click();
  const dialog = page.getByRole("dialog", { name: "创建空间节点" });
  for (const [label, value] of [["X 坐标", coordinates[0]], ["Y 坐标", coordinates[1]], ["Z 坐标", coordinates[2]]] as const) {
    await dialog.getByLabel(label).fill(value);
  }
  await dialog.getByRole("button", { name: "添加到模型" }).click();
}

async function expectRequiredPropertyError(properties: Locator, field: string, saveAction: string, message: string) {
  await properties.getByLabel(field).fill("");
  await properties.getByRole("button", { name: saveAction }).click();
  await expect(properties.getByRole("alert")).toHaveText(message);
}

test("UI02 keeps project selection and editable properties in one left sidebar", async () => {
  const { app, page } = await launchFrameMind();

  const sidebar = page.getByRole("complementary", { name: "项目与属性" });
  await expect(sidebar).toBeVisible();
  const projectTree = sidebar.getByRole("region", { name: "项目树" });
  const properties = sidebar.getByRole("region", { name: "对象属性" });
  await expect(projectTree).toBeVisible();
  await expect(properties).toContainText("未选择对象");
  await expect(page.locator(".inspector-panel")).toHaveCount(0);
  await expect(page.locator(".assistant-panel")).toHaveCount(0);

  const layout = await page.locator(".workspace").evaluate(() => {
    const tree = document.querySelector(".project-tree-pane")!.getBoundingClientRect();
    const property = document.querySelector(".property-pane")!.getBoundingClientRect();
    const viewport = document.querySelector(".model-area")!.getBoundingClientRect();
    return { treeBottom: tree.bottom, propertyTop: property.top, propertyRight: property.right, viewportLeft: viewport.left };
  });
  expect(layout.treeBottom).toBeLessThanOrEqual(layout.propertyTop);
  expect(layout.propertyRight).toBeLessThanOrEqual(layout.viewportLeft);

  await createNode(page, ["1", "2", "3"]);

  await expect(sidebar.locator(".tree-item.selected")).toHaveText(/N1/);
  await expect(properties.getByLabel("X 坐标")).toHaveValue("1");
  await properties.getByLabel("X 坐标").fill("4.5");
  await properties.getByRole("button", { name: "保存节点属性" }).click();

  await expect(sidebar.locator(".tree-item.selected")).toContainText("4.5, 2, 3");
  await expect(properties.getByText("4.500 m", { exact: true })).toBeVisible();

  await expectRequiredPropertyError(properties, "X 坐标", "保存节点属性", "X 坐标不能为空");

  await page.getByRole("button", { name: "创建材料与截面" }).click();
  await page.getByRole("button", { name: "保存材料与截面" }).click();
  await projectTree.getByText("材料 M1 · Q355", { exact: true }).click();
  await expect(properties).toContainText("自定义材料");

  const canvas = page.locator(".viewport canvas");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await canvas.click({ position: { x: canvasBox!.width / 2, y: canvasBox!.height / 2 } });
  await expect(sidebar.locator(".tree-item.selected")).toHaveText(/N1/);
  await expect(properties.getByLabel("X 坐标")).toHaveValue("4.5");

  await projectTree.getByText("材料 M1 · Q355", { exact: true }).click();
  await expectRequiredPropertyError(properties, "弹性模量 E", "保存材料属性", "弹性模量 E不能为空");

  await projectTree.getByText("截面 S1 · 箱形截面", { exact: true }).click();
  await expectRequiredPropertyError(properties, "面积 A", "保存截面属性", "面积 A不能为空");

  await createNode(page, ["8", "2", "3"]);
  await page.getByRole("button", { name: "创建杆件" }).click();
  await page.getByRole("dialog", { name: "连接空间杆件" }).getByRole("button", { name: "添加杆件" }).click();
  await expectRequiredPropertyError(properties, "截面转角（°）", "保存杆件属性", "截面转角不能为空");

  await app.close();
});
