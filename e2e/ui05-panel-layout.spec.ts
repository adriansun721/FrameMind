import { expect, test, type Page } from "@playwright/test";
import { launchFrameMind } from "./electron-app";
import { createNode } from "./modeling-actions";

async function canvasWidth(page: Page): Promise<number> {
  return page.locator(".viewport canvas").evaluate((canvas) => canvas.getBoundingClientRect().width);
}

async function expectRenderedCanvas(page: Page): Promise<void> {
  const png = await page.locator(".viewport canvas").screenshot();
  const colors = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const sample = document.createElement("canvas");
    sample.width = image.width; sample.height = image.height;
    const context = sample.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    const colors = new Set<string>();
    for (let index = 0; index < pixels.length; index += 16) {
      colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
    }
    return colors.size;
  }, png.toString("base64"));
  expect(colors).toBeGreaterThan(5);
}

test("UI05 synchronizes panel controls and preserves selection, drafts, scroll and canvas", async () => {
  const { app, page } = await launchFrameMind();
  try {
    await createNode(page, ["1", "2", "3"]);
    const properties = page.getByRole("region", { name: "对象属性" });
    await properties.getByLabel("X 坐标").fill("4.5");
    const assistantDraft = page.getByLabel("AI 消息草稿");
    await assistantDraft.fill("draft");
    await assistantDraft.pressSequentially(" text");
    await assistantDraft.press("Control+z");
    await expect(page.getByTestId("viewport-node-count")).toHaveText("1 个节点");
    await assistantDraft.press("Control+y");
    await expect(page.getByTestId("viewport-node-count")).toHaveText("1 个节点");
    await page.getByLabel("AI 消息草稿").fill("检查当前模型");
    const scrollTop = await page.locator(".project-tree").evaluate((tree) => {
      tree.scrollTop = tree.scrollHeight;
      return tree.scrollTop;
    });
    await page.locator(".viewport canvas").evaluate((canvas) => {
      (window as Window & { layoutCanvas?: Element }).layoutCanvas = canvas;
    });
    const initialWidth = await canvasWidth(page);
    const resourceToggle = page.getByRole("button", { name: "切换资源管理器", exact: true });
    const activityToggle = page.getByRole("button", { name: "资源管理器", exact: true });
    const assistantToggle = page.getByRole("button", { name: "切换 AI 对话", exact: true });

    await activityToggle.click();
    await expect(page.locator("#resource-panel")).toBeHidden();
    await expect(resourceToggle).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => canvasWidth(page)).toBeGreaterThan(initialWidth);
    await expect(page.locator("#assistant-panel")).toBeVisible();
    await resourceToggle.click();
    await expect(activityToggle).toHaveAttribute("aria-pressed", "true");
    await expect(properties.getByLabel("X 坐标")).toHaveValue("4.5");
    await expect(page.locator(".tree-item.selected")).toContainText("N1");
    expect(await page.locator(".project-tree").evaluate((tree) => tree.scrollTop)).toBe(scrollTop);

    await page.getByRole("button", { name: "收起 AI 对话", exact: true }).click();
    await expect(page.locator("#assistant-panel")).toBeHidden();
    await expect(assistantToggle).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => canvasWidth(page)).toBeGreaterThan(initialWidth);
    await expect(page.locator("#resource-panel")).toBeVisible();
    await assistantToggle.click();
    await expect(page.getByLabel("AI 消息草稿")).toHaveValue("检查当前模型");
    await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.querySelector(".viewport canvas") === (window as Window & { layoutCanvas?: Element }).layoutCanvas)).toBe(true);
    await expect(properties.getByText("1.000 m", { exact: true })).toBeVisible();
    await expect(page.locator(".model-summary")).toHaveCount(0);
    await expectRenderedCanvas(page);
  } finally {
    await app.close();
  }
});

test("UI05 docks horizontal properties below the viewport and resizes without losing drafts", async ({}, testInfo) => {
  const { app, page } = await launchFrameMind();
  try {
    await createNode(page, ["1", "2", "3"]);
    const properties = page.getByRole("region", { name: "对象属性" });
    const toggle = page.locator(".layout-controls button").nth(1);
    const separator = page.getByRole("separator", { name: "调整属性面板高度" });
    await expect(toggle).toHaveAttribute("aria-label", "切换属性面板");
    await expect(toggle.locator(".lucide-table-2")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "数据表", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "模型数据表" })).toHaveCount(0);
    await properties.getByLabel("X 坐标").fill("9.5");

    for (const [width, height] of [[1440, 900], [1080, 680]]) {
      await app.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height);
      }, { width, height });
      const layout = await page.evaluate(() => {
        const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        const viewport = rect(".viewport"); const property = rect("#property-panel");
        const identity = rect(".inspector-overview"); const form = rect(".property-form");
        return { viewLeft: viewport.left, viewRight: viewport.right, viewBottom: viewport.bottom,
          propertyLeft: property.left, propertyRight: property.right, propertyTop: property.top,
          propertyBottom: property.bottom, areaBottom: rect(".model-area").bottom,
          identityTop: identity.top, formTop: form.top, identityRight: identity.right, formLeft: form.left };
      });
      expect(layout.propertyLeft).toBe(layout.viewLeft);
      expect(layout.propertyRight).toBe(layout.viewRight);
      expect(layout.viewBottom).toBeLessThanOrEqual(layout.propertyTop);
      expect(layout.propertyBottom).toBe(layout.areaBottom);
      expect(layout.identityTop).toBe(layout.formTop);
      expect(layout.identityRight).toBeLessThanOrEqual(layout.formLeft);
      await page.screenshot({ path: testInfo.outputPath(`bottom-properties-${width}.png`) });
    }

    await separator.focus();
    await separator.press("Home");
    await expect(separator).toHaveAttribute("aria-valuenow", "160");
    const handle = await separator.boundingBox();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y - 60, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Number(await separator.getAttribute("aria-valuenow"))).toBeGreaterThan(210);
    const resizedHeight = await separator.getAttribute("aria-valuenow");
    const initialCanvasHeight = await page.locator(".viewport canvas").evaluate((canvas) => canvas.getBoundingClientRect().height);
    await properties.getByRole("button", { name: "收起属性面板", exact: true }).click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => page.locator(".viewport canvas").evaluate((canvas) => canvas.getBoundingClientRect().height)).toBeGreaterThan(initialCanvasHeight);
    await toggle.click();
    await expect(properties.getByLabel("X 坐标")).toHaveValue("9.5");
    await expect(separator).toHaveAttribute("aria-valuenow", resizedHeight!);
    await expect(properties.getByText("1.000 m", { exact: true })).toBeVisible();
    await properties.getByRole("button", { name: "保存节点属性" }).click();
    await expect(properties.getByText("9.500 m", { exact: true })).toBeVisible();
    await expectRenderedCanvas(page);
  } finally {
    await app.close();
  }
});

test("UI05 keeps the merged titlebar and every panel combination inside supported window sizes", async ({}, testInfo) => {
  const { app, page } = await launchFrameMind();
  try {
    for (const [width, height] of [[1440, 900], [1080, 680]]) {
      await app.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height);
      }, { width, height });
      for (const [resourceOpen, propertyOpen, assistantOpen] of [[true, true, true], [false, true, true], [false, false, true], [true, false, true], [true, false, false], [false, false, false], [false, true, false], [true, true, false]]) {
        for (const [name, open] of [["切换资源管理器", resourceOpen], ["切换属性面板", propertyOpen], ["切换 AI 对话", assistantOpen]] as const) {
          const button = page.getByRole("button", { name, exact: true });
          if (await button.getAttribute("aria-pressed") !== String(open)) await button.click();
        }
        await expect.poll(async () => page.locator(".viewport canvas").evaluate((canvas) => {
          const viewport = document.querySelector(".viewport")!.getBoundingClientRect();
          return Math.abs(canvas.getBoundingClientRect().width - viewport.width);
        })).toBeLessThan(2);
        const layout = await page.evaluate(() => {
          const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
          return {
            width: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            height: document.documentElement.clientHeight,
            scrollHeight: document.documentElement.scrollHeight,
            titleBottom: rect(".topbar").bottom,
            toolsTop: rect(".task-toolbar").top,
            tabsRight: rect(".task-tabs").right,
            documentLeft: rect(".document-title").left,
            documentRight: rect(".document-title").right,
            controlsLeft: rect(".layout-controls").left,
            controlsRight: rect(".layout-controls").right,
          };
        });
        expect(layout.scrollWidth).toBe(layout.width);
        expect(layout.scrollHeight).toBe(layout.height);
        expect(layout.toolsTop).toBe(layout.titleBottom);
        expect(layout.tabsRight).toBeLessThanOrEqual(layout.documentLeft);
        expect(layout.documentRight).toBeLessThanOrEqual(layout.controlsLeft);
        expect(layout.controlsRight).toBeLessThanOrEqual(layout.width - 138);
        await expect(page.getByRole("button", { name: "资源管理器", exact: true })).toBeVisible();
        await expectRenderedCanvas(page);
        await page.screenshot({ path: testInfo.outputPath(`layout-${width}-${resourceOpen}-${propertyOpen}-${assistantOpen}.png`) });
      }
    }
  } finally {
    await app.close();
  }
});
