import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNode } from "./modeling-actions";

async function fileAction(page: import("@playwright/test").Page, name: "保存项目" | "打开项目") {
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(name) }).click();
}

test("T10 configures, solves, edits and reopens self weight without changing the frozen result", async () => {
  test.setTimeout(90000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t10-"));
  const path = join(directory, "self-weight.framemind");
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  env.FRAMEMIND_E2E_PROJECT_PATH = path;
  delete env.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await page.bringToFront();
    await expect(page.locator(".viewport canvas")).toBeVisible();
    await createNode(page, ["0", "0", "0"]); await createNode(page, ["4", "0", "0"]);
    await page.getByRole("button", { name: "创建材料与截面" }).click();
    await page.getByRole("button", { name: "保存材料与截面" }).click();
    await page.getByRole("button", { name: "创建杆件" }).click(); await page.getByRole("button", { name: "添加杆件" }).click();
    await page.getByRole("toolbar", { name: "建模工具" }).getByRole("button", { name: "支座", exact: true }).click(); await page.getByRole("button", { name: "添加支座" }).click();
    await page.getByRole("button", { name: "荷载", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "设置自重" })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "工况", exact: true }).click();
    const manager = page.getByRole("dialog", { name: "荷载工况管理" });
    await manager.getByRole("button", { name: "新建工况" }).click();
    await expect(manager.getByRole("button", { name: "设置自重" })).toBeDisabled();
    await manager.getByLabel("工况名称").fill("横向荷载");
    await manager.getByRole("button", { name: "创建工况", exact: true }).click();
    await expect(page.getByLabel("当前工况", { exact: true })).toHaveValue("LC2");
    await manager.getByRole("listitem").filter({ hasText: "LC1" }).click();
    await manager.getByRole("button", { name: "设置自重" }).click();
    await expect(manager).toHaveCount(0);
    const selfWeight = page.getByRole("dialog", { name: "设置结构自重" });
    await expect(selfWeight.getByLabel("所属工况")).toHaveValue("LC1");
    await selfWeight.getByLabel("启用结构自重").check();
    await selfWeight.getByRole("button", { name: "保存自重设置" }).click();
    await expect(page.getByRole("status")).toContainText("已启用结构自重");
    await expect(page.getByRole("button", { name: "结构自重 LC1" })).toContainText("已启用");
    await page.getByRole("button", { name: "荷载", exact: true }).click();
    await page.getByRole("menuitem", { name: "工况", exact: true }).click();
    await manager.getByRole("listitem").filter({ hasText: "LC2" }).click();
    await expect(manager.getByRole("region", { name: "工况自重" })).toContainText("自重当前计入 LC1");
    await manager.getByRole("button", { name: "设置自重" }).click();
    await expect(selfWeight.getByLabel("所属工况")).toHaveValue("LC2");
    await expect(selfWeight.getByLabel("启用结构自重")).not.toBeChecked();
    await selfWeight.getByLabel("所属工况").selectOption("LC1");
    await expect(selfWeight.getByLabel("启用结构自重")).toBeChecked();
    await selfWeight.getByLabel("所属工况").selectOption("LC2");
    await expect(selfWeight.getByLabel("启用结构自重")).not.toBeChecked();
    await selfWeight.getByRole("button", { name: "保存自重设置" }).click();
    await expect(page.getByRole("status")).toContainText("LC2 未启用结构自重");
    await page.getByLabel("当前工况", { exact: true }).selectOption("LC1");
    await expect(page.getByRole("button", { name: "结构自重 LC1" })).toContainText("已启用");
    await page.getByRole("button", { name: "运行分析" }).click();
    await expect(page.getByRole("status")).toContainText("分析完成");
    await page.getByRole("button", { name: "查看分析结果" }).click();
    await expect(page.getByText("3.080 kN · LC1", { exact: true })).toBeVisible();

    await page.getByText("截面 S1 · 箱形截面", { exact: true }).click();
    await page.getByLabel("面积 A").fill("0.02");
    await page.getByRole("button", { name: "保存截面属性" }).click();
    await page.getByRole("button", { name: "查看分析结果" }).click();
    await expect(page.getByText(/R\d+ · 已过期/)).toBeVisible();
    await expect(page.getByText("3.080 kN · LC1", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "运行分析" }).click();
    await expect(page.getByRole("status")).toContainText("分析完成");
    await page.getByRole("button", { name: "查看分析结果" }).click();
    await expect(page.getByText("6.161 kN · LC1", { exact: true })).toBeVisible();

    await fileAction(page, "保存项目");
    await expect(page.getByRole("status")).toContainText("已保存");
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.selfWeight).toMatchObject({ enabled: true, loadCaseId: "LC1", gravity: { z: -9.81 } });
    expect(saved.latestAnalysis.input.selfWeight.gravity.z).toBe(-9.81);
    await app.close();
    app = await electron.launch({ args: ["."], env }); page = await app.firstWindow();
    await fileAction(page, "打开项目");
    await expect(page.getByRole("button", { name: "结构自重 LC1" })).toContainText("已启用");
    await page.getByRole("button", { name: "查看分析结果" }).click();
    await expect(page.getByText("6.161 kN · LC1", { exact: true })).toBeVisible();
  } finally {
    await app.close(); await rm(directory, { recursive: true, force: true });
  }
});
