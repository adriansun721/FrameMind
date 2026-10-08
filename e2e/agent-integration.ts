import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { encodeProject } from "../src/domain/project-file";
import { engineeringContent } from "../src/workspace/draft-coordination";
import { redactPersistence } from "../electron/persistence-redaction";
import { columns } from "../src/workspace/section-stage.fixture";
import type { AiTaskResult } from "../src/workspace/ai-task";
import type { ConversationHistory } from "../src/workspace/task-persistence";
import { enterWorkbenchWithoutRecovery } from "./electron-app";

export type Tool = { name: string; input: unknown };

export async function agentFixture(id: string, options: { task: "T2-11" | "T2-41"; project?: ReturnType<typeof columns> }, run: (context: {
  page: Page; app: () => ElectronApplication; path: string; project: ReturnType<typeof columns>;
  restart(): Promise<Page>; check(name: string, value: boolean): void;
  ask(page: Page, prompt: string, rounds: Tool[][], response: string): Promise<AiTaskResult>;
}) => Promise<void>) {
  const prefix = options.task === "T2-11" ? "FRAMEMIND_T211" : "FRAMEMIND_T241";
  const online = process.env[prefix + "_ONLINE"] === "1";
  const mode = online ? "online" : "replay";
  const directory = await mkdtemp(join(tmpdir(), "framemind-t211-"));
  const path = join(directory, "reliability.framemind");
  const project = options.project ?? columns();
  const checks: Record<string, boolean> = {};
  const turns: unknown[] = [];
  const startedAt = new Date().toISOString();
  let app: ElectronApplication | undefined;
  let settings: unknown;
  let failed = false;
  let failure: string | undefined;
  let activePage: Page | undefined;
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path,
    FRAMEMIND_E2E_REPORT_PATH: join(directory, "report.docx"), FRAMEMIND_E2E_REPORT_PDF_PATH: join(directory, "report.pdf") };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  const launch = async () => {
    app = await electron.launch({ args: ["."], env });
    const page = await app.firstWindow();
    await enterWorkbenchWithoutRecovery(page);
    await page.keyboard.press("Control+o");
    await expect(page.locator('footer[role="status"]')).toContainText("已打开");
    activePage = page;
    return page;
  };
  try {
    await writeFile(path, encodeProject(project));
    if (online) {
      const source = join(process.env.APPDATA!, "framemind");
      // Copy encrypted files only; the real application's OSCrypt decrypts the key.
      for (const file of ["deepseek.credentials", "Local State"]) await copyFile(join(source, file), join(directory, file));
    }
    const page = await launch();
    if (!online) {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "设置", exact: true });
      await dialog.getByLabel("DeepSeek API Key").fill("sk-t211-fixture-only");
      await dialog.getByRole("button", { name: "保存连接" }).click();
      await expect(dialog.getByTestId("deepseek-feedback")).toHaveText("连接设置已保存");
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    }
    settings = await page.evaluate(() => window.frameMind.getDeepSeekSettings());
    await run({ page, app: () => app!, path, project,
      restart: async () => { await app!.close(); app = undefined; return launch(); },
      check: (name, value) => { checks[name] = (checks[name] ?? true) && value; },
      ask: async (page, prompt, rounds, response) => {
        const previousIds = await page.evaluate(async (id) => {
          const previous = JSON.parse(await window.frameMind.loadChatHistory(id) ?? "[]") as ConversationHistory[];
          return previous.flatMap((history) => history.turns.map((turn) => turn.id));
        }, project.id);
        if (!online) await app!.evaluate((_electron, script) => {
          let index = 0;
          globalThis.fetch = async () => {
            const tools = script.rounds[index++];
            return new Response(JSON.stringify({ choices: [{ message: tools
              ? { role: "assistant", content: null, tool_calls: tools.map((tool, i) => ({ id: `t211-${index}-${i}`, type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.input) } })) }
              : { role: "assistant", content: script.response } }] }));
          };
        }, { rounds, response });
        await page.getByLabel("AI 消息草稿").fill(prompt);
        await page.getByRole("button", { name: "发送消息", exact: true }).click();
        await expect(page.getByTestId("ai-turn-status").last()).toHaveText(/^(等待确认|缺少输入|已完成|处理失败|已取消) ·/, { timeout: 150_000 });
        let evidence: AiTaskResult | undefined;
        await expect.poll(async () => {
          evidence = await page.evaluate(async ({ projectId, previousIds, prompt }) => {
            const histories = JSON.parse(await window.frameMind.loadChatHistory(projectId) ?? "[]") as ConversationHistory[];
            return histories.flatMap((history) => history.turns).findLast((turn) => !previousIds.includes(turn.id) && turn.prompt === prompt && turn.result)?.result;
          }, { projectId: project.id, previousIds, prompt });
          return Boolean(evidence);
        }, { timeout: 150_000, intervals: [500] }).toBe(true);
        turns.push({ prompt, ...evidence, observed: { toolCalls: evidence!.records.length, rounds: Math.max(0, ...evidence!.records.map((r) => r.round)), exploration: evidence!.exploration } });
        return evidence!;
      },
    });
    if (options.task === "T2-41") {
      const results = turns as (AiTaskResult & { prompt: string })[];
      checks.budget = results.length > 0 && results.every((r) => r.records.length <= 64 && r.records.every((record) => record.round <= 8));
      checks.toolBoundary = results.length > 0 && results.every((r) => r.records.every((record) => !/command|shell|script|code|exec|file_write|optimize/.test(record.call.function.name)));
    }
    for (const [name, value] of Object.entries(checks)) expect(value, name).toBe(true);
    expect(Object.keys(checks).length).toBeGreaterThan(0);
  } catch (error) {
    failed = true;
    failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    try {
      const output = resolve(process.env[prefix + "_OUTPUT"] ?? `docs/evidence/plan2/${options.task}/${mode}`);
      await mkdir(output, { recursive: true });
      let partialHistories: unknown;
      if (failed && activePage && !activePage.isClosed()) {
        try { partialHistories = await activePage.evaluate(async (id) => JSON.parse(await window.frameMind.loadChatHistory(id) ?? "[]"), project.id); } catch { /* A crashed renderer has no retrievable history. */ }
      }
      let saved: unknown;
      try { saved = JSON.parse(await readFile(path, "utf8")); } catch { /* Preserve even launch failures. */ }
      await writeFile(join(output, `${id}-${test.info().repeatEachIndex}.json`), JSON.stringify(redactPersistence({
        id, mode, repeat: test.info().repeatEachIndex, startedAt, endedAt: new Date().toISOString(),
        status: failed ? "failed" : "passed", failure, partialHistories, settings, checks, turns, input: project, saved,
        transport: online ? "actual DeepSeek HTTPS; no transport replacement" : "fixed tool responses; actual Electron application",
      }), null, 2) + "\n");
    } finally {
      try { await app?.close(); } finally {
        if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !basename(directory).startsWith("framemind-t211-")) throw new Error("Invalid test cleanup path");
        await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      }
    }
  }
}
