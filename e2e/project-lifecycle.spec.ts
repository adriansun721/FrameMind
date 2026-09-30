import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("creates, displays, saves, closes, and reopens a spatial node", async () => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-e2e-"));
  const projectPath = join(directory, "coursework.framemind");
  const environment: NodeJS.ProcessEnv = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  environment.FRAMEMIND_E2E_PROJECT_PATH = projectPath;

  const firstRun = await electron.launch({ args: ["."], env: environment });
  const firstWindow = await firstRun.firstWindow();

  await firstWindow.getByRole("button", { name: "创建节点" }).click();
  await firstWindow.getByLabel("X 坐标").fill("1.25");
  await firstWindow.getByLabel("Y 坐标").fill("-2");
  await firstWindow.getByLabel("Z 坐标").fill("3.5");
  await firstWindow.getByRole("button", { name: "添加到模型" }).click();

  await expect(firstWindow.getByTestId("viewport-node-count")).toHaveText("1 个节点");
  await expect(firstWindow.getByText("node_0001", { exact: true })).toBeVisible();

  await firstWindow.getByRole("button", { name: "保存项目" }).click();
  await expect(firstWindow.getByRole("status")).toContainText("已保存");
  await firstRun.close();

  const saved = JSON.parse(await readFile(projectPath, "utf8"));
  expect(saved.nodes[0]).toMatchObject({
    id: "node_0001",
    position: { x: 1.25, y: -2, z: 3.5 },
  });

  const secondRun = await electron.launch({ args: ["."], env: environment });
  const secondWindow = await secondRun.firstWindow();
  await secondWindow.getByRole("button", { name: "打开项目" }).click();
  await secondWindow.getByText("N1", { exact: true }).click();

  await expect(secondWindow.getByTestId("viewport-node-count")).toHaveText("1 个节点");
  await expect(secondWindow.getByText("node_0001", { exact: true })).toBeVisible();
  await expect(secondWindow.getByText("1.250 m", { exact: true })).toBeVisible();

  await secondRun.close();
  await rm(directory, { recursive: true, force: true });
});
