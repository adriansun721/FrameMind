import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNode } from "./modeling-actions";

async function configure(page: Page) {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await dialog.getByLabel("DeepSeek API Key").fill("sk-t20-fixture-only");
  await dialog.getByRole("button", { name: "保存连接" }).click();
  await expect(dialog.getByTestId("deepseek-feedback")).toHaveText("连接设置已保存");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
}

async function replay(app: ElectronApplication, calls: { name: string; arguments: string }[], reply: string) {
  await app.evaluate((_electron, fixture) => {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const outputs = body.messages.filter((message: { role: string }) => message.role === "tool");
      return new Response(JSON.stringify({ choices: [{ message: outputs.length
        ? { role: "assistant", content: fixture.reply }
        : { role: "assistant", content: null, tool_calls: fixture.calls.map((call, index) => ({
          id: `t20_${index}`, type: "function", function: call,
        })) },
      }] }), { status: 200 });
    };
  }, { calls, reply });
}

async function send(page: Page, prompt: string) {
  await page.getByLabel("AI 消息草稿").fill(prompt);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
}

test("T20 replays selected model reads, distinguishes committed edits and preserves project data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t20-"));
  const projectPath = join(directory, "readonly.framemind");
  const env: NodeJS.ProcessEnv = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: projectPath };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await configure(page);
    await createNode(page, ["0", "0", "0"]);
    await createNode(page, ["4", "0", "0"]);
    await page.getByRole("button", { name: "创建材料与截面" }).click();
    await page.getByRole("button", { name: "保存材料与截面" }).click();
    await page.getByRole("button", { name: "创建杆件" }).click();
    await page.getByRole("button", { name: "添加杆件" }).click();
    await page.getByRole("button", { name: "数据表", exact: true }).click();
    const table = page.getByRole("region", { name: "模型数据表" });
    await table.getByRole("button", { name: "定位杆件 M1" }).click();
    const panel = page.getByRole("complementary", { name: "AI 对话", exact: true });
    await expect(panel.getByRole("region", { name: "当前对话对象" })).toHaveCount(0);
    await table.getByLabel("M1 截面转角").fill("45");
    await replay(app, [{ name: "read_selection", arguments: "{}" }], "M1 的已应用截面转角是 0 度。");
    await send(page, "这根梁的转角是多少？");
    await expect(panel.getByTestId("ai-turn-status").last()).toContainText("已完成");
    await expect(panel.getByText("M1 的已应用截面转角是 0 度。", { exact: true })).toBeVisible();
    await panel.locator(".ai-tool-record > summary").last().click();
    await panel.getByText("工具输出", { exact: true }).last().click();
    await expect(panel.locator(".ai-tool-output").last()).toContainText('"rotationDegrees": 0');
    await expect(panel.locator(".ai-tool-output").last()).toContainText('"x": 4');
    await table.getByRole("button", { name: "保存 M1", exact: true }).click();
    await expect(page.getByTestId("viewport-member-details")).toContainText("45°");
    await replay(app, [{ name: "read_objects", arguments: JSON.stringify({ objects: [{ kind: "member", id: "member_0001" }] }) }], "M1 当前转角为 45 度。");
    await send(page, "再读取这根梁");
    await expect(panel.getByText("M1 当前转角为 45 度。", { exact: true })).toBeVisible();
    await panel.locator(".ai-tool-record > summary").last().click();
    await panel.getByText("工具输出", { exact: true }).last().click();
    await expect(panel.locator(".ai-tool-output").last()).toContainText('"rotationDegrees": 45');
    await page.keyboard.press("Control+s");
    await expect(page.getByRole("status")).toContainText("已保存");
    const saved = await readFile(projectPath, "utf8");
    expect(saved).not.toContain("sk-t20-");
    expect(saved).not.toContain("这根梁");
    expect(JSON.parse(saved).members[0].rotationDegrees).toBe(45);
    while (await panel.locator(".ai-tool-record[open] > summary").count()) {
      await panel.locator(".ai-tool-record[open] > summary").first().click();
    }
    await panel.getByRole("log").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    for (const theme of ["dark", "light"] as const) {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "设置", exact: true });
      await settings.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
      await settings.getByRole("button", { name: "关闭", exact: true }).click();
      for (const width of [1440, 1080]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 900), width);
        const layout = await page.evaluate(() => {
          const panelRect = document.querySelector("#assistant-panel")!.getBoundingClientRect();
          const composer = document.querySelector(".assistant-composer")!.getBoundingClientRect();
          return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
            panelRight: panelRect.right, composerBottom: composer.bottom, panelBottom: panelRect.bottom };
        });
        expect(layout.scrollWidth).toBe(layout.width);
        expect(layout.panelRight).toBeLessThanOrEqual(layout.width);
        expect(layout.composerBottom).toBeLessThanOrEqual(layout.panelBottom);
        const colors = await page.locator(".viewport canvas").evaluate((element) => new Promise<number>((resolve) => requestAnimationFrame(() => {
          const gl = (element as HTMLCanvasElement).getContext("webgl2")!;
          const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
          gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          const unique = new Set<string>();
          for (let i = 0; i < pixels.length; i += 4) unique.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
          resolve(unique.size);
        })));
        expect(colors).toBeGreaterThan(12);
        await page.screenshot({ path: `docs/evidence/T20-${theme}-${width}.png` });
      }
    }
    // Undo restores R5; editing again reuses R6 with different model contents.
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await table.getByRole("button", { name: "定位杆件 M1", exact: true }).click();
    await table.getByLabel("M1 截面转角").fill("30");
    await table.getByRole("button", { name: "保存 M1", exact: true }).click();
    await expect(panel.locator(".ai-turn").last().locator(".ai-stale")).toHaveText("历史版本");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
