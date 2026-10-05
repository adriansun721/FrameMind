import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { decodeProject } from "../src/domain/project-file";
import { isAnalysisResultCurrent } from "../src/domain/analysis";
import { enterWorkbenchWithoutRecovery } from "./electron-app";

async function fileAction(page: Page, action: string) {
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(action) }).click();
}

test("T2-17 manual units preserve native physics, history, project precision and Word/PDF exports", async () => {
  test.setTimeout(150000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t217-"));
  const path = join(directory, "units.framemind");
  const wordPath = join(directory, "units.docx"); const pdfPath = join(directory, "units.pdf");
  const evidence = "docs/evidence/plan2/T2-17"; await mkdir(evidence, { recursive: true });
  const samples = JSON.parse(await readFile("docs/evidence/plan2/T2-14/wire-samples.json", "utf8"));
  await writeFile(path, JSON.stringify(samples.find((s: { id: string }) => s.id === "axial").project));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path, FRAMEMIND_E2E_REPORT_PATH: wordPath, FRAMEMIND_E2E_REPORT_PDF_PATH: pdfPath };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await fileAction(page, "打开项目");
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    await fileAction(page, "保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    const before = decodeProject(await readFile(path, "utf8"));
    for (let i = 0; i < 3; i++) for (const preset of ["mm-N", "mm-kN", "m-kN"]) await page.getByLabel("单位预设").selectOption(preset);
    await page.getByLabel("单位预设").selectOption("mm-N");
    await expect(page.locator(".analysis-result-panel")).toContainText("当前");
    await expect(page.locator(".analysis-result-panel")).toContainText("位移 (0.016, 0, 0) mm");
    await expect(page.locator(".analysis-result-panel")).toContainText("-8000 N");
    await page.getByRole("tab", { name: "内力图", exact: true }).click();
    await expect(page.locator(".result-legend")).toContainText("8000 N");
    await expect(page.getByLabel("视图结果图例")).toContainText("N · N");
    await page.getByRole("tab", { name: "结果表", exact: true }).click();
    for (const theme of ["dark", "light"]) {
      if (theme === "light") { await page.getByRole("button", { name: "设置", exact: true }).click(); await page.getByRole("button", { name: "浅色", exact: true }).click(); await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: "关闭", exact: true }).click(); }
      for (const width of [1440, 1080]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.getByLabel("单位预设")).toBeInViewport();
        await page.screenshot({ path: join(evidence, `units-${theme}-${width}.png`) });
      }
    }
    await fileAction(page, "保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    const switched = decodeProject(await readFile(path, "utf8"));
    expect(switched.revision).toBe(before.revision);
    expect(switched.nodes).toEqual(before.nodes); expect(switched.materials).toEqual(before.materials);
    expect(switched.sections).toEqual(before.sections); expect(switched.analysisResults).toEqual(before.analysisResults);
    expect(isAnalysisResultCurrent(switched, switched.latestAnalysis!)).toBe(true);
    await page.getByRole("region", { name: "项目树" }).getByText("L1 · N2", { exact: true }).click();
    await expect(page.getByLabel("FX", { exact: true })).toHaveValue("8000");
    await page.getByLabel("FX", { exact: true }).fill("16000");
    await page.getByRole("button", { name: "保存荷载属性", exact: true }).click();
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    await expect(page.locator(".analysis-result-panel")).toContainText("位移 (0.032, 0, 0) mm");
    await page.getByRole("button", { name: "工程计算书", exact: true }).click();
    const report = page.getByRole("dialog", { name: "工程计算书" });
    await report.getByRole("button", { name: "导出 Word", exact: true }).click();
    await expect(report.locator(".report-notice")).toContainText("已导出");
    const zip = await JSZip.loadAsync(await readFile(wordPath)); const xml = await zip.file("word/document.xml")!.async("string");
    for (const text of ["E (MPa)", "A (mm²)", "FX (N)", "MX (N·mm)", "0.032", "16000"]) expect(xml).toContain(text);
    await report.getByRole("button", { name: "导出 PDF", exact: true }).click();
    await expect(report.locator(".report-notice")).toContainText("units.pdf");
    const pdf = await PDFDocument.load(await readFile(pdfPath)); expect(pdf.getPageCount()).toBeGreaterThan(1);
    await copyFile(wordPath, join(evidence, "units.docx")); await copyFile(pdfPath, join(evidence, "units.pdf"));
    await report.getByRole("button", { name: "关闭", exact: true }).last().click();
    await page.getByRole("button", { name: "创建节点", exact: true }).click();
    const node = page.getByRole("dialog", { name: "创建空间节点" });
    await node.getByLabel("X 坐标").fill("1000000000125"); await node.getByLabel("Y 坐标").fill("0.001"); await node.getByLabel("Z 坐标").fill("-12.5");
    await node.getByRole("button", { name: "添加到模型" }).click();
    await fileAction(page, "保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    const saved = decodeProject(await readFile(path, "utf8"));
    expect(saved.nodalLoads[0].force.x).toBe(16);
    expect(saved.nodes.at(-1)?.position).toEqual({ x: 1000000000.125, y: .000001, z: -.0125 });
    expect(saved.analysisResults).toHaveLength(2);
    expect(saved.analysisResults[0].input.nodalLoads[0].force.x).toBe(8);
    await app.close(); app = await electron.launch({ args: ["."], env }); page = await app.firstWindow();
    await enterWorkbenchWithoutRecovery(page); await fileAction(page, "打开项目");
    await expect(page.getByLabel("单位预设")).toHaveValue("mm-N");
    await copyFile(path, join(evidence, "units.framemind"));
    await writeFile(join(evidence, "desktop-verification.json"), JSON.stringify({ passed: true, solver: saved.latestAnalysis!.input.solver?.implementation, switchPreservesRevision: switched.revision === before.revision, switchPreservesFrozenResults: true, manualForceKN: 16, originalForceKN: 8, coordinate: saved.nodes.at(-1)?.position, pdfPages: pdf.getPageCount(), wordUnitLabels: ["MPa", "mm²", "N", "N·mm"], reopenedPreset: "mm-N" }, null, 2));
  } finally {
    await app.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup path");
    await rm(directory, { recursive: true, force: true });
  }
});
