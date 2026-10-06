import { _electron as electron, expect, test } from "@playwright/test";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releasedBeam } from "../src/validation/member-release-fixtures";
import { addAnalysisCase, selectAnalysisCase } from "../src/domain/project";
import { DEFAULT_MESH_POLICY } from "../src/domain/analysis-mesh";
import { decodeProject } from "../src/domain/project-file";
import { enterWorkbenchWithoutRecovery } from "./electron-app";
import { save } from "./frame-proposal-actions";

test("T2-26 internal mesh stays hidden, actual scale is visible and saved result survives reopening", async () => {
  test.setTimeout(150000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t226-")), path = join(directory, "mesh.framemind");
  await writeFile(path, JSON.stringify(releasedBeam()));
  const wordPath = join(directory, "mesh.docx"), pdfPath = join(directory, "mesh.pdf");
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path, FRAMEMIND_E2E_REPORT_PATH: wordPath, FRAMEMIND_E2E_REPORT_PDF_PATH: pdfPath };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  let app = await electron.launch({ args: ["."], env });
  const evidence = "docs/evidence/plan2/T2-26"; await mkdir(evidence, { recursive: true });
  try {
    let page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page);
    const open = async () => { await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click(); };
    await open(); await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成", { timeout: 30000 });
    const summary = page.getByTestId("analysis-process").getByTestId("discretization-summary");
    await expect(summary).toContainText("加密检查满足精度");
    await expect(summary).toContainText("2 / 1"); await expect(summary).toContainText("3 / 2");
    const saved = await save(page, path);
    expect(saved.nodes).toHaveLength(2); expect(saved.members).toHaveLength(1);
    expect(saved.latestAnalysis!.discretization!.counts.equations).toBe(6);
    await page.getByRole("button", { name: "工程计算书", exact: true }).click();
    const report = page.getByRole("dialog", { name: "工程计算书" });
    await report.getByRole("checkbox", { name: /杆件过程（/ }).check();
    await report.getByRole("checkbox", { name: /附录杆件 M1/ }).check();
    await report.getByRole("checkbox", { name: "所选杆件组装贡献", exact: true }).check();
    await report.getByRole("checkbox", { name: "整体约束处理与荷载向量", exact: true }).check();
    await report.getByRole("button", { name: "导出 Word", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("已导出 Word 计算书", { timeout: 30000 });
    const zip = await JSZip.loadAsync(await readFile(wordPath)), xml = await zip.file("word/document.xml")!.async("string");
    for (const text of [saved.latestAnalysis!.id, "内部细分", "__mesh_2_e_0_0", "约束后方程 6"]) expect(xml).toContain(text);
    expect(xml).not.toContain("整体过程缺少记录");
    await report.getByRole("button", { name: "导出 PDF", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("已导出 PDF 计算书", { timeout: 30000 });
    expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe("%PDF-");
    await copyFile(wordPath, join(evidence, "mesh.docx")); await copyFile(pdfPath, join(evidence, "mesh.pdf"));
    await report.getByLabel("关闭", { exact: true }).click();
    const separator = page.getByRole("separator", { name: "调整属性面板高度" });
    await separator.focus(); await separator.press("End");
    for (const theme of ["light", "dark"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page.getByRole("button", { name: theme === "light" ? "浅色" : "深色", exact: true }).click();
      await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: /关闭/ }).click();
      for (const width of [1080, 1440]) {
        await page.setViewportSize({ width, height: 900 }); await summary.evaluate((element) => element.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: join(evidence, `mesh-${theme}-${width}.png`) });
      }
    }
    await app.close(); app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await open();
    const reopened = decodeProject(await readFile(path, "utf8"));
    expect(reopened.latestAnalysis!.discretization!.status).toBe("converged");
    expect(reopened.nodes.map((n) => n.id)).toEqual(saved.nodes.map((n) => n.id));
    await page.getByRole("button", { name: /^M1 N/ }).click();
    await expect(page.getByTestId("member-analysis-process")).toContainText("结果来自内部单元映射");
    await writeFile(join(evidence, "desktop.json"), JSON.stringify({ passed: true, counts: reopened.latestAnalysis!.discretization!.counts, themes: ["light", "dark"], widths: [1080, 1440], reopened: true }, null, 2));
  } finally { await app.close(); }
});

test("T2-26 single-grid budget exposes an explicit unchecked state in the desktop result", async () => {
  test.setTimeout(90000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t226-budget-")), path = join(directory, "budget.framemind");
  let seed = addAnalysisCase(releasedBeam(), { name: "单网格预算", method: "static", loadSourceId: "LC1", settings: { solver: "native-static", mesh: { ...DEFAULT_MESH_POLICY, maxDivisions: 1 } } });
  seed = selectAnalysisCase(seed, seed.analysisCases.at(-1)!.id);
  await writeFile(path, JSON.stringify(seed));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page);
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("结果未收敛", { timeout: 30000 });
    await expect(page.getByTestId("discretization-summary")).toContainText("预算内未满足精度");
    const saved = await save(page, path); expect(saved.latestAnalysis!.discretization!.runs).toHaveLength(1);
    await page.getByRole("separator", { name: "调整属性面板高度" }).focus(); await page.getByRole("separator", { name: "调整属性面板高度" }).press("End");
    await page.getByTestId("discretization-summary").evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: "docs/evidence/plan2/T2-26/budget-exhausted.png" });
  } finally { await app.close(); }
});
