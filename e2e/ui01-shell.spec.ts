import { expect, test, type Page } from "@playwright/test";
import { launchFrameMind } from "./electron-app";

function colorChannels(color: string): number[] {
  return color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
}

async function expectNeutralSurface(page: Page, selector: string): Promise<void> {
  const color = await page.locator(selector).evaluate((element) => getComputedStyle(element).backgroundColor);
  const channels = colorChannels(color);

  expect(channels).toHaveLength(3);
  expect(Math.max(...channels) - Math.min(...channels)).toBeLessThanOrEqual(8);
}

test("UI01 presents a compact neutral workbench at supported window sizes", async () => {
  const { app, page } = await launchFrameMind();

  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".topbar")).toHaveCSS("height", "34px");
  await expect(page.getByText("STRUCTURAL STUDIO", { exact: true })).toHaveCount(0);
  await expect(page.getByText("MODEL SPACE", { exact: true })).toHaveCount(0);

  const tokens = await page.locator(":root").evaluate((root) => {
    const styles = getComputedStyle(root);
    return [
      "--surface-root",
      "--surface-panel",
      "--surface-control",
      "--text-primary",
      "--text-muted",
      "--border-subtle",
      "--radius-control",
      "--control-height",
      "--model-selected",
      "--model-axis-z",
    ].map((name) => styles.getPropertyValue(name).trim());
  });
  expect(tokens.every(Boolean)).toBe(true);

  await expectNeutralSurface(page, ".topbar");
  await expectNeutralSurface(page, ".project-panel");
  await expectNeutralSurface(page, ".property-pane");
  await expectNeutralSurface(page, ".tool-button.active");

  await page.getByRole("button", { name: "创建节点" }).click();
  const nodeDialog = page.getByRole("dialog", { name: "创建空间节点" });
  await nodeDialog.getByLabel("X 坐标").fill("1");
  await nodeDialog.getByLabel("Y 坐标").fill("2");
  await nodeDialog.getByLabel("Z 坐标").fill("3");
  await nodeDialog.getByRole("button", { name: "添加到模型" }).click();

  await expectNeutralSurface(page, ".tree-item.selected");
  await expect(page.locator(".tree-item.selected")).toHaveCSS("box-shadow", "none");
  await expect(page.locator(".statusbar")).toHaveCSS("font-size", "11px");
  await expect(page.locator(".selection-icon svg")).toHaveCSS("width", "15px");
  await expect(page.locator(".viewport-count")).toBeHidden();
  await expect(page.locator(".view-chip")).toHaveCSS("border-top-width", "0px");

  for (const [width, height] of [[1440, 900], [1080, 680]]) {
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
    }, { width, height });
    await page.waitForTimeout(100);

    const layout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      clientHeight: document.documentElement.clientHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    expect(layout.scrollWidth).toBe(layout.clientWidth);
    expect(layout.scrollHeight).toBe(layout.clientHeight);

    for (const name of ["创建节点", "创建材料与截面"]) {
      await expect(page.getByRole("button", { name })).toBeVisible();
    }
    await page.getByRole("button", { name: "文件" }).click();
    for (const name of ["新建项目", "打开项目", "保存项目"]) {
      await expect(page.getByRole("menu", { name: "文件" }).getByRole("menuitem", { name: new RegExp(name) })).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("complementary", { name: "项目与属性" }).getByLabel("X 坐标")).toBeVisible();
  }

  await app.close();
});
