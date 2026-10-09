import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { createProject, addNode } from "../src/domain/project";
import { encodeProject, decodeProject } from "../src/domain/project-file";
import { enterWorkbenchWithoutRecovery } from "./electron-app";
import { prismStep } from "../scripts/fixtures/p25-04-prism.mjs";

async function fileAction(page: Page, action: string) {
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(action) }).click();
}
for (const source of ["specified", "analytic-prism"] as const) test(`P25-04 ${source}: real import, pose, export and formal model isolation`, async () => {
  test.setTimeout(120_000);
  const temp = await mkdtemp(join(tmpdir(), "framemind-p2504-"));
  const projectPath = join(temp, "formal.framemind"), previewPath = join(temp, "preview.json"), fixturePath = join(temp, "prism.step");
  await writeFile(fixturePath, prismStep());
  const input = source === "specified" ? resolve("完整钢架装配.STEP") : fixturePath;
  const original = addNode(createProject(), { x: 6, y: 2, z: 1 });
  await writeFile(projectPath, encodeProject(original));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: temp, FRAMEMIND_E2E_PROJECT_PATH: projectPath, FRAMEMIND_E2E_STEP_PATH: input, FRAMEMIND_E2E_CAD_PREVIEW_PATH: previewPath };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({ args: ["."], env });
  const runId = randomUUID(), evidence = join("docs/evidence/plan2/P25-04/desktop", runId);
  await mkdir(evidence, { recursive: true });
  try {
    const page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await fileAction(page, "打开项目");
    await expect(page.locator('footer[role="status"]')).toContainText("已打开");
    await fileAction(page, "导入 STEP");
    const dialog = page.getByRole("dialog", { name: "STEP 工程拓扑预览" });
    await expect(dialog).toBeVisible({ timeout: 30000 }); await expect(dialog.getByRole("img")).toBeVisible();
    if (source === "specified") {
      await expect(dialog).toContainText("8 个装配实例"); await expect(dialog).toContainText("0 条实体中心线");
      await expect(dialog).toContainText("uncertain-principal-axis");
      await dialog.getByRole("button", { name: "定位来源 #6739", exact: true }).first().click();
      await expect(dialog.locator(".cad-solid-box.located")).toHaveCount(24);
    } else {
      await expect(dialog).toContainText("1 条实体中心线"); await expect(dialog).toContainText("2 个草稿节点");
      await expect(dialog.locator(".cad-member")).toHaveCount(1);
    }
    await expect(dialog.locator(".cad-preview-frame")).toHaveCount(12);
    await dialog.getByLabel("平移 X（m）", { exact: true }).fill("1.25");
    await dialog.getByLabel("旋转 X（°）", { exact: true }).fill("90");
    await dialog.getByLabel("旋转 Z（°）", { exact: true }).fill("45");
    await dialog.getByRole("button", { name: "记录草稿位姿" }).click();
    await dialog.getByRole("button", { name: "关闭预览" }).click(); await fileAction(page, "重开 STEP 预览");
    await expect(dialog.getByLabel("平移 X（m）", { exact: true })).toHaveValue("1.25");
    await expect(dialog).toContainText("已记录 1 次决定");
    await dialog.getByRole("button", { name: "导出预览 JSON" }).click(); await expect(dialog.getByRole("status")).toContainText("已导出");
    const previewContent = await readFile(previewPath, "utf8"), exported = JSON.parse(previewContent);
    expect(exported.poseDecisions).toHaveLength(1); expect(exported.pose.translationM).toEqual([1.25, 0, 0]);
    expect(exported.poseDecisions[0].geometryHash).toBe(exported.geometryHash);
    expect(exported.previewOnly).toBe(true); expect(previewContent).not.toContain(input); expect(previewContent).not.toContain("ISO-10303-21");
    await writeFile(join(evidence, "preview.json"), previewContent);
    for (const width of [1440, 1080]) { await page.setViewportSize({ width, height: 900 }); await page.screenshot({ path: join(evidence, `preview-dark-${width}.png`) }); }
    await dialog.getByRole("button", { name: "关闭预览" }).click();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "浅色", exact: true }).click();
    await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: "关闭", exact: true }).click();
    await fileAction(page, "重开 STEP 预览");
    for (const width of [1440, 1080]) { await page.setViewportSize({ width, height: 900 }); await page.screenshot({ path: join(evidence, `preview-light-${width}.png`) }); }
    await dialog.getByRole("button", { name: "关闭预览" }).click();
    await fileAction(page, "保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    const saved = decodeProject(await readFile(projectPath, "utf8"));
    expect(saved.nodes).toEqual(original.nodes); expect(saved.members).toEqual(original.members); expect(saved.revision).toBe(original.revision);
    // A formal edit invalidates the draft; it cannot silently cross snapshots.
    await page.getByRole("button", { name: "创建节点", exact: true }).click();
    await page.getByRole("button", { name: "添加到模型", exact: true }).click();
    await page.getByRole("button", { name: "文件", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: /重开 STEP 预览/ })).toHaveCount(0);
    const hash = (content: string | Buffer) => createHash("sha256").update(content).digest("hex");
    const buildHashes = Object.fromEntries(await Promise.all(["dist/index.html", "dist-electron/main.js"].map(async (path) => [path, hash(await readFile(path))])));
    const sourceHashes = Object.fromEntries(await Promise.all(["scripts/step-intermediate.mjs", "scripts/step-centerlines.mjs", "src/workspace/cad-topology.ts", "src/components/CadTopologyPreview.tsx", "e2e/p25-04-step.spec.ts"].map(async (path) => [path, hash((await readFile(path, "utf8")).replace(/\r\n/g, "\n"))])));
    const manifest = { runId, source, recordedAt: new Date().toISOString(), inputSha256: hash(await readFile(input)), previewSha256: hash(previewContent), parser: exported.intermediateState.source.parserVersion, geometryHash: exported.geometryHash, sourceHashNormalization: "UTF-8-LF", sourceHashes, buildHashes, formalModelUnchanged: true, reopenedPosePreserved: true, editingInvalidatesDraft: true, geometryAcceptance: source === "specified" ? "blocked" : "analytic-fixture-passed", taskAcceptance: "pending-independent-cad-and-specified-solid-recognition" };
    await writeFile(join(evidence, "desktop.json"), JSON.stringify(manifest, null, 2));
  } finally {
    await app.close();
    if (!resolve(temp).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup target");
    await rm(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});
