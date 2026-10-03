import { expect, test } from "@playwright/test";
import { desktop, parameters, replay, save, send } from "./frame-proposal-actions";
import { openProposalView, proposalDrawer } from "./proposal-drawer-actions";

test("compact card keeps local edits separate from text updates and previews in both themes", async () => {
  await desktop(async (app, page, path) => {
    await replay(app, parameters); await send(page, "建立两层刚架");
    const card = page.getByRole("region", { name: "建模参数卡片" });
    await expect(card.locator("input, select")).toHaveCount(0);
    expect(await card.getByRole("button").allTextContents()).toEqual(["详情", "编辑", "确认建模"]);
    await openProposalView(page, card, "edit");
    const editor = proposalDrawer(page);
    await editor.getByLabel("X 向跨长 (m)", { exact: true }).fill("8");
    await expect(page.getByLabel("未应用三维方案")).toBeVisible();
    await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeDisabled();
    await expect(card).toContainText("侧栏有未保存编辑");
    expect((await save(page, path)).nodes).toHaveLength(0);
    await editor.getByRole("button", { name: "取消编辑", exact: true }).click();
    await openProposalView(page, card, "edit");
    await expect(editor.getByLabel("X 向跨长 (m)", { exact: true })).toHaveValue("6");
    await editor.getByLabel("X 向跨长 (m)", { exact: true }).fill("8");
    await editor.getByRole("button", { name: "更新预览", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await replay(app, { storeyHeights: { value: [3, 4], source: "user", replace: true } });
    await send(page, "第二层改成4米，其他保持当前方案");
    await expect(card).toContainText("3, 4 m");
    await expect(card).toContainText("X：8 m");
    for (const theme of ["dark", "light"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "设置", exact: true });
      await settings.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
      await settings.getByRole("button", { name: "关闭", exact: true }).click();
      for (const width of [1440, 1080]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 900), width);
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `docs/evidence/compact-cards/${theme}-${width}-summary.png` });
        await openProposalView(page, card, "edit");
        const bounds = await editor.boundingBox();
        const viewport = await page.locator(".viewport").boundingBox();
        expect(bounds!.width).toBeGreaterThan(450);
        expect(bounds!.x - viewport!.x).toBeGreaterThan(150);
        expect(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth)).toBe(true);
        await page.screenshot({ path: `docs/evidence/compact-cards/${theme}-${width}-editor.png` });
        await editor.getByRole("button", { name: "取消编辑", exact: true }).click();
      }
    }
    await card.getByRole("button", { name: "确认建模", exact: true }).click();
    await expect(card).toHaveCount(0);
    const applied = await save(page, path);
    expect(applied.nodes.at(-1).position).toEqual({ x: 8, y: 4, z: 7 });
    await expect(page.locator(".ai-turn").last().getByText("操作详情 · 1 项", { exact: true })).toBeVisible();
  });
});
