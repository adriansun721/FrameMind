import { expect, test } from "@playwright/test";
import { launchFrameMind } from "./electron-app";
import { createNode } from "./modeling-actions";

test("T03 computes and displays a constrained spatial cantilever", async () => {
  const { app, page } = await launchFrameMind();
  await createNode(page, ["0", "0", "0"]);
  await createNode(page, ["4", "0", "0"]);
  await page.getByRole("button", { name: "创建材料与截面" }).click();
  await page.getByLabel("弹性模量 E").fill("200");
  await page.getByLabel("惯性矩 Iy").fill("0.0002");
  await page.getByLabel("惯性矩 Iz").fill("0.0001");
  await page.getByLabel("扭转常数 J").fill("0.00015");
  await page.getByRole("button", { name: "保存材料与截面" }).click();
  await page.getByRole("button", { name: "创建杆件" }).click();
  await page.getByRole("button", { name: "添加杆件" }).click();

  await page.getByRole("toolbar", { name: "建模工具" }).getByRole("button", { name: "支座", exact: true }).click();
  await page.getByRole("button", { name: "添加支座" }).click();
  await page.getByRole("button", { name: "荷载", exact: true }).click(); await page.getByRole("menuitem", { name: "创建荷载" }).click();
  const load = page.getByRole("dialog", { name: "创建节点集中荷载" });
  await load.getByLabel("FX").fill("8");
  await load.getByLabel("FY").fill("5");
  await load.getByLabel("FZ").fill("-3");
  await load.getByLabel("MX").fill("2");
  await load.getByLabel("MY").fill("1.5");
  await load.getByLabel("MZ").fill("-1.25");
  await load.getByRole("button", { name: "添加节点荷载" }).click();
  await page.getByRole("button", { name: "运行分析" }).click();

  await expect(page.getByRole("status")).toContainText("分析完成");
  await expect(page.getByText("3D 线弹性静力", { exact: true })).toBeVisible();
  await expect(page.getByText("位移 (0.000, 0.005, -0.002) m", { exact: true })).toBeVisible();
  await expect(page.getByText("起点 Fx -8.000 kN · Fy -5.000 kN · Fz 3.000 kN · Mx -2.000 kN·m · My -13.500 kN·m · Mz -18.750 kN·m", { exact: true })).toBeVisible();
  await app.close();
});
