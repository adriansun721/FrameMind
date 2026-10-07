import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { desktop, parameters, replay, save, send } from "./frame-proposal-actions";
import { createNode } from "./modeling-actions";
import { openProposalView, proposalDrawer } from "./proposal-drawer-actions";

const evidence = "docs/evidence/plan2/T2-39";
const audit = process.env.FRAMEMIND_T239_AUDIT === "1";

async function theme(page: Page, value: "dark" | "light") {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await settings.getByRole("button", { name: value === "dark" ? "深色" : "浅色", exact: true }).click();
  if (!audit) {
    const font = await settings.getByLabel("DeepSeek 模型").evaluate((select) => ({ actual: getComputedStyle(select).fontFamily, expected: getComputedStyle(document.body).fontFamily }));
    expect(font.actual).toBe(font.expected);
  }
  await settings.getByRole("button", { name: "关闭", exact: true }).click();
}

test("T2-39 readable workbench at both window sizes, themes and sidebar limits", async () => {
  test.setTimeout(120000);
  await mkdir(evidence, { recursive: true });
  await desktop(async (app, page) => {
    await createNode(page, ["-0.00000000012345678", "-234567.12345", "3.12345"]);
    const properties = page.getByRole("region", { name: "对象属性" });
    await properties.getByLabel("X 坐标").fill("");
    await properties.getByRole("button", { name: "保存节点属性" }).click();
    await expect(properties.getByRole("alert")).toHaveText("X 坐标不能为空");
    await replay(app, parameters);
    await send(page, "建立两层刚架，保留待确认草案。工程说明：" + "较长的文字与编号用于核查换行。".repeat(8) + "ProjectReference_".repeat(10));
    const card = page.getByRole("region", { name: "建模参数卡片" });
    await expect(card).toBeVisible();
    await page.getByLabel("AI 消息草稿").fill("未发送的多行输入\n保留中文、123456.789 和 kN·m");
    const measurements: unknown[] = [];
    for (const [width, height] of [[1440, 900], [1080, 680]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height), { width, height });
      for (const value of ["dark", "light"] as const) {
        await theme(page, value);
        for (const narrow of [false, true]) {
          const left = page.getByRole("separator", { name: "调整项目面板宽度" });
          const right = page.getByRole("separator", { name: "调整 AI 对话面板宽度" });
          await left.focus(); await page.keyboard.press(narrow ? "Home" : "End");
          await right.focus(); await page.keyboard.press(narrow ? "Home" : "End");
          await card.getByRole("button", { name: "确认建模", exact: true }).scrollIntoViewIfNeeded();
          await properties.locator(".coordinates-list").scrollIntoViewIfNeeded();
          const reading = await page.evaluate(() => {
            const rect = (selector: string) => {
              const r = document.querySelector(selector)!.getBoundingClientRect();
              return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
            };
            const overflow = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)]
              .filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => ({ text: e.textContent, width: e.clientWidth, scroll: e.scrollWidth }));
            const rgb = (color: string) => color.match(/[\d.]+/g)!.map(Number);
            const background = (e: Element): number[] => {
              const color = rgb(getComputedStyle(e).backgroundColor);
              return color.length < 4 || color[3] === 1 ? color : e.parentElement ? background(e.parentElement) : [26, 26, 26];
            };
            const luminance = (color: number[]) => color.slice(0, 3).map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
              .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
            const contrasts = [".field > span", ".field em", ".field input", ".form-error", ".proposal-summary dt", ".proposal-confirm", ".unit-preset-selector", ".tree-item.selected"]
              .map((selector) => {
                const e = document.querySelector(selector)!;
                const foreground = luminance(rgb(getComputedStyle(e).color)), bg = luminance(background(e));
                return { selector, ratio: (Math.max(foreground, bg) + 0.05) / (Math.min(foreground, bg) + 0.05) };
              });
            const card = rect(".proposal-summary-card"), composer = rect(".assistant-composer");
            const buttons = [...document.querySelectorAll<HTMLElement>(".proposal-card-actions button, .assistant-composer-actions button")].map((e) => {
              const r = e.getBoundingClientRect();
              const container = e.closest(".proposal-summary-card") ? card : composer;
              return { label: e.getAttribute("aria-label") ?? e.textContent, fits: r.left >= container.left && r.right <= container.right && r.top >= container.top && r.bottom <= container.bottom };
            });
            return { window: { width: innerWidth, height: innerHeight }, documentFits: document.documentElement.scrollWidth === innerWidth,
              model: rect(".model-area"), assistant: rect(".assistant-panel"), composer, buttons, contrasts,
              overflow: overflow(".proposal-summary-card, .assistant-composer, .coordinates-list dd, .property-form, .form-error"),
              numericInputWidth: document.querySelector('input[aria-label="Y 坐标"]')!.getBoundingClientRect().width,
              selectFont: getComputedStyle(document.querySelector(".unit-preset-selector")!).fontFamily,
              bodyFont: getComputedStyle(document.body).fontFamily };
          });
          measurements.push({ width, height, theme: value, narrow, ...reading });
          await page.screenshot({ path: `${evidence}/${audit ? "before" : "after"}-${value}-${width}-${narrow ? "narrow" : "wide"}.png` });
          if (!audit) {
            expect(reading.documentFits).toBe(true);
            expect(reading.model.width).toBeGreaterThanOrEqual(360);
            expect(reading.composer.bottom).toBeLessThanOrEqual(height - 23);
            expect(reading.buttons.every((button) => button.fits), JSON.stringify(reading.buttons)).toBe(true);
            expect(reading.overflow, JSON.stringify(reading.overflow)).toEqual([]);
            expect(reading.numericInputWidth).toBeGreaterThanOrEqual(100);
            for (const contrast of reading.contrasts) expect(contrast.ratio, `${value}: ${contrast.selector}`).toBeGreaterThanOrEqual(4.5);
            await expect(properties.getByLabel("X 坐标")).toHaveValue("");
            await expect(properties.getByRole("alert")).toHaveText("X 坐标不能为空");
            await expect(page.getByLabel("AI 消息草稿")).toHaveValue("未发送的多行输入\n保留中文、123456.789 和 kN·m");
          }
        }
      }
    }
    await writeFile(`${evidence}/${audit ? "audit" : "desktop"}.json`, JSON.stringify(measurements, null, 2));
    if (audit) return;

    // Local draft state survives visual layout changes and keyboard navigation.
    await openProposalView(page, card, "edit");
    const editor = proposalDrawer(page);
    const span = editor.getByLabel("X 向跨长 (m)", { exact: true });
    await span.fill("8.125");
    await theme(page, "dark");
    await expect(span).toHaveValue("8.125");
    await expect(card).toContainText("侧栏有未保存编辑");
    await editor.getByRole("button", { name: "取消编辑", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    await expect(card.getByRole("button", { name: "编辑", exact: true })).toBeFocused();

    await page.getByRole("button", { name: "收起属性面板", exact: true }).click();
    await page.getByRole("button", { name: "切换属性面板", exact: true }).click();
    await expect(properties.getByLabel("X 坐标")).toHaveValue("");
    await properties.getByLabel("X 坐标").fill("-12.3456789");
    const separator = page.getByRole("separator", { name: "调整属性面板高度" });
    await separator.focus(); await page.keyboard.press("Home");
    const before = Number(await separator.getAttribute("aria-valuenow"));
    await page.keyboard.press("ArrowUp");
    expect(Number(await separator.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
    const bounds = await separator.boundingBox();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await page.mouse.down(); await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y - 35, { steps: 5 }); await page.mouse.up();
    expect(Number(await separator.getAttribute("aria-valuenow"))).toBeGreaterThan(before + 16);
    await expect(properties.getByLabel("X 坐标")).toHaveValue("-12.3456789");
    await properties.getByRole("button", { name: "保存节点属性" }).focus(); await page.keyboard.press("Enter");
    await expect(properties.getByText("-12.345679 m", { exact: true })).toBeVisible();
    await expect(page.getByLabel("未保存修改", { exact: true })).toBeVisible();
    const right = page.getByRole("separator", { name: "调整 AI 对话面板宽度" });
    const oldWidth = Number(await right.getAttribute("aria-valuenow"));
    const rightBounds = await right.boundingBox();
    await page.mouse.move(rightBounds!.x + 3, rightBounds!.y + 100);
    await page.mouse.down(); await page.mouse.move(rightBounds!.x - 40, rightBounds!.y + 100, { steps: 5 }); await page.mouse.up();
    expect(Number(await right.getAttribute("aria-valuenow"))).toBeGreaterThan(oldWidth);
    await page.getByRole("button", { name: "切换 AI 对话", exact: true }).click();
    await expect(page.getByLabel("AI 消息草稿")).toBeHidden();
    await page.getByRole("button", { name: "切换 AI 对话", exact: true }).click();
    await expect(page.getByLabel("AI 消息草稿")).toHaveValue("未发送的多行输入\n保留中文、123456.789 和 kN·m");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const motion = await page.locator(".button").first().evaluate((button) => getComputedStyle(button).transitionDuration);
    expect(parseFloat(motion)).toBeLessThanOrEqual(0.00001);
    // Editing the model correctly expires the draft; its inspection remains available.
    await card.getByRole("button", { name: "详情", exact: true }).click();
    await expect(proposalDrawer(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card.getByRole("button", { name: "详情", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await app.evaluate(() => { globalThis.fetch = () => new Promise<Response>(() => {}); });
    await page.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(page.getByTestId("deepseek-feedback")).toContainText("正在处理连接");
    await expect(page.locator(".spin")).toHaveCSS("animation-name", "none");
    await page.screenshot({ path: `${evidence}/reduced-motion-focus.png` });
  });
});

test("T2-39 complete task keeps long labels and confirmation usable in narrow panels", async () => {
  await desktop(async (app, page, path) => {
    await createNode(page, ["0", "0", "0"]);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1080, 680));
    const goal = "保留人工节点，准备一份长说明的集中荷载草案：" + "LongEngineeringReference_".repeat(30);
    await replay(app, { goal, supports: [{ nodeId: "node_0001", restraints: [true, true, true, true, true, true], source: "user" }], nodalLoads: [{ nodeId: "node_0001", loadCaseId: "LC1", force: { x: 0, y: 0, z: -3 }, moment: { x: 0, y: 0, z: 0 }, source: "user" }], analysis: { requested: false, source: "user" } }, "propose_task");
    await send(page, "仅准备上述荷载，核对后一次确认，不计算");
    const card = page.getByRole("region", { name: "完整任务草案" });
    const right = page.getByRole("separator", { name: "调整 AI 对话面板宽度" });
    await right.focus(); await page.keyboard.press("Home");
    for (const value of ["dark", "light"] as const) {
      await theme(page, value);
      await card.getByRole("button", { name: "确认整体任务", exact: true }).scrollIntoViewIfNeeded();
      const reading = await card.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return {
          overflow: element.scrollWidth > element.clientWidth + 1,
          labels: [...element.querySelectorAll("dt")].map((label) => label.getBoundingClientRect().height),
          buttons: [...element.querySelectorAll(".proposal-card-actions button")].map((button) => {
            const b = button.getBoundingClientRect(); return b.left >= r.left && b.right <= r.right;
          }),
        };
      });
      expect(reading.overflow).toBe(false);
      expect(reading.labels.every((height) => height <= 22)).toBe(true);
      expect(reading.buttons.every(Boolean)).toBe(true);
      await page.screenshot({ path: `${evidence}/task-${value}-1080-narrow.png` });
    }
    await expect(page.locator(".ai-task-timeline")).toContainText("整理完整任务草案");
    expect((await save(page, path)).nodalLoads).toHaveLength(0);
    await expect(card.getByRole("button", { name: "确认整体任务", exact: true })).toBeEnabled();
    await card.getByRole("button", { name: "确认整体任务", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(card).toHaveCount(0);
    const result = await save(page, path);
    expect(result.nodalLoads).toHaveLength(1);
    expect(result.nodalLoads[0].force.z).toBe(-3);
    expect(result.analysisResults).toHaveLength(0);
    await page.keyboard.press("Control+z");
    expect((await save(page, path)).nodalLoads).toHaveLength(0);
  });
});

test("T2-39 narrow resource editor retains long names, errors and numeric drafts", async () => {
  await desktop(async (app, page) => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1080, 680));
    const left = page.getByRole("separator", { name: "调整项目面板宽度" });
    await left.focus(); await page.keyboard.press("Home");
    await page.getByRole("navigation", { name: "侧边导航" }).getByRole("button", { name: "资源库", exact: true }).click();
    const panel = page.getByRole("complementary", { name: "资源库", exact: true });
    await panel.getByRole("button", { name: "新增自定义材料", exact: true }).click();
    const name = "较长的中文材料名称 MixedMaterial_" + "Reference".repeat(8);
    await panel.getByLabel("材料名称", { exact: true }).fill(name);
    await panel.getByLabel("弹性模量 E", { exact: true }).fill("-207.123456789");
    await panel.getByRole("button", { name: "保存到资源库", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("弹性模量必须为正");
    for (const value of ["dark", "light"] as const) {
      await theme(page, value);
      await panel.getByRole("button", { name: "保存到资源库", exact: true }).scrollIntoViewIfNeeded();
      const reading = await panel.evaluate((element) => {
        const name = element.querySelector<HTMLInputElement>('input[aria-label="材料名称"]')!;
        const number = element.querySelector<HTMLInputElement>('input[aria-label="弹性模量 E"]')!;
        const alert = element.querySelector<HTMLElement>('[role="alert"]')!;
        return { textFont: getComputedStyle(name).fontFamily, numberFont: getComputedStyle(number).fontFamily,
          bodyFont: getComputedStyle(document.body).fontFamily, errorFits: alert.scrollWidth <= alert.clientWidth + 1 };
      });
      expect(reading.textFont).toBe(reading.bodyFont);
      expect(reading.numberFont).not.toBe(reading.textFont);
      expect(reading.errorFits).toBe(true);
      await panel.getByRole("alert").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${evidence}/library-error-${value}-1080-narrow.png` });
    }
    await page.getByRole("button", { name: "切换资源管理器", exact: true }).click();
    await page.getByRole("button", { name: "切换资源管理器", exact: true }).click();
    await expect(panel.getByLabel("材料名称", { exact: true })).toHaveValue(name);
    await expect(panel.getByLabel("弹性模量 E", { exact: true })).toHaveValue("-207.123456789");
    await panel.getByLabel("弹性模量 E", { exact: true }).fill("207.123456789");
    await panel.getByRole("button", { name: "保存到资源库", exact: true }).click();
    await expect(panel.getByRole("button", { name, exact: true })).toBeVisible();
    await page.screenshot({ path: `${evidence}/library-long-name-light-1080-narrow.png` });
  });
});
