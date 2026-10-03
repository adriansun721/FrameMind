import { expect, test } from "@playwright/test";
import { desktop } from "./frame-proposal-actions";

test("composer keeps focused text inside its outline with compact controls", async () => {
  await desktop(async (app, page) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const composer = page.locator(".assistant-composer");
    const field = page.getByLabel("AI 消息草稿");
    const resizer = page.getByRole("separator", { name: "调整 AI 对话面板宽度" });
    for (const theme of ["dark", "light"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "设置", exact: true });
      await settings.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
      await settings.getByRole("button", { name: "关闭", exact: true }).click();
      for (const width of ["Home", "End"]) {
        await resizer.focus(); await resizer.press(width);
        await field.fill(""); await field.focus();
        const input = (await field.boundingBox())!;
        const metrics = await composer.evaluate((element) => {
          const form = element as HTMLFormElement;
          const textarea = form.querySelector("textarea")!;
          const button = form.querySelector(".ai-send-button") as HTMLButtonElement;
          const bounds = form.getBoundingClientRect();
          const scale = bounds.width / form.offsetWidth;
          const inputBounds = textarea.getBoundingClientRect();
          const style = getComputedStyle(textarea);
          return {
            topInset: (inputBounds.top - bounds.top) / scale + parseFloat(style.paddingTop),
            leftInset: (inputBounds.left - bounds.left) / scale + parseFloat(style.paddingLeft),
            buttonWidth: button.offsetWidth, buttonHeight: button.offsetHeight,
            bottomInset: (bounds.bottom - button.getBoundingClientRect().bottom) / scale,
            height: form.offsetHeight,
          };
        });
        expect(metrics.topInset).toBeGreaterThanOrEqual(10);
        expect(metrics.leftInset).toBeGreaterThanOrEqual(12);
        expect(metrics.buttonWidth).toBeLessThanOrEqual(28);
        expect(metrics.buttonHeight).toBe(metrics.buttonWidth);
        expect(metrics.bottomInset).toBeGreaterThan(4);
        expect(metrics.height).toBeLessThan(85);
        await field.fill("第一行\n第二行\n第三行");
        expect((await field.boundingBox())!.height).toBeGreaterThan(input.height);
        await field.fill("检查结构参数和构件截面。".repeat(200));
        await field.press("End");
        const layout = await field.evaluate((element) => {
          const textarea = element as HTMLTextAreaElement;
          const bounds = textarea.getBoundingClientRect();
          const controls = textarea.form!.querySelector(".assistant-composer-actions")!.getBoundingClientRect();
          return { bottom: bounds.bottom, controlsTop: controls.top, scrolls: textarea.scrollHeight > textarea.clientHeight, overflows: textarea.scrollWidth > textarea.clientWidth };
        });
        expect(layout.bottom).toBeLessThanOrEqual(layout.controlsTop);
        expect(layout.scrolls).toBe(true);
        expect(layout.overflows).toBe(false);
        await field.fill("核对层高、跨度与截面。"); await field.focus();
        await composer.screenshot({ path: `test-results/ai-composer-${theme}-${width}.png` });
      }
    }
    await app.evaluate(() => { globalThis.fetch = () => new Promise<Response>(() => {}); });
    await field.press("Enter");
    const pause = page.getByRole("button", { name: "暂停输出", exact: true });
    await expect(pause).toBeVisible();
    expect((await pause.boundingBox())!.width).toBeLessThanOrEqual(28);
    await composer.screenshot({ path: "test-results/ai-composer-busy.png" });
    await pause.click();
    await expect(page.getByRole("button", { name: "继续输出", exact: true })).toBeVisible();
  });
});
