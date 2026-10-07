# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plan2-t2-11-reliability.spec.ts >> T2-11 whole-task confirmation, restart and requested local solve
- Location: e2e\plan2-t2-11-reliability.spec.ts:41:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: '暂不恢复，进入工作台', exact: true }).or(getByRole('button', { name: '文件', exact: true }))
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('button', { name: '暂不恢复，进入工作台', exact: true }).or(getByRole('button', { name: '文件', exact: true })) with timeout 5000ms
  - waiting for getByRole('button', { name: '暂不恢复，进入工作台', exact: true }).or(getByRole('button', { name: '文件', exact: true }))

```

# Test source

```ts
  1  | import { _electron as electron, expect, type Page } from "@playwright/test";
  2  | 
  3  | /** Existing formal-file scenarios explicitly choose to enter without applying an automatic snapshot. */
  4  | export async function enterWorkbenchWithoutRecovery(page: Page) {
  5  |   const skipRecovery = page.getByRole("button", { name: "暂不恢复，进入工作台", exact: true });
> 6  |   await expect(skipRecovery.or(page.getByRole("button", { name: "文件", exact: true }))).toBeVisible();
     |                                                                                        ^ Error: expect(locator).toBeVisible() failed
  7  |   if (await skipRecovery.isVisible()) await skipRecovery.click();
  8  | }
  9  | 
  10 | export async function launchFrameMind(options: { userDataPath?: string } = {}) {
  11 |   const environment: NodeJS.ProcessEnv = { ...process.env };
  12 |   if (options.userDataPath) environment.FRAMEMIND_E2E_USER_DATA_PATH = options.userDataPath;
  13 |   delete environment.ELECTRON_RUN_AS_NODE;
  14 |   const app = await electron.launch({ args: ["."], env: environment });
  15 |   const page = await app.firstWindow();
  16 |   await enterWorkbenchWithoutRecovery(page);
  17 |   return { app, page };
  18 | }
  19 | 
```