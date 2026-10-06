import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { sectionCantilever, SECTION_REFERENCES } from "../src/validation/section-fixtures";
import { SECTION_DIMENSIONS } from "../src/domain/section-geometry";
import { enterWorkbenchWithoutRecovery } from "./electron-app";
import { desktop, replay, save, send } from "./frame-proposal-actions";

async function open(page: Page) {
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("menuitem", { name: /打开项目/ }).click();
}
test("T2-22 five manual shapes, invalid walls, orientation, native solve and reopen", async () => {
  test.setTimeout(180000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t222-")), path = join(directory, "sections.framemind");
  const initial = sectionCantilever(); await writeFile(path, JSON.stringify(initial));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  let app = await electron.launch({ args: ["."], env });
  const evidence = "docs/evidence/plan2/T2-22"; await mkdir(evidence, { recursive: true });
  try {
    let page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await open(page);
    await page.getByLabel("单位预设").selectOption("mm-N");
    const dialog = page.getByRole("dialog", { name: "参数化截面管理" });
    for (const { geometry, expected } of SECTION_REFERENCES) {
      await page.getByRole("button", { name: "参数化截面管理", exact: true }).click();
      await dialog.getByLabel("截面形状").selectOption(geometry.shape);
      await dialog.getByLabel("截面名称", { exact: true }).fill(geometry.shape);
      for (const [key, value] of Object.entries(geometry)) if (key !== "shape") await dialog.getByLabel(SECTION_DIMENSIONS[key as keyof typeof SECTION_DIMENSIONS], { exact: true }).fill(String(Number(value) * 1000));
      if (geometry.shape === "rectangular-tube") {
        await dialog.getByLabel(SECTION_DIMENSIONS.thickness, { exact: true }).fill("110");
        await dialog.getByRole("button", { name: "预览截面影响" }).click();
        await expect(dialog.getByRole("alert")).toContainText("壁厚");
        await expect(dialog.getByRole("button", { name: "确认截面变更" })).toBeDisabled();
        await dialog.getByLabel(SECTION_DIMENSIONS.thickness, { exact: true }).fill("10");
      }
      await dialog.getByText(/指派范围与转角/).click();
      await dialog.getByLabel("指派 member_0001", { exact: true }).check();
      await dialog.getByLabel("设置指派转角").check(); await dialog.getByLabel("指派截面转角").fill("90");
      await dialog.getByRole("button", { name: "预览截面影响" }).click();
      await expect(dialog.getByLabel("截面影响预览")).toContainText("member_0001");
      await dialog.getByLabel("截面影响预览").getByText(/M1 · member_0001/).click();
      await expect(dialog.getByLabel("截面影响预览")).toContainText("global-z");
      await dialog.getByLabel("截面影响预览").scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(evidence, `${geometry.shape}-mm-dark.png`) });
      await dialog.getByRole("button", { name: "确认截面变更" }).click();
      const saved = await save(page, path);
      expect(saved.sections.at(-1)?.geometry).toEqual(geometry);
      expect(saved.sections.at(-1)?.areaM2).toBeCloseTo(expected[0], 13);
      expect(saved.members[0].rotationDegrees).toBe(90);
    }
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    const baseline = await save(page, path);
    expect(baseline.latestAnalysis?.input.sections.at(-1)?.geometry?.shape).toBe("i-section");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "浅色", exact: true }).click();
    await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: "关闭", exact: true }).click();
    for (const width of [1440, 1080]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole("button", { name: "参数化截面管理", exact: true }).click();
      await dialog.getByLabel("截面操作").selectOption("update"); await dialog.getByLabel("项目截面").selectOption(baseline.sections.at(-1)!.id);
      await dialog.getByLabel(SECTION_DIMENSIONS.width, { exact: true }).fill("300");
      await dialog.getByRole("button", { name: "预览截面影响" }).click();
      await dialog.getByLabel("截面影响预览").scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(evidence, `shared-light-${width}.png`) });
      if (width === 1440) await dialog.getByRole("button", { name: "取消", exact: true }).click();
    }
    await dialog.getByRole("button", { name: "确认截面变更" }).click();
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    expect((await save(page, path)).sections).toEqual(baseline.sections);
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await page.getByRole("button", { name: "运行分析", exact: true }).click(); await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    const changed = await save(page, path);
    expect(changed.analysisResults).toHaveLength(2);
    expect(changed.latestAnalysis?.input.sections.at(-1)?.geometry).toMatchObject({ width: .3 });
    await app.close(); app = await electron.launch({ args: ["."], env }); page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await open(page);
    const restored = await save(page, path);
    expect(restored.sections).toEqual(changed.sections); expect(restored.analysisResults).toEqual(changed.analysisResults);
    await writeFile(join(evidence, "desktop.json"), JSON.stringify({ passed: true, shapes: SECTION_REFERENCES.map((r) => r.geometry.shape), invalidWallsRejected: true, undoRedo: true, nativeAnalysis: restored.latestAnalysis?.id, restartPreserved: true }, null, 2));
  } finally { await app.close(); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup path"); await rm(directory, { recursive: true, force: true }); }
});

test("T2-22 agent dimensions and batch assignment remain isolated until confirmation", async () => {
  await desktop(async (app, page, path) => {
    await writeFile(path, JSON.stringify(sectionCantilever())); await open(page);
    await replay(app, { inputUnits: { length: "mm" }, operations: [
      { type: "create_section", properties: { name: "AI rectangular tube", geometry: { shape: "rectangular-tube", width: 200, height: 400, thickness: 10 } } },
      { type: "assign_section", id: "section_0002", memberIds: ["member_0001"], rotationDegrees: 30 },
    ] }, "propose_model_edits");
    await send(page, "创建矩形管截面并指派 M1，先核对尺寸、来源和朝向");
    const card = page.getByRole("region", { name: "基础编辑草案" });
    await expect(card.getByLabel("截面影响预览")).toContainText("薄壁");
    expect((await save(page, path)).sections).toHaveLength(1);
    await card.getByRole("button", { name: "确认编辑", exact: true }).click();
    const saved = await save(page, path);
    expect(saved.sections[1].geometry).toEqual({ shape: "rectangular-tube", width: .2, height: .4, thickness: .01 });
    expect(saved.members[0]).toMatchObject({ sectionId: "section_0002", rotationDegrees: 30 });
    expect(saved.confirmedOperations?.at(-1)?.result.status).toBe("applied");
  });
});
