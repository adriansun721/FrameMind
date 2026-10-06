import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modalCantilever } from "../src/validation/modal-fixtures";
import { enterWorkbenchWithoutRecovery } from "./electron-app";
import { save } from "./frame-proposal-actions";
import { decodeProject } from "../src/domain/project-file";

test("T2-27 manual modal case, native shapes, amplitude, themes and saved reopening", async () => {
  test.setTimeout(150000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t227-")), path = join(directory, "modal.framemind");
  const original = modalCantilever();
  await writeFile(path, JSON.stringify({ ...original, analysisCases: [], activeAnalysisCaseId: undefined, nextAnalysisCaseNumber: 1 }));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const evidence = "docs/evidence/plan2/T2-27"; await mkdir(evidence, { recursive: true });
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page);
    const open = async () => { await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click(); };
    await open();
    await page.getByRole("button", { name: "管理分析工况", exact: true }).click();
    const manager = page.getByRole("dialog", { name: "分析工况管理", exact: true });
    await manager.getByLabel("分析工况名称", { exact: true }).fill("梁模态");
    await manager.getByLabel("分析方法", { exact: true }).selectOption("modal");
    await expect(manager).toContainText("静力荷载和自重开关不参与质量");
    await manager.getByLabel("提取模态数", { exact: true }).fill("6");
    await manager.getByRole("button", { name: "创建分析工况", exact: true }).click();
    await expect(manager.getByRole("listitem")).toContainText("模态");
    await manager.getByRole("button", { name: "计算此分析工况", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成", { timeout: 30000 });
    const panel = page.getByTestId("modal-results");
    await expect(panel).toContainText("满足频率精度"); await expect(panel).toContainText("471");
    await expect(panel.getByRole("table", { name: "模态频率表" })).toContainText("9.059");
    await expect(page.getByLabel("视图结果图例", { exact: true })).toContainText("非实际位移");
    await panel.getByLabel("当前振型", { exact: true }).selectOption("2");
    await panel.getByLabel("振型显示幅值", { exact: true }).fill("250");
    await expect(page.getByLabel("视图结果图例", { exact: true })).toContainText("0.25 m");
    const saved = await save(page, path);
    expect(saved.latestAnalysis!.modal!.modes).toHaveLength(6); expect(saved.latestAnalysis!.nodes).toEqual([]);
    expect(saved.nodes).toHaveLength(2); expect(saved.members).toHaveLength(1);
    expect(saved.latestAnalysis!.input.analysisCase!.settings.modal!.modeCount).toBe(6);
    const separator = page.getByRole("separator", { name: "调整属性面板高度" }); await separator.focus(); await separator.press("End");
    for (const theme of ["light", "dark"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page.getByRole("button", { name: theme === "light" ? "浅色" : "深色", exact: true }).click();
      await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: /关闭/ }).click();
      for (const width of [1080, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await panel.getByRole("heading", { name: "频率与振型", exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(evidence, `modal-${theme}-${width}.png`) });
      }
    }
    await app.close(); app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await open();
    await page.getByRole("button", { name: "查看分析结果", exact: true }).click();
    await expect(page.getByTestId("modal-results")).toContainText("梁模态");
    await page.getByTestId("modal-results").getByLabel("当前振型").selectOption("6");
    await page.getByTestId("modal-results").getByText("当前振型的节点分量", { exact: false }).click();
    await expect(page.getByRole("table", { name: "振型节点分量" })).toContainText("node_0002");
    const reopened = decodeProject(await readFile(path, "utf8"));
    expect(reopened.latestAnalysis!.modal).toEqual(saved.latestAnalysis!.modal);
    await writeFile(join(evidence, "desktop.json"), JSON.stringify({ passed: true, native: reopened.latestAnalysis!.input.solver!.implementation, modes: 6, counts: reopened.latestAnalysis!.modal!.counts, themes: ["light", "dark"], widths: [1080, 1440], reopened: true, amplitudeDoesNotChangeStoredShapes: true }, null, 2));
  } finally { await app.close(); }
});

test("T2-27 budget stops explicitly and a failed later run does not replace prior modal history", async () => {
  test.setTimeout(90000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t227-budget-")), path = join(directory, "budget.framemind");
  await writeFile(path, JSON.stringify(modalCantilever({ modeCount: 6, maxDivisions: 1, maxEquations: 600, frequencyTolerance: .002 })));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page);
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.getByTestId("modal-results")).toContainText("预算停止 · 未收敛", { timeout: 30000 });
    const saved = await save(page, path), oldId = saved.latestAnalysis!.id;
    await page.getByRole("button", { name: "管理分析工况", exact: true }).click();
    const manager = page.getByRole("dialog", { name: "分析工况管理", exact: true });
    await manager.getByLabel("模态最大方程数").fill("1");
    await manager.getByRole("button", { name: "保存分析工况", exact: true }).click();
    await manager.getByRole("button", { name: "计算此分析工况", exact: true }).click();
    await expect(page.getByRole("region", { name: "分析诊断", exact: true })).toContainText("Equation budget", { timeout: 30000 });
    const after = await save(page, path);
    expect(after.analysisResults).toHaveLength(1); expect(after.latestAnalysis!.id).toBe(oldId);
  } finally { await app.close(); }
});
