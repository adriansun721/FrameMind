import { _electron as electron, expect, test } from "@playwright/test";
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { reportAppendixFixture, reportFixture } from "../src/domain/engineering-report.fixture";
import { encodeProject } from "../src/domain/project-file";
import { addMember, addNodalLoad, addNode, attachAnalysisResult, updateMaterial, updateSection } from "../src/domain/project";
import { solveFrame } from "../src/domain/analysis";
import JSZip from "jszip";

test("T30 exports PDF and Word with the same selected source, repeats export and preserves a file after failure", async () => {
  test.setTimeout(90000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t30-"));
  const original = reportFixture(true);
  const first = original.analysisResults[0];
  const changed = updateSection(original, original.sections[0].id, { ...original.sections[0], areaM2: 0.04 });
  const project = attachAnalysisResult(changed, solveFrame(changed));
  const projectPath = join(directory, "中文工程.framemind");
  const pdfPath = join(directory, "中文计算书.pdf"); const wordPath = join(directory, "中文计算书.docx");
  await writeFile(projectPath, encodeProject(project));
  const env = { ...process.env, FRAMEMIND_E2E_PROJECT_PATH: projectPath, FRAMEMIND_E2E_REPORT_PDF_PATH: pdfPath, FRAMEMIND_E2E_REPORT_PATH: wordPath }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env }); const page = await app.firstWindow();
  try {
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await page.getByRole("button", { name: "工程计算书", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "工程计算书" });
    await dialog.getByLabel("报告分析来源").selectOption(first.id);
    await expect(dialog).toContainText("历史结果");
    await dialog.getByRole("checkbox", { name: /杆件过程（/ }).check();
    await dialog.getByRole("checkbox", { name: /附录杆件 M1/ }).check();
    await dialog.getByRole("checkbox", { name: "整体约束处理与荷载向量", exact: true }).check();
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      for (const [width, height] of [[1440, 900], [1080, 680]]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
        await expect(dialog.getByRole("button", { name: "导出 PDF", exact: true })).toBeInViewport();
        await expect(dialog.getByRole("button", { name: "导出 Word", exact: true })).toBeInViewport();
        await page.screenshot({ path: `docs/evidence/T30-${theme}-${width}.png` });
      }
    }
    await dialog.getByRole("button", { name: "导出 PDF", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("已导出 PDF 计算书");
    expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe("%PDF-");
    await copyFile(pdfPath, "docs/evidence/T30-selected.pdf");
    await dialog.getByRole("button", { name: "导出 Word", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("已导出 Word 计算书");
    const zip = await JSZip.loadAsync(await readFile(wordPath));
    const xml = await zip.file("word/document.xml")!.async("string");
    for (const value of [first.id, "0.01", "500000", "0.00003", "CB1", "-0.5"]) expect(xml).toContain(value);
    expect(xml).not.toContain(project.analysisResults[1].id);
    await copyFile(wordPath, "docs/evidence/T30-selected.docx");
    await writeFile("docs/evidence/T30-selected.framemind", encodeProject(original));
    await dialog.getByRole("button", { name: "导出 PDF", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("已导出 PDF 计算书");
    const before = await readFile(pdfPath);
    // Fail the public filesystem boundary only after real PDF rendering.
    await app.evaluate(() => { process.env.FRAMEMIND_E2E_REPORT_PDF_PATH = process.env.FRAMEMIND_E2E_PROJECT_PATH + "/不存在/计算书.pdf"; });
    await dialog.getByRole("button", { name: "导出 PDF", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("status")).toContainText("PDF 计算书导出失败");
    expect(await readFile(pdfPath)).toEqual(before);
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp") || name.endsWith(".bak"))).toEqual([]);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await app.evaluate((_electron, path) => { process.env.FRAMEMIND_E2E_REPORT_PDF_PATH = path; }, pdfPath);
    const renderingFailure = await page.evaluate(async () => {
      try {
        await window.frameMind.exportReportPdf({ suggestedName: "失败图表", html: '<!doctype html><html lang="zh-CN"><head></head><body><img src="data:image/png,broken" /></body></html>' });
        return "unexpected success";
      } catch (error) { return String(error); }
    });
    expect(renderingFailure).not.toBe("unexpected success");
    expect(await readFile(pdfPath)).toEqual(before);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await app.evaluate(({ dialog }) => {
      delete process.env.FRAMEMIND_E2E_REPORT_PDF_PATH;
      dialog.showSaveDialog = async () => ({ canceled: true, filePath: "" });
    });
    await dialog.getByRole("button", { name: "导出 PDF", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("已取消 PDF 计算书导出");
    expect(await readFile(pdfPath)).toEqual(before);
  } finally {
    await app.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup path");
    await rm(directory, { recursive: true, force: true });
  }
});

test("T30 exports all matrices and long names with multipage body and appendix tables", async () => {
  test.setTimeout(120000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t30-layout-"));
  const projectPath = join(directory, "分页工程.framemind");
  const pdfPath = join(directory, "分页计算书.pdf"); const wordPath = join(directory, "分页计算书.docx");
  const env = { ...process.env, FRAMEMIND_E2E_PROJECT_PATH: projectPath, FRAMEMIND_E2E_REPORT_PDF_PATH: pdfPath, FRAMEMIND_E2E_REPORT_PATH: wordPath }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env }); const page = await app.firstWindow();
  try {
    for (const sample of ["all", "long"] as const) {
      let project = reportAppendixFixture();
      if (sample === "long") {
        project = updateMaterial(project, project.materials[0].id, { ...project.materials[0], name: "长名称材料中文与连续英文参数名称".repeat(4) + "ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(3) });
        project = updateSection(project, project.sections[0].id, { ...project.sections[0], name: "长名称截面用于验证跨页表格不能截断名称".repeat(4) });
        for (let i = 0; i < 18; i++) {
          project = addNode(project, { x: 4 + i, y: 1, z: 1 });
          const end = project.nodes.at(-1)!;
          project = addMember(project, { startNodeId: project.nodes[0].id, endNodeId: end.id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
          project = addNodalLoad(project, end.id, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
        }
        project = attachAnalysisResult(project, solveFrame(project));
      }
      await writeFile(projectPath, encodeProject(project));
      await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
      await page.getByRole("button", { name: "工程计算书", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "工程计算书" });
      for (const checkbox of await dialog.locator(".report-step-list input").all()) await checkbox.check();
      if (sample === "all") await dialog.getByRole("button", { name: "选择全部杆件" }).click();
      else await dialog.getByRole("checkbox", { name: /附录杆件 M1 ·/ }).check();
      await dialog.getByRole("button", { name: "导出 PDF", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("已导出 PDF 计算书", { timeout: 30000 });
      await copyFile(pdfPath, `docs/evidence/T30-${sample}.pdf`);
      await dialog.getByRole("button", { name: "导出 Word", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("已导出 Word 计算书", { timeout: 30000 });
      await copyFile(wordPath, `docs/evidence/T30-${sample}.docx`);
      await writeFile(`docs/evidence/T30-${sample}.framemind`, encodeProject(project));
      await dialog.getByRole("button", { name: "关闭", exact: true }).last().click();
    }
  } finally {
    await app.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup path");
    await rm(directory, { recursive: true, force: true });
  }
});
