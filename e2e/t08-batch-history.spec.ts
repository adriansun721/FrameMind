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
    await page.getByRole("button", { name: "数据表", exact: true }).click();
    const table = page.getByRole("region", { name: "模型数据表" });
    await table.getByRole("tab", { name: /节点/ }).click();
    await table.getByLabel("选择节点 N1").check();
    await table.getByLabel("选择节点 N2").check();
    await table.getByRole("button", { name: "批量修改" }).click();
    const dialog = page.getByRole("dialog", { name: "批量移动节点" });
    await dialog.getByLabel("X 偏移").fill("1");
    await dialog.getByRole("button", { name: "应用批量修改" }).click();
    await expect(table.getByRole("row", { name: /定位节点 N1/ })).toContainText("1, 0, 0");
    await expect(table.getByRole("row", { name: /定位节点 N2/ })).toContainText("3, 0, 0");
    await page.getByRole("button", { name: "撤销" }).click();
    await expect(table.getByRole("row", { name: /定位节点 N1/ })).toContainText("0, 0, 0");
    await expect(table.getByRole("row", { name: /定位节点 N2/ })).toContainText("2, 0, 0");
    await page.getByRole("button", { name: "重做" }).click();
    await expect(table.getByRole("row", { name: /定位节点 N1/ })).toContainText("1, 0, 0");
    await table.getByLabel("选择节点 N1").check();
    await table.getByRole("button", { name: "复制选中" }).click();
    await expect(table.getByRole("button", { name: "定位节点 N3" })).toBeVisible();
    await table.getByRole("button", { name: "删除选中" }).click();
    await expect(table.getByRole("button", { name: "定位节点 N3" })).toHaveCount(0);
  } finally {
    await app.close();
  }
});
