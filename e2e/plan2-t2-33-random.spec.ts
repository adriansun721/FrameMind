import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterWorkbenchWithoutRecovery } from "./electron-app";
import { desktop, replay, save, send } from "./frame-proposal-actions";

const evidence = "docs/evidence/plan2/T2-33";
test("T2-33 manual binding, PSD/RMS, units, source location, budgets, stale history and reopening", async () => {
  test.setTimeout(150000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t233-")), path = join(directory, "random.framemind");
  const fixture = JSON.parse(await readFile(join(evidence, "prepared.framemind"), "utf8"));
  await writeFile(path, JSON.stringify(fixture)); await mkdir(evidence, { recursive: true });
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page);
    const open = async () => { await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click(); };
    await open(); await page.getByRole("button", { name: "管理分析工况", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "分析工况管理", exact: true });
    await dialog.getByRole("button", { name: "新建分析工况", exact: true }).click();
    await dialog.getByLabel("分析工况名称", { exact: true }).fill("单节点随机力"); await dialog.getByLabel("分析方法", { exact: true }).selectOption("random");
    await dialog.getByRole("button", { name: "创建分析工况", exact: true }).click(); await expect(dialog.getByRole("alert")).toBeVisible();
    await dialog.getByLabel("绑定模态结果", { exact: true }).selectOption(fixture.latestAnalysis.id);
    await dialog.getByLabel("随机力输入谱", { exact: true }).selectOption("PSD1");
    await dialog.getByLabel("随机力作用节点", { exact: true }).selectOption(fixture.nodes[1].id);
    await dialog.getByLabel("随机力方向 y", { exact: true }).fill("1"); await dialog.getByLabel("随机力方向 z", { exact: true }).fill("0");
    await dialog.getByLabel("随机响应节点", { exact: true }).selectOption(fixture.nodes[1].id); await dialog.getByLabel("平移响应分量", { exact: true }).selectOption("y");
    for (const invalid of ["", "1e-400"]) {
      await dialog.getByLabel("随机力空间幅值", { exact: true }).fill(invalid);
      await dialog.getByRole("button", { name: "创建分析工况", exact: true }).click(); await expect(dialog.getByRole("alert")).toBeVisible();
      await expect(dialog.getByLabel("随机力空间幅值", { exact: true })).toHaveValue(invalid);
    }
    await dialog.getByLabel("随机力空间幅值", { exact: true }).fill("1");
    await dialog.getByRole("button", { name: "创建分析工况", exact: true }).click(); await expect(dialog.getByRole("alert")).toHaveCount(0);
    await dialog.getByRole("button", { name: "计算此分析工况", exact: true }).click();
    const panel = () => page.getByTestId("random-results");
    await expect(panel()).toContainText("当前有效", { timeout: 30000 }); await expect(panel().getByTestId("random-rms")).toContainText("0.049");
    await expect(panel()).toContainText("不是瞬时峰值"); await expect(panel().getByRole("img", { name: "节点平移响应 PSD 曲线" })).toBeVisible();
    let saved = await save(page, path); const successfulId = saved.latestAnalysis.id;
    await page.getByLabel("单位预设", { exact: true }).selectOption("mm-N"); await expect(panel().getByTestId("random-rms")).toContainText("49.438");
    expect((await save(page, path)).latestAnalysis.random.rms).toBe(saved.latestAnalysis.random.rms);
    await page.getByLabel("单位预设", { exact: true }).selectOption("m-kN");
    const separator = page.getByRole("separator", { name: "调整属性面板高度" }); await separator.focus(); await separator.press("End");
    for (const theme of ["light", "dark"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click(); await page.getByRole("button", { name: theme === "light" ? "浅色" : "深色", exact: true }).click();
      await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: /关闭/ }).click();
      for (const width of [1080, 1440]) { await page.setViewportSize({ width, height: 900 }); await panel().getByRole("heading", { name: "随机响应 PSD / RMS" }).scrollIntoViewIfNeeded(); await page.screenshot({ path: join(evidence, `response-${theme}-${width}.png`) }); }
    }
    await panel().getByRole("button", { name: "定位响应节点", exact: true }).click(); await expect(page.getByText("空间节点", { exact: true })).toBeVisible(); await expect(panel()).toContainText("当前有效");
    await page.getByRole("button", { name: "管理分析工况", exact: true }).click(); dialog = page.getByRole("dialog", { name: "分析工况管理", exact: true });
    await dialog.getByRole("listitem").filter({ hasText: "单节点随机力" }).click(); await dialog.getByText("频点、积分与模态截断精度", { exact: true }).click();
    await dialog.getByLabel("最大频点数", { exact: true }).fill("100"); await dialog.getByRole("button", { name: "保存分析工况", exact: true }).click(); await dialog.getByRole("button", { name: "计算此分析工况", exact: true }).click();
    await expect(page.getByRole("region", { name: "分析诊断", exact: true })).toContainText(/Frequency point budget|频点/, { timeout: 30000 });
    saved = await save(page, path); expect(saved.latestAnalysis.id).toBe(successfulId); expect(saved.analysisResults.filter((r: { random?: unknown }) => r.random)).toHaveLength(1);
    await expect(panel()).toContainText("历史结果");
    await page.getByRole("button", { name: "撤销", exact: true }).click(); await expect(panel()).toContainText("当前有效");
    await page.getByRole("button", { name: "管理分析工况", exact: true }).click(); await page.getByRole("button", { name: "管理随机输入谱", exact: true }).click();
    const spectra = page.getByRole("dialog", { name: "随机输入谱管理", exact: true }); await spectra.getByRole("button", { name: /PSD1 · White force/ }).click();
    await spectra.getByLabel("点 1 密度", { exact: true }).fill("4"); await spectra.getByLabel("点 2 密度", { exact: true }).fill("4"); await spectra.getByRole("button", { name: "保存输入谱", exact: true }).click(); await spectra.getByRole("button", { name: "关闭随机输入谱管理", exact: true }).click();
    await expect(panel()).toContainText("历史结果"); await save(page, path);
    await app.close(); app = await electron.launch({ args: ["."], env }); page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await open();
    await page.getByRole("button", { name: "查看分析结果", exact: true }).click(); await expect(panel()).toContainText("历史结果");
    await page.getByRole("button", { name: "运行分析", exact: true }).click(); await expect(panel()).toContainText("当前有效", { timeout: 30000 });
    const recalculated = await save(page, path); expect(recalculated.latestAnalysis.random.rms / saved.latestAnalysis.random.rms).toBeCloseTo(2, 8);
    await writeFile(join(evidence, "desktop.json"), JSON.stringify({ passed: true, manualBinding: true, unitsEquivalent: true, statisticalMeaning: true, located: true, frequencyBudgetFailurePreservesHistory: true,
      undo: true, editedSpectrumStale: true, reopenedHistory: true, recalculatedRmsFactor: 2, themes: ["light", "dark"], widths: [1080, 1440] }, null, 2));
  } finally { await app.close(); }
});

test("T2-33 agent random case draft is atomic and persisted only after confirmation", async () => {
  test.setTimeout(90000);
  await desktop(async (app, page, path) => {
    const fixture = JSON.parse(await readFile(join(evidence, "prepared.framemind"), "utf8")); await writeFile(path, JSON.stringify(fixture));
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    const resultFixture = JSON.parse(await readFile(join(evidence, "random.framemind"), "utf8"));
    const properties = resultFixture.analysisCases[1]; delete properties.id;
    properties.settings.random.modalAnalysisId = fixture.latestAnalysis.id; properties.name = "工具节点随机力";
    await replay(app, { operations: [{ type: "create_analysis_case", properties }] }, "propose_model_edits"); await send(page, "准备一个节点随机力分析工况，先等我确认");
    const card = page.getByRole("region", { name: "基础编辑草案", exact: true }); await card.getByText("查看逐项变化", { exact: true }).click();
    expect((await save(page, path)).analysisCases).toHaveLength(1); await card.getByRole("button", { name: "确认编辑", exact: true }).click();
    const confirmed = await save(page, path); expect(confirmed.analysisCases).toHaveLength(2); expect(confirmed.analysisCases[1].settings.random.modalAnalysisId).toBe(fixture.latestAnalysis.id);
    await page.getByLabel("当前分析工况", { exact: true }).selectOption(confirmed.analysisCases[1].id); await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.getByTestId("random-results")).toContainText("当前有效", { timeout: 30000 }); expect((await save(page, path)).latestAnalysis.random.rms).toBeGreaterThan(.049);
    await writeFile(join(evidence, "agent-replay.json"), JSON.stringify({ passed: true, appliedBeforeConfirmation: false, currentModalBinding: true, nativeResponse: true, realAi: false }, null, 2));
  });
});
