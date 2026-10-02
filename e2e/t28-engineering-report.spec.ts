import { _electron as electron, expect, test } from "@playwright/test";
import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import JSZip from "jszip";
import { reportFixture } from "../src/domain/engineering-report.fixture";
import { encodeProject } from "../src/domain/project-file";
import { attachAnalysisResult, updateSection } from "../src/domain/project";
import { solveFrame } from "../src/domain/analysis";

test("T28 exports selected frozen inputs and results offline while edits continue", async () => {
  test.setTimeout(90000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t28-"));
  const projectPath = join(directory, "中文工程.framemind"); const reportPath = join(directory, "中文计算书.docx");
  const original = reportFixture(); const first = original.analysisResults[0];
  const modified = updateSection(original, original.sections[0].id, { ...original.sections[0], areaM2: 0.02 });
  const project = attachAnalysisResult(modified, solveFrame(modified));
  await writeFile(projectPath, encodeProject(project));
  const env = { ...process.env, FRAMEMIND_E2E_PROJECT_PATH: projectPath, FRAMEMIND_E2E_REPORT_PATH: reportPath }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env }); const page = await app.firstWindow();
  try {
    await app.evaluate(() => { globalThis.fetch = async () => { throw new Error("offline"); }; });
    await page.getByRole("button", { name: "工程计算书", exact: true }).click();
    await expect(page.getByRole("button", { name: "导出 Word", exact: true })).toBeDisabled();
    await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).last().click();
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await page.getByRole("button", { name: "工程计算书", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "工程计算书" });
    await dialog.getByLabel("报告分析来源").selectOption(first.id);
    await expect(dialog).toContainText("历史结果");
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      for (const [width, height] of [[1440, 900], [1080, 680]]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
        await expect(dialog.getByRole("button", { name: "导出 Word", exact: true })).toBeInViewport();
        await page.screenshot({ path: `docs/evidence/T28-${theme}-${width}.png` });
      }
    }
    // Hold figure rasterization at its public browser boundary, then edit the model.
    await page.evaluate(() => {
      const originalToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        HTMLCanvasElement.prototype.toBlob = originalToBlob;
        document.documentElement.dataset.reportRendering = "held";
        const canvas = this;
        window.addEventListener("release-report-render", () => originalToBlob.call(canvas, callback, type, quality), { once: true });
      };
    });
    await dialog.getByRole("button", { name: "导出 Word", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-report-rendering", "held");
    await dialog.getByRole("button", { name: "关闭", exact: true }).last().click();
    await page.getByRole("button", { name: /截面 S1/ }).click();
    await page.getByLabel("面积 A").fill("0.04"); await page.getByRole("button", { name: "保存截面属性" }).click();
    await page.evaluate(() => window.dispatchEvent(new Event("release-report-render")));
    await expect(page.getByRole("status")).toContainText("已导出 Word 计算书");
    const zip = await JSZip.loadAsync(await readFile(reportPath)); const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain(first.id); expect(xml).not.toContain(project.analysisResults[1].id);
    expect(xml).toContain("0.00002"); expect(xml).toContain("0.01"); expect(xml).not.toContain(">0.04<");
    const media = Object.keys(zip.files).filter((name) => name.startsWith("word/media/") && name.endsWith(".png"));
    expect(media).toHaveLength(2);
    for (const name of media) expect((await zip.file(name)!.async("nodebuffer")).length).toBeGreaterThan(1000);
    await copyFile(reportPath, "docs/evidence/T28-baseline.docx");
    await writeFile("docs/evidence/T28-baseline.framemind", encodeProject(original));

    // The newer run remains available and repeated export replaces the file cleanly.
    await page.getByRole("button", { name: "工程计算书", exact: true }).click();
    await page.getByLabel("报告分析来源").selectOption(project.analysisResults[1].id);
    await page.getByRole("button", { name: "导出 Word", exact: true }).click();
    await expect(page.locator(".report-notice")).toContainText("已导出");
    const newer = await JSZip.loadAsync(await readFile(reportPath));
    expect(await newer.file("word/document.xml")!.async("string")).toContain("0.00001");
    expect((await readdir(directory)).filter((name) => /\.(tmp|bak)$/.test(name))).toHaveLength(0);
    await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).last().click();

    // A missing destination directory must surface a failure, never a saved notice.
    await app.evaluate((_electron, path) => { process.env.FRAMEMIND_E2E_REPORT_PATH = path; }, join(directory, "不存在目录", "错误.docx"));
    await page.getByRole("button", { name: "工程计算书", exact: true }).click();
    await page.getByRole("button", { name: "导出 Word", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("ENOENT");
    await expect(page.getByRole("status")).toContainText("导出失败");
  } finally {
    await app.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup path");
    await rm(directory, { recursive: true, force: true });
  }
});

test("T28 exports raw combination cases, factors and weighted responses", async () => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t28-combination-"));
  const projectPath = join(directory, "组合.framemind"); const reportPath = join(directory, "组合计算书.docx");
  const project = reportFixture(true); await writeFile(projectPath, encodeProject(project));
  const env = { ...process.env, FRAMEMIND_E2E_PROJECT_PATH: projectPath, FRAMEMIND_E2E_REPORT_PATH: reportPath }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env }); const page = await app.firstWindow();
  try {
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await page.getByRole("button", { name: "工程计算书", exact: true }).click(); await page.getByRole("button", { name: "导出 Word", exact: true }).click();
    await expect(page.locator(".report-notice")).toContainText("已导出");
    const zip = await JSZip.loadAsync(await readFile(reportPath)); const xml = await zip.file("word/document.xml")!.async("string");
    for (const value of ["CB1", "LC2", "-0.5", "-3", "1.5", "4.62051", "314", "启用", "原始自重", project.analysisResults[0].id]) expect(xml).toContain(value);
    await copyFile(reportPath, "docs/evidence/T28-combination.docx"); await writeFile("docs/evidence/T28-combination.framemind", encodeProject(project));
  } finally {
    await app.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup path");
    await rm(directory, { recursive: true, force: true });
  }
});
