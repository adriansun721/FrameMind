import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import JSZip from "jszip";
import { reportFixture } from "../src/domain/engineering-report.fixture";
import { decodeProject, encodeProject } from "../src/domain/project-file";
import { enterWorkbenchWithoutRecovery } from "./electron-app";

test("T2-12 runs a real Worker, browses and persists the same service record, and exports its actual stages", async () => {
  test.setTimeout(60000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t212-"));
  const path = join(directory, "service.framemind");
  const reportPath = join(directory, "service.docx");
  await writeFile(path, encodeProject(reportFixture()));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path, FRAMEMIND_E2E_REPORT_PATH: reportPath };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await enterWorkbenchWithoutRecovery(page);
    await page.keyboard.press("Control+o");
    await expect(page.locator('footer[role="status"]')).toContainText("已打开");
    await page.getByRole("button", { name: "运行分析" }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    await expect(page.getByTestId("analysis-process")).toContainText("模型检查 → 刚度组装 → 方程求解 → 结果恢复");
    await page.keyboard.press("Control+s");
    await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    const saved = decodeProject(await readFile(path, "utf8"));
    const result = saved.latestAnalysis!;
    expect(result.service!.origin.kind).toBe("formal-model");
    expect(result.nodes[1].displacement.x).toBeCloseTo(0.00002, 12);
    expect(result.service!.stages.map((item) => item.stage)).toEqual(["model-check", "assembly", "solve", "recovery"]);
    const evidence = "docs/evidence/plan2/T2-12";
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, "static-process.png") });
    await page.getByRole("button", { name: "工程计算书", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "工程计算书" });
    await dialog.getByRole("button", { name: "导出 Word", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("已导出 Word 计算书");
    const zip = await JSZip.loadAsync(await readFile(reportPath));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain(result.service!.requestId);
    expect(xml).toContain("模型检查");
    await dialog.getByRole("button", { name: "关闭", exact: true }).last().click();
    await page.keyboard.press("Control+o");
    await expect(page.locator('footer[role="status"]')).toContainText("已打开");
    const reopened = decodeProject(await readFile(path, "utf8"));
    expect(reopened.latestAnalysis!.service).toEqual(result.service);
    await writeFile(join(evidence, "desktop-result.json"), JSON.stringify({ passed: true, result, reportRequestIdMatched: true }, null, 2) + "\n");
  } finally {
    await app.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !basename(directory).startsWith("framemind-t212-")) throw new Error("Invalid T2-12 temporary path");
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});
