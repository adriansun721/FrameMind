# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plan2-t2-41-agent.spec.ts >> T2-41 missing mass is clarified without invented engineering inputs
- Location: e2e\plan2-t2-41-agent.spec.ts:37:5

# Error details

```
Error: clarified

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  1   | import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
  2   | import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
  3   | import { tmpdir } from "node:os";
  4   | import { basename, join, resolve, sep } from "node:path";
  5   | import { encodeProject } from "../src/domain/project-file";
  6   | import { engineeringContent } from "../src/workspace/draft-coordination";
  7   | import { redactPersistence } from "../electron/persistence-redaction";
  8   | import { columns } from "../src/workspace/section-stage.fixture";
  9   | import type { AiTaskResult } from "../src/workspace/ai-task";
  10  | import type { ConversationHistory } from "../src/workspace/task-persistence";
  11  | import { enterWorkbenchWithoutRecovery } from "./electron-app";
  12  | 
  13  | export type Tool = { name: string; input: unknown };
  14  | 
  15  | export async function agentFixture(id: string, options: { task: "T2-11" | "T2-41"; project?: ReturnType<typeof columns> }, run: (context: {
  16  |   page: Page; app: () => ElectronApplication; path: string; project: ReturnType<typeof columns>;
  17  |   restart(): Promise<Page>; check(name: string, value: boolean): void;
  18  |   ask(page: Page, prompt: string, rounds: Tool[][], response: string): Promise<AiTaskResult>;
  19  | }) => Promise<void>) {
  20  |   const prefix = options.task === "T2-11" ? "FRAMEMIND_T211" : "FRAMEMIND_T241";
  21  |   const online = process.env[prefix + "_ONLINE"] === "1";
  22  |   const mode = online ? "online" : "replay";
  23  |   const directory = await mkdtemp(join(tmpdir(), "framemind-t211-"));
  24  |   const path = join(directory, "reliability.framemind");
  25  |   const project = options.project ?? columns();
  26  |   const checks: Record<string, boolean> = {};
  27  |   const turns: unknown[] = [];
  28  |   const startedAt = new Date().toISOString();
  29  |   let app: ElectronApplication | undefined;
  30  |   let settings: unknown;
  31  |   let failed = false;
  32  |   let failure: string | undefined;
  33  |   let activePage: Page | undefined;
  34  |   const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  35  |   delete env.ELECTRON_RUN_AS_NODE;
  36  |   delete env.VITE_DEV_SERVER_URL;
  37  |   const launch = async () => {
  38  |     app = await electron.launch({ args: ["."], env });
  39  |     const page = await app.firstWindow();
  40  |     await enterWorkbenchWithoutRecovery(page);
  41  |     await page.keyboard.press("Control+o");
  42  |     await expect(page.locator('footer[role="status"]')).toContainText("已打开");
  43  |     activePage = page;
  44  |     return page;
  45  |   };
  46  |   try {
  47  |     await writeFile(path, encodeProject(project));
  48  |     if (online) {
  49  |       const source = join(process.env.APPDATA!, "framemind");
  50  |       // Copy encrypted files only; the real application's OSCrypt decrypts the key.
  51  |       for (const file of ["deepseek.credentials", "Local State"]) await copyFile(join(source, file), join(directory, file));
  52  |     }
  53  |     const page = await launch();
  54  |     if (!online) {
  55  |       await page.getByRole("button", { name: "设置", exact: true }).click();
  56  |       const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  57  |       await dialog.getByLabel("DeepSeek API Key").fill("sk-t211-fixture-only");
  58  |       await dialog.getByRole("button", { name: "保存连接" }).click();
  59  |       await expect(dialog.getByTestId("deepseek-feedback")).toHaveText("连接设置已保存");
  60  |       await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  61  |     }
  62  |     settings = await page.evaluate(() => window.frameMind.getDeepSeekSettings());
  63  |     await run({ page, app: () => app!, path, project,
  64  |       restart: async () => { await app!.close(); app = undefined; return launch(); },
  65  |       check: (name, value) => { checks[name] = (checks[name] ?? true) && value; },
  66  |       ask: async (page, prompt, rounds, response) => {
  67  |         const previousIds = await page.evaluate(async (id) => {
  68  |           const previous = JSON.parse(await window.frameMind.loadChatHistory(id) ?? "[]") as ConversationHistory[];
  69  |           return previous.flatMap((history) => history.turns.map((turn) => turn.id));
  70  |         }, project.id);
  71  |         if (!online) await app!.evaluate((_electron, script) => {
  72  |           let index = 0;
  73  |           globalThis.fetch = async () => {
  74  |             const tools = script.rounds[index++];
  75  |             return new Response(JSON.stringify({ choices: [{ message: tools
  76  |               ? { role: "assistant", content: null, tool_calls: tools.map((tool, i) => ({ id: `t211-${index}-${i}`, type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.input) } })) }
  77  |               : { role: "assistant", content: script.response } }] }));
  78  |           };
  79  |         }, { rounds, response });
  80  |         await page.getByLabel("AI 消息草稿").fill(prompt);
  81  |         await page.getByRole("button", { name: "发送消息", exact: true }).click();
  82  |         await expect(page.getByTestId("ai-turn-status").last()).toHaveText(/^(等待确认|缺少输入|已完成|处理失败|已取消) ·/, { timeout: 150_000 });
  83  |         let evidence: AiTaskResult | undefined;
  84  |         await expect.poll(async () => {
  85  |           evidence = await page.evaluate(async ({ projectId, previousIds, prompt }) => {
  86  |             const histories = JSON.parse(await window.frameMind.loadChatHistory(projectId) ?? "[]") as ConversationHistory[];
  87  |             return histories.flatMap((history) => history.turns).findLast((turn) => !previousIds.includes(turn.id) && turn.prompt === prompt && turn.result)?.result;
  88  |           }, { projectId: project.id, previousIds, prompt });
  89  |           return Boolean(evidence);
  90  |         }, { timeout: 150_000, intervals: [500] }).toBe(true);
  91  |         turns.push({ prompt, ...evidence, observed: { toolCalls: evidence!.records.length, rounds: Math.max(0, ...evidence!.records.map((r) => r.round)), exploration: evidence!.exploration } });
  92  |         return evidence!;
  93  |       },
  94  |     });
  95  |     if (options.task === "T2-41") {
  96  |       const results = turns as (AiTaskResult & { prompt: string })[];
  97  |       checks.budget = results.length > 0 && results.every((r) => r.records.length <= 64 && r.records.every((record) => record.round <= 8));
  98  |       checks.toolBoundary = results.length > 0 && results.every((r) => r.records.every((record) => !/command|shell|script|code|exec|file_write|optimize/.test(record.call.function.name)));
  99  |     }
> 100 |     for (const [name, value] of Object.entries(checks)) expect(value, name).toBe(true);
      |                                                                             ^ Error: clarified
  101 |     expect(Object.keys(checks).length).toBeGreaterThan(0);
  102 |   } catch (error) {
  103 |     failed = true;
  104 |     failure = error instanceof Error ? error.message : String(error);
  105 |     throw error;
  106 |   } finally {
  107 |     try {
  108 |       const output = resolve(process.env[prefix + "_OUTPUT"] ?? `docs/evidence/plan2/${options.task}/${mode}`);
  109 |       await mkdir(output, { recursive: true });
  110 |       let partialHistories: unknown;
  111 |       if (failed && activePage && !activePage.isClosed()) {
  112 |         try { partialHistories = await activePage.evaluate(async (id) => JSON.parse(await window.frameMind.loadChatHistory(id) ?? "[]"), project.id); } catch { /* A crashed renderer has no retrievable history. */ }
  113 |       }
  114 |       let saved: unknown;
  115 |       try { saved = JSON.parse(await readFile(path, "utf8")); } catch { /* Preserve even launch failures. */ }
  116 |       await writeFile(join(output, `${id}-${test.info().repeatEachIndex}.json`), JSON.stringify(redactPersistence({
  117 |         id, mode, repeat: test.info().repeatEachIndex, startedAt, endedAt: new Date().toISOString(),
  118 |         status: failed ? "failed" : "passed", failure, partialHistories, settings, checks, turns, input: project, saved,
  119 |         transport: online ? "actual DeepSeek HTTPS; no transport replacement" : "fixed tool responses; actual Electron application",
  120 |       }), null, 2) + "\n");
  121 |     } finally {
  122 |       try { await app?.close(); } finally {
  123 |         if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !basename(directory).startsWith("framemind-t211-")) throw new Error("Invalid test cleanup path");
  124 |         await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  125 |       }
  126 |     }
  127 |   }
  128 | }
  129 | 
```