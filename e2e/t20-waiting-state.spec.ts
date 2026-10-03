import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNode } from "./modeling-actions";

test("T20 displays an unapplied model request as waiting in the process timeline", async ({}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t20-waiting-"));
  const projectPath = join(directory, "readonly.framemind");
  const env: NodeJS.ProcessEnv = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory,
    FRAMEMIND_E2E_PROJECT_PATH: projectPath };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    let settings = page.getByRole("dialog", { name: "设置", exact: true });
    await settings.getByLabel("DeepSeek API Key").fill("sk-t20-waiting-fixture");
    await settings.getByRole("button", { name: "保存连接" }).click();
    await expect(settings.getByTestId("deepseek-feedback")).toHaveText("连接设置已保存");
    await settings.getByRole("button", { name: "关闭", exact: true }).click();
    await createNode(page, ["1", "2", "3"]);
    await app.evaluate(() => {
      globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: {
        role: "assistant", content: null, tool_calls: [{ id: "blocked-change", type: "function",
          function: { name: "update_node", arguments: '{"id":"node_0001","position":{"x":99,"y":2,"z":3}}' } }],
      } }] }));
    });
    const panel = page.getByRole("complementary", { name: "AI 对话", exact: true });
    await page.getByLabel("AI 消息草稿").fill("将这个节点移到 x=99");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const timeline = panel.getByRole("region", { name: "处理过程", exact: true });
    await expect(timeline.getByText("等待确认", { exact: true })).toBeVisible();
    await expect(timeline.getByText(/本阶段只读.*请使用手动编辑/)).toBeVisible();
    await expect(panel.locator(".ai-turn-details")).toHaveCount(0);
    await page.keyboard.press("Control+s");
    await expect(page.getByRole("status")).toContainText("已保存");
    expect(JSON.parse(await readFile(projectPath, "utf8")).nodes[0].position).toEqual({ x: 1, y: 2, z: 3 });

    for (const theme of ["dark", "light"] as const) {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      settings = page.getByRole("dialog", { name: "设置", exact: true });
      await settings.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
      await settings.getByRole("button", { name: "关闭", exact: true }).click();
      for (const width of [1440, 1080]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 900), width);
        await expect(timeline.getByText(/本阶段只读.*请使用手动编辑/)).toBeVisible();
        const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
        expect(dimensions.scrollWidth).toBe(dimensions.width);
        await page.screenshot({ path: testInfo.outputPath(`waiting-${theme}-${width}.png`) });
      }
    }
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
