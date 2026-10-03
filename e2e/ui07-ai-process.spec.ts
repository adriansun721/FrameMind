import { expect, test } from "@playwright/test";
import { desktop, parameters, replay, save, send } from "./frame-proposal-actions";
import { openProposalView, proposalDrawer } from "./proposal-drawer-actions";

test("thinking appears immediately, animates, pauses and uses neutral text in both themes", async () => {
  await desktop(async (app, page) => {
    await app.evaluate(() => {
      const state = { requests: 0, release: undefined as (() => void) | undefined };
      (globalThis as typeof globalThis & { processFixture?: typeof state }).processFixture = state;
      globalThis.fetch = () => new Promise<Response>((resolve) => {
        state.requests += 1;
        state.release = () => resolve(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "你好，请告诉我结构参数。" } }] })));
      });
    });
    await page.getByLabel("AI 消息草稿").fill("你好");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const timeline = page.getByRole("region", { name: "处理过程" });
    await expect(timeline).toContainText("思考中");
    await expect(timeline).toHaveAttribute("aria-busy", "true");
    await expect(timeline.locator(".active .ai-process-dot")).toHaveCSS("animation-name", "ai-thinking-pulse");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(timeline.locator(".active .ai-process-dot")).toHaveCSS("animation-name", "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByRole("button", { name: "暂停输出", exact: true }).click();
    await expect(timeline).toContainText("已暂停输出");
    await expect(timeline.locator(".active")).toHaveCount(0);
    await page.getByRole("button", { name: "继续输出", exact: true }).click();
    await expect(timeline).toContainText("思考中");
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { processFixture?: { requests: number } }).processFixture?.requests)).toBe(2);
    await app.evaluate(() => (globalThis as typeof globalThis & { processFixture?: { release?: () => void } }).processFixture?.release?.());
    const reply = page.locator(".ai-assistant-message");
    await expect(reply).toHaveText("你好，请告诉我结构参数。");
    await expect(timeline).toHaveAttribute("aria-busy", "false");
    await expect(timeline.locator(".active")).toHaveCount(0);
    await expect(page.getByText("执行详情 · 0 项", { exact: true })).toHaveCount(0);
    for (const theme of ["dark", "light"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "设置", exact: true });
      await settings.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
      await settings.getByRole("button", { name: "关闭", exact: true }).click();
      await expect(reply).toHaveCSS("color", theme === "dark" ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)");
      await expect(page.locator(".ai-workflow > .ai-user-message p")).toHaveCSS("color", theme === "dark" ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)");
      await expect(timeline).toHaveCSS("color", theme === "dark" ? "rgb(138, 138, 138)" : "rgb(98, 98, 98)");
      await page.screenshot({ path: `test-results/ai-process-${theme}.png` });
    }
    await timeline.getByRole("button", { name: "收起处理过程" }).click();
    await expect(timeline.locator("ol")).toHaveCount(0);
    await expect(reply).toBeVisible();
  });
});

test("missing input waits for the card, rejection retires it, and network failure ends the active step", async () => {
  await desktop(async (app, page) => {
    await replay(app, { storeys: { value: 2, source: "user" } });
    await send(page, "建立两层刚架");
    const timeline = page.getByRole("region", { name: "处理过程" });
    const card = page.getByRole("region", { name: "建模参数卡片" });
    await expect(timeline.locator(".issue")).toContainText("发现待补充参数");
    await expect(timeline.locator(".waiting")).toContainText("等待填写并确认建模参数");
    await expect(timeline.locator(".active")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "确认建模" })).toBeDisabled();
    await openProposalView(page, card, "actions");
    await proposalDrawer(page).getByRole("button", { name: "拒绝方案", exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(timeline.locator(".cancelled")).toContainText("建模参数已取消");
    await expect(timeline.locator(".active, .waiting")).toHaveCount(0);
    await app.evaluate(() => { globalThis.fetch = async () => { throw new Error("offline fixture"); }; });
    await page.getByLabel("AI 消息草稿").fill("读取当前模型");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const failed = page.getByRole("region", { name: "处理过程" }).last();
    await expect(failed).toContainText("处理未完成");
    await expect(failed.locator(".active, .waiting")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "重试消息", exact: true })).toBeEnabled();
  });
});

test("a text amendment supersedes the earlier waiting stage for the same card", async () => {
  await desktop(async (app, page) => {
    await replay(app, parameters);
    await send(page, "建立两层刚架");
    await replay(app, { xSpans: { value: [8], source: "user", replace: true } });
    await send(page, "X 向跨长改为8米");
    const timelines = page.getByRole("region", { name: "处理过程" });
    await expect(timelines.first()).toContainText("建模参数已更新");
    await expect(page.locator(".ai-process-step.waiting")).toHaveCount(1);
    await expect(timelines.last()).toContainText("等待填写并确认建模参数");
    await page.getByRole("button", { name: "确认建模", exact: true }).click();
    await expect(timelines.last()).toContainText("建模参数已确认");
    await expect(timelines.first()).not.toContainText("建模参数已确认");
    await expect(page.locator(".ai-process-step.waiting")).toHaveCount(0);
  });
});

test("retrying an earlier failed calculation keeps its task after an unrelated chat", async () => {
  await desktop(async (app, page) => {
    await replay(app, parameters);
    await send(page, "建立两层刚架");
    await page.getByRole("button", { name: "确认建模", exact: true }).click();
    await replay(app, { supports: [], nodalLoads: [], analysisSourceId: "LC1" }, "propose_analysis_conditions");
    await send(page, "准备条件并计算");
    await page.getByRole("button", { name: "确认并计算", exact: true }).click();
    const original = page.locator(".ai-workflow").nth(1);
    await expect(original.getByTestId("ai-turn-status").last()).toContainText("失败");
    await app.evaluate(() => { globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "你好" } }] })); });
    await send(page, "你好");
    const unrelated = page.locator(".ai-workflow").last();
    await original.getByRole("button", { name: "继续本地计算", exact: true }).click();
    await expect(original.getByRole("region", { name: "处理过程" }).getByText("处理未完成", { exact: true })).toHaveCount(2);
    await expect(unrelated).not.toContainText("检查并计算已确认模型");
    await expect(unrelated.locator(".ai-assistant-message")).toHaveText("你好");
  });
});

test("cards dock above the composer, retire after confirmation and continue the same vertical process", async () => {
  await desktop(async (app, page, path) => {
    await app.evaluate((_electron, fixture) => {
      globalThis.fetch = async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        if (request.messages.at(-1).content === "你好") return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "你好，有什么需要帮助的？" } }] }));
        const continuing = request.messages.at(-1).content.includes("建模阶段已确认");
        if (continuing) await new Promise<void>((resolve) => {
          (globalThis as typeof globalThis & { releaseConditions?: () => void }).releaseConditions = resolve;
        });
        const name = continuing ? "propose_analysis_conditions" : "propose_frame";
        const args = continuing ? {
          supports: [1, 2, 3, 4].map((n) => ({ nodeId: `node_${String(n).padStart(4, "0")}`, restraints: [true, true, true, true, true, true], source: "suggestion" })),
          nodalLoads: [{ nodeId: "node_0012", loadCaseId: "LC1", force: { x: 5, y: 0, z: -10 }, moment: { x: 0, y: 0, z: 0 }, source: "user" }],
        } : { parameters: fixture };
        return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: `process-${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] }));
      };
    }, parameters);
    await page.getByLabel("AI 消息草稿").fill("建立两层刚架并计算");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const log = page.getByRole("log", { name: "对话消息" });
    const dock = page.getByRole("region", { name: "待确认参数", exact: true });
    const card = page.getByRole("region", { name: "建模参数卡片" });
    const timeline = page.getByRole("region", { name: "处理过程" }).first();
    await expect(card).toBeVisible();
    await expect(log.getByRole("region", { name: "建模参数卡片" })).toHaveCount(0);
    await expect(dock.getByRole("region", { name: "建模参数卡片" })).toBeVisible();
    await expect(timeline.locator(".waiting")).toContainText("等待填写并确认建模参数");
    await expect(timeline.locator(".active")).toHaveCount(0);
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    for (const width of [1440, 1080]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 900), width);
      const cardBox = (await card.boundingBox())!;
      const composerBox = (await page.locator(".assistant-composer").boundingBox())!;
      expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(composerBox.y);
      expect(cardBox.y).toBeGreaterThan((await log.boundingBox())!.y);
      expect(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/ai-card-dock-${width}.png` });
    }
    await send(page, "你好");
    await expect(page.locator(".ai-assistant-message")).toHaveText("你好，有什么需要帮助的？");
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("X 向跨长 (m)", { exact: true }).fill("8");
    await expect(card.getByRole("button", { name: "确认建模" })).toBeDisabled();
    await proposalDrawer(page).getByRole("button", { name: "更新预览", exact: true }).click();
    await card.getByRole("button", { name: "确认建模", exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(timeline.locator(".done")).toContainText(["已整理请求", "整理建模参数", "建模参数已确认"]);
    await expect(timeline.locator(".active")).toContainText("思考中");
    await expect(page.getByRole("region", { name: "处理过程" })).toHaveCount(2);
    await expect(page.getByRole("region", { name: "处理过程" }).last()).not.toContainText("建模参数已确认");
    await timeline.getByText("建模参数已确认", { exact: true }).click();
    await expect(timeline).toContainText("X 向跨长 (m)：8");
    await expect.poll(() => app.evaluate(() => Boolean((globalThis as typeof globalThis & { releaseConditions?: () => void }).releaseConditions))).toBe(true);
    await app.evaluate(() => (globalThis as typeof globalThis & { releaseConditions?: () => void }).releaseConditions?.());
    const conditions = page.getByRole("region", { name: "分析条件卡片" });
    await expect(conditions).toBeVisible();
    await expect(timeline.locator(".waiting")).toContainText("等待填写并确认分析条件");
    await conditions.getByRole("button", { name: "确认并计算", exact: true }).click();
    await expect(conditions).toHaveCount(0);
    await expect(page.locator(".ai-workflow").first().getByTestId("ai-turn-status").last()).toContainText("本地分析完成");
    await expect(timeline.getByText("分析条件已确认", { exact: true })).toBeVisible();
    await timeline.getByText("分析条件已确认", { exact: true }).click();
    await expect(timeline).toContainText("FZ=-10 kN");
    await expect(timeline).toContainText("固结");
    await expect(timeline).toContainText("计算来源：默认工况");
    await expect(timeline.locator(".active, .waiting")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "待确认参数", exact: true })).toHaveCount(0);
    expect((await save(page, path)).analysisResults).toHaveLength(1);
    await page.screenshot({ path: "test-results/ai-process-confirmed.png" });
  });
});
