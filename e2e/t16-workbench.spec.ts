import { expect, test, type Page } from "@playwright/test";
import { launchFrameMind } from "./electron-app";
import { createNode } from "./modeling-actions";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("T16 restores the chosen theme after a real desktop restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t16-theme-"));
  let desktop = await launchFrameMind({ userDataPath: directory });
  try {
    await desktop.page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = desktop.page.getByRole("dialog", { name: "设置" });
    await settings.getByRole("button", { name: "浅色", exact: true }).click();
    await expect(desktop.page.locator(":root")).toHaveCSS("color-scheme", "light");
    await expect(settings.getByRole("button", { name: "浅色", exact: true })).toHaveAttribute("aria-pressed", "true");
    await desktop.app.close();
    desktop = await launchFrameMind({ userDataPath: directory });
    await expect(desktop.page.locator(":root")).toHaveCSS("color-scheme", "light");
    await desktop.page.getByRole("button", { name: "设置", exact: true }).click();
    await desktop.page.getByRole("button", { name: "深色", exact: true }).click();
    await expect(desktop.page.locator(":root")).toHaveCSS("color-scheme", "dark");
  } finally {
    await desktop.app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("T16 independently collapses properties without losing selection or edits", async () => {
  const { app, page } = await launchFrameMind();
  try {
    await createNode(page, ["1", "2", "3"]);
    const properties = page.getByRole("region", { name: "对象属性" });
    await properties.getByLabel("X 坐标").fill("4.5");
    const initialHeight = await page.locator(".viewport canvas").evaluate((canvas) => canvas.getBoundingClientRect().height);
    await page.getByRole("button", { name: "收起属性面板", exact: true }).click();
    await expect(properties).toBeHidden();
    await expect(page.getByRole("region", { name: "项目树" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "AI 对话" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("当前选择 N1");
    await expect.poll(() => page.locator(".viewport canvas").evaluate((canvas) => canvas.getBoundingClientRect().height)).toBeGreaterThan(initialHeight);
    await page.getByRole("button", { name: "切换属性面板", exact: true }).click();
    await expect(properties.getByLabel("X 坐标")).toHaveValue("4.5");
    const nodesGroup = page.getByRole("button", { name: "节点", exact: true });
    await nodesGroup.click();
    await expect(page.locator(".tree-item.selected")).toBeHidden();
    await expect(properties.getByLabel("X 坐标")).toHaveValue("4.5");
    await nodesGroup.click();
    await expect(page.locator(".tree-item.selected")).toBeVisible();
    await properties.getByRole("button", { name: "保存节点属性" }).click();
    await expect(properties.getByText("4.500 m", { exact: true })).toBeVisible();
    const layout = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      return { treeRight: rect(".project-panel").right, viewLeft: rect(".model-area").left,
        viewRight: rect(".model-area").right, propertyLeft: rect(".property-pane").left, viewportBottom: rect(".viewport").bottom, propertyTop: rect(".property-pane").top,
        propertyRight: rect(".property-pane").right, assistantLeft: rect(".assistant-panel").left };
    });
    expect(layout.treeRight).toBeLessThanOrEqual(layout.viewLeft);
    expect(layout.viewLeft).toBe(layout.propertyLeft);
    expect(layout.viewRight).toBe(layout.propertyRight);
    expect(layout.viewportBottom).toBeLessThanOrEqual(layout.propertyTop);
    expect(layout.propertyRight).toBeLessThanOrEqual(layout.assistantLeft);
  } finally { await app.close(); }
});

async function canvasPixels(page: Page) {
  const png = await page.locator(".viewport canvas").screenshot();
  return page.evaluate(async (base64) => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const styles = getComputedStyle(document.documentElement);
    const tokens = ["--surface-canvas", "--model-support", "--model-load", "--model-moment", "--model-deformation", "--model-force"];
    const counts: Record<string, number> = {};
    const colorCanvas = document.createElement("canvas"); colorCanvas.width = colorCanvas.height = 1;
    const colorContext = colorCanvas.getContext("2d")!;
    for (const token of tokens) {
      colorContext.fillStyle = styles.getPropertyValue(token).trim(); colorContext.fillRect(0, 0, 1, 1);
      const rgb = Array.from(colorContext.getImageData(0, 0, 1, 1).data).slice(0, 3);
      let count = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (rgb.every((value, channel) => Math.abs(value - pixels[index + channel]) <= 8)) count++;
      }
      counts[token] = count;
    }
    return { counts, total: canvas.width * canvas.height };
  }, png.toString("base64"));
}

test("T16 renders a spatial model, loads and actual results in both themes", async () => {
  test.setTimeout(90000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t16-visual-"));
  const { app, page } = await launchFrameMind({ userDataPath: directory });
  try {
    await createNode(page, ["0", "0", "0"]);
    await createNode(page, ["0", "0", "3"]);
    await createNode(page, ["4", "2", "4"]);
    await page.getByRole("button", { name: "创建材料与截面" }).click();
    await page.getByRole("button", { name: "保存材料与截面" }).click();
    for (const [start, end] of [["node_0001", "node_0002"], ["node_0002", "node_0003"]]) {
      await page.getByRole("button", { name: "创建杆件" }).click();
      const member = page.getByRole("dialog", { name: "连接空间杆件" });
      await member.getByLabel("起点节点").selectOption(start);
      await member.getByLabel("终点节点").selectOption(end);
      await member.getByRole("button", { name: "添加杆件" }).click();
    }
    await page.getByRole("button", { name: "设置支座" }).click();
    await page.getByRole("button", { name: "添加支座" }).click();
    await page.getByRole("button", { name: "荷载", exact: true }).click(); await page.getByRole("menuitem", { name: "创建荷载" }).click();
    const load = page.getByRole("dialog", { name: "创建节点集中荷载" });
    await load.getByLabel("FZ").fill("-12");
    await load.getByLabel("MY").fill("4");
    await load.getByRole("button", { name: "添加节点荷载" }).click();
    await page.getByRole("button", { name: "荷载", exact: true }).click(); await page.getByRole("menuitem", { name: "创建均布荷载" }).click();
    const uniform = page.getByRole("dialog", { name: "创建杆件均布荷载" });
    await uniform.getByLabel("加载杆件").selectOption("member_0002");
    await uniform.getByLabel("qz", { exact: true }).fill("-2");
    await uniform.getByRole("button", { name: "添加均布荷载" }).click();
    await page.getByRole("button", { name: "运行分析" }).click();
    await expect(page.getByRole("status")).toContainText("分析完成");
    await page.getByRole("button", { name: "适合模型" }).click();
    await expect(page.getByRole("button", { name: "工程计算书", exact: true })).toBeVisible();
    for (const [width, height] of [[1440, 900], [1080, 680]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height), { width, height });
      for (const theme of ["dark", "light"]) {
        const camera = await page.locator(".viewport").getAttribute("data-camera-state");
        await page.getByRole("button", { name: "设置", exact: true }).click();
        await page.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
        await page.getByRole("dialog", { name: "设置" }).getByRole("button", { name: "关闭", exact: true }).click();
        await expect(page.locator(".viewport")).toHaveAttribute("data-camera-state", camera!);
        const contrasts = await page.evaluate(() => {
          const styles = getComputedStyle(document.documentElement);
          const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d")!;
          const luminance = (token: string) => {
            context.fillStyle = styles.getPropertyValue(token).trim(); context.fillRect(0, 0, 1, 1);
            const channels = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map((value) => value / 255)
              .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
            return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
          };
          const background = luminance("--surface-panel");
          return ["--text-primary", "--text-secondary", "--text-muted", "--status-error"].map((token) => {
            const foreground = luminance(token);
            return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
          });
        });
        for (const contrast of contrasts) expect(contrast).toBeGreaterThanOrEqual(4.5);
        for (const [tab, mode] of [["结果表", "model"], ["变形图", "deformation"], ["内力图", "forces"]]) {
          await page.getByRole("tab", { name: tab, exact: true }).click();
          if (mode === "deformation") await page.getByLabel("变形放大比例").fill("25");
          if (mode === "forces") await page.getByLabel("内力分量", { exact: true }).selectOption("My");
          await page.getByRole("button", { name: "适合模型" }).click();
          const pixels = await canvasPixels(page);
          expect(pixels.counts["--surface-canvas"]).toBeGreaterThan(pixels.total * 0.3);
          expect(pixels.counts["--surface-canvas"]).toBeLessThan(pixels.total * 0.995);
          expect(pixels.counts["--model-support"], `${theme}/${mode}/${width}: ${JSON.stringify(pixels)}`).toBeGreaterThan(3);
          expect(pixels.counts["--model-load"]).toBeGreaterThan(3);
          expect(pixels.counts["--model-moment"]).toBeGreaterThan(3);
          if (mode !== "model") expect(pixels.counts[mode === "forces" ? "--model-force" : "--model-deformation"]).toBeGreaterThan(3);
          const rects = await page.evaluate(() => {
            const selectors = [".project-panel", ".model-area", ".assistant-panel"];
            return selectors.map((selector) => { const rect = document.querySelector(selector)!.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width }; });
          });
          for (let i = 1; i < rects.length; i++) expect(rects[i].left).toBeGreaterThanOrEqual(rects[i - 1].right);
          expect(rects[1].width).toBeGreaterThanOrEqual(300);
          await page.screenshot({ path: `docs/evidence/T16-${theme}-${mode}-${width}.png` });
        }
      }
    }
    const tree = page.getByRole("region", { name: "项目树" });
    await tree.getByText("B1 · N1", { exact: true }).click();
    await expect(page.getByLabel("选中节点信息")).toContainText("约束 Ux · Uy · Uz · Rx · Ry · Rz");
    await tree.getByText("L1 · N3", { exact: true }).click();
    await expect(page.getByLabel("选中节点信息")).toContainText("F (0, 0, -12) kN");
    await expect(page.getByLabel("选中节点信息")).toContainText("M (0, 4, 0) kN·m");
    await tree.getByText("N1", { exact: true }).click();
    const properties = page.getByRole("region", { name: "对象属性" });
    await properties.getByLabel("X 坐标").fill("");
    await properties.getByRole("button", { name: "保存节点属性" }).click();
    await expect(properties.getByRole("alert")).toHaveText("X 坐标不能为空");
    for (const theme of ["dark", "light"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
      await page.getByRole("dialog", { name: "设置" }).getByRole("button", { name: "关闭", exact: true }).click();
      await page.screenshot({ path: `docs/evidence/T16-${theme}-selection-error-1080.png` });
    }
    const cameraBefore = await page.locator(".viewport").getAttribute("data-camera-state");
    const canvas = await page.locator(".viewport canvas").boundingBox();
    await page.mouse.move(canvas!.x + canvas!.width * 0.4, canvas!.y + canvas!.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(canvas!.x + canvas!.width * 0.6, canvas!.y + canvas!.height * 0.5, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator(".viewport")).not.toHaveAttribute("data-camera-state", cameraBefore!);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
