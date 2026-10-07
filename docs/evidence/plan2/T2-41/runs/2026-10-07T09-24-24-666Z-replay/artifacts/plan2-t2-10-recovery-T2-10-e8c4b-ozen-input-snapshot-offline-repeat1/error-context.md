# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plan2-t2-10-recovery.spec.ts >> T2-10 restores a crashed local calculation from its automatic frozen-input snapshot offline
- Location: e2e\plan2-t2-10-recovery.spec.ts:225:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 1
Received: 0

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  136 |           if (stage === "before-write") return stop();
  137 |           if (stage === "mid-write") { await nodeRequire("node:fs/promises").writeFile(path, content.slice(0, content.length / 2)); return stop(); }
  138 |           await originalWrite(path, content);
  139 |           if (stage === "before-rename") return stop();
  140 |         };
  141 |         files.rename = async (from: string, to: string) => { await originalRename(from, to); if (stage === "after-rename") return stop(); };
  142 |         return originalSave.call(this, request);
  143 |       };
  144 |     }, stage);
  145 |     await page.evaluate((content) => { void window.frameMind.saveRecovery({ content, formalSave: null }).catch(() => {}); }, encodeProject(applied));
  146 |     await expect.poll(() => app().evaluate(() => (globalThis as unknown as { recoveryFaultReached: string }).recoveryFaultReached)).toBe(stage);
  147 |     await crash(); page = await launch();
  148 |     await expect(page.getByRole("main", { name: "启动恢复" })).toContainText(base.id);
  149 |     const restored = decodeProject(await page.evaluate(async () => window.frameMind.readRecovery((await window.frameMind.listRecovery()).entries[0].id)));
  150 |     expect(restored.nodes).toHaveLength(stage === "after-rename" ? 1 : 0);
  151 |     expect(restored.confirmedOperations ?? []).toHaveLength(stage === "after-rename" ? 1 : 0);
  152 |     expect(new ModelEditConfirmation().confirm(restored, confirmation).project.nodes).toHaveLength(1);
  153 |     await page.getByRole("button", { name: "恢复此快照", exact: true }).click();
  154 |     await expect(page.locator('footer[role="status"]')).toContainText(`${stage === "after-rename" ? 1 : 0} 节点`);
  155 |   });
  156 | });
  157 | 
  158 | test("T2-10 shows disk failure without losing the previous snapshot, allows edits, and retries", async () => {
  159 |   await fixture(async (launch, _crash, _directory, app) => {
  160 |     const page = await launch(); await createNode(page, ["1", "0", "0"]);
  161 |     await expect.poll(async () => (await latest(page))?.nodes?.length).toBe(1);
  162 |     await app().evaluate(() => {
  163 |       const nodeRequire = process.getBuiltinModule("module")!.createRequire(`${process.cwd()}/dist-electron/main.js`);
  164 |       const store = nodeRequire("./recovery-store.js").RecoveryStore;
  165 |       const original = store.prototype.save;
  166 |       store.prototype.save = function (request: unknown) {
  167 |         const write = this.files.write;
  168 |         this.files.write = async () => { throw new Error("ENOSPC"); };
  169 |         (globalThis as unknown as { restoreRecoveryDisk: () => void }).restoreRecoveryDisk = () => { this.files.write = write; store.prototype.save = original; };
  170 |         store.prototype.save = function (request: unknown) { return original.call(this, request); };
  171 |         return original.call(this, request);
  172 |       };
  173 |     });
  174 |     await createNode(page, ["2", "0", "0"]);
  175 |     await expect(page.getByTestId("recovery-notice")).toContainText("快照写入失败");
  176 |     expect((await latest(page)).nodes).toHaveLength(1);
  177 |     await createNode(page, ["3", "0", "0"]);
  178 |     await expect(page.locator('footer[role="status"]')).toContainText("3 节点");
  179 |     await app().evaluate(() => (globalThis as unknown as { restoreRecoveryDisk: () => void }).restoreRecoveryDisk());
  180 |     await expect.poll(async () => (await latest(page))?.nodes?.length).toBe(3);
  181 |     await expect(page.getByTestId("recovery-notice")).toHaveCount(0);
  182 |   });
  183 | });
  184 | 
  185 | for (const checkpoint of ["before-model-commit", "after-model-before-receipt", "after-receipt-before-snapshot"] as const) test(`T2-10 terminates the live confirmation ${checkpoint} without publishing a partial state`, async () => {
  186 |   await fixture(async (launch, crash, _directory, app) => {
  187 |     let page = await launch();
  188 |     await page.getByRole("button", { name: "设置", exact: true }).click();
  189 |     const settings = page.getByRole("dialog", { name: "设置", exact: true });
  190 |     await settings.getByLabel("DeepSeek API Key").fill("sk-t210-fixture-only");
  191 |     await settings.getByRole("button", { name: "保存连接" }).click();
  192 |     await expect(settings.getByTestId("deepseek-feedback")).toHaveText("连接设置已保存");
  193 |     await settings.getByRole("button", { name: "关闭", exact: true }).click();
  194 |     await replay(app(), parameters); await send(page, "准备两层刚架，先等我确认");
  195 |     await expect.poll(async () => (await latest(page))?.taskState?.conversations[0]?.proposal?.version).toBe(1);
  196 |     const pending = await latest(page);
  197 |     const debuggerSession = await app().context().newCDPSession(page);
  198 |     await debuggerSession.send("Debugger.enable");
  199 |     await page.evaluate(({ checkpoint, id }) => {
  200 |       if (checkpoint === "before-model-commit") {
  201 |         document.addEventListener("click", (event) => { if ((event.target as HTMLElement).closest("button")?.textContent === "确认建模") { debugger; } }, { capture: true });
  202 |       } else {
  203 |         const stringify = JSON.stringify;
  204 |         JSON.stringify = function (value, replacer, space) {
  205 |           const afterModel = Array.isArray(value) && value[0] === id && Array.isArray(value[2]) && value[2].length === 12;
  206 |           const afterReceipt = value && typeof value === "object" && value.id === id && value.confirmedOperations?.length === 1;
  207 |           if (checkpoint === "after-model-before-receipt" ? afterModel : afterReceipt) { debugger; }
  208 |           return stringify(value, replacer, space);
  209 |         } as typeof JSON.stringify;
  210 |       }
  211 |     }, { checkpoint, id: pending.id });
  212 |     const paused = new Promise<void>((done) => debuggerSession.once("Debugger.paused", () => done()));
  213 |     void page.getByRole("button", { name: "确认建模", exact: true }).click().catch(() => {});
  214 |     await paused; await crash(); page = await launch();
  215 |     await expect(page.getByRole("main", { name: "启动恢复" })).toContainText(pending.id);
  216 |     const restored = await latest(page); expect(restored.nodes).toHaveLength(0); expect(restored.confirmedOperations ?? []).toHaveLength(0);
  217 |     await page.getByRole("button", { name: "恢复此快照", exact: true }).click();
  218 |     await page.getByRole("button", { name: "恢复任务", exact: true }).click();
  219 |     await page.getByRole("button", { name: "确认建模", exact: true }).dblclick();
  220 |     await expect.poll(async () => (await latest(page))?.nodes?.length).toBe(12);
  221 |     expect((await latest(page)).confirmedOperations).toHaveLength(1);
  222 |   });
  223 | });
  224 | 
  225 | test("T2-10 restores a crashed local calculation from its automatic frozen-input snapshot offline", async () => {
  226 |   await fixture(async (launch, crash, directory) => {
  227 |     const path = join(directory, "中文正式工程.framemind"); await writeFile(path, encodeProject(columns()));
  228 |     let page = await launch();
  229 |     await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
  230 |     await expect(page.locator('footer[role="status"]')).toContainText("已打开");
  231 |     await page.evaluate(() => {
  232 |       const NativeWorker = window.Worker;
  233 |       window.Worker = class extends NativeWorker { postMessage() { /* Keep the actual task in its pending numerical phase until the process is terminated. */ } };
  234 |     });
  235 |     await page.getByRole("button", { name: "运行分析", exact: true }).click();
> 236 |     await expect.poll(async () => (await latest(page))?.taskState?.analyses?.length).toBe(1);
      |                                                                                      ^ Error: expect(received).toBe(expected) // Object.is equality
  237 |     const interrupted = await latest(page); await crash(); page = await launch();
  238 |     await page.getByRole("button", { name: "恢复此快照", exact: true }).click();
  239 |     await expect(page.getByRole("button", { name: "取消计算", exact: true })).toHaveCount(0);
  240 |     expect((await latest(page)).analysisResults).toHaveLength(1);
  241 |     await page.getByRole("button", { name: "继续任务", exact: true }).click();
  242 |     await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
  243 |     await expect.poll(async () => (await latest(page))?.analysisResults?.length).toBe(2);
  244 |     expect((await latest(page)).analysisResults[1].input).toEqual(interrupted.taskState.analyses[0].input);
  245 |   });
  246 | });
  247 | 
```