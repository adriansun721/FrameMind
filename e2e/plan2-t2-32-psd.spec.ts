import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../src/domain/project";
import { canonicalPsdConvention, integratePsd, psdSpectrumInput } from "../src/domain/psd";
import { enterWorkbenchWithoutRecovery } from "./electron-app";
import { desktop, replay, save, send } from "./frame-proposal-actions";

test("T2-32 desktop table, white-noise, explicit CSV units, conversion, undo and reopening", async () => {
  test.setTimeout(120000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t232-")), path = join(directory, "psd.framemind");
  await writeFile(path, JSON.stringify(createProject("PSD inputs")));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const evidence = "docs/evidence/plan2/T2-32"; await mkdir(evidence, { recursive: true });
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page);
    const openProject = async () => { await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click(); };
    const openEditor = async () => { await page.getByRole("button", { name: "管理分析工况", exact: true }).click(); await page.getByRole("button", { name: "管理随机输入谱", exact: true }).click(); };
    await openProject(); await openEditor();
    const dialog = () => page.getByRole("dialog", { name: "随机输入谱管理" });
    await expect(dialog().getByTestId("psd-variance")).toContainText("20 kN²");
    await dialog().getByLabel("输入谱名称").fill("rectangle");
    await dialog().getByText("带限白噪声模板", { exact: true }).click();
    await dialog().getByRole("button", { name: "应用带限白噪声模板" }).click();
    await dialog().getByRole("button", { name: "保存输入谱" }).click();
    let stored = await save(page, path); expect(stored.psdSpectra).toHaveLength(1);
    expect(integratePsd(psdSpectrumInput(stored.psdSpectra[0]))).toBe(20);
    await dialog().getByLabel("点 1 密度").fill("4");
    await expect(dialog().getByTestId("psd-variance")).toContainText("30 kN²");
    await dialog().getByRole("button", { name: "保存输入谱" }).click();
    await dialog().getByRole("button", { name: "关闭随机输入谱管理" }).click();
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    stored = await save(page, path); expect(integratePsd(psdSpectrumInput(stored.psdSpectra[0]))).toBe(20);
    await page.getByRole("button", { name: "重做", exact: true }).click();
    stored = await save(page, path); expect(integratePsd(psdSpectrumInput(stored.psdSpectra[0]))).toBe(30);
    await openEditor(); await dialog().getByRole("button", { name: /PSD1 · rectangle/ }).click();
    await dialog().getByText("导入 PSD CSV", { exact: true }).click();
    await dialog().getByLabel("选择 PSD CSV 文件").setInputFiles({ name: "input.csv", mimeType: "text/csv", buffer: Buffer.from('frequency,density\r\n0,0\r\n5,4\r\n10,0\r\n') });
    await expect(dialog().getByLabel("PSD CSV 内容")).toContainText("5,4");
    await dialog().getByRole("button", { name: "验证并导入 CSV" }).click();
    await expect(dialog().getByRole("alert")).toBeVisible();
    await expect(dialog().getByLabel("点 1 密度")).toHaveValue("4");
    await dialog().getByLabel("CSV 激励量单位").selectOption("kN");
    await dialog().getByLabel("CSV 频率单位").selectOption("Hz");
    await dialog().getByLabel("CSV 谱密度单位").selectOption("kN²/Hz");
    await dialog().getByLabel("CSV 谱约定").selectOption("one-sided");
    await dialog().getByLabel("CSV 频段下限").fill("0"); await dialog().getByLabel("CSV 频段上限").fill("10");
    await dialog().getByRole("button", { name: "验证并导入 CSV" }).click();
    await expect(dialog().getByTestId("psd-variance")).toContainText("20 kN²");
    await dialog().getByLabel("PSD CSV 内容").fill("frequency,density\n0,0\n0,4\n10,0");
    await dialog().getByRole("button", { name: "验证并导入 CSV" }).click();
    await expect(dialog().getByRole("alert")).toContainText("严格递增");
    await expect(dialog().getByLabel("点 2 频率")).toHaveValue("5");
    await dialog().getByText("导入 PSD CSV", { exact: true }).click();
    await dialog().getByText("转换单位与谱约定", { exact: true }).click();
    await dialog().getByLabel("目标激励量单位").selectOption("N");
    await dialog().getByLabel("目标频率单位").selectOption("rad/s");
    await dialog().getByLabel("目标谱约定").selectOption("two-sided-even-positive");
    await dialog().getByRole("button", { name: "转换当前谱" }).click();
    await expect(dialog().getByTestId("psd-variance")).toContainText("20 kN²");
    await dialog().getByRole("button", { name: "保存输入谱" }).click();
    await expect(dialog().getByRole("status")).toContainText("单边 Hz");
    await dialog().getByText("转换单位与谱约定", { exact: true }).click();
    stored = await save(page, path); expect(stored.psdSpectra[0].points[1].density).toBeCloseTo(4, 12);
    expect(stored.psdSpectra[0].frequencyUnit).toBe("Hz"); expect(stored.analysisResults).toHaveLength(0);
    for (const theme of ["light", "dark"]) {
      await dialog().getByRole("button", { name: "关闭随机输入谱管理" }).click();
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page.getByRole("button", { name: theme === "light" ? "浅色" : "深色", exact: true }).click();
      await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: /关闭/ }).click();
      await openEditor(); await dialog().getByRole("button", { name: /PSD1 · rectangle/ }).click();
      for (const width of [1080, 1440]) { await page.setViewportSize({ width, height: 900 }); await dialog().getByTestId("psd-variance").scrollIntoViewIfNeeded(); await page.screenshot({ path: join(evidence, `psd-${theme}-${width}.png`) }); }
    }
    await dialog().getByRole("button", { name: "关闭随机输入谱管理" }).click(); await save(page, path);
    await app.close(); app = await electron.launch({ args: ["."], env }); page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page);
    await openProject(); await openEditor(); await dialog().getByRole("button", { name: /PSD1 · rectangle/ }).click();
    await expect(dialog().getByTestId("psd-variance")).toContainText("20 kN²");
    expect((await save(page, path)).psdSpectra).toEqual(stored.psdSpectra);
    await writeFile(join(evidence, "desktop.json"), JSON.stringify({ passed: true, rectangleArea: 20, manualArea: 30, triangleArea: 20, csvMissingUnitsRejected: true, duplicateCsvRejected: true, spectrumConversionPreservesArea: true, undoRedo: true, reopened: true, responseResultsCreated: false, themes: ["light", "dark"], widths: [1080, 1440] }, null, 2));
  } finally { await app.close(); }
});

test("T2-32 agent input spectrum remains unapplied until concrete confirmation", async () => {
  await desktop(async (app, page, path) => {
    const properties = { name: "agent white noise", ...canonicalPsdConvention("force"), band: [10, 20], points: [{ frequency: 10, density: 2 }, { frequency: 20, density: 2 }] };
    await replay(app, { operations: [{ type: "create_psd_spectrum", properties }] }, "propose_model_edits");
    await send(page, "准备 10 到 20 Hz、2 kN²/Hz 的单边随机力输入谱，先确认，不计算响应");
    const card = page.getByRole("region", { name: "基础编辑草案" });
    await card.getByText("查看逐项变化", { exact: true }).click(); await expect(card).toContainText("kN²/Hz"); await expect(card).toContainText("PSD1");
    expect((await save(page, path)).psdSpectra).toHaveLength(0);
    await card.getByText("查看逐项变化", { exact: true }).click();
    await card.getByRole("button", { name: "确认编辑", exact: true }).click();
    const after = await save(page, path); expect(after.psdSpectra).toHaveLength(1); expect(after.analysisResults).toHaveLength(0);
    expect(integratePsd(psdSpectrumInput(after.psdSpectra[0]))).toBe(20);
    await writeFile("docs/evidence/plan2/T2-32/agent-replay.json", JSON.stringify({ passed: true, confirmationRequired: true, variance: 20, noAnalysisRequested: true, realAi: false }, null, 2));
  });
});
