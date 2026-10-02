import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNode } from "./modeling-actions";

interface PendingFixture {
  started: boolean;
  aborted: boolean;
  release?: (reply: string) => void;
}
type FixtureGlobal = typeof globalThis & { t20Pending?: PendingFixture };

async function withDesktop(run: (app: ElectronApplication, page: Page, projectPath: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t20-boundaries-"));
  const projectPath = join(directory, "boundaries.framemind");
  const env: NodeJS.ProcessEnv = {
    ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: projectPath,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ args: ["."], env });
    await run(app, await app.firstWindow(), projectPath);
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function configure(page: Page) {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await dialog.getByLabel("DeepSeek API Key").fill("sk-t20-boundary-fixture");
  await dialog.getByRole("button", { name: "保存连接" }).click();
  await expect(dialog.getByTestId("deepseek-feedback")).toHaveText("连接设置已保存");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
}

async function send(page: Page, prompt: string) {
  await page.getByLabel("AI 消息草稿").fill(prompt);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
}

async function replay(app: ElectronApplication, name: string, args: unknown, reply = "已读取选中对象。") {
  await app.evaluate((_electron, fixture) => {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const hasOutput = body.messages.some((message: { role: string }) => message.role === "tool");
      return new Response(JSON.stringify({ choices: [{ message: hasOutput
        ? { role: "assistant", content: fixture.reply }
        : { role: "assistant", content: null, tool_calls: [{
          id: "boundary-call", type: "function",
          function: { name: fixture.name, arguments: JSON.stringify(fixture.args) },
        }] },
      }] }));
    };
  }, { name, args, reply });
}

async function pending(app: ElectronApplication, page: Page, prompt: string) {
  await app.evaluate(() => {
    const state: PendingFixture = { started: false, aborted: false };
    (globalThis as FixtureGlobal).t20Pending = state;
    // Ignore abort at the fixture boundary so a late network response can still arrive.
    globalThis.fetch = (_url, init) => new Promise<Response>((resolve) => {
      state.started = true;
      state.aborted = Boolean(init?.signal?.aborted);
      init?.signal?.addEventListener("abort", () => { state.aborted = true; }, { once: true });
      state.release = (reply) => resolve(new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: reply } }],
      })));
    });
  });
  await send(page, prompt);
  await expect.poll(() => app.evaluate(() => (globalThis as FixtureGlobal).t20Pending?.started)).toBe(true);
  await expect(page.getByRole("button", { name: "取消对话", exact: true })).toBeVisible();
}

async function releaseLate(app: ElectronApplication, reply: string) {
  await app.evaluate(async (_electron, text) => {
    (globalThis as FixtureGlobal).t20Pending?.release?.(text);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }, reply);
}

test("T20 recovers from missing credentials and keeps script and model mutation tools inert", async () => {
  await withDesktop(async (app, page, projectPath) => {
    const panel = page.getByRole("complementary", { name: "AI 对话", exact: true });
    await send(page, "读取当前项目");
    await expect(panel.getByTestId("ai-turn-status").last()).toContainText("失败");
    await expect(panel.getByTestId("ai-turn-status").last()).toContainText("尚未配置");
    await panel.getByRole("button", { name: "打开连接设置" }).click();
    const dialog = page.getByRole("dialog", { name: "设置", exact: true });
    await expect(dialog.getByText("未配置", { exact: true })).toBeVisible();
    await dialog.getByLabel("DeepSeek API Key").fill("sk-t20-boundary-fixture");
    await dialog.getByRole("button", { name: "保存连接" }).click();
    await expect(dialog.getByTestId("deepseek-feedback")).toHaveText("连接设置已保存");
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await createNode(page, ["1", "2", "3"]);

    await replay(app, "execute_script", { code: "project.nodes[0].position.x = 999" });
    await send(page, "运行脚本移动节点");
    await expect(panel.getByTestId("ai-turn-status").last()).toContainText("失败");
    await expect(panel.locator(".ai-tool-record").last().locator("summary").first()).toContainText("execute_script");
    await replay(app, "update_node", { id: "node_0001", position: { x: 999, y: 2, z: 3 } });
    await send(page, "将节点移动到 x=999");
    await expect(panel.getByTestId("ai-turn-status").last()).toContainText("等待确认");
    await expect(panel.getByTestId("ai-turn-status").last()).toContainText("只读");
    await expect(page.getByTestId("viewport-node-count")).toHaveText("1 个节点");
    await page.keyboard.press("Control+s");
    await expect(page.getByRole("status")).toContainText("已保存");
    expect(JSON.parse(await readFile(projectPath, "utf8")).nodes[0].position).toEqual({ x: 1, y: 2, z: 3 });
  });
});

test("T20 reads a mixed batch of nodes and members through their stable identities", async () => {
  await withDesktop(async (app, page) => {
    await configure(page);
    await createNode(page, ["0", "0", "0"]);
    await createNode(page, ["4", "0", "0"]);
    await page.getByRole("button", { name: "创建材料与截面" }).click();
    await page.getByRole("button", { name: "保存材料与截面" }).click();
    await page.getByRole("button", { name: "创建杆件" }).click();
    await page.getByRole("button", { name: "添加杆件" }).click();
    await page.getByRole("button", { name: "数据表", exact: true }).click();
    const table = page.getByRole("region", { name: "模型数据表" });
    await table.getByLabel("选择杆件 M1", { exact: true }).check();
    await table.getByRole("tab", { name: "节点 (2)", exact: true }).click();
    await table.getByLabel("选择节点 N1", { exact: true }).check();
    await table.getByLabel("选择节点 N2", { exact: true }).check();
    const panel = page.getByRole("complementary", { name: "AI 对话", exact: true });
    await expect(panel.getByRole("region", { name: "当前对话对象" })).toHaveCount(0);
    await replay(app, "read_selection", {}, "已读取两个节点与一根杆件。");
    await send(page, "读取这一组对象");
    await expect(panel.getByTestId("ai-turn-status").last()).toContainText("已完成");
    const record = panel.locator(".ai-tool-record").last();
    await record.locator("summary").first().click();
    await record.getByText("工具输出", { exact: true }).click();
    const output = JSON.parse(await record.locator(".ai-tool-output").innerText());
    expect(output.context.selection.map((object: { kind: string; id: string }) => ({ kind: object.kind, id: object.id }))).toEqual([
      { kind: "node", id: "node_0001" }, { kind: "node", id: "node_0002" }, { kind: "member", id: "member_0001" },
    ]);
    expect(output.data.objects.map((object: { id: string }) => object.id)).toEqual(["node_0001", "node_0002", "member_0001"]);
    expect(output.data.objects[2]).toMatchObject({ startNodeId: "node_0001", endNodeId: "node_0002" });
  });
});

test("T20 cancels pending responses when the user cancels, changes context or removes credentials", async () => {
  await withDesktop(async (app, page, projectPath) => {
    await configure(page);
    await createNode(page, ["0", "0", "0"]);
    await createNode(page, ["4", "0", "0"]);
    await page.getByRole("button", { name: "数据表", exact: true }).click();
    const table = page.getByRole("region", { name: "模型数据表" });
    const panel = page.getByRole("complementary", { name: "AI 对话", exact: true });
    await table.getByRole("button", { name: "定位节点 N1", exact: true }).click();

    await pending(app, page, "请求将由用户取消");
    await panel.getByRole("button", { name: "取消对话", exact: true }).click();
    await expect(panel.getByTestId("ai-turn-status").last()).toContainText("已取消");
    await expect.poll(() => app.evaluate(() => (globalThis as FixtureGlobal).t20Pending?.aborted)).toBe(true);
    await releaseLate(app, "late-user-cancel-response");

    await pending(app, page, "请求期间切换选择");
    await table.getByRole("button", { name: "定位节点 N2", exact: true }).click();
    await expect(panel.getByTestId("ai-turn-status").last()).toContainText("已取消");
    await releaseLate(app, "late-selection-response");

    await pending(app, page, "请求期间修改模型");
    await table.getByLabel("N2 X 坐标", { exact: true }).fill("7");
    await table.getByRole("button", { name: "保存 N2", exact: true }).click();
    await expect(panel.getByTestId("ai-turn-status").last()).toContainText("已取消");
    await releaseLate(app, "late-model-response");

    await pending(app, page, "请求期间移除凭据");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "设置", exact: true });
    await dialog.getByRole("button", { name: "移除本机凭据", exact: true }).click();
    await expect(dialog.getByTestId("deepseek-feedback")).toHaveText("本机凭据已移除");
    await releaseLate(app, "late-credential-response");
    await expect(panel.getByTestId("ai-turn-status").last()).toContainText("已取消");
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(panel.getByRole("button", { name: "发送消息", exact: true })).toBeVisible();
    for (const reply of ["late-user-cancel-response", "late-selection-response", "late-model-response", "late-credential-response"]) {
      await expect(panel.getByText(reply, { exact: true })).toHaveCount(0);
    }
    await page.keyboard.press("Control+s");
    await expect(page.getByRole("status")).toContainText("已保存");
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.nodes).toHaveLength(2);
    expect(saved.nodes[1].position).toEqual({ x: 7, y: 0, z: 0 });
  });
});
