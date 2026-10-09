import { _electron as electron, expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createProject, addNode } from "../src/domain/project";
import { encodeProject, decodeProject } from "../src/domain/project-file";
import { enterWorkbenchWithoutRecovery } from "./electron-app";
import { prismStep } from "../scripts/fixtures/p25-04-prism.mjs";

for (const source of ["analytic-prism", "specified"] as const) test(`P25-05 ${source}: resources, correction history, bounded AI and export`, async () => {
  test.setTimeout(120_000);
  const runId = randomUUID(), directory = await mkdtemp(join(tmpdir(), "framemind-p2505-"));
  const evidence = resolve("docs/evidence/plan2/P25-05", "runs", runId), previewPath = join(directory, "preview.json"), projectPath = join(directory, "formal.framemind"), fixturePath = join(directory, "prism.step");
  const original = addNode(createProject(), { x: 6, y: 2, z: 1 });
  await mkdir(evidence, { recursive: true }); await writeFile(projectPath, encodeProject(original)); await writeFile(fixturePath, prismStep());
  const input = source === "specified" ? resolve("完整钢架装配.STEP") : fixturePath;
  const online = process.env.FRAMEMIND_P2505_ONLINE === "1";
  if (online) for (const file of ["deepseek.credentials", "Local State"]) await copyFile(join(process.env.APPDATA!, "framemind", file), join(directory, file));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: projectPath, FRAMEMIND_E2E_STEP_PATH: input, FRAMEMIND_E2E_CAD_PREVIEW_PATH: previewPath };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page);
    const fileAction = async (name: string) => { await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: new RegExp(name) }).click(); };
    await fileAction("打开项目");
    await expect(page.locator('footer[role="status"]')).toContainText("已打开");
    await fileAction("导入 STEP");
    const dialog = page.getByRole("dialog", { name: "STEP 工程拓扑预览" }); await expect(dialog).toBeVisible({ timeout: 30_000 });
    const resources = dialog.getByRole("region", { name: "截面材料与刚接核验" });
    const exportPreview = async () => { await dialog.getByRole("button", { name: "导出预览 JSON" }).click(); await expect(dialog.getByRole("status").last()).toContainText("已导出"); return JSON.parse(await readFile(previewPath, "utf8")); };
    let preview = await exportPreview();
    expect(preview.resourceReview.status).not.toBe("verified");
    expect(preview.aiVerification.status).toBe("not-requested");
    for (const [name, value] of [["导入材料名称", "S355JR"], ["导入材料弹性模量", "210"], ["导入材料泊松比", "0.3"], ["导入材料密度", "7850"]]) await resources.getByLabel(name, { exact: true }).fill(value);
    await resources.getByLabel("确认材料来源与参数", { exact: true }).check();
    await resources.getByLabel(/我明确确认/).check();
    for (const checkbox of await resources.getByRole("checkbox", { name: /^接受警告/ }).all()) await checkbox.check();
    preview = await exportPreview();
    if (source === "analytic-prism") {
      expect(preview.resourceReview.status).toBe("verified");
      const section = preview.resourceReview.sections[0];
      expect(section.properties.areaM2).toBeCloseTo(.01, 12);
      expect(section.properties.secondMomentYM4).toBeCloseTo(.1 ** 4 / 12, 12);
      expect(section.properties.torsionalConstantM4).toBeCloseTo(.14083333333333333 * .1 ** 4, 12);
      const lineId = section.centerlineIds[0];
      await resources.getByText(`人工补齐或修正 · ${lineId}`, { exact: true }).click();
      await resources.getByLabel(`${lineId} A（m²）`, { exact: true }).fill(".011");
      await resources.getByLabel(`${lineId} 独立参考`, { exact: true }).fill("人工修改回归证据（仅验证修正，不作为指定 CAD 基准）");
      await resources.getByLabel(`确认 ${lineId} 人工参数、局部轴与参考`, { exact: true }).check();
      preview = await exportPreview();
      expect(preview.resourceReview.corrections[0].original.areaM2).toBeCloseTo(.01, 12);
      await resources.getByLabel(`${lineId} A（m²）`, { exact: true }).fill(".01");
      await resources.getByLabel(`确认 ${lineId} 人工参数、局部轴与参考`, { exact: true }).check();
      await dialog.getByRole("button", { name: "关闭预览", exact: true }).click(); await fileAction("重开 STEP 预览");
      expect((await exportPreview()).resourceReview.corrections).toHaveLength(2);
      await expect(resources.getByLabel("导入材料名称", { exact: true })).toHaveValue("S355JR");
      await expect(resources.getByLabel(`${lineId} A（m²）`, { exact: true })).toHaveValue("0.01");
    } else {
      expect(preview.resourceReview.status).toBe("blocked");
      expect(preview.resourceReview.sections).toHaveLength(0);
      expect(preview.intermediateState.engineeringGeometry.centerlines).toHaveLength(0);
    }
    await resources.getByRole("button", { name: "生成 AI 只读核验摘要", exact: true }).click();
    await resources.getByRole("button", { name: "在线 AI 只读核验", exact: true }).click();
    await expect(resources.getByRole("status")).toContainText(online ? /accepted|needs-human|rejected|format-error|failed|timeout/ : "failed", { timeout: 45_000 });
    preview = await exportPreview();
    if (online) {
      expect(preview.aiVerification.origin).toBe("online");
      expect(["accepted", "rejected", "needs-human"]).toContain(preview.aiVerification.status);
      if (source === "specified") expect(preview.aiVerification.status).not.toBe("accepted");
    } else expect(preview.aiVerification.status).not.toBe("accepted");
    await writeFile(join(evidence, "verification.json"), JSON.stringify(preview, null, 2));
    // Changes invalidate an existing response, including changes made during a request.
    await resources.getByLabel("导入材料密度", { exact: true }).fill("7800");
    await expect(resources.getByRole("status")).toContainText("not-requested");
    preview = await exportPreview(); expect(preview.aiVerification.status).toBe("not-requested");
    await page.setViewportSize({ width: 1440, height: 900 });
    await resources.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(evidence, "resources-dark-1440.png") });
    await dialog.getByRole("button", { name: "关闭预览", exact: true }).click();
    await fileAction("保存项目");
    await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    const saved = decodeProject(await readFile(projectPath, "utf8")); expect(saved.nodes).toEqual(original.nodes); expect(saved.members).toEqual(original.members); expect(saved.revision).toBe(original.revision);
    const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
    const files = ["src/workspace/cad-resources.ts", "src/components/CadTopologyPreview.tsx", "src/components/CadResourceReviewPanel.tsx", "src/App.tsx", "e2e/p25-05-resources.spec.ts", "dist/index.html", "dist-electron/main.js"];
    const sourceHashes = Object.fromEntries(await Promise.all(files.map(async (file) => [file, hash(await readFile(file))])));
    const artifacts = Object.fromEntries(await Promise.all(["verification.json", "resources-dark-1440.png"].map(async (file) => [file, hash(await readFile(join(evidence, file)))])));
    const settings = await page.evaluate(() => window.frameMind.getDeepSeekSettings());
    const manifest = { runId, source, recordedAt: new Date().toISOString(), status: "passed", mode: online ? "online" : "local-no-credential", model: settings.model, inputSha256: hash(await readFile(input)), sourceHashes, artifacts, formalModelUnchanged: true, aiChecked: true, specifiedGeometryAcceptance: source === "specified" ? "blocked-upstream-cad-reference-and-recognition" : "analytic-fixture", taskAcceptance: "pending-specified-complex-section-independent-reference", offlineReverify: "npm run build && node scripts/run-e2e-isolated.cjs e2e/p25-05-resources.spec.ts" };
    await writeFile(join(evidence, "run.json"), JSON.stringify(manifest, null, 2));
  } finally {
    await app.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid temporary workspace");
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});
