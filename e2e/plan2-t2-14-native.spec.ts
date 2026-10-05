import { _electron as electron, expect, test } from "@playwright/test";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeProject, encodeProject } from "../src/domain/project-file";
import { isAnalysisResultCurrent, type AnalysisResult } from "../src/domain/analysis";
import type { FrameProject } from "../src/domain/project";
import { enterWorkbenchWithoutRecovery } from "./electron-app";

test("T2-14 desktop calls C++, browses and saves all independent spatial static loads with compiler-free PATH", async () => {
  test.setTimeout(180000);
  const evidence = process.env.FRAMEMIND_T214_EVIDENCE ?? "docs/evidence/plan2/T2-14";
  const samples: Array<{ id: string; project: FrameProject; result: AnalysisResult }> = JSON.parse(await readFile(join("docs/evidence/plan2/T2-14", "wire-samples.json"), "utf8"));
  expect(samples).toHaveLength(22);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t214-"));
  const projectPath = join(directory, "原生完整静力.framemind");
  const wordPath = join(directory, "原生计算书.docx"), pdfPath = join(directory, "原生计算书.pdf");
  await mkdir(evidence, { recursive: true });
  const env = { ...process.env, PATH: `${process.env.SystemRoot}\\System32`, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: projectPath,
    FRAMEMIND_E2E_REPORT_PATH: wordPath, FRAMEMIND_E2E_REPORT_PDF_PATH: pdfPath };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const installed = process.env.FRAMEMIND_INSTALLED_EXE;
  const app = await electron.launch(installed ? { executablePath: installed, env } : { args: ["."], env });
  const records = [];
  try {
    const page = await app.firstWindow();
    await enterWorkbenchWithoutRecovery(page);
    const fileAction = async (name: "打开项目" | "保存项目") => {
      await page.getByRole("button", { name: "文件", exact: true }).click();
      await page.getByRole("menuitem", { name: new RegExp(name) }).click();
    };
    for (const sample of samples) {
      await writeFile(projectPath, encodeProject(sample.project));
      await fileAction("打开项目");
      await expect(page.locator('footer[role="status"]')).toContainText("已打开");
      await page.getByRole("button", { name: "运行分析", exact: true }).click();
      await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
      await fileAction("保存项目");
      await expect(page.locator('footer[role="status"]')).toContainText("已保存");
      const saved = decodeProject(await readFile(projectPath, "utf8"));
      const result = saved.latestAnalysis!;
      expect(result.input.solver!.implementation).toBe("framemind-native/2");
      expect(result.service!.stages.map((record) => record.stage)).toEqual(["model-check", "assembly", "solve", "recovery"]);
      expect(result.process!.assembledStiffness).toHaveLength(sample.project.nodes.length * 6);
      expect(result.members[0].nativeResponses).toHaveLength(17);
      expect(isAnalysisResultCurrent(saved, result)).toBe(true);
      expect(result.nodes).toEqual(sample.result.nodes);
      expect(result.members).toEqual(sample.result.members);
      await fileAction("打开项目");
      await expect(page.locator('footer[role="status"]')).toContainText("已打开");
      await expect(page.getByTestId("analysis-process")).toContainText("framemind-native/2");
      records.push({ id: sample.id, passed: true, result });
      if (sample.id === "combination-negative") {
        await page.getByRole("button", { name: "工程计算书", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "工程计算书" });
        await dialog.getByRole("checkbox", { name: /杆件过程（/ }).check();
        await dialog.getByRole("checkbox", { name: /附录杆件 M1/ }).check();
        await dialog.getByRole("checkbox", { name: "整体约束处理与荷载向量", exact: true }).check();
        await dialog.getByRole("button", { name: "导出 Word", exact: true }).click();
        await expect(page.locator('footer[role="status"]')).toContainText("已导出 Word 计算书", { timeout: 30000 });
        const zip = await JSZip.loadAsync(await readFile(wordPath));
        const xml = await zip.file("word/document.xml")!.async("string");
        for (const text of [result.id, "framemind-native/2", "sparse-ldlt", "CB1", "-0.5"]) expect(xml).toContain(text);
        expect(xml).not.toContain("整体过程缺少记录");
        await dialog.getByRole("button", { name: "导出 PDF", exact: true }).click();
        await expect(page.locator('footer[role="status"]')).toContainText("已导出 PDF 计算书", { timeout: 30000 });
        expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe("%PDF-");
        await copyFile(wordPath, join(evidence, "native-combination.docx"));
        await copyFile(pdfPath, join(evidence, "native-combination.pdf"));
        await dialog.getByRole("button", { name: "关闭", exact: true }).last().click();
      }
    }
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, installed ? "installed-native.png" : "native-process.png") });
    const mechanism = structuredClone(samples[0].project);
    mechanism.supports[0].restraints = [true, true, true, false, false, false];
    await writeFile(projectPath, encodeProject(mechanism));
    await fileAction("打开项目");
    await expect(page.locator('footer[role="status"]')).toContainText("已打开");
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("方程求解失败");
    await fileAction("保存项目");
    await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    expect(decodeProject(await readFile(projectPath, "utf8")).latestAnalysis).toBeUndefined();
    await writeFile(projectPath, encodeProject(samples[0].project));
    await fileAction("打开项目");
    await expect(page.locator('footer[role="status"]')).toContainText("已打开");
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    await fileAction("保存项目");
    await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    expect(decodeProject(await readFile(projectPath, "utf8")).latestAnalysis!.input.solver!.implementation).toBe("framemind-native/2");
    await writeFile(join(evidence, installed ? "installed-desktop.json" : "desktop-results.json"), JSON.stringify({ passed: true, installed: installed ?? false,
      compilerPath: "Windows System32 only", directory, records, nativeFailureDidNotSaveResult: true, formalEntry: "native-static" }, null, 2) + "\n");
  } finally { await app.close(); }
});
