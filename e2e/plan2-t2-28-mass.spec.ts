import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modalCantilever } from "../src/validation/modal-fixtures";
import { enterWorkbenchWithoutRecovery } from "./electron-app";
import { desktop, replay, save, send } from "./frame-proposal-actions";
import { isAnalysisResultCurrent } from "../src/domain/analysis";

test("T2-28 manual mass, unit switching, native sources, stale history, undo and reopening", async () => {
  test.setTimeout(180000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t228-")), path = join(directory, "mass.framemind");
  await writeFile(path, JSON.stringify(modalCantilever()));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const evidence = "docs/evidence/plan2/T2-28"; await mkdir(evidence, { recursive: true });
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page);
    const open = async () => { await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click(); };
    await open(); await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.getByTestId("modal-results")).toContainText("471", { timeout: 30000 });
    const baseline = await save(page, path);
    await page.getByRole("region", { name: "项目树" }).getByText("N2", { exact: true }).click();
    await page.getByLabel("附加点质量", { exact: true }).fill("100");
    await page.getByRole("button", { name: "保存附加点质量", exact: true }).click();
    await page.getByRole("button", { name: /^M1 N/ }).click();
    await page.getByLabel("单位预设").selectOption("mm-N");
    await page.getByLabel("附加线质量", { exact: true }).fill("0.02");
    await page.getByRole("button", { name: "保存附加线质量", exact: true }).click();
    await expect(page.getByLabel("附加线质量", { exact: true })).toHaveValue("0.02");
    await page.setViewportSize({ width: 1080, height: 900 });
    await page.screenshot({ path: join(evidence, "line-editor-1080.png") });
    const edited = await save(page, path);
    expect(edited.nodes[1].additionalMassKg).toBe(100); expect(edited.members[0].additionalLineMassKgM).toBe(20);
    expect(edited.selfWeight).toEqual(baseline.selfWeight); expect(edited.nodalLoads).toEqual(baseline.nodalLoads);
    expect(isAnalysisResultCurrent(edited, edited.latestAnalysis!)).toBe(false);
    await page.getByLabel("单位预设").selectOption("m-kN");
    await expect(page.getByLabel("附加线质量", { exact: true })).toHaveValue("20");
    await page.getByLabel("单位预设").selectOption("mm-N");
    const switched = await save(page, path);
    expect(switched.revision).toBe(edited.revision); expect(switched.members).toEqual(edited.members);
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    const panel = page.getByTestId("modal-results");
    await expect(panel).toContainText("631", { timeout: 30000 });
    await expect(panel).toContainText("160"); await expect(panel).toContainText("满足频率精度");
    await panel.getByText("质量来源与方法", { exact: true }).click();
    await expect(panel.getByRole("table", { name: "附加质量来源", exact: true })).toContainText("0.02 kg/mm");
    await expect(panel.getByRole("table", { name: "附加质量来源", exact: true })).toContainText("node_0002");
    const calculated = await save(page, path);
    expect(calculated.analysisResults).toHaveLength(2);
    expect(calculated.latestAnalysis!.modal!.modes[0].frequencyHz).toBeLessThan(baseline.latestAnalysis!.modal!.modes[0].frequencyHz);
    const separator = page.getByRole("separator", { name: "调整属性面板高度" }); await separator.focus(); await separator.press("End");
    for (const theme of ["light", "dark"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page.getByRole("button", { name: theme === "light" ? "浅色" : "深色", exact: true }).click();
      await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: /关闭/ }).click();
      for (const width of [1080, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await panel.getByRole("table", { name: "附加质量来源", exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(evidence, `mass-sources-${theme}-${width}.png`) });
      }
    }
    await page.getByRole("region", { name: "项目树" }).getByText("N2", { exact: true }).click();
    await page.getByLabel("附加点质量", { exact: true }).fill("150");
    await page.getByRole("button", { name: "保存附加点质量", exact: true }).click();
    const stale = await save(page, path);
    expect(isAnalysisResultCurrent(stale, stale.latestAnalysis!)).toBe(false);
    expect(stale.latestAnalysis!.input.nodes[1].additionalMassKg).toBe(100);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    const undone = await save(page, path);
    expect(undone.nodes[1].additionalMassKg).toBe(100); expect(isAnalysisResultCurrent(undone, undone.latestAnalysis!)).toBe(true);
    await page.getByRole("button", { name: "重做", exact: true }).click(); await save(page, path);
    await page.getByRole("region", { name: "项目树" }).getByText("N2", { exact: true }).click();
    await page.screenshot({ path: join(evidence, "point-editor-dark-1440.png") });
    await app.close(); app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await open();
    await page.getByRole("region", { name: "项目树" }).getByText("N2", { exact: true }).click();
    await expect(page.getByLabel("附加点质量", { exact: true })).toHaveValue("150");
    await page.getByRole("button", { name: /^M1 N/ }).click();
    await expect(page.getByLabel("附加线质量", { exact: true })).toHaveValue("0.02");
    const reopened = await save(page, path);
    expect(reopened.latestAnalysis!.modal).toEqual(calculated.latestAnalysis!.modal);
    await writeFile(join(evidence, "desktop.json"), JSON.stringify({ passed: true, massKg: calculated.latestAnalysis!.modal!.totalMassKg, additionalMassKg: calculated.latestAnalysis!.modal!.additionalMassKg, structuralMassKg: calculated.latestAnalysis!.modal!.structuralMassKg, reopened: true, undoRestoresCurrent: true, redoRestoresStale: true, sources: calculated.latestAnalysis!.modal!.additionalSources, staticLoadsUnchanged: true, presets: ["m-kN", "mm-N"], themes: ["light", "dark"], widths: [1080, 1440] }, null, 2));
  } finally { await app.close(); }
});

test("T2-28 agent mass draft requires confirmation and preserves physical quantities", async () => {
  await desktop(async (app, page, path) => {
    const p = modalCantilever(); await writeFile(path, JSON.stringify(p));
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await replay(app, { inputUnits: { mass: "t", lineMass: "kg/mm" }, operations: [{ type: "set_node_mass", id: p.nodes[1].id, massKg: .1 }, { type: "update_member", id: p.members[0].id, changes: { additionalLineMassKgM: .02 } }] }, "propose_model_edits");
    await send(page, "给 N2 加 0.1 t 点质量，M1 加 0.02 kg/mm 均布线质量，先预览确认");
    const card = page.getByRole("region", { name: "基础编辑草案" });
    await expect(card).toContainText("node_0002");
    await card.getByText("查看逐项变化", { exact: true }).click();
    await expect(card).toContainText("additionalMassKg"); await expect(card).toContainText("additionalLineMassKgM");
    await card.getByText("查看逐项变化", { exact: true }).click();
    const before = await save(page, path); expect(before.nodes[1].additionalMassKg).toBeUndefined(); expect(before.members[0].additionalLineMassKgM).toBeUndefined();
    await expect(card.getByRole("button", { name: "确认编辑", exact: true })).toBeEnabled();
    await card.getByRole("button", { name: "确认编辑", exact: true }).click();
    const after = await save(page, path); expect(after.nodes[1].additionalMassKg).toBe(100); expect(after.members[0].additionalLineMassKgM).toBe(20);
    expect(after.selfWeight).toEqual(p.selfWeight); expect(after.nodalLoads).toEqual(p.nodalLoads);
  });
});
