import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

export const parameters = {
  storeys: { value: 2, source: "user" }, xSpans: { value: [6], source: "user" }, ySpans: { value: [4], source: "user" },
  storeyHeights: { value: [3, 3], source: "user" }, origin: { value: [0, 0, 0], source: "suggestion" },
  material: { value: "en10025-s355jr", source: "suggestion" }, columnSection: { value: "arcelor-hea200", source: "suggestion" },
  beamSection: { value: "arcelor-ipe200", source: "suggestion" }, rotationDegrees: { value: 0, source: "suggestion" },
};
export async function desktop(run: (app: ElectronApplication, page: Page, path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t21-"));
  const path = join(directory, "proposal.framemind");
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ args: ["."], env });
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "设置", exact: true });
    await settings.getByLabel("DeepSeek API Key").fill("sk-t21-fixture-only");
    await settings.getByRole("button", { name: "保存连接" }).click();
    await expect(settings.getByTestId("deepseek-feedback")).toHaveText("连接设置已保存");
    await settings.getByRole("button", { name: "关闭", exact: true }).click();
    await run(app, page, path);
  } finally {
    try { await app?.close(); } finally {
      if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid temporary directory");
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  }
}
export async function replay(app: ElectronApplication, args: unknown, name = "propose_frame") {
  await app.evaluate((_electron, fixture) => {
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: request.messages.some((message: { role: string }) => message.role === "tool")
        ? { role: "assistant", content: "已拒绝方案，正式模型保持可用。" }
        : { role: "assistant", content: null, tool_calls: [{ id: "t21-proposal", index: 0, type: "function", function: { name: fixture.name, arguments: JSON.stringify(fixture.args) } }] } }] }));
    };
  }, { args: name === "propose_frame" ? { parameters: args } : args, name });
}
export async function send(page: Page, prompt: string) {
  await page.getByLabel("AI 消息草稿").fill(prompt);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByTestId("ai-turn-status").last()).toHaveText(/^(等待确认|缺少输入|已完成) ·/);
}
export async function save(page: Page, path: string) {
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("status")).toContainText("已保存");
  // A repeated save may retain the prior feedback while the atomic file replacement is still in flight.
  let saved = "";
  await expect.poll(async () => {
    try { saved = await readFile(path, "utf8"); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }).toBe(true);
  return JSON.parse(saved);
}
