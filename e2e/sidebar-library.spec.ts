import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function newProject(page: Page) {
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("menuitem", { name: /新建项目/ }).click();
}

test("sidebar modules preserve drafts and share custom resources across projects and restarts", async ({}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-shared-library-"));
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({ args: [".", `--user-data-dir=${directory}`], env: environment });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const navigation = page.getByRole("navigation", { name: "侧边导航" });
    await expect(navigation.getByRole("button")).toHaveCount(3);
    const indicator = await navigation.locator(".active").evaluate((button) => getComputedStyle(button, "::before").content);
    expect(indicator).toBe("none");
    await navigation.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "搜索", exact: true })).toContainText("暂未开放");
    await expect(page.locator("#resource-panel")).toBeHidden();
    await navigation.getByRole("button", { name: "资源库", exact: true }).click();
    let panel = page.getByRole("complementary", { name: "资源库", exact: true });
    await expect(panel.getByRole("button", { name: "S235JR", exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "加入当前项目" }).click();
    await navigation.getByRole("button", { name: "资源管理器", exact: true }).click();
    await page.getByText("材料 M1 · S235JR", { exact: true }).click();
    const properties = page.getByRole("region", { name: "对象属性" });
    await expect(properties).toContainText("EN 10025-2:2019");
    await properties.getByLabel("弹性模量 E").fill("205");
    await navigation.getByRole("button", { name: "资源库", exact: true }).click();
    await panel.getByRole("button", { name: "新增自定义材料" }).click();
    await panel.getByLabel("材料名称", { exact: true }).fill("共享钢材");
    await panel.getByLabel("弹性模量 E").fill("-1");
    await panel.getByRole("button", { name: "保存到资源库" }).click();
    await expect(panel.getByRole("alert")).toContainText("弹性模量必须为正");
    await panel.getByLabel("弹性模量 E").fill("207");
    await navigation.getByRole("button", { name: "资源管理器", exact: true }).click();
    await expect(properties.getByLabel("弹性模量 E")).toHaveValue("205");
    await navigation.getByRole("button", { name: "资源库", exact: true }).click();
    await expect(panel.getByLabel("材料名称", { exact: true })).toHaveValue("共享钢材");
    await panel.getByRole("button", { name: "保存到资源库" }).click();
    await panel.getByRole("button", { name: "加入当前项目" }).click();
    await panel.getByRole("button", { name: "编辑自定义材料" }).click();
    await panel.getByLabel("弹性模量 E").fill("208");
    await panel.getByRole("button", { name: "保存到资源库" }).click();
    await navigation.getByRole("button", { name: "资源管理器", exact: true }).click();
    await page.getByText("材料 M2 · 共享钢材", { exact: true }).click();
    await expect(properties.getByLabel("弹性模量 E")).toHaveValue("207");
    await navigation.getByRole("button", { name: "资源库", exact: true }).click();
    await panel.getByRole("tab", { name: "截面", exact: true }).click();
    await panel.getByRole("button", { name: "新增自定义截面" }).click();
    await panel.getByLabel("截面名称", { exact: true }).fill("共享箱形截面");
    await panel.getByRole("button", { name: "保存到资源库" }).click();
    await newProject(page);
    await expect(panel.getByRole("button", { name: "共享箱形截面", exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "加入当前项目" }).click();
    await panel.getByRole("tab", { name: "材料", exact: true }).click();
    await panel.getByRole("button", { name: "共享钢材", exact: true }).click();
    await panel.getByRole("button", { name: "加入当前项目" }).click();
    for (const [width, height] of [[1440, 900], [1080, 680]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height), { width, height });
      const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, height: document.documentElement.clientHeight, scrollHeight: document.documentElement.scrollHeight }));
      expect(layout.scrollWidth).toBe(layout.width);
      expect(layout.scrollHeight).toBe(layout.height);
      await panel.getByRole("button", { name: "编辑自定义材料" }).click();
      await page.screenshot({ path: testInfo.outputPath(`library-editor-${width}.png`) });
      await panel.getByRole("button", { name: "取消编辑" }).click();
    }
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("navigation", { name: "侧边导航" }).getByRole("button", { name: "资源库", exact: true }).click();
    panel = page.getByRole("complementary", { name: "资源库", exact: true });
    await panel.getByRole("button", { name: "共享钢材", exact: true }).click();
    await expect(panel.getByRole("region", { name: "材料详情" })).toContainText("208");
    await panel.getByRole("button", { name: "加入当前项目" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await panel.getByRole("button", { name: "删除自定义材料" }).click();
    await expect(panel.getByRole("button", { name: "共享钢材", exact: true })).toHaveCount(0);
    await panel.getByRole("tab", { name: "截面", exact: true }).click();
    await panel.getByRole("button", { name: "共享箱形截面", exact: true }).click();
    await panel.getByRole("button", { name: "编辑自定义截面" }).click();
    await panel.getByLabel("面积 A").fill("0.02");
    await panel.getByRole("button", { name: "保存到资源库" }).click();
    await expect(panel.getByRole("region", { name: "截面详情" })).toContainText("0.02");
    page.once("dialog", (dialog) => dialog.accept());
    await panel.getByRole("button", { name: "删除自定义截面" }).click();
    await expect(panel.getByRole("button", { name: "共享箱形截面", exact: true })).toHaveCount(0);
    await page.getByRole("navigation", { name: "侧边导航" }).getByRole("button", { name: "资源管理器", exact: true }).click();
    await expect(page.getByText("材料 M1 · 共享钢材", { exact: true })).toBeVisible();
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
