import { _electron as electron } from "@playwright/test";

export async function launchFrameMind(options: { userDataPath?: string } = {}) {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  if (options.userDataPath) environment.FRAMEMIND_E2E_USER_DATA_PATH = options.userDataPath;
  delete environment.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env: environment });
  return { app, page: await app.firstWindow() };
}
