import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { parameters, replay, save, send } from "./frame-proposal-actions";
import { columns } from "../src/workspace/section-stage.fixture";
import { encodeProject } from "../src/domain/project-file";
import { captureAiSnapshot } from "../src/workspace/ai-tools";
import { ConditionsStageConfirmation, prepareConditionsConfirmation, proposeConditions } from "../src/workspace/analysis-conditions";
import { persistTaskState, type ConversationHistory } from "../src/workspace/task-persistence";
import type { FrameProject } from "../src/domain/project";

function conversation(project: FrameProject): ConversationHistory {
  return { id: "saved-task", updatedAt: 1, turns: [], proposalSource: project, conditionsSource: project, sectionSource: project, modelEditsSource: project, taskDraftSource: project,
    sectionSelection: [], targets: [], calculationRequested: false, requestPrompt: "读取当前模型" };
}

test("T2-09 restarts the desktop with an unconfirmed draft, full local chat and durable undo receipts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t209-"));
  const path = join(directory, "restart.framemind");
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  const launch = async () => { app = await electron.launch({ args: ["."], env }); return app.firstWindow(); };
  const open = async (page: Page) => { await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click(); await expect(page.locator('footer[role="status"]')).toContainText("已打开"); };
  try {
    let page = await launch();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "设置", exact: true });
    await settings.getByLabel("DeepSeek API Key").fill("sk-t209-fixture-only");
    await settings.getByRole("button", { name: "保存连接" }).click();
    await expect(settings.getByTestId("deepseek-feedback")).toHaveText("连接设置已保存");
    await settings.getByRole("button", { name: "关闭", exact: true }).click();
    await replay(app!, parameters);
    await send(page, "准备两层刚架");
    const pending = await save(page, path);
    expect(pending.formatVersion).toBe(2); expect(pending.nodes).toHaveLength(0);
    expect(pending.taskState.conversations[0].proposal).toBeDefined();
    await app!.close(); page = await launch(); await open(page);
    await expect(page.getByRole("region", { name: "建模参数卡片" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "重启任务恢复" })).toBeVisible();
    await page.getByRole("button", { name: "恢复任务", exact: true }).click();
    await expect(page.getByRole("region", { name: "建模参数卡片" })).toBeVisible();
    await expect(page.getByRole("button", { name: "确认建模", exact: true })).toBeEnabled();
    expect((await save(page, path)).nodes).toHaveLength(0);
    await page.getByRole("button", { name: "确认建模", exact: true }).dblclick();
    const applied = await save(page, path);
    expect(applied.nodes).toHaveLength(12); expect(applied.confirmedOperations).toHaveLength(1);
    await page.keyboard.press("Control+z");
    const undone = await save(page, path);
    expect(undone.nodes).toHaveLength(0); expect(undone.confirmedOperations).toHaveLength(1);
    await app!.close(); page = await launch(); await open(page);
    await page.getByRole("button", { name: "恢复任务", exact: true }).click();
    expect((await save(page, path)).nodes).toHaveLength(0);
    await expect(page.getByRole("region", { name: "建模参数卡片" })).toHaveCount(0);
    await mkdir("docs/evidence/plan2/T2-09", { recursive: true });
    await page.screenshot({ path: "docs/evidence/plan2/T2-09/reopened-receipt.png" });
    const chats = await readFile(join(directory, "chat-history", `${pending.id}.json`), "utf8");
    expect(chats).not.toContain("sk-t209"); expect(chats).toContain("准备两层刚架");
    expect(JSON.stringify(undone)).not.toContain("sk-t209");
  } finally {
    await app?.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid test cleanup path");
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});

for (const stage of ["applied", "failed"] as const) test(`T2-09 resumes the saved ${stage} stage without resubmitting confirmed conditions`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t209-stage-"));
  const path = join(directory, "stage.framemind");
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  try {
    const base = columns(); const saved = conversation(base); let project = base;
    if (stage === "applied") {
      const load = base.nodalLoads[0];
      const draft = proposeConditions({ supports: [], nodalLoads: [{ id: load.id, nodeId: load.nodeId, loadCaseId: load.loadCaseId, moment: load.moment, force: { x: 10, y: 0, z: 0 }, source: "user" }] });
      const result = new ConditionsStageConfirmation().confirm(base, prepareConditionsConfirmation(base, draft));
      expect(result.result.status, result.result.message).toBe("applied");
      project = result.project; saved.calculationRequested = true; saved.analysisSourceId = "LC1";
      saved.turns = [{ id: "confirmed", origin: "confirmation", prompt: "确认条件", sourceProject: base, context: result.result.context,
        result: { ...result.result, workKind: "agent", records: [{ round: 0, call: { id: "confirmed", type: "function", function: { name: "confirm_analysis_conditions", arguments: "{}" } }, result: result.result }] } }];
    } else {
      saved.turns = [{ id: "failed", origin: "chat", prompt: "读取当前模型", sourceProject: base, context: captureAiSnapshot(base, []).context,
        result: { status: "failed", workKind: "agent", message: "网络断开，任务未完成", context: captureAiSnapshot(base, []).context, records: [] } }];
    }
    await writeFile(path, encodeProject({ ...project, taskState: persistTaskState(project.id, [saved], []) }), "utf8");
    app = await electron.launch({ args: ["."], env }); const page = await app.firstWindow();
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("已打开");
    await page.getByRole("button", { name: "恢复任务", exact: true }).click();
    if (stage === "applied") {
      expect((await save(page, path)).analysisResults).toHaveLength(1);
      await page.getByRole("button", { name: "继续本地计算", exact: true }).click();
      await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
      const computed = await save(page, path);
      expect(computed.nodalLoads).toHaveLength(2); expect(computed.nodalLoads[0].force.x).toBe(10);
      expect(computed.confirmedOperations).toHaveLength(1); expect(computed.analysisResults).toHaveLength(2);
    } else {
      await expect(page.getByRole("button", { name: "重试消息", exact: true })).toBeEnabled();
      // No credential is available; local editing and solving still remain available.
      await page.getByRole("button", { name: "运行分析", exact: true }).click();
      await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
      expect((await save(page, path)).analysisResults).toHaveLength(2);
    }
  } finally {
    await app?.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid test cleanup path");
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});

test("T2-09 freezes an interrupted local calculation and resumes it offline only on request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t209-solve-"));
  const path = join(directory, "solve.framemind");
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  const launch = async () => {
    app = await electron.launch({ args: ["."], env });
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "文件", exact: true }).click();
    await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("已打开");
    return page;
  };
  try {
    await writeFile(path, encodeProject(columns()), "utf8");
    let page = await launch();
    await page.evaluate(() => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker { postMessage() { /* Simulate exit while the numerical worker is still processing. */ } };
    });
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.getByRole("button", { name: "取消计算", exact: true })).toBeVisible();
    const interrupted = await save(page, path);
    expect(interrupted.taskState.analyses).toHaveLength(1);
    expect(interrupted.taskState.scheduled.some((task: { kind: string; status: string }) => task.kind === "analysis" && task.status === "running")).toBe(true);
    await app!.close(); page = await launch();
    await expect(page.getByRole("button", { name: "取消计算", exact: true })).toHaveCount(0);
    expect((await save(page, path)).analysisResults).toHaveLength(1);
    await page.getByRole("button", { name: "继续任务", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    const resumed = await save(page, path);
    expect(resumed.analysisResults).toHaveLength(2);
    expect(resumed.analysisResults[1].input).toEqual(interrupted.taskState.analyses[0].input);
    expect(resumed.taskState.analyses).toHaveLength(0);
    await mkdir("docs/evidence/plan2/T2-09", { recursive: true });
    await page.screenshot({ path: "docs/evidence/plan2/T2-09/offline-resumed-analysis.png" });
  } finally {
    await app?.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid test cleanup path");
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});
