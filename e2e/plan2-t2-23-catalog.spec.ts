import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { sectionCantilever } from "../src/validation/section-fixtures";
import { updateSection } from "../src/domain/project";
import { enterWorkbenchWithoutRecovery } from "./electron-app";
import { desktop, replay, save, send } from "./frame-proposal-actions";

async function open(page: Page) {
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("menuitem", { name: /打开项目/ }).click();
}

test("T2-23 legacy mechanics, explicit catalog supplementation, undo, units and restart", async () => {
  test.setTimeout(180000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t223-")), path = join(directory, "catalog.framemind");
  const base = sectionCantilever(), legacy = updateSection(base, base.sections[0].id, { name: "IPE 200", areaM2: .02, secondMomentYM4: .0001, secondMomentZM4: .0002, torsionalConstantM4: .0003 });
  await writeFile(path, JSON.stringify({ ...legacy, formatVersion: 1 }));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  let app = await electron.launch({ args: ["."], env });
  const evidence = "docs/evidence/plan2/T2-23"; await mkdir(evidence, { recursive: true });
  try {
    let page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await open(page);
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    const original = await save(page, path);
    expect(original.sections[0].areaM2).toBe(.02); expect(original.sections[0].geometry).toBeUndefined();
    await page.getByLabel("单位预设").selectOption("mm-N");
    const dialog = page.getByRole("dialog", { name: "参数化截面管理" });
    await page.getByRole("button", { name: "参数化截面管理", exact: true }).click();
    await dialog.getByLabel("截面操作").selectOption("update");
    await dialog.getByLabel("截面名称", { exact: true }).fill("IPE 200 legacy properties");
    await dialog.getByRole("button", { name: "预览截面影响" }).click();
    await expect(dialog.getByLabel("截面影响预览")).toContainText("几何未定义");
    await dialog.getByLabel("截面形状").selectOption("catalog");
    await dialog.getByLabel("标准截面").selectOption("arcelor-ipe200");
    await dialog.getByRole("button", { name: "预览截面影响" }).click();
    await expect(dialog.getByLabel("截面影响预览")).toContainText("正式分析采用目录参数");
    await expect(dialog.getByLabel("截面影响预览")).toContainText("原表圆角 r = 12 mm");
    await expect(dialog.getByLabel("截面影响预览")).toContainText("member_0001");
    expect((await save(page, path)).sections[0].areaM2).toBe(.02);
    for (const width of [1440, 1080]) {
      await page.setViewportSize({ width, height: 900 }); await dialog.getByRole("button", { name: "确认截面变更" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(evidence, `catalog-dark-${width}.png`) });
    }
    await dialog.getByRole("button", { name: "确认截面变更" }).click();
    const changed = await save(page, path);
    expect(changed.sections[0].areaM2).toBe(.00285); expect(changed.sections[0].geometry).toMatchObject({ height: .2, width: .1 });
    expect(changed.latestAnalysis).toEqual(original.latestAnalysis);
    await page.getByRole("button", { name: "撤销", exact: true }).click(); expect((await save(page, path)).sections).toEqual(original.sections);
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await page.getByRole("button", { name: "运行分析", exact: true }).click(); await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    const analyzed = await save(page, path); expect(analyzed.analysisResults).toHaveLength(2);
    expect(analyzed.latestAnalysis?.input.sections[0].catalogBasis?.source.edition).toContain("V2026-1");
    await page.getByRole("button", { name: "设置", exact: true }).click(); await page.getByRole("button", { name: "浅色", exact: true }).click();
    await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "参数化截面管理", exact: true }).click(); await dialog.getByLabel("截面操作").selectOption("update");
    for (const width of [1440, 1080]) { await page.setViewportSize({ width, height: 900 }); await page.screenshot({ path: join(evidence, `catalog-light-${width}.png`) }); }
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await app.close(); app = await electron.launch({ args: ["."], env }); page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await open(page);
    const restored = await save(page, path); expect(restored.sections).toEqual(analyzed.sections); expect(restored.analysisResults).toEqual(analyzed.analysisResults);
    await writeFile(join(evidence, "desktop.json"), JSON.stringify({ passed: true, legacySameNameNotMatched: true, legacyNativeSolve: original.latestAnalysis?.id, confirmedCatalogSolve: restored.latestAnalysis?.id, undoRedo: true, restartPreservesCatalogAndHistoricalInput: true }, null, 2));
  } finally { await app.close(); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup path"); await rm(directory, { recursive: true, force: true }); }
});

test("T2-23 AI catalog selection uses original mechanics only after confirmation", async () => {
  await desktop(async (app, page, path) => {
    await writeFile(path, JSON.stringify(sectionCantilever())); await open(page);
    await replay(app, { operations: [
      { type: "create_section", properties: { name: "AI IPE 100", catalogId: "arcelor-ipe100" } },
      { type: "assign_section", id: "section_0002", memberIds: ["member_0001"] },
    ] }, "propose_model_edits");
    await send(page, "选用目录 IPE 100 并指派 M1，先预览来源与参数");
    const card = page.getByRole("region", { name: "基础编辑草案" });
    await expect(card.getByLabel("截面影响预览")).toContainText("正式分析采用目录参数");
    await expect(card.getByLabel("截面影响预览")).toContainText("J 仅作公式对照");
    expect((await save(page, path)).sections).toHaveLength(1);
    await card.getByRole("button", { name: "确认编辑", exact: true }).click();
    const saved = await save(page, path); expect(saved.sections[1].torsionalConstantM4).toBe(1.157e-8);
    expect(saved.sections[1].catalogBasis?.source.edition).toContain("V2026-1"); expect(saved.members[0].sectionId).toBe("section_0002");
    expect(saved.confirmedOperations?.at(-1)?.result.status).toBe("applied");
  });
});
