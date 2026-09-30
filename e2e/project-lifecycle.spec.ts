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

test("creates, edits, displays, saves, and reopens a custom single member", async () => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t02-e2e-"));
  const projectPath = join(directory, "single-member.framemind");
  const environment: NodeJS.ProcessEnv = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  environment.FRAMEMIND_E2E_PROJECT_PATH = projectPath;

  const firstRun = await electron.launch({ args: ["."], env: environment });
  const page = await firstRun.firstWindow();
  for (const coordinates of [["0", "0", "0"], ["4", "0", "0"]]) {
    await page.getByRole("button", { name: "创建节点" }).click();
    const nodeDialog = page.getByRole("dialog", { name: "创建空间节点" });
    await nodeDialog.getByLabel("X 坐标").fill(coordinates[0]);
    await nodeDialog.getByLabel("Y 坐标").fill(coordinates[1]);
    await nodeDialog.getByLabel("Z 坐标").fill(coordinates[2]);
    await nodeDialog.getByRole("button", { name: "添加到模型" }).click();
  }
  await expect(page.getByRole("complementary").getByLabel("X 坐标")).toHaveValue("4");

  await page.getByRole("button", { name: "创建材料与截面" }).click();
  await page.getByLabel("材料名称").fill("Q355");
  await page.getByLabel("截面名称").fill("箱形 300");
  await page.getByRole("button", { name: "保存材料与截面" }).click();

  await page.getByRole("button", { name: "创建杆件" }).click();
  await page.getByLabel("起点节点").selectOption("node_0001");
  await page.getByLabel("终点节点").selectOption("node_0002");
  await page.getByLabel("截面转角（°）").fill("15");
  await page.getByRole("button", { name: "添加杆件" }).click();

  await expect(page.getByTestId("viewport-member-count")).toHaveText("1 根杆件");
  await expect(page.getByText("member_0001", { exact: true })).toBeVisible();
  await expect(page.getByText("4.000 m", { exact: true })).toBeVisible();
  await expect(page.getByText("局部 y", { exact: true })).toBeVisible();

  await page.getByText("N2", { exact: true }).click();
  await page.getByLabel("X 坐标").fill("5");
  await page.getByRole("button", { name: "保存节点属性" }).click();
  await page.getByText("材料 M1 · Q355", { exact: true }).click();
  await page.getByLabel("弹性模量 E").fill("210");
  await page.getByRole("button", { name: "保存材料属性" }).click();
  await page.getByText("截面 S1 · 箱形 300", { exact: true }).click();
  await page.getByLabel("面积 A").fill("0.012");
  await page.getByRole("button", { name: "保存截面属性" }).click();
  await page.getByText("M1", { exact: true }).click();
  await expect(page.getByText("5.000 m", { exact: true })).toBeVisible();
  await expect(page.getByTestId("viewport-member-details")).toContainText("E 210 GPa");
  await expect(page.getByTestId("viewport-member-details")).toContainText("A 0.012 m²");
  await page.getByLabel("截面转角（°）").fill("30");
  await page.getByRole("button", { name: "保存杆件属性" }).click();
  await expect(page.getByRole("status")).toContainText("已更新 M1");

  await page.getByRole("button", { name: "保存项目" }).click();
  await firstRun.close();

  const saved = JSON.parse(await readFile(projectPath, "utf8"));
  expect(saved.members[0]).toMatchObject({
    id: "member_0001",
    materialId: "material_0001",
    sectionId: "section_0001",
    rotationDegrees: 30,
  });
  expect(saved.nodes[1].position.x).toBe(5);
  expect(saved.materials[0].elasticModulusGPa).toBe(210);
  expect(saved.sections[0].areaM2).toBe(0.012);

  const secondRun = await electron.launch({ args: ["."], env: environment });
  const reopened = await secondRun.firstWindow();
  await reopened.getByRole("button", { name: "打开项目" }).click();
  await reopened.getByText("M1", { exact: true }).click();
  await expect(reopened.getByText("member_0001", { exact: true })).toBeVisible();
  await expect(reopened.getByLabel("截面转角（°）")).toHaveValue("30");
  await expect(reopened.getByText("Q355", { exact: true })).toBeVisible();
  await expect(reopened.getByText("箱形 300", { exact: true })).toBeVisible();

  await secondRun.close();
  await rm(directory, { recursive: true, force: true });
});
