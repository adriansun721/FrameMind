import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeProject, encodeProject } from "../src/domain/project-file";
import { isAnalysisResultCurrent, type AnalysisResult } from "../src/domain/analysis";
import type { FrameProject } from "../src/domain/project";
import { enterWorkbenchWithoutRecovery } from "./electron-app";

// ADR-0032 tolerances also apply when comparing the former /1 and production /2 cores.
const expectVector = (actual: readonly number[] | { x: number; y: number; z: number }, reference: readonly number[] | { x: number; y: number; z: number }, absoluteTolerance: number) => {
  expect(Object.keys(actual)).toEqual(Object.keys(reference));
  const expectedValues: number[] = Object.values(reference);
  Object.values(actual).forEach((value: number, index) => {
    expect(Number.isFinite(value)).toBe(true);
    expect(Math.abs(value - expectedValues[index])).toBeLessThanOrEqual(Math.max(absoluteTolerance, 1e-8 * Math.abs(expectedValues[index])));
  });
};

const expectEquivalentResults = (actual: AnalysisResult, reference: AnalysisResult) => {
  expect(actual.nodes.map((node) => node.nodeId)).toEqual(reference.nodes.map((node) => node.nodeId));
  actual.nodes.forEach((node, index) => {
    const expected = reference.nodes[index];
    expectVector(node.displacement, expected.displacement, 1e-11);
    expectVector(node.rotation, expected.rotation, 1e-11);
    expectVector(node.reaction, expected.reaction, 1e-9);
    expectVector(node.reactionMoment, expected.reactionMoment, 1e-9);
  });
  expect(actual.members.map((member) => member.memberId)).toEqual(reference.members.map((member) => member.memberId));
  actual.members.forEach((member, index) => {
    const expected = reference.members[index];
    expect(member.length).toBe(expected.length);
    expect(member.localAxes).toEqual(expected.localAxes);
    expectVector(member.localEndForces.start, expected.localEndForces.start, 1e-9);
    expectVector(member.localEndForces.end, expected.localEndForces.end, 1e-9);
    expect(member.nativeResponses).toHaveLength(expected.nativeResponses!.length);
    member.nativeResponses!.forEach((response, station) => {
      const expectedResponse = expected.nativeResponses![station];
      expect(response.position).toBe(expectedResponse.position);
      expectVector(response.forces, expectedResponse.forces, 1e-9);
      expectVector(response.localDisplacement, expectedResponse.localDisplacement, 1e-11);
      expectVector(response.globalDisplacement, expectedResponse.globalDisplacement, 1e-11);
    });
  });
};

test("T2-13 desktop calls C++, browses and saves all independent single-member loads with compiler-free PATH", async () => {
  test.setTimeout(120000);
  const evidence = process.env.FRAMEMIND_T213_EVIDENCE ?? "docs/evidence/plan2/T2-13";
  const samples: Array<{ id: string; project: FrameProject; result: AnalysisResult }> = JSON.parse(await readFile(join("docs/evidence/plan2/T2-13", "wire-samples.json"), "utf8"));
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
      await page.getByRole("button", { name: "运行分析", exact: true }).click();
      await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
      await page.keyboard.press("Control+s");
      await expect(page.locator('footer[role="status"]')).toContainText("已保存");
      const saved = decodeProject(await readFile(projectPath, "utf8"));
      const result = saved.latestAnalysis!;
      expect(result.input.solver!.implementation).toBe("framemind-native/2");
      expect(result.service!.stages.map((record) => record.stage)).toEqual(["model-check", "assembly", "solve", "recovery"]);
      expect(result.process!.assembledStiffness).toHaveLength(12);
      expect(result.members[0].nativeResponses).toHaveLength(17);
      expect(isAnalysisResultCurrent(saved, result)).toBe(true);
      expectEquivalentResults(result, sample.result);
      await page.keyboard.press("Control+o");
      await expect(page.locator('footer[role="status"]')).toContainText("已打开");
      await expect(page.getByTestId("analysis-process")).toContainText("framemind-native/2");
      records.push({ id: sample.id, passed: true, result });
    }
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, installed ? "installed-native.png" : "native-process.png") });
    const mechanism = structuredClone(samples[0].project);
    mechanism.supports[0].restraints = [true, true, true, false, false, false];
    await writeFile(projectPath, encodeProject(mechanism));
    await page.keyboard.press("Control+o");
    await expect(page.locator('footer[role="status"]')).toContainText("已打开");
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("方程求解失败");
    await page.keyboard.press("Control+s");
    await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    expect(decodeProject(await readFile(projectPath, "utf8")).latestAnalysis).toBeUndefined();
    await writeFile(projectPath, encodeProject(samples[0].project));
    await page.keyboard.press("Control+o");
    await expect(page.locator('footer[role="status"]')).toContainText("已打开");
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    await page.keyboard.press("Control+s");
    await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    expect(decodeProject(await readFile(projectPath, "utf8")).latestAnalysis!.input.solver!.implementation).toBe("framemind-native/2");
    await writeFile(join(evidence, installed ? "installed-desktop.json" : "desktop-results.json"), JSON.stringify({ passed: true, installed: installed ?? false,
      compilerPath: "Windows System32 only", directory, records, nativeFailureDidNotSaveResult: true, formalEntry: "native-static" }, null, 2) + "\n");
  } finally { await app.close(); }
});
