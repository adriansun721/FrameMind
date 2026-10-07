import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterWorkbenchWithoutRecovery } from "./electron-app";
import { desktop, replay, save, send } from "./frame-proposal-actions";

const evidence = "docs/evidence/plan2/T2-34";
test("T2-34 manual spatial sources, units, markers, staleness and reopening", async () => {
  test.setTimeout(150000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t234-")), path = join(directory, "random.framemind");
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
    await dialog.getByLabel("分析工况名称", { exact: true }).fill("空间随机力");
    await dialog.getByLabel("分析方法", { exact: true }).selectOption("random");
    await dialog.getByLabel("绑定模态结果", { exact: true }).selectOption(fixture.latestAnalysis.id);
    await dialog.getByLabel("随机力输入谱", { exact: true }).selectOption("PSD1");
    await dialog.getByLabel("随机力作用节点", { exact: true }).selectOption(fixture.nodes[1].id);
    await dialog.getByLabel("随机力方向 y", { exact: true }).fill("1"); await dialog.getByLabel("随机力方向 z", { exact: true }).fill("0");
    await dialog.getByLabel("随机响应节点", { exact: true }).selectOption(fixture.nodes[1].id);
    await dialog.getByLabel("平移响应分量", { exact: true }).selectOption("y");
    await dialog.getByRole("button", { name: "编辑空间分布与独立源", exact: true }).click();
    await dialog.getByLabel("源 1 作用 1 类型", { exact: true }).selectOption("member-uniform");
    await dialog.getByRole("button", { name: "添加同源作用 1", exact: true }).click();
    await dialog.getByLabel("源 1 作用 2 对象", { exact: true }).selectOption(fixture.nodes[1].id);
    await dialog.getByLabel("源 1 作用 2 方向 y", { exact: true }).fill("1"); await dialog.getByLabel("源 1 作用 2 方向 z", { exact: true }).fill("0");
    await dialog.getByLabel("源 1 作用 2 空间系数", { exact: true }).fill("-0.25");
    await dialog.getByRole("button", { name: "添加独立随机源", exact: true }).click();
    await dialog.getByLabel("源 2 输入谱", { exact: true }).selectOption("PSD2");
    await dialog.getByLabel("源 2 作用 1 对象", { exact: true }).selectOption(fixture.nodes[1].id);
    await dialog.getByLabel("源 2 作用 1 方向 y", { exact: true }).fill("1"); await dialog.getByLabel("源 2 作用 1 方向 z", { exact: true }).fill("0");
    await dialog.getByLabel("源 2 身份", { exact: true }).fill("RS1");
    await dialog.getByRole("button", { name: "创建分析工况", exact: true }).click(); await expect(dialog.getByRole("alert")).toContainText("唯一");
    await dialog.getByLabel("源 2 身份", { exact: true }).fill("RS2");
    await dialog.getByLabel("源 1 作用 1 空间系数", { exact: true }).fill("1e-400");
    await dialog.getByRole("button", { name: "创建分析工况", exact: true }).click(); await expect(dialog.getByRole("alert")).toBeVisible();
    await dialog.getByLabel("源 1 作用 1 空间系数", { exact: true }).fill("1");
    await dialog.getByRole("button", { name: "创建分析工况", exact: true }).click(); await expect(dialog.getByRole("alert")).toHaveCount(0);
    await dialog.getByRole("button", { name: "计算此分析工况", exact: true }).click();
    const panel = () => page.getByTestId("random-results");
    await expect(panel()).toContainText("当前有效", { timeout: 30000 });
    await expect(page.getByLabel("随机作用标记", { exact: true })).toContainText("RS1");
    const completed = await save(page, path), rms = completed.latestAnalysis.random.rms;
    expect(completed.analysisCases[1].settings.random.sources[0].actions).toHaveLength(2);
    const separator = page.getByRole("separator", { name: "调整属性面板高度" }); await separator.focus(); await separator.press("End");
    for (const theme of ["light", "dark"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click(); await page.getByRole("button", { name: theme === "light" ? "浅色" : "深色", exact: true }).click();
      await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: /关闭/ }).click();
      for (const width of [1080, 1440]) { await page.setViewportSize({ width, height: 900 }); await page.screenshot({ path: join(evidence, "sources-" + theme + "-" + width + ".png") }); }
    }
    await panel().getByRole("button", { name: "定位作用 RS1 / 1", exact: true }).click(); await expect(page.getByTestId("viewport-member-details")).toBeVisible();
    await page.getByLabel("单位预设", { exact: true }).selectOption("mm-N"); await expect(panel()).toContainText("0.001 1/mm");
    await page.getByRole("button", { name: "管理分析工况", exact: true }).click(); dialog = page.getByRole("dialog", { name: "分析工况管理", exact: true });
    await dialog.getByRole("listitem").filter({ hasText: "空间随机力" }).click();
    await expect(dialog.getByLabel("源 1 作用 1 空间系数", { exact: true })).toHaveValue("0.001");
    await dialog.getByLabel("源 1 作用 1 空间系数", { exact: true }).fill("0.002");
    await dialog.getByRole("button", { name: "保存分析工况", exact: true }).click();
    await dialog.getByRole("button", { name: "关闭分析工况管理", exact: true }).click(); await expect(panel()).toContainText("历史结果");
    const changed = await save(page, path); expect(changed.analysisCases[1].settings.random.sources[0].actions[0].scalePerM).toBe(2); expect(changed.latestAnalysis.random.rms).toBe(rms);
    await page.getByRole("button", { name: "撤销", exact: true }).click(); await expect(panel()).toContainText("当前有效");
    await save(page, path); await app.close(); app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await open();
    await page.getByRole("button", { name: "查看分析结果", exact: true }).click(); await expect(panel()).toContainText("当前有效");
    expect((await save(page, path)).latestAnalysis.random.rms).toBe(rms);
    await writeFile(join(evidence, "desktop.json"), JSON.stringify({ passed: true, manualSources: true, signedSameSource: true, duplicateRejected: true, numericUnderflowRejected: true, markers: true, memberLocated: true, inverseLengthUnits: true, actionEditStale: true, undo: true, reopenedCurrent: true, themes: ["light", "dark"], widths: [1080, 1440] }, null, 2));
  } finally { await app.close(); }
});

test("T2-34 agent distributed sources remain isolated until confirmation", async () => {
  test.setTimeout(90000);
  await desktop(async (app, page, path) => {
    const fixture = JSON.parse(await readFile(join(evidence, "prepared.framemind"), "utf8")); await writeFile(path, JSON.stringify(fixture));
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    const resultFixture = JSON.parse(await readFile(join(evidence, "random.framemind"), "utf8"));
    const properties = resultFixture.analysisCases[1]; delete properties.id; properties.settings.random.modalAnalysisId = fixture.latestAnalysis.id;
    await replay(app, { operations: [{ type: "create_analysis_case", properties }] }, "propose_model_edits");
    await send(page, "为杆件均布随机力和独立节点力准备空间随机工况，先等确认");
    const card = page.getByRole("region", { name: "基础编辑草案", exact: true });
    await card.getByText("查看逐项变化", { exact: true }).click(); expect((await save(page, path)).analysisCases).toHaveLength(1);
    await card.getByRole("button", { name: "确认编辑", exact: true }).click();
    const confirmed = await save(page, path); expect(confirmed.analysisCases[1].settings.random.sources).toHaveLength(2);
    await page.getByLabel("当前分析工况", { exact: true }).selectOption("AC2"); await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.getByTestId("random-results")).toContainText("当前有效", { timeout: 30000 });
    await writeFile(join(evidence, "agent-replay.json"), JSON.stringify({ passed: true, appliedBeforeConfirmation: false, sourcesPreserved: true, nativeResponse: true, realAi: false }, null, 2));
  });
});

