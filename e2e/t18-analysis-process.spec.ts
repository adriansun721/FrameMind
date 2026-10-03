import { expect, test } from "@playwright/test";
import { launchFrameMind } from "./electron-app";
import { createNode } from "./modeling-actions";

test("T18 exposes overall DOF numbering, assembly and textbook page mapping", async () => {
  const { app, page } = await launchFrameMind();
  try {
    await createNode(page, ["0", "0", "0"]);
    await createNode(page, ["4", "0", "0"]);
    await page.getByRole("button", { name: "创建材料与截面" }).click();
    await page.getByRole("button", { name: "保存材料与截面" }).click();
    await page.getByRole("button", { name: "创建杆件" }).click();
    const memberDialog = page.getByRole("dialog", { name: "连接空间杆件" });
    await memberDialog.getByLabel("起点节点").selectOption("node_0001");
    await memberDialog.getByLabel("终点节点").selectOption("node_0002");
    await memberDialog.getByRole("button", { name: "添加杆件" }).click();
    await page.getByRole("toolbar", { name: "建模工具" }).getByRole("button", { name: "支座", exact: true }).click();
    await page.getByRole("button", { name: "添加支座" }).click();
    await page.getByRole("button", { name: "荷载", exact: true }).click(); await page.getByRole("menuitem", { name: "创建荷载" }).click();
    const loadDialog = page.getByRole("dialog", { name: "创建节点集中荷载" });
    await loadDialog.getByLabel("FX").fill("8");
    await loadDialog.getByRole("button", { name: "添加节点荷载" }).click();
    await page.getByRole("button", { name: "运行分析" }).click();
    await expect(page.getByRole("status")).toContainText("分析完成");

    const process = page.getByTestId("analysis-process");
    await expect(process).toBeVisible();
    await expect(process).toContainText("本次运行实际快照");
    await expect(process).toContainText("K · u = F");
    await expect(process).toContainText("自由度 / 约束 / 自由");
    await expect(process).toContainText("整体组装");
    await process.getByText("节点自由度与约束状态", { exact: false }).click();
    await expect(process.getByRole("table", { name: "整体自由度编号" })).toContainText("node_0001");
    await process.getByText("单元组装条目", { exact: false }).click();
    await expect(process).toContainText("整体索引 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11");
    await expect(process).toContainText("书内印刷页");
    await expect(process).toContainText("PDF 页序");
  } finally {
    await app.close();
  }
});
