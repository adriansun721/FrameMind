import { expect, test } from "@playwright/test";
import { launchFrameMind } from "./electron-app";

test("UI03 exposes modeling tasks, contextual tools, and honest unavailable actions", async () => {
  const { app, page } = await launchFrameMind();

  const tasks = page.getByRole("tablist", { name: "工作任务" });
  await expect(tasks.getByRole("tab", { name: "建模" })).toHaveAttribute("aria-selected", "true");
  for (const task of ["荷载", "分析", "结果"]) {
    await expect(tasks.getByRole("tab", { name: task })).toBeDisabled();
  }

  const toolbar = page.getByRole("toolbar", { name: "建模工具" });
  await expect(toolbar.getByRole("button", { name: "选择" })).toHaveAttribute("aria-pressed", "true");
  await expect(toolbar.getByRole("button", { name: "创建节点" })).toBeEnabled();
  await expect(toolbar.getByRole("button", { name: "创建材料与截面" })).toBeEnabled();
  const unavailableMember = toolbar.getByRole("button", { name: "创建杆件" });
  await expect(unavailableMember).toBeDisabled();
  await unavailableMember.focus();
  await expect(unavailableMember).toBeFocused();
  const support = toolbar.getByRole("button", { name: "支座", exact: true });
  await expect(support).toHaveCount(1);
  await expect(support).toBeEnabled();
  await support.focus();
  await expect(support).toBeFocused();
  await support.click();
  const supportDialog = page.getByRole("dialog", { name: "创建节点支座" });
  await expect(supportDialog).toBeVisible();
  await supportDialog.getByRole("button", { name: "取消" }).click();
  await expect(toolbar.getByRole("button", { name: "撤销（尚未实现）" })).toBeDisabled();
  await expect(toolbar.getByRole("button", { name: "重做（尚未实现）" })).toBeDisabled();
  await expect(toolbar).not.toContainText("XYZ");
  await expect(toolbar.getByRole("button", { name: "创建节点" }).locator("svg")).toHaveCSS("stroke-width", "1.5px");

  const statusbar = page.getByRole("status");
  await expect(statusbar).toContainText("当前选择 无选择");
  await expect(statusbar).toContainText("长度 m");
  await expect(statusbar).toContainText("全局坐标系 · Z 向上");

  const dimensions = await page.evaluate(() => ({
    titlebar: document.querySelector<HTMLElement>(".topbar")!.offsetHeight,
    taskbar: document.querySelector<HTMLElement>(".task-toolbar")!.offsetHeight,
  }));
  expect(dimensions.titlebar + dimensions.taskbar).toBeLessThan(80);

  const fileMenuButton = page.getByRole("button", { name: "文件" });
  await fileMenuButton.focus();
  await expect(fileMenuButton).toBeFocused();
  await fileMenuButton.click();
  const fileMenu = page.getByRole("menu", { name: "文件" });
  await expect(fileMenu.getByRole("menuitem", { name: /新建项目/ })).toContainText("Ctrl+N");
  await expect(fileMenu.getByRole("menuitem", { name: /打开项目/ })).toContainText("Ctrl+O");
  await expect(fileMenu.getByRole("menuitem", { name: /保存项目/ })).toContainText("Ctrl+S");
  await expect(fileMenu.getByRole("menuitem", { name: /新建项目/ }).locator("svg")).toHaveCSS("stroke-width", "1.5px");
  await page.keyboard.press("Escape");
  await expect(fileMenu).toBeHidden();

  await toolbar.getByRole("button", { name: "创建节点" }).click();
  await expect(page.getByRole("dialog", { name: "创建空间节点" })).toBeVisible();

  await app.close();
});

test("UI03 keeps the new-project keyboard shortcut available from the workbench", async () => {
  const { app, page } = await launchFrameMind();

  await page.getByRole("button", { name: "创建节点" }).click();
  await page.getByRole("dialog", { name: "创建空间节点" }).getByRole("button", { name: "添加到模型" }).click();
  await expect(page.getByTestId("viewport-node-count")).toHaveText("1 个节点");

  page.once("dialog", (dialog) => dialog.accept());
  await page.keyboard.press("Control+N");
  await expect(page.getByTestId("viewport-node-count")).toHaveText("0 个节点");
  await expect(page.getByRole("status")).toContainText("已创建空白项目");

  await app.close();
});
