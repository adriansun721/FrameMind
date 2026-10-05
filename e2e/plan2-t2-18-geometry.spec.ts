import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { decodeProject } from "../src/domain/project-file";
import { enterWorkbenchWithoutRecovery } from "./electron-app";
import { createNode } from "./modeling-actions";
import { freeGeometryFixtures } from "../src/validation/free-geometry-fixtures";

async function fileAction(page: Page, action: string) {
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(action) }).click();
}

test("T2-18 manual free coordinates, native diagonal physics, unit changes and save/reopen preserve topology", async () => {
  test.setTimeout(120000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t218-"));
  const path = join(directory, "geometry.framemind");
  const evidence = "docs/evidence/plan2/T2-18"; await mkdir(evidence, { recursive: true });
  const fixture = freeGeometryFixtures()[0]; await writeFile(path, JSON.stringify(fixture.project));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await fileAction(page, "打开项目");
    await expect(page.getByTestId("viewport-node-count")).toHaveText("2 个节点");
    await page.getByRole("region", { name: "项目树" }).getByText("N2", { exact: true }).click();
    await page.getByLabel("X 坐标", { exact: true }).fill("-120.625");
    await page.getByLabel("Y 坐标", { exact: true }).fill("-51.5");
    await page.getByLabel("Z 坐标", { exact: true }).fill("3.125");
    await page.getByRole("button", { name: "保存节点属性", exact: true }).click();
    await expect(page.getByLabel("选中节点信息")).toContainText("-120.625");
    await fileAction(page, "保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    expect(decodeProject(await readFile(path, "utf8")).nodes[1].position).toEqual({ x: -120.625, y: -51.5, z: 3.125 });
    // Restore the independently registered diagonal before the native solve.
    await page.getByLabel("X 坐标", { exact: true }).fill("-120.125"); await page.getByLabel("Y 坐标", { exact: true }).fill("-51.25"); await page.getByLabel("Z 坐标", { exact: true }).fill("3.5");
    await page.getByRole("button", { name: "保存节点属性", exact: true }).click();
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    for (const preset of ["mm-N", "mm-kN", "m-kN"]) await page.getByLabel("单位预设").selectOption(preset);
    await fileAction(page, "保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    const solved = decodeProject(await readFile(path, "utf8"));
    expect(solved.latestAnalysis!.input.solver?.implementation).toBe("framemind-native/2");
    expect(solved.nodes).toEqual(fixture.project.nodes); expect(solved.members).toEqual(fixture.project.members);
    expect(solved.latestAnalysis!.nodes[1].displacement.x).toBeCloseTo(.000015, 12);
    expect(solved.latestAnalysis!.nodes[1].displacement.z).toBeCloseTo(.000020, 12);
    await page.getByRole("button", { name: "适合模型", exact: true }).click();
    for (const theme of ["dark", "light"]) {
      if (theme === "light") { await page.getByRole("button", { name: "设置", exact: true }).click(); await page.getByRole("button", { name: "浅色", exact: true }).click(); await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: "关闭", exact: true }).click(); }
      for (const width of [1440, 1080]) { await page.setViewportSize({ width, height: 900 }); await page.screenshot({ path: join(evidence, `geometry-${theme}-${width}.png`) }); }
    }
    await createNode(page, ["-200.001125", ".000125", "-.0125"]);
    await createNode(page, ["1000000000.125", "-1000000000.25", "1000000000.5"]);
    await createNode(page, ["1000000000.1251220703125", "-1000000000.25", "1000000000.5"]);
    await fileAction(page, "保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    const saved = decodeProject(await readFile(path, "utf8"));
    expect(saved.nodes[2].position).toEqual({ x: -200.001125, y: .000125, z: -.0125 });
    expect(saved.nodes[4].position.x - saved.nodes[3].position.x).toBe(.0001220703125);
    expect(saved.members).toEqual(fixture.project.members);
    await app.close(); app = await electron.launch({ args: ["."], env }); page = await app.firstWindow();
    await enterWorkbenchWithoutRecovery(page); await fileAction(page, "打开项目");
    await expect(page.getByTestId("viewport-node-count")).toHaveText("5 个节点");
    await fileAction(page, "保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    const reopened = decodeProject(await readFile(path, "utf8")); expect(reopened.nodes).toEqual(saved.nodes); expect(reopened.members).toEqual(saved.members);
    // A compact model at large world coordinates exercises the local scene origin in Electron.
    const close = freeGeometryFixtures()[1].project; await writeFile(path, JSON.stringify(close)); await fileAction(page, "打开项目");
    await page.getByRole("button", { name: "适合模型", exact: true }).click();
    await expect(page.getByTestId("viewport-node-count")).toHaveText("2 个节点");
    await page.getByRole("button", { name: "运行分析", exact: true }).click(); await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    await page.screenshot({ path: join(evidence, "large-close.png") });
    await fileAction(page, "保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    const closeSaved = decodeProject(await readFile(path, "utf8")); expect(closeSaved.latestAnalysis!.nodes[1].displacement.x).toBeCloseTo(4.8828125e-10, 18);
    const state = (await page.getByLabel("三维模型视图").getAttribute("data-camera-state"))!.split(",").map(Number);
    expect(state.slice(0, 6).every((value) => Number.isFinite(value) && Math.abs(value) < 100)).toBe(true);
    await copyFile(path, join(evidence, "large-close.framemind"));
    await writeFile(join(evidence, "desktop-verification.json"), JSON.stringify({ passed: true, solver: solved.latestAnalysis!.input.solver?.implementation, savedCoordinates: saved.nodes.map((node) => node.position), reopenedTopologyPreserved: true, diagonalTip: solved.latestAnalysis!.nodes[1].displacement, largeCloseTip: closeSaved.latestAnalysis!.nodes[1].displacement, localCamera: state }, null, 2));
  } finally {
    await app.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup path");
    await rm(directory, { recursive: true, force: true });
  }
});
