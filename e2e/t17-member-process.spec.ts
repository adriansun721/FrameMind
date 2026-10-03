import { expect, test } from "@playwright/test";
import { launchFrameMind } from "./electron-app";
import { createNode } from "./modeling-actions";

test("T17 exposes the selected member's real axes, mapping, vectors and matrices", async () => {
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
    await page.getByRole("button", { name: "设置支座" }).click();
    await page.getByRole("button", { name: "添加支座" }).click();
    await page.getByRole("button", { name: "荷载", exact: true }).click(); await page.getByRole("menuitem", { name: "创建荷载" }).click();
    const loadDialog = page.getByRole("dialog", { name: "创建节点集中荷载" });
    await loadDialog.getByLabel("FX").fill("8");
    await loadDialog.getByRole("button", { name: "添加节点荷载" }).click();
    await page.getByRole("button", { name: "运行分析" }).click();
    await expect(page.getByRole("status")).toContainText("分析完成");

    await page.getByRole("region", { name: "项目树" }).getByText("M1", { exact: true }).click();
    const process = page.getByTestId("member-analysis-process");
    await expect(process).toBeVisible();
    await expect(process).toContainText("按");
    await expect(process).toContainText("局部 x");
    await expect(process).toContainText("node_0001");
    await expect(process).toContainText("u_local = T · u_global");
    await expect(process).toContainText("第 5 章");
    const localMatrix = process.locator("summary", { hasText: "局部单元刚度 K_local" });
    await expect(localMatrix).toBeVisible();
    await localMatrix.click();
    await expect(localMatrix.locator("..")).toHaveAttribute("open", "");
    await expect(process.getByRole("table", { name: "局部单元刚度 K_local" })).toBeVisible();
    await expect(process).toContainText("500000");
    await page.screenshot({ path: "docs/evidence/T17-member-process.png" });
  } finally {
    await app.close();
  }
});
