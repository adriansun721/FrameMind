import { _electron as electron, expect, test } from "@playwright/test";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import JSZip from "jszip";
import { reportAppendixFixture, reportFixture } from "../src/domain/engineering-report.fixture";
import { encodeProject } from "../src/domain/project-file";
import { attachAnalysisResult, updateSection } from "../src/domain/project";
import { solveFrame } from "../src/domain/analysis";

test("T29 selects historical objects and steps, keeps the body and exports frozen process records", async () => {
  test.setTimeout(90000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t29-"));
  const projectPath = join(directory, "附录工程.framemind"); const reportPath = join(directory, "过程附录.docx");
  const original = reportFixture(true); const first = original.analysisResults[0];
  const changed = updateSection(original, original.sections[0].id, { ...original.sections[0], areaM2: 0.04 });
  const project = attachAnalysisResult(changed, solveFrame(changed));
  await writeFile(projectPath, encodeProject(project));
  const env = { ...process.env, FRAMEMIND_E2E_PROJECT_PATH: projectPath, FRAMEMIND_E2E_REPORT_PATH: reportPath }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env }); const page = await app.firstWindow();
  try {
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await page.getByRole("button", { name: "工程计算书", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "工程计算书" });
    await dialog.getByLabel("报告分析来源").selectOption(first.id);
    await expect(dialog).toContainText("历史结果");
    await expect(dialog.getByRole("checkbox", { name: /整体刚度矩阵 K$/, exact: false })).not.toBeChecked();
    await dialog.getByRole("checkbox", { name: /杆件过程（/ }).check();
    await dialog.getByRole("checkbox", { name: /附录杆件 M1/ }).check();
    await dialog.getByRole("checkbox", { name: "所选杆件组装贡献", exact: true }).check();
    await dialog.getByRole("checkbox", { name: "整体约束处理与荷载向量", exact: true }).check();
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      for (const [width, height] of [[1440, 900], [1080, 680]]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
        await expect(dialog.getByRole("button", { name: "导出 Word", exact: true })).toBeInViewport();
        await dialog.locator(".report-appendix").scrollIntoViewIfNeeded();
        await page.screenshot({ path: `docs/evidence/T29-${theme}-${width}.png` });
      }
    }
    // Freeze appendix selection and records before the first asynchronous rendering boundary.
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
    await page.getByLabel("面积 A").fill("0.08"); await page.getByRole("button", { name: "保存截面属性" }).click();
    await page.evaluate(() => window.dispatchEvent(new Event("release-report-render")));
    await expect(page.getByRole("status")).toContainText("已导出 Word 计算书");
    const zip = await JSZip.loadAsync(await readFile(reportPath)); const xml = await zip.file("word/document.xml")!.async("string");
    const appendix = xml.slice(xml.indexOf("附录 A 所选分析的计算过程"));
    for (const value of [first.id, "杆件过程 M1", "500000", "0.00003", "所选杆件组装贡献", "本次运行实际快照", "按冻结输入重建", "阎军、杨春秋"]) expect(appendix).toContain(value);
    expect(xml).not.toContain(project.analysisResults[1].id);
    expect(appendix).not.toContain("整体刚度矩阵 K ·");
    await copyFile(reportPath, "docs/evidence/T29-selected.docx");
    await writeFile("docs/evidence/T29-selected.framemind", encodeProject(original));
    // Clear the steps: the entire body is still present, with no appendix.
    await page.getByRole("button", { name: "工程计算书", exact: true }).click();
    await dialog.getByLabel("报告分析来源").selectOption(first.id);
    await expect(dialog.locator(".report-step-list input:checked")).toHaveCount(0);
    await dialog.getByRole("button", { name: "导出 Word", exact: true }).click();
    await expect(page.locator(".report-notice")).toContainText("已导出");
    const empty = await JSZip.loadAsync(await readFile(reportPath)); const emptyXml = await empty.file("word/document.xml")!.async("string");
    expect(emptyXml).toContain("6 关键响应与完整结果"); expect(emptyXml).not.toContain("附录 A");
    await dialog.getByRole("checkbox", { name: /杆件过程（/ }).check();
    await expect(dialog.getByRole("note")).toContainText("未选择杆件");
    await dialog.getByLabel("报告分析来源").selectOption(project.analysisResults[1].id);
    await expect(dialog.locator(".report-step-list input:checked")).toHaveCount(0);
  } finally {
    await app.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup path");
    await rm(directory, { recursive: true, force: true });
  }
});

test("T29 labels missing legacy records and exports a separate frozen-input supplemental appendix", async () => {
  test.setTimeout(90000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t29-legacy-"));
  const projectPath = join(directory, "旧过程.framemind"); const reportPath = join(directory, "补算附录.docx");
  const original = reportFixture(); const first = original.analysisResults[0];
  const legacy = { ...original, analysisResults: [{ ...first, process: undefined, input: { ...first.input, solver: undefined } }] };
  await writeFile(projectPath, encodeProject(updateSection(legacy, legacy.sections[0].id, { ...legacy.sections[0], areaM2: 0.04 })));
  const env = { ...process.env, FRAMEMIND_E2E_PROJECT_PATH: projectPath, FRAMEMIND_E2E_REPORT_PATH: reportPath }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env }); const page = await app.firstWindow();
  try {
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await page.getByRole("button", { name: "工程计算书", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "工程计算书" });
    await dialog.getByRole("checkbox", { name: /杆件过程（/ }).check();
    await dialog.getByRole("checkbox", { name: /附录杆件 M1/ }).check();
    await dialog.getByRole("checkbox", { name: "整体自由度映射", exact: true }).check();
    await expect(dialog.getByRole("note")).toContainText("未采集整体过程快照");
    await dialog.getByRole("button", { name: "导出 Word", exact: true }).click();
    await expect(page.locator(".report-notice")).toContainText("已导出");
    const missing = await JSZip.loadAsync(await readFile(reportPath)); const missingXml = await missing.file("word/document.xml")!.async("string");
    expect(missingXml).toContain("缺少记录"); expect(missingXml).not.toContain("局部单元刚度 Kl");
    // Hold the public Worker request to exercise cancellation before a fast solve completes.
    await page.evaluate(() => {
      const original = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function () { Worker.prototype.postMessage = original; };
    });
    await dialog.getByRole("button", { name: "基于冻结输入补算附录过程" }).click();
    await expect(dialog.getByRole("button", { name: "导出 Word", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "取消补算", exact: true }).click();
    await expect(dialog).toContainText("已取消附录过程补算");
    await expect(dialog.getByRole("button", { name: "导出 Word", exact: true })).toBeEnabled();
    await expect(dialog.getByRole("note")).toContainText("未采集整体过程快照");
    await dialog.getByRole("button", { name: "基于冻结输入补算附录过程" }).click();
    await expect(dialog).toContainText("附录使用补算过程");
    await dialog.getByRole("button", { name: "导出 Word", exact: true }).click();
    await expect(dialog.locator(".report-notice").last()).toContainText("已导出");
    const zip = await JSZip.loadAsync(await readFile(reportPath)); const xml = await zip.file("word/document.xml")!.async("string");
    const [body, appendix] = xml.split("附录 A 所选分析的计算过程");
    expect(body).toContain(first.id); expect(appendix).toContain(first.id);
    for (const value of ["补算过程分析", "500000", "0.00002", "整体自由度映射表"]) expect(appendix).toContain(value);
    expect(appendix).not.toContain("缺少记录");
    expect(await dialog.getByLabel("报告分析来源").locator("option").count()).toBe(1);
    await copyFile(reportPath, "docs/evidence/T29-supplemental.docx");
    await writeFile("docs/evidence/T29-supplemental.framemind", encodeProject(legacy));
  } finally {
    await app.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup path");
    await rm(directory, { recursive: true, force: true });
  }
});

test("T29 filters multiple members and exports all explicitly selected process steps", async () => {
  test.setTimeout(90000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t29-many-"));
  const projectPath = join(directory, "多对象.framemind"); const reportPath = join(directory, "完整过程附录.docx");
  const project = reportAppendixFixture(); await writeFile(projectPath, encodeProject(project));
  const env = { ...process.env, FRAMEMIND_E2E_PROJECT_PATH: projectPath, FRAMEMIND_E2E_REPORT_PATH: reportPath }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env }); const page = await app.firstWindow();
  try {
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await page.getByRole("button", { name: "工程计算书", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "工程计算书" });
    await dialog.getByRole("checkbox", { name: /杆件过程（/ }).check();
    await dialog.getByRole("checkbox", { name: /附录杆件 M2/ }).check();
    await dialog.getByRole("button", { name: "导出 Word", exact: true }).click();
    await expect(dialog.locator(".report-notice")).toContainText("已导出");
    const filtered = await JSZip.loadAsync(await readFile(reportPath)); const filteredXml = await filtered.file("word/document.xml")!.async("string");
    const filteredAppendix = filteredXml.split("附录 A 所选分析的计算过程")[1];
    expect(filteredAppendix).toContain("杆件过程 M2"); expect(filteredAppendix).not.toContain("杆件过程 M1"); expect(filteredAppendix).not.toContain("杆件过程 M3");
    for (const checkbox of await dialog.locator(".report-step-list").getByRole("checkbox").all()) await checkbox.check();
    await dialog.getByRole("button", { name: "选择全部杆件" }).click();
    await dialog.getByRole("button", { name: "导出 Word", exact: true }).click();
    await expect(dialog.locator(".report-notice")).toContainText("已导出");
    const zip = await JSZip.loadAsync(await readFile(reportPath)); const xml = await zip.file("word/document.xml")!.async("string");
    for (const value of ["杆件过程 M1", "杆件过程 M2", "杆件过程 M3", "整体刚度矩阵 K · 24 × 24", "约束后刚度矩阵 Kff · 18 × 18", "列 18—23", "列 18—23", project.analysisResults.at(-1)!.id]) expect(xml).toContain(value);
    await copyFile(reportPath, "docs/evidence/T29-all.docx");
    await writeFile("docs/evidence/T29-all.framemind", encodeProject(project));
  } finally {
    await app.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup path");
    await rm(directory, { recursive: true, force: true });
  }
});
