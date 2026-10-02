import { expect, test } from "@playwright/test";
import { launchFrameMind } from "./electron-app";
import { createNode } from "./modeling-actions";

test("T08 applies one batch boundary and restores it with undo and redo", async () => {
  test.setTimeout(60000);
  const { app, page } = await launchFrameMind();
  try {
    await createNode(page, ["0", "0", "0"]);
    await createNode(page, ["2", "0", "0"]);
    await page.getByRole("button", { name: "创建材料与截面" }).click();
    await page.getByRole("dialog", { name: "创建材料与截面" }).getByRole("button", { name: "保存材料与截面" }).click();
    await page.getByRole("button", { name: "创建杆件" }).click();
    await page.getByRole("dialog", { name: "连接空间杆件" }).getByRole("button", { name: "添加杆件" }).click();
    const properties = page.getByRole("region", { name: "对象属性" });
    await page.getByRole("region", { name: "项目树" }).getByLabel("选择节点 N1").check();
    await page.getByRole("region", { name: "项目树" }).getByLabel("选择节点 N2").check();
    await properties.getByRole("button", { name: "批量修改" }).click();
    const dialog = page.getByRole("dialog", { name: "批量移动节点" });
    await dialog.getByLabel("X 偏移").fill("1");
    await dialog.getByRole("button", { name: "应用批量修改" }).click();
    await expect(page.getByRole("region", { name: "项目树" }).locator(".tree-item").filter({ has: page.getByText("N1", { exact: true }) })).toContainText("1, 0, 0");
    await expect(page.getByRole("region", { name: "项目树" }).locator(".tree-item").filter({ has: page.getByText("N2", { exact: true }) })).toContainText("3, 0, 0");
    await page.getByRole("button", { name: "撤销" }).click();
    await expect(page.getByRole("region", { name: "项目树" }).locator(".tree-item").filter({ has: page.getByText("N1", { exact: true }) })).toContainText("0, 0, 0");
    await expect(page.getByRole("region", { name: "项目树" }).locator(".tree-item").filter({ has: page.getByText("N2", { exact: true }) })).toContainText("2, 0, 0");
    await page.getByRole("button", { name: "重做" }).click();
    await expect(page.getByRole("region", { name: "项目树" }).locator(".tree-item").filter({ has: page.getByText("N1", { exact: true }) })).toContainText("1, 0, 0");
    await page.getByRole("region", { name: "项目树" }).getByLabel("选择节点 N1").check();
    await properties.getByRole("button", { name: "复制选中" }).click();
    await expect(page.getByRole("region", { name: "项目树" }).getByText("N3", { exact: true })).toBeVisible();
    await properties.getByRole("button", { name: "删除选中" }).click();
    await expect(page.getByRole("region", { name: "项目树" }).getByText("N3", { exact: true })).toHaveCount(0);
  } finally {
    await app.close();
  }
});
