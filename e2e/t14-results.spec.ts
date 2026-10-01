import { expect, test } from "@playwright/test";
import { launchFrameMind } from "./electron-app";
import { createNode } from "./modeling-actions";

test("T14 switches result views, scales deformation, and locates a member station", async () => {
  const { app, page } = await launchFrameMind();
  await createNode(page, ["0", "0", "0"]);
  await createNode(page, ["4", "0", "0"]);
  await page.getByRole("button", { name: "创建材料与截面" }).click();
  await page.getByRole("button", { name: "保存材料与截面" }).click();
  await page.getByRole("button", { name: "创建杆件" }).click();
  await page.getByRole("button", { name: "添加杆件" }).click();
  await page.getByRole("button", { name: "设置支座" }).click();
  await page.getByRole("button", { name: "添加支座" }).click();
  await page.getByRole("button", { name: "创建荷载" }).click();
  const load = page.getByRole("dialog", { name: "创建节点集中荷载" });
  await load.getByLabel("FY").fill("5");
  await load.getByRole("button", { name: "添加节点荷载" }).click();
  await page.getByRole("button", { name: "运行分析" }).click();
  await expect(page.getByRole("status")).toContainText("分析完成");

  await page.getByRole("tab", { name: "变形图" }).click();
  await expect(page.getByLabel("变形放大比例")).toHaveValue("100");
  await page.getByLabel("变形放大比例").fill("250");
  await expect(page.getByText("250×", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "内力图" }).click();
  await page.getByLabel("内力分量").selectOption("My");
  await expect(page.locator(".result-legend")).toContainText("弯矩 My");
  await page.getByRole("tab", { name: "结果表" }).click();
  await page.getByLabel("M1 沿杆位置").fill("2");
  await page.getByRole("button", { name: "定位 M1 结果位置" }).click();
  await expect(page.getByRole("region", { name: "对象属性" })).toContainText("M1");
  await app.close();
});
