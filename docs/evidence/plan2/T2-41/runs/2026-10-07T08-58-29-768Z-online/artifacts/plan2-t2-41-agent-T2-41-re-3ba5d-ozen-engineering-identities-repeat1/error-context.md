# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plan2-t2-41-agent.spec.ts >> T2-41 real citations bind all five saved methods to frozen engineering identities
- Location: e2e\plan2-t2-41-agent.spec.ts:96:5

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator: getByTestId('ai-turn-status').last()
Expected pattern: /^(等待确认|缺少输入|已完成|处理失败|已取消) ·/
Received string:  "处理中 · 正在读取当前模型"

Call log:
  - Expect "toHaveText" getByTestId('ai-turn-status').last() with timeout 150000ms
  - waiting for getByTestId('ai-turn-status').last()
    29 × locator resolved to <span class="ai-turn-status" data-testid="ai-turn-status">处理中 · 正在读取当前模型</span>
       - unexpected value "处理中 · 正在读取当前模型"
  - Protocol error (Runtime.callFunctionOn): Internal server error, session closed.

```

```yaml
- text: 处理中 · 正在读取当前模型
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
  32  |   const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  33  |   delete env.ELECTRON_RUN_AS_NODE;
  34  |   delete env.VITE_DEV_SERVER_URL;
  35  |   const launch = async () => {
  36  |     app = await electron.launch({ args: ["."], env });
  37  |     const page = await app.firstWindow();
  38  |     await enterWorkbenchWithoutRecovery(page);
  39  |     await page.keyboard.press("Control+o");
  40  |     await expect(page.locator('footer[role="status"]')).toContainText("已打开");
  41  |     return page;
  42  |   };
  43  |   try {
  44  |     await writeFile(path, encodeProject(project));
  45  |     if (online) {
  46  |       const source = join(process.env.APPDATA!, "framemind");
  47  |       // Copy encrypted files only; the real application's OSCrypt decrypts the key.
  48  |       for (const file of ["deepseek.credentials", "Local State"]) await copyFile(join(source, file), join(directory, file));
  49  |     }
  50  |     const page = await launch();
  51  |     if (!online) {
  52  |       await page.getByRole("button", { name: "设置", exact: true }).click();
  53  |       const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  54  |       await dialog.getByLabel("DeepSeek API Key").fill("sk-t211-fixture-only");
  55  |       await dialog.getByRole("button", { name: "保存连接" }).click();
  56  |       await expect(dialog.getByTestId("deepseek-feedback")).toHaveText("连接设置已保存");
  57  |       await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  58  |     }
  59  |     settings = await page.evaluate(() => window.frameMind.getDeepSeekSettings());
  60  |     await run({ page, app: () => app!, path, project,
  61  |       restart: async () => { await app!.close(); app = undefined; return launch(); },
  62  |       check: (name, value) => { checks[name] = (checks[name] ?? true) && value; },
  63  |       ask: async (page, prompt, rounds, response) => {
  64  |         const previousIds = await page.evaluate(async (id) => {
  65  |           const previous = JSON.parse(await window.frameMind.loadChatHistory(id) ?? "[]") as ConversationHistory[];
  66  |           return previous.flatMap((history) => history.turns.map((turn) => turn.id));
  67  |         }, project.id);
  68  |         if (!online) await app!.evaluate((_electron, script) => {
  69  |           let index = 0;
  70  |           globalThis.fetch = async () => {
  71  |             const tools = script.rounds[index++];
  72  |             return new Response(JSON.stringify({ choices: [{ message: tools
  73  |               ? { role: "assistant", content: null, tool_calls: tools.map((tool, i) => ({ id: `t211-${index}-${i}`, type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.input) } })) }
  74  |               : { role: "assistant", content: script.response } }] }));
  75  |           };
  76  |         }, { rounds, response });
  77  |         await page.getByLabel("AI 消息草稿").fill(prompt);
  78  |         await page.getByRole("button", { name: "发送消息", exact: true }).click();
> 79  |         await expect(page.getByTestId("ai-turn-status").last()).toHaveText(/^(等待确认|缺少输入|已完成|处理失败|已取消) ·/, { timeout: 150_000 });
      |                                                                 ^ Error: expect(locator).toHaveText(expected) failed
  80  |         let evidence: AiTaskResult | undefined;
  81  |         await expect.poll(async () => {
  82  |           evidence = await page.evaluate(async ({ projectId, previousIds, prompt }) => {
  83  |             const histories = JSON.parse(await window.frameMind.loadChatHistory(projectId) ?? "[]") as ConversationHistory[];
  84  |             return histories.flatMap((history) => history.turns).findLast((turn) => !previousIds.includes(turn.id) && turn.prompt === prompt && turn.result)?.result;
  85  |           }, { projectId: project.id, previousIds, prompt });
  86  |           return Boolean(evidence);
  87  |         }, { timeout: 150_000, intervals: [500] }).toBe(true);
  88  |         turns.push({ prompt, ...evidence, observed: { toolCalls: evidence!.records.length, rounds: Math.max(0, ...evidence!.records.map((r) => r.round)), exploration: evidence!.exploration } });
  89  |         return evidence!;
  90  |       },
  91  |     });
  92  |     if (options.task === "T2-41") {
  93  |       const results = turns as (AiTaskResult & { prompt: string })[];
  94  |       checks.budget = results.length > 0 && results.every((r) => r.records.length <= 64 && r.records.every((record) => record.round <= 8));
  95  |       checks.toolBoundary = results.length > 0 && results.every((r) => r.records.every((record) => !/command|shell|script|code|exec|file_write|optimize/.test(record.call.function.name)));
  96  |     }
  97  |     for (const [name, value] of Object.entries(checks)) expect(value, name).toBe(true);
  98  |     expect(Object.keys(checks).length).toBeGreaterThan(0);
  99  |   } catch (error) {
  100 |     failed = true;
  101 |     throw error;
  102 |   } finally {
  103 |     try {
  104 |       const output = resolve(process.env[prefix + "_OUTPUT"] ?? `docs/evidence/plan2/${options.task}/${mode}`);
  105 |       await mkdir(output, { recursive: true });
  106 |       let saved: unknown;
  107 |       try { saved = JSON.parse(await readFile(path, "utf8")); } catch { /* Preserve even launch failures. */ }
  108 |       await writeFile(join(output, `${id}-${test.info().repeatEachIndex}.json`), JSON.stringify(redactPersistence({
  109 |         id, mode, repeat: test.info().repeatEachIndex, startedAt, endedAt: new Date().toISOString(),
  110 |         status: failed ? "failed" : "passed", settings, checks, turns, input: project, saved,
  111 |         transport: online ? "actual DeepSeek HTTPS; no transport replacement" : "fixed tool responses; actual Electron application",
  112 |       }), null, 2) + "\n");
  113 |     } finally {
  114 |       try { await app?.close(); } finally {
  115 |         if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !basename(directory).startsWith("framemind-t211-")) throw new Error("Invalid test cleanup path");
  116 |         await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  117 |       }
  118 |     }
  119 |   }
  120 | }
  121 | 
```