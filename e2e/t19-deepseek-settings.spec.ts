import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNode } from "./modeling-actions";

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  return page.getByRole("dialog", { name: "设置", exact: true });
}
async function fixedResponse(app: ElectronApplication, status: number) {
  await app.evaluate((_electron, code) => {
    globalThis.fetch = async () => {
      if (code === -1) throw new Error("network sk-t19-secret-fixture");
      return new Response(JSON.stringify(code === 200
        ? { choices: [{ message: { role: "assistant", content: "OK" } }] }
        : { error: { message: "sk-t19-secret-fixture" } }), { status: code });
    };
  }, status);
}

test("T19 configures, tests, updates and removes real Windows encrypted credentials separately from the project", async () => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t19-desktop-"));
  const userDataPath = join(directory, "profile");
  const projectPath = join(directory, "offline.framemind");
  const env: NodeJS.ProcessEnv = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: userDataPath, FRAMEMIND_E2E_PROJECT_PATH: projectPath };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ args: ["."], env });
    let page = await app.firstWindow();
    await createNode(page, ["1", "2", "3"]);
    let dialog = await openSettings(page);
    await expect(dialog.getByText("未配置", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("DeepSeek 模型")).toHaveValue("deepseek-flash");
    await expect(dialog.getByRole("button", { name: "测试连接" })).toBeDisabled();
    await dialog.getByLabel("DeepSeek API Key").fill("sk-t19-secret-fixture");
    await expect(dialog.getByLabel("DeepSeek API Key")).toHaveAttribute("type", "password");
    await dialog.getByRole("button", { name: "保存连接" }).click();
    await expect(dialog.getByTestId("deepseek-feedback")).toHaveText("连接设置已保存");
    await expect(dialog.getByLabel("DeepSeek API Key")).toHaveValue("");
    await fixedResponse(app, 200);
    await dialog.getByRole("button", { name: "测试连接" }).click();
    await expect(dialog.getByTestId("deepseek-feedback")).toHaveText("连接成功");
    for (const [status, message] of [[401, "认证失败"], [429, "限流"], [-1, "网络连接失败"]] as const) {
      await fixedResponse(app, status);
      await dialog.getByRole("button", { name: "测试连接" }).click();
      await expect(dialog.getByTestId("deepseek-feedback")).toContainText(message);
      expect(await page.locator("body").innerText()).not.toContain("sk-t19-secret-fixture");
    }
    for (const theme of ["dark", "light"] as const) {
      await dialog.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
      for (const width of [1440, 1080]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 900), width);
        const box = await dialog.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
        await page.screenshot({ path: `docs/evidence/T19-${theme}-${width}.png` });
      }
    }
    await dialog.getByLabel("DeepSeek 模型").selectOption("deepseek-v4-pro");
    await expect(dialog.getByRole("button", { name: "测试连接" })).toBeDisabled();
    await dialog.getByLabel("DeepSeek API Key").fill("sk-t19-updated-fixture");
    await dialog.getByRole("button", { name: "保存连接" }).click();
    await expect(dialog.getByTestId("deepseek-feedback")).toHaveText("连接设置已保存");
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "文件", exact: true }).click();
    await page.getByRole("menuitem", { name: /保存项目/ }).click();
    await expect(page.getByRole("status")).toContainText("已保存");
    const saved = await readFile(projectPath, "utf8");
    expect(saved).not.toContain("sk-t19-");
    expect(saved).not.toContain("deepseek");
    const encrypted = await readFile(join(userDataPath, "deepseek.credentials"));
    expect(encrypted.includes(Buffer.from("sk-t19-"))).toBe(false);
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    dialog = await openSettings(page);
    await expect(dialog.getByText("已配置本机凭据", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("DeepSeek 模型")).toHaveValue("deepseek-v4-pro");
    await expect(dialog.getByLabel("DeepSeek API Key")).toHaveValue("");
    const credentialMatches = await app.evaluate(({ safeStorage }, bytes) => {
      const decrypted = JSON.parse(safeStorage.decryptString(Buffer.from(bytes)));
      return decrypted.apiKey === "sk-t19-updated-fixture";
    }, Array.from(encrypted));
    expect(credentialMatches).toBe(true);
    await dialog.getByRole("button", { name: "移除本机凭据" }).click();
    await expect(dialog.getByTestId("deepseek-feedback")).toHaveText("本机凭据已移除");
    await expect(dialog.getByRole("button", { name: "测试连接" })).toBeDisabled();
    await expect(readFile(join(userDataPath, "deepseek.credentials"))).rejects.toMatchObject({ code: "ENOENT" });
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "文件", exact: true }).click();
    await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await expect(page.getByTestId("viewport-node-count")).toHaveText("1 个节点");
    await createNode(page, ["4", "2", "3"]);
    await page.getByRole("button", { name: "创建材料与截面" }).click();
    await page.getByRole("button", { name: "保存材料与截面" }).click();
    await page.getByRole("button", { name: "创建杆件" }).click();
    await page.getByRole("button", { name: "添加杆件" }).click();
    await page.getByRole("button", { name: "设置支座" }).click();
    await page.getByRole("button", { name: "添加支座" }).click();
    await page.getByRole("button", { name: "荷载", exact: true }).click(); await page.getByRole("menuitem", { name: "创建荷载" }).click();
    await page.getByRole("dialog", { name: "创建节点集中荷载" }).getByLabel("FX").fill("8");
    await page.getByRole("button", { name: "添加节点荷载" }).click();
    await page.getByRole("button", { name: "运行分析" }).click();
    await expect(page.getByRole("status")).toContainText("分析完成");
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("T19 closing a pending test keeps local editing usable and reopening does not display its late response", async () => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t19-pending-"));
  const env: NodeJS.ProcessEnv = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    let dialog = await openSettings(page);
    await dialog.getByLabel("DeepSeek API Key").fill("sk-t19-pending");
    await dialog.getByRole("button", { name: "保存连接" }).click();
    await expect(dialog.getByTestId("deepseek-feedback")).toHaveText("连接设置已保存");
    await app.evaluate(() => { globalThis.fetch = () => new Promise(() => undefined); });
    await dialog.getByRole("button", { name: "测试连接" }).click();
    await expect(dialog.getByTestId("deepseek-feedback")).toContainText("正在处理");
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await createNode(page, ["0", "0", "0"]);
    dialog = await openSettings(page);
    await expect(dialog.getByText("已配置本机凭据", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "移除本机凭据" }).click();
    await expect(dialog.getByTestId("deepseek-feedback")).toHaveText("本机凭据已移除");
    await expect(page.getByTestId("viewport-node-count")).toHaveText("1 个节点");
    await expect(dialog.getByTestId("deepseek-feedback")).not.toContainText("失效");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
