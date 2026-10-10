import { _electron as electron, expect, test } from "@playwright/test";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createProject } from "../src/domain/project";
import { encodeProject, decodeProject } from "../src/domain/project-file";
import { enterWorkbenchWithoutRecovery } from "./electron-app";
import { createNode } from "./modeling-actions";

test("P25-07 desktop: independent history, copy/new lineage, recovery and missing history", async () => {
  test.setTimeout(180_000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-p2507-")), runId = randomUUID();
  const evidence = resolve("docs/evidence/plan2/P25-07/runs", runId), path = join(directory, "project.framemind");
  const copyPath = join(directory, "copy.framemind"), newPath = join(directory, "new.framemind"), movedPath = join(directory, "moved.framemind");
  const parent = createProject(); await writeFile(path, encodeProject(parent)); await mkdir(evidence, { recursive: true });
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const sourceHeadBefore = await readFile(resolve(".git/refs/heads/main"), "utf8");
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page);
    const action = async (name: string) => { await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: new RegExp(name) }).click(); };
    await action("打开项目"); await expect(page.locator('footer[role="status"]')).toContainText("历史目录缺失");
    await action("保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    const original = decodeProject(await readFile(path, "utf8"));
    expect(original.projectHistory?.id).toMatch(/^history_/);
    const initial = await page.evaluate((id) => window.frameMind.listProjectCheckpoints(id), parent.id);
    expect(initial).toHaveLength(1);
    // The controlled checkpoint API persists a before/after pair for downstream task entry points.
    await page.evaluate(async ({ id, original }) => {
      await window.frameMind.recordProjectCheckpoints({ projectId: id, snapshots: [
        { kind: "candidate-round", content: original, taskId: "round-1", candidateId: "candidate-1", resultSha256: "b".repeat(64), evidenceIndex: ["run-1/report.json"] },
        { kind: "merge-before", content: original, taskId: "round-1" },
      ] });
    }, { id: parent.id, original: await readFile(path, "utf8") });
    await app.evaluate((_electron, target) => { process.env.FRAMEMIND_E2E_SAVE_AS_PATH = target; }, copyPath);
    await action("另存为（复制历史）"); await expect(page.locator('footer[role="status"]')).toContainText("已复制历史");
    const copied = decodeProject(await readFile(copyPath, "utf8"));
    expect(copied.projectHistory?.id).not.toBe(original.projectHistory?.id);
    const copiedRecords = await page.evaluate((id) => window.frameMind.listProjectCheckpoints(id), parent.id);
    expect(copiedRecords[0].copiedFrom?.historyId).toBe(original.projectHistory!.id);
    expect(copiedRecords.map((r) => r.kind)).toContain("candidate-round");
    await createNode(page, ["2", "0", "0"]);
    await action("保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    await expect(page.getByTestId("viewport-node-count")).toHaveText("1 个节点");
    await action("项目历史"); const history = page.getByRole("dialog", { name: "项目历史", exact: true });
    await expect(history.getByText(/复制自/)).toBeVisible();
    await history.locator("p").filter({ hasText: /^save ·/ }).last().getByRole("button", { name: "查看恢复差异" }).click();
    await expect(history.getByRole("region", { name: "checkpoint 恢复差异" })).toBeVisible();
    await expect(history.getByRole("region", { name: "checkpoint 恢复差异" })).toContainText("nodes");
    await page.screenshot({ path: join(evidence, "history.png") });
    page.once("dialog", (dialog) => dialog.accept()); await history.getByRole("button", { name: "确认整体恢复" }).click();
    await expect(history).toBeHidden(); await expect(page.locator('footer[role="status"]')).toContainText("旧任务与导入确认已失效");
    await expect(page.getByTestId("viewport-node-count")).toHaveText("0 个节点");
    await action("保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    expect(decodeProject(await readFile(copyPath, "utf8")).projectHistory?.id).toBe(copied.projectHistory?.id);
    await app.evaluate((_electron, target) => { process.env.FRAMEMIND_E2E_SAVE_AS_PATH = target; }, newPath);
    await action("另存为（新历史）"); await expect(page.locator('footer[role="status"]')).toContainText("已建立新历史");
    const newRecords = await page.evaluate((id) => window.frameMind.listProjectCheckpoints(id), parent.id);
    expect(newRecords.map((r) => r.kind)).toEqual(["initial"]);
    await cp(newPath, movedPath);
    await app.evaluate((_electron, target) => { process.env.FRAMEMIND_E2E_PROJECT_PATH = target; }, movedPath);
    await action("打开项目"); await expect(page.locator('footer[role="status"]')).toContainText("历史目录缺失");
    await action("项目历史"); await expect(history.getByText(/旁车缺失/)).toBeVisible();
    await page.screenshot({ path: join(evidence, "missing-history.png") });
    expect(await readFile(resolve(".git/refs/heads/main"), "utf8")).toBe(sourceHeadBefore);
    await writeFile(join(evidence, "history.json"), JSON.stringify({ initial, copiedRecords, newRecords }, null, 2));
    for (const [file, source] of [["original.framemind", path], ["copied.framemind", copyPath], ["new.framemind", newPath]]) await cp(source, join(evidence, file));
    const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    const artifacts = Object.fromEntries(await Promise.all(["history.png", "missing-history.png", "history.json", "original.framemind", "copied.framemind", "new.framemind"].map(async (file) => [file, hash(await readFile(join(evidence, file)))])));
    const sources = ["electron/project-history-store.ts", "electron/project-checkpoints.ts", "electron/main.ts", "src/App.tsx",
      "src/components/AiConversationPanel.tsx", "src/components/CadImportHistory.tsx", "src/workspace/checkpoint-restore.ts",
      "e2e/p25-07-history.spec.ts", "dist/index.html", "dist-electron/main.js",
      ...(await readdir(resolve("dist/assets"))).filter((file) => /\.(js|css)$/.test(file)).map((file) => `dist/assets/${file}`)];
    const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async (file) => [file, hash(await readFile(file))])));
    await writeFile(join(evidence, "run.json"), JSON.stringify({ task: "P25-07", runId, recordedAt: new Date().toISOString(), mode: "local-real-git", status: "passed", sourceRepositoryUnchanged: true, artifacts, sourceHashes, reverify: "npm run build && node scripts/run-e2e-isolated.cjs e2e/p25-07-history.spec.ts" }, null, 2));
  } finally {
    await app.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid test profile");
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});
