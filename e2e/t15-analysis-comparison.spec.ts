import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNode } from "./modeling-actions";
import { enterWorkbenchWithoutRecovery } from "./electron-app";

test("T15 keeps the previous run and compares two frozen results", async () => {
  test.setTimeout(90000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t15-"));
  const environment = { ...process.env, FRAMEMIND_E2E_PROJECT_PATH: join(directory, "comparison.framemind") };
  delete environment.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ args: ["."], env: environment });
  let page = await app.firstWindow();
  const fileAction = async (name: "保存项目" | "打开项目") => {
    await page.getByRole("button", { name: "文件", exact: true }).click();
    await page.getByRole("menuitem", { name: new RegExp(name) }).click();
  };
  try {
  await enterWorkbenchWithoutRecovery(page);
  await createNode(page, ["0", "0", "0"]);
  await createNode(page, ["4", "0", "0"]);
  await page.getByRole("button", { name: "创建材料与截面" }).click();
  await page.getByRole("button", { name: "保存材料与截面" }).click();
  await page.getByRole("button", { name: "创建杆件" }).click();
  await page.getByRole("button", { name: "添加杆件" }).click();
  await page.getByRole("toolbar", { name: "建模工具" }).getByRole("button", { name: "支座", exact: true }).click();
  await page.getByRole("button", { name: "添加支座" }).click();
  await page.getByRole("button", { name: "荷载", exact: true }).click(); await page.getByRole("menuitem", { name: "创建荷载" }).click();
  const load = page.getByRole("dialog", { name: "创建节点集中荷载" });
  await load.getByLabel("FX").fill("5");
  await load.getByRole("button", { name: "添加节点荷载" }).click();
  await page.getByRole("button", { name: "运行分析" }).click();
  await expect(page.getByRole("status")).toContainText("分析完成");

  await page.getByRole("button", { name: /截面 S1/ }).click();
  await page.getByLabel("面积 A").fill("0.02");
  await page.getByRole("button", { name: "保存截面属性" }).click();
  await page.getByRole("button", { name: "运行分析" }).click();
  await expect(page.getByRole("status")).toContainText("分析完成");
  await page.getByRole("button", { name: "查看分析结果" }).click();
  await page.getByRole("button", { name: "前后结果对比" }).click();

  const dialog = page.getByRole("dialog", { name: "前后结果对比" });
  await expect(dialog).toContainText("模型变化");
  await expect(dialog).toContainText("面积 A");
  await expect(dialog).toContainText("节点响应变化");
  await expect(dialog).toContainText("杆件内力变化");
  await dialog.getByRole("button", { name: "完成" }).click();
  await fileAction("保存项目");
  await expect(page.getByRole("status")).toContainText("已保存");
  await app.close();
  app = await electron.launch({ args: ["."], env: environment });
  page = await app.firstWindow();
  await enterWorkbenchWithoutRecovery(page);
  await fileAction("打开项目");
  await expect(page.getByRole("status")).toContainText("已打开");
  await page.getByRole("button", { name: "查看分析结果" }).click();
  await page.getByRole("button", { name: "前后结果对比" }).click();
  await expect(page.getByRole("dialog", { name: "前后结果对比" })).toContainText("面积 A");
  await app.close();
  } finally {
    await app.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
