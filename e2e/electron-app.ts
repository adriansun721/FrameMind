import { _electron as electron } from "@playwright/test";

export async function launchFrameMind() {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env: environment });
  return { app, page: await app.firstWindow() };
}
