import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bucklingColumn } from "../src/validation/buckling-fixtures";
import { enterWorkbenchWithoutRecovery } from "./electron-app";
import { save } from "./frame-proposal-actions";
import { decodeProject } from "../src/domain/project-file";

test("T2-30 manual fixed/reference case, native factors, shape, locating, themes and reopening", async () => {
  test.setTimeout(150000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t230-")), path = join(directory, "buckling.framemind");
  const original = bucklingColumn(30);
  await writeFile(path, JSON.stringify({ ...original, analysisCases: [], activeAnalysisCaseId: undefined, nextAnalysisCaseNumber: 1 }));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const evidence = "docs/evidence/plan2/T2-30"; await mkdir(evidence, { recursive: true });
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page);
    const open = async () => { await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click(); };
    await open();
    await page.getByRole("button", { name: "管理分析工况", exact: true }).click();
    const manager = page.getByRole("dialog", { name: "分析工况管理", exact: true });
    await manager.getByLabel("分析工况名称", { exact: true }).fill("固定30参考10");
    await manager.getByLabel("分析方法", { exact: true }).selectOption("buckling");
    await expect(manager).toContainText("λ 只放大参考部分");
    await manager.getByRole("button", { name: "添加固定预荷载", exact: true }).click();
    await manager.getByLabel("固定荷载来源 1", { exact: true }).selectOption("LC2");
    await manager.getByRole("button", { name: "创建分析工况", exact: true }).click();
    await expect(manager.getByRole("listitem")).toContainText("特征值屈曲");
    await manager.getByRole("button", { name: "计算此分析工况", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成", { timeout: 30000 });
    const panel = page.getByTestId("buckling-results");
    await expect(panel).toContainText("满足因子精度");
    await expect(panel.getByRole("table", { name: "屈曲因子表" })).toContainText("88.385");
    await expect(panel).toContainText("λ 只放大参考荷载");
    await expect(page.getByLabel("视图结果图例", { exact: true })).toContainText("屈曲形态");
    await panel.getByLabel("当前屈曲形态", { exact: true }).selectOption("2");
    await panel.getByLabel("屈曲形态显示幅值", { exact: true }).fill("250");
    await expect(page.getByLabel("视图结果图例", { exact: true })).toContainText("0.25");
    await panel.getByText("固定预荷载来源、方向与系数", { exact: true }).click();
    await expect(panel).toContainText("LC2"); await expect(panel).toContainText("-30");
    await panel.getByRole("button", { name: "node_0002", exact: true }).click();
    await expect(page.getByRole("region", { name: "对象属性", exact: true }).getByText("空间节点", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "查看分析结果", exact: true }).click();
    const saved = await save(page, path);
    expect(saved.latestAnalysis!.buckling!.modes).toHaveLength(3); expect(saved.latestAnalysis!.nodes).toEqual([]);
    expect(saved.latestAnalysis!.modal).toBeUndefined(); expect(saved.nodes).toHaveLength(2); expect(saved.members).toHaveLength(1);
    expect(saved.latestAnalysis!.input.analysisCase!.settings.buckling!.fixed).toEqual([{ loadCaseId: "LC2", factor: 1 }]);
    await page.getByRole("separator", { name: "调整属性面板高度" }).focus();
    await page.getByRole("separator", { name: "调整属性面板高度" }).press("End");
    for (const theme of ["light", "dark"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page.getByRole("button", { name: theme === "light" ? "浅色" : "深色", exact: true }).click();
      await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: /关闭/ }).click();
      for (const width of [1080, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await panel.getByRole("heading", { name: "屈曲因子与形态", exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(evidence, `buckling-${theme}-${width}.png`) });
      }
    }
    await app.close(); app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await open();
    await page.getByRole("button", { name: "查看分析结果", exact: true }).click();
    await expect(page.getByTestId("buckling-results")).toContainText("固定30参考10");
    await page.getByTestId("buckling-results").getByLabel("当前屈曲形态").selectOption("3");
    const reopened = decodeProject(await readFile(path, "utf8"));
    expect(reopened.latestAnalysis!.buckling).toEqual(saved.latestAnalysis!.buckling);
    await writeFile(join(evidence, "desktop.json"), JSON.stringify({ passed: true, native: reopened.latestAnalysis!.input.solver!.implementation, modes: 3, counts: reopened.latestAnalysis!.buckling!.counts, themes: ["light", "dark"], widths: [1080, 1440], reopened: true, located: "node_0002", amplitudeDoesNotChangeStoredShapes: true }, null, 2));
  } finally { await app.close(); }
});

test("T2-30 budget nonconvergence and no positive factor fail while preserving previous history", async () => {
  test.setTimeout(90000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t230-failure-")), path = join(directory, "budget.framemind");
  await writeFile(path, JSON.stringify(bucklingColumn()));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page);
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.getByTestId("buckling-results")).toContainText("满足因子精度", { timeout: 30000 });
    const saved = await save(page, path), oldId = saved.latestAnalysis!.id;
    await page.getByRole("button", { name: "管理分析工况", exact: true }).click();
    const manager = page.getByRole("dialog", { name: "分析工况管理", exact: true });
    await manager.getByLabel("屈曲每杆最大单元").selectOption("1");
    await manager.getByRole("button", { name: "保存分析工况", exact: true }).click();
    await manager.getByRole("button", { name: "计算此分析工况", exact: true }).click();
    await expect(page.getByRole("region", { name: "分析诊断", exact: true })).toContainText("did not converge", { timeout: 30000 });
    await page.getByRole("button", { name: "管理分析工况", exact: true }).click();
    await manager.getByLabel("参考荷载系数 1").fill("-1");
    await manager.getByRole("button", { name: "保存分析工况", exact: true }).click();
    await manager.getByRole("button", { name: "计算此分析工况", exact: true }).click();
    await expect(page.getByRole("region", { name: "分析诊断", exact: true })).toContainText("No finite positive buckling factor", { timeout: 30000 });
    const after = await save(page, path);
    expect(after.analysisResults).toHaveLength(1); expect(after.latestAnalysis!.id).toBe(oldId);
  } finally { await app.close(); }
});
