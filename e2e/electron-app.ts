import { _electron as electron, expect, type Page } from "@playwright/test";

/** Existing formal-file scenarios explicitly choose to enter without applying an automatic snapshot. */
export async function enterWorkbenchWithoutRecovery(page: Page) {
  const skipRecovery = page.getByRole("button", { name: "暂不恢复，进入工作台", exact: true });
  await expect(skipRecovery.or(page.getByRole("button", { name: "文件", exact: true }))).toBeVisible();
  if (await skipRecovery.isVisible()) await skipRecovery.click();
}

export async function launchFrameMind(options: { userDataPath?: string } = {}) {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  if (options.userDataPath) environment.FRAMEMIND_E2E_USER_DATA_PATH = options.userDataPath;
  delete environment.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env: environment });
  const page = await app.firstWindow();
  await enterWorkbenchWithoutRecovery(page);
  return { app, page };
}
