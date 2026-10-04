import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { columns } from "../src/workspace/section-stage.fixture";
import { encodeProject } from "../src/domain/project-file";
import { desktop, parameters, replay, save, send } from "./frame-proposal-actions";
import { createNode } from "./modeling-actions";

async function failNetwork(app: ElectronApplication) {
  await app.evaluate(() => { globalThis.fetch = async () => { throw new Error("offline sk-t21-fixture-only"); }; });
}
async function sendInterrupted(page: Page, prompt: string) {
  await page.getByLabel("AI 消息草稿").fill(prompt);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByTestId("ai-turn-status").last()).toContainText("失败");
}
async function openProject(page: Page) {
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("menuitem", { name: /打开项目/ }).click();
}
async function conditions(app: ElectronApplication) {
  await replay(app, {
    supports: [1, 2, 3, 4].map((n) => ({ nodeId: `node_${String(n).padStart(4, "0")}`, restraints: [true, true, true, true, true, true], source: "user" })),
    nodalLoads: [{ nodeId: "node_0012", loadCaseId: "LC1", force: { x: 5, y: 0, z: -10 }, moment: { x: 0, y: 0, z: 0 }, source: "user" }],
  }, "propose_analysis_conditions");
}

test("T27 retries a disconnected continuation without replaying geometry and solves offline after confirmation", async () => {
  await desktop(async (app, page, path) => {
    await replay(app, parameters);
    await send(page, "建立两层空间钢刚架并计算");
    await failNetwork(app);
    await page.getByRole("button", { name: "确认建模", exact: true }).click();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("失败");
    await page.locator(".ai-turn-details > summary").first().click();
    await page.getByText("操作详情 · 1 项", { exact: true }).click();
    await expect(page.getByText("本地提交回执已保留", { exact: false })).toBeVisible();
    const applied = await save(page, path);
    expect(applied.nodes).toHaveLength(12); expect(applied.members).toHaveLength(16);
    await page.screenshot({ path: "docs/evidence/T27-recovery.png" });

    await conditions(app);
    await page.getByRole("button", { name: "重试消息", exact: true }).click();
    const card = page.getByRole("region", { name: "分析条件卡片" });
    await expect(card).toBeVisible();
    await expect(page.getByRole("region", { name: "刚架参数卡片" })).toHaveCount(0);
    expect((await save(page, path)).supports).toHaveLength(0);
    await expect(page.getByRole("button", { name: "重试消息", exact: true })).toBeDisabled();
    await failNetwork(app);
    await card.getByRole("button", { name: /^(确认条件|确认并计算)$/ }).dblclick();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已完成 · 本地分析完成");
    const computed = await save(page, path);
    expect(computed.nodes).toHaveLength(12); expect(computed.supports).toHaveLength(4);
    expect(computed.nodalLoads).toHaveLength(1); expect(computed.analysisResults).toHaveLength(1);
    expect(JSON.stringify(computed)).not.toContain("sk-t21-fixture-only");
    await page.screenshot({ path: "docs/evidence/T27-offline-analysis.png" });

    // Reload starts a fresh conversation but reads the same saved model and immutable result.
    await page.reload();
    await openProject(page);
    await expect(page.getByTestId("viewport-node-count")).toHaveText("12 个节点");
    await expect(page.getByTestId("ai-turn-status")).toHaveCount(0);
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    expect((await save(page, path)).analysisResults).toHaveLength(2);
  });
});

test("T27 keeps an unconfirmed draft isolated on disconnect and blocks stale retries after manual editing", async () => {
  await desktop(async (app, page, path) => {
    await replay(app, parameters); await send(page, "准备两层刚架");
    await failNetwork(app); await sendInterrupted(page, "读取当前模型");
    await expect(page.getByText("已有草案仍需在卡片中核对并确认。", { exact: false })).toBeVisible();
    expect((await save(page, path)).nodes).toHaveLength(0);
    await createNode(page, ["2", "3", "4"]);
    await expect(page.getByRole("button", { name: "重试消息", exact: true })).toBeDisabled();
    await expect(page.getByText("上下文或阶段已变化", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "确认建模", exact: true })).toBeEnabled();
    expect((await save(page, path)).nodes).toHaveLength(1);
    expect(await page.getByRole("log").innerText()).not.toContain("sk-t21-fixture-only");
  });
});

test("T27 retries with a new identity and ignores a cancelled request arriving after the retry", async () => {
  await desktop(async (app, page, path) => {
    await app.evaluate(() => {
      globalThis.fetch = () => new Promise<Response>((resolve) => {
        (globalThis as typeof globalThis & { t27Release?: () => void }).t27Release = () => resolve(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "迟到的旧回复" } }] })));
      });
    });
    await page.getByLabel("AI 消息草稿").fill("读取模型");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect.poll(() => app.evaluate(() => Boolean((globalThis as typeof globalThis & { t27Release?: () => void }).t27Release))).toBe(true);
    await page.getByRole("button", { name: "取消对话", exact: true }).click();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已取消");
    await replay(app, { collection: "summary" }, "read_model");
    await page.getByRole("button", { name: "重试消息", exact: true }).click();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已完成");
    await app.evaluate(() => (globalThis as typeof globalThis & { t27Release?: () => void }).t27Release?.());
    await expect(page.getByText("迟到的旧回复", { exact: true })).toHaveCount(0);
    const records = page.getByRole("log").locator(".ai-turn");
    for (const summary of await page.locator(".ai-turn-details > summary").all()) await summary.click();
    await records.nth(0).getByText("任务与恢复记录", { exact: true }).click();
    await records.nth(1).getByText("任务与恢复记录", { exact: true }).click();
    const oldRecord = JSON.parse(await records.nth(0).locator(".ai-context-details").nth(1).locator("pre").innerText());
    const retryRecord = JSON.parse(await records.nth(1).locator(".ai-context-details").nth(1).locator("pre").innerText());
    expect(retryRecord.requestId).not.toBe(oldRecord.requestId);
    expect(retryRecord.retryOf).toBe(oldRecord.requestId);
    expect((await save(page, path)).nodes).toHaveLength(0);
  });
});

test("T27 starts only one task when send is submitted twice before the next render", async () => {
  await desktop(async (app, page) => {
    await app.evaluate(() => {
      const state = { requests: 0 };
      (globalThis as typeof globalThis & { t27Requests?: typeof state }).t27Requests = state;
      globalThis.fetch = async () => { state.requests += 1; return new Promise<Response>(() => undefined); };
    });
    await page.getByLabel("AI 消息草稿").fill("读取当前模型");
    await page.locator(".assistant-composer").evaluate(() => {
      const form = document.querySelector<HTMLFormElement>(".assistant-composer")!;
      form.requestSubmit(); form.requestSubmit();
    });
    await expect(page.getByTestId("ai-turn-status")).toHaveCount(1);
    await page.getByRole("button", { name: "取消对话", exact: true }).click();
    await expect(page.getByTestId("ai-turn-status")).toContainText("已取消");
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { t27Requests?: { requests: number } }).t27Requests?.requests)).toBe(1);
  });
});

test("T27 edits and computes without credentials, then reopens saved results after a full application restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t27-restart-"));
  const path = join(directory, "offline.framemind");
  const environment: NodeJS.ProcessEnv = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete environment.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  try {
    await writeFile(path, encodeProject(columns()), "utf8");
    app = await electron.launch({ args: ["."], env: environment });
    let page = await app.firstWindow();
    await openProject(page);
    await expect(page.getByTestId("viewport-node-count")).toHaveText("4 个节点");
    await sendInterrupted(page, "读取模型");
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("尚未配置");
    await page.getByRole("region", { name: "项目树" }).getByText("N2", { exact: true }).click();
    const properties = page.getByRole("region", { name: "对象属性" });
    await properties.getByLabel("Z 坐标", { exact: true }).fill("5");
    await properties.getByRole("button", { name: "保存节点属性", exact: true }).click();
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    const saved = await save(page, path);
    expect(saved.analysisResults).toHaveLength(2);
    expect(saved.analysisResults[1].nodes[1].displacement.x).toBeCloseTo(0.010416666666666666, 12);
    await app.close(); app = undefined;

    app = await electron.launch({ args: ["."], env: environment });
    page = await app.firstWindow(); await openProject(page);
    await expect(page.getByTestId("viewport-node-count")).toHaveText("4 个节点");
    await expect(page.getByTestId("ai-turn-status")).toHaveCount(0);
    const reopened = await save(page, path);
    expect(reopened.nodes).toEqual(saved.nodes); expect(reopened.analysisResults).toEqual(saved.analysisResults);
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    expect((await save(page, path)).analysisResults).toHaveLength(3);
  } finally {
    await app?.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid test profile cleanup path");
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});
