import { expect, test } from "@playwright/test";
import { desktop } from "./frame-proposal-actions";

test("AI home shows recent conversations, expands history and reopens the selected chat", async () => {
  await desktop(async (app, page) => {
    await app.evaluate(() => { globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "收到消息" } }] })); });
    const home = page.getByRole("region", { name: "历史对话列表" });
    await expect(home).toBeVisible();
    await expect(page.getByRole("region", { name: "首次使用引导" })).toHaveCount(0);
    const composer = page.locator(".assistant-composer");
    const field = page.getByLabel("AI 消息草稿");
    const fieldBox = (await field.boundingBox())!;
    const addBox = (await page.getByRole("button", { name: "添加附件或插件" }).boundingBox())!;
    const sendBox = (await page.getByRole("button", { name: "发送消息", exact: true }).boundingBox())!;
    expect(fieldBox.height).toBeGreaterThan(40);
    expect((await composer.boundingBox())!.height).toBeLessThan(110);
    expect(addBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height);
    expect(sendBox.x).toBeGreaterThan(addBox.x + addBox.width);
    await page.screenshot({ path: "test-results/ai-home.png" });
    for (let index = 1; index <= 4; index += 1) {
      await field.fill(`历史消息 ${index}`);
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await expect(home).toHaveCount(0);
      await expect(page.getByTestId("ai-turn-status").last()).toContainText("已完成");
      await page.getByRole("button", { name: "新建对话", exact: true }).click();
      await expect(home).toBeVisible();
    }
    await expect(home.locator(".ai-history-item")).toHaveCount(3);
    await home.getByRole("button", { name: "查看全部（4 个）" }).click();
    await expect(home.locator(".ai-history-item")).toHaveCount(4);
    await page.screenshot({ path: "test-results/ai-history.png" });
    await home.getByRole("button", { name: /历史消息 1/ }).click();
    await expect(page.getByRole("log")).toContainText("历史消息 1");
    await expect(page.getByRole("log")).not.toContainText("历史消息 4");
    await field.fill("接着问"); await field.press("Enter");
    await expect(page.getByTestId("ai-turn-status")).toHaveCount(2);
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已完成");
    await expect(composer).toBeVisible();
  });
});

test("AI control pauses and continues the same turn, rejects late output and returns to an arrow", async () => {
  await desktop(async (app, page) => {
    await app.evaluate(() => {
      const state = { requests: 0, aborted: 0, releaseOld: undefined as (() => void) | undefined, releaseCurrent: undefined as (() => void) | undefined };
      (globalThis as typeof globalThis & { aiPauseFixture?: typeof state }).aiPauseFixture = state;
      globalThis.fetch = (_url, init) => {
        state.requests += 1;
        init?.signal?.addEventListener("abort", () => { state.aborted += 1; });
        return new Promise<Response>((resolve) => {
          const release = () => resolve(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: state.requests === 1 ? "旧回答" : "继续后的回答" } }] })));
          if (state.requests === 1) state.releaseOld = release;
          else state.releaseCurrent = release;
        });
      };
    });
    await page.getByLabel("AI 消息草稿").fill("你好");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { aiPauseFixture?: { requests: number } }).aiPauseFixture?.requests)).toBe(1);
    await page.getByRole("button", { name: "暂停输出", exact: true }).click();
    await expect(page.getByRole("button", { name: "继续输出", exact: true })).toBeVisible();
    await expect(page.getByTestId("ai-turn-status")).toHaveText("已暂停输出");
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { aiPauseFixture?: { aborted: number } }).aiPauseFixture?.aborted)).toBe(1);
    await app.evaluate(() => (globalThis as typeof globalThis & { aiPauseFixture?: { releaseOld?: () => void } }).aiPauseFixture?.releaseOld?.());
    await expect(page.getByText("旧回答", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: "test-results/ai-paused.png" });
    await page.getByRole("button", { name: "继续输出", exact: true }).click();
    await expect(page.getByRole("button", { name: "暂停输出", exact: true })).toBeVisible();
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { aiPauseFixture?: { requests: number } }).aiPauseFixture?.requests)).toBe(2);
    await app.evaluate(() => (globalThis as typeof globalThis & { aiPauseFixture?: { releaseCurrent?: () => void } }).aiPauseFixture?.releaseCurrent?.());
    await expect(page.getByTestId("ai-turn-status")).toContainText("已完成");
    await expect(page.getByText("继续后的回答", { exact: true })).toBeVisible();
    await expect(page.locator(".ai-turn")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "继续输出", exact: true })).toHaveCount(0);
  });
});

test("the plus menu adds a text attachment and exposes the connection plugin", async () => {
  await desktop(async (app, page) => {
    await app.evaluate(() => {
      globalThis.fetch = async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        const last = request.messages.at(-1).content;
        return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: last.includes("层高 3 m") ? "已收到参考文件" : "缺少附件" } }] }));
      };
    });
    const add = page.getByRole("button", { name: "添加附件或插件", exact: true });
    await add.click(); await page.getByRole("button", { name: "插件", exact: true }).click();
    await page.getByRole("button", { name: "DeepSeek 连接", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "设置", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await add.click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "添加文件", exact: true }).click();
    await (await chooser).setFiles({ name: "结构说明.txt", mimeType: "text/plain", buffer: Buffer.from("层高 3 m") });
    await expect(page.locator(".ai-attachment")).toContainText("结构说明.txt");
    await page.getByLabel("AI 消息草稿").fill("读取参考文件");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect(page.getByText("已收到参考文件", { exact: true })).toBeVisible();
    await expect(page.locator(".ai-attachment")).toHaveCount(0);
  });
});
