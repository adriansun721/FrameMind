import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeProject, encodeProject } from "../src/domain/project-file";
import { isAnalysisResultCurrent, type AnalysisResult } from "../src/domain/analysis";
import type { FrameProject } from "../src/domain/project";
import { enterWorkbenchWithoutRecovery } from "./electron-app";

test("T2-13 desktop calls C++, browses and saves all independent single-member loads with compiler-free PATH", async () => {
  test.setTimeout(120000);
  const evidence = "docs/evidence/plan2/T2-13";
  const samples: Array<{ id: string; project: FrameProject; result: AnalysisResult }> = JSON.parse(await readFile(join(evidence, "wire-samples.json"), "utf8"));
  expect(samples).toHaveLength(9);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t213-"));
  const projectPath = join(directory, "原生单杆.framemind");
  const env = { ...process.env, PATH: `${process.env.SystemRoot}\\System32`, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: projectPath };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const installed = process.env.FRAMEMIND_INSTALLED_EXE;
  const app = await electron.launch(installed ? { executablePath: installed, env } : { args: ["."], env });
  const records = [];
  try {
    const page = await app.firstWindow();
    await enterWorkbenchWithoutRecovery(page);
    for (const sample of samples) {
      await writeFile(projectPath, encodeProject(sample.project));
      await page.keyboard.press("Control+o");
      await expect(page.locator('footer[role="status"]')).toContainText("已打开");
      await page.getByRole("button", { name: "C++ 单杆试算", exact: true }).click();
      await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
      await page.keyboard.press("Control+s");
      await expect(page.locator('footer[role="status"]')).toContainText("已保存");
      const saved = decodeProject(await readFile(projectPath, "utf8"));
      const result = saved.latestAnalysis!;
      expect(result.input.solver!.implementation).toBe("framemind-native/1");
      expect(result.service!.stages.map((record) => record.stage)).toEqual(["model-check", "assembly", "solve", "recovery"]);
      expect(result.process!.assembledStiffness).toHaveLength(12);
      expect(result.members[0].nativeResponses).toHaveLength(17);
      expect(isAnalysisResultCurrent(saved, result)).toBe(true);
      expect(result.nodes).toEqual(sample.result.nodes);
      expect(result.members).toEqual(sample.result.members);
      await page.keyboard.press("Control+o");
      await expect(page.locator('footer[role="status"]')).toContainText("已打开");
      await expect(page.getByTestId("analysis-process")).toContainText("framemind-native/1");
      records.push({ id: sample.id, passed: true, result });
    }
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, installed ? "installed-native.png" : "native-process.png") });
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    await page.keyboard.press("Control+s");
    await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    expect(decodeProject(await readFile(projectPath, "utf8")).latestAnalysis!.input.solver!.implementation).toBe("framemind-frame/3");
    await writeFile(join(evidence, installed ? "installed-desktop.json" : "desktop-results.json"), JSON.stringify({ passed: true, installed: installed ?? false,
      compilerPath: "Windows System32 only", directory, records, legacyFormalEntry: "passed" }, null, 2) + "\n");
  } finally { await app.close(); }
});
