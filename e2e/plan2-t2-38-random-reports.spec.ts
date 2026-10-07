import { _electron as electron, expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import JSZip from "jszip";

test("T2-38 desktop exports frozen force, base, multi-source and full long-table random Word/PDF/ZIP", async () => {
  test.setTimeout(240000);
  const evidence = resolve("docs/evidence/plan2/T2-38");
  const env = { ...process.env, FRAMEMIND_E2E_PROJECT_PATH: resolve(evidence, "force.framemind") }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  const page = await app.firstWindow(); page.on("dialog", (d) => void d.accept());
  try {
    for (const sample of ["force", "base", "multi", "long", "missing"]) {
      const word = resolve(evidence, `${sample}.docx`), pdf = resolve(evidence, `${sample}.pdf`), data = resolve(evidence, `${sample}-desktop.zip`);
      await app.evaluate((_electron, paths) => {
        process.env.FRAMEMIND_E2E_PROJECT_PATH = paths.project; process.env.FRAMEMIND_E2E_REPORT_PATH = paths.word;
        process.env.FRAMEMIND_E2E_REPORT_PDF_PATH = paths.pdf; process.env.FRAMEMIND_E2E_REPORT_DATA_PATH = paths.data;
      }, { project: resolve(evidence, `${sample}.framemind`), word, pdf, data });
      await page.getByRole("button", { name: "文件", exact: true }).click();
      await page.getByRole("menuitem", { name: /打开项目/ }).click();
      await expect(page.locator("footer[role=status]")).toContainText(`已打开 ${sample}.framemind`);
      await page.getByRole("button", { name: "工程计算书", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "工程计算书" });
      await expect(dialog).toContainText("历史结果");
      await expect(dialog).toContainText("已保存的矩阵与计算坐标包含在随机数据 ZIP 中");
      await dialog.getByRole("checkbox", { name: sample === "long" ? "完整输入谱与响应 PSD 频点" : "实际分析设置与运行阶段", exact: true }).check();
      await expect(dialog.getByRole("button", { name: "基于冻结输入补算附录过程" })).toHaveCount(0);
      if (sample === "multi") for (const theme of ["dark", "light"]) {
        await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
        for (const [width, height] of [[1440, 900], [1080, 680]]) {
          await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
          await expect(dialog.getByRole("button", { name: "导出随机数据 ZIP", exact: true })).toBeInViewport();
          await page.screenshot({ path: resolve(evidence, `report-${theme}-${width}.png`) });
        }
      }
      await dialog.getByRole("button", { name: "导出随机数据 ZIP", exact: true }).click();
      await expect(page.locator("footer[role=status]")).toContainText("已导出随机数据", { timeout: 60000 });
      const zip = await JSZip.loadAsync(await readFile(data)), manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
      expect(manifest.current).toBe(false); expect(manifest.spectra).toHaveLength(sample === "multi" ? 2 : 1);
      expect((await zip.file("response.csv")!.async("string")).trim().split("\r\n")).toHaveLength(manifest.responsePoints + 1);
      await dialog.getByRole("button", { name: "导出 PDF", exact: true }).click();
      await expect(page.locator("footer[role=status]")).toContainText("已导出 PDF 计算书", { timeout: 60000 });
      expect((await readFile(pdf)).subarray(0, 5).toString()).toBe("%PDF-");
      await dialog.getByRole("button", { name: "导出 Word", exact: true }).click();
      await expect(page.locator("footer[role=status]")).toContainText("已导出 Word 计算书", { timeout: 60000 });
      const doc = await JSZip.loadAsync(await readFile(word)), xml = await doc.file("word/document.xml")!.async("string");
      for (const value of [manifest.analysisId, "历史结果 已过期", "mm²/Hz", "RMS 统计均方根", sample === "force" || sample === "long" ? "固定全局参考" : "相对基底"]) expect(xml).toContain(value);
      expect(xml).not.toContain("最大节点位移幅值");
      if (sample === "missing") expect(xml).toContain("缺少记录");
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
      await dialog.getByRole("button", { name: "关闭", exact: true }).last().click();
    }
  } finally { await app.close(); }
});
