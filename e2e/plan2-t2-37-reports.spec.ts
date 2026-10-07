import { _electron as electron, expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import JSZip from "jszip";

test("T2-37 exports historical static, second-order, buckling and modal Word/PDF with actual appendices", async () => {
  test.setTimeout(240000);
  const evidence = resolve("docs/evidence/plan2/T2-37");
  const env = { ...process.env, FRAMEMIND_E2E_PROJECT_PATH: resolve(evidence, "static.framemind") }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  const page = await app.firstWindow();
  page.on("dialog", (dialog) => void dialog.accept());
  try {
    for (const sample of ["static", "combination", "second-order", "buckling", "modal", "missing"]) {
      const wordPath = resolve(evidence, `${sample}.docx`), pdfPath = resolve(evidence, `${sample}.pdf`);
      await app.evaluate((_electron, paths) => {
        process.env.FRAMEMIND_E2E_PROJECT_PATH = paths.project;
        process.env.FRAMEMIND_E2E_REPORT_PATH = paths.word;
        process.env.FRAMEMIND_E2E_REPORT_PDF_PATH = paths.pdf;
      }, { project: resolve(evidence, `${sample}.framemind`), word: wordPath, pdf: pdfPath });
      await page.getByRole("button", { name: "文件", exact: true }).click();
      await page.getByRole("menuitem", { name: /打开项目/ }).click();
      await expect(page.locator("footer[role=status]")).toContainText(`已打开 ${sample}.framemind`);
      await page.getByRole("button", { name: "工程计算书", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "工程计算书" });
      await expect(dialog).toContainText("历史结果");
      if (sample === "static" || sample === "combination") {
        await dialog.getByRole("checkbox", { name: "整体约束处理与荷载向量", exact: true }).check();
      } else {
        for (const name of sample === "missing" ? ["实际分析设置与运行阶段"] : ["实际分析设置与运行阶段", "实际内部细分映射", "实际计算坐标与特征向量"]) await dialog.getByRole("checkbox", { name, exact: true }).check();
        if (sample === "second-order") await dialog.getByRole("checkbox", { name: "实际加载校正与收敛记录", exact: true }).check();
        else if (sample !== "missing") await dialog.getByRole("checkbox", { name: "完整节点与沿杆形态样本", exact: true }).check();
        if (sample === "buckling") await dialog.getByRole("checkbox", { name: "固定与参考轴力记录", exact: true }).check();
        if (sample === "modal" || sample === "missing") await dialog.getByRole("checkbox", { name: "实际质量矩阵", exact: true }).check();
        await expect(dialog.getByRole("button", { name: "基于冻结输入补算附录过程" })).toHaveCount(0);
      }
      if (sample === "missing") await expect(dialog.getByRole("note")).toContainText("未保存");
      if (sample === "modal") for (const theme of ["dark", "light"]) {
        await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
        for (const [width, height] of [[1440, 900], [1080, 680]]) {
          await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
          await expect(dialog.getByRole("button", { name: "导出 PDF", exact: true })).toBeInViewport();
          await page.screenshot({ path: resolve(evidence, `report-${theme}-${width}.png`) });
        }
      }
      await dialog.getByRole("button", { name: "导出 PDF", exact: true }).click();
      await expect(page.locator("footer[role=status]")).toContainText("已导出 PDF 计算书", { timeout: 60000 });
      expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe("%PDF-");
      await dialog.getByRole("button", { name: "导出 Word", exact: true }).click();
      await expect(page.locator("footer[role=status]")).toContainText("已导出 Word 计算书", { timeout: 60000 });
      const zip = await JSZip.loadAsync(await readFile(wordPath));
      const xml = await zip.file("word/document.xml")!.async("string");
      expect(xml).toContain("历史结果 已过期");
      expect(xml).toContain("附录 A");
      if (sample === "modal") for (const text of ["721", "点质量", "线质量", "单位广义质量"]) expect(xml).toContain(text);
      if (sample === "buckling") for (const text of ["固定预荷载", "参考荷载", "归一化形态"]) expect(xml).toContain(text);
      if (sample === "second-order") for (const text of ["最终加载因子 1", "校正", "初应力弹性二阶"]) expect(xml).toContain(text);
      if (sample === "missing") expect(xml).toContain("缺少记录");
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
      await dialog.getByRole("button", { name: "关闭", exact: true }).last().click();
    }
  } finally { await app.close(); }
});
