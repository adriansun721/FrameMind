import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createPerformanceModel, PERFORMANCE_MODELS } from "../src/validation/performance-models";
import { solveFrame } from "../src/domain/analysis";
import { attachAnalysisResult } from "../src/domain/project";
import { encodeProject } from "../src/domain/project-file";

test("T32 pages every result and process entry while building matrices only on request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t32-navigation-"));
  const model = createPerformanceModel(PERFORMANCE_MODELS[0]);
  const project = attachAnalysisResult(model, solveFrame(model));
  const path = join(directory, "分页.framemind");
  await writeFile(path, encodeProject(project));
  const env = { ...process.env, FRAMEMIND_E2E_PROJECT_PATH: path }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env }); const page = await app.firstWindow();
  try {
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    const process = page.getByTestId("analysis-process");
    await expect(process.getByRole("table", { name: "整体自由度编号" })).toHaveCount(0);
    await expect(process.getByRole("table", { name: "M1整体自由度映射" })).toHaveCount(0);
    await process.locator("summary").filter({ hasText: "节点自由度与约束状态" }).click();
    const numbering = process.getByRole("table", { name: "整体自由度编号" });
    await expect(numbering.locator("tbody tr")).toHaveCount(100);
    const pages = process.getByRole("navigation", { name: "整体自由度编号分页" });
    await pages.getByRole("button", { name: "下一页" }).click(); await pages.getByRole("button", { name: "下一页" }).click();
    await expect(numbering).toContainText("node_0036"); await expect(numbering.locator("tbody tr")).toHaveCount(16);
    await process.locator("summary").filter({ hasText: "单元组装条目" }).click();
    const assembly = process.getByRole("navigation", { name: "单元组装条目分页" });
    await assembly.getByRole("button", { name: "下一页" }).click(); await assembly.getByRole("button", { name: "下一页" }).click();
    await process.locator("summary").filter({ hasText: /^M58 ·/ }).click();
    await expect(process.getByRole("table", { name: "M58整体自由度映射", exact: true })).toBeVisible();
    await expect(process.getByRole("table", { name: /M58 · 单元整体刚度贡献/ })).toHaveCount(0);
    await process.locator("summary").filter({ hasText: /M58 · 单元整体刚度贡献/ }).click();
    await expect(process.getByRole("table", { name: /M58 · 单元整体刚度贡献/ })).toBeVisible();
    await page.getByRole("navigation", { name: "杆端内力分页" }).getByRole("button", { name: "下一页" }).click();
    await expect(page.getByRole("region", { name: "对象属性" })).toContainText("M58 · L");
    await page.getByRole("tab", { name: "变形图", exact: true }).click();
    await page.getByRole("tab", { name: "结果表", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "杆端内力分页" })).toContainText("1 / 2");
  } finally {
    await app.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup path");
    await rm(directory, { recursive: true, force: true });
  }
});
