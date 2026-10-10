import { _electron as electron, expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { addNode, createProject } from "../src/domain/project";
import { decodeProject, encodeProject } from "../src/domain/project-file";
import { prismStep } from "../scripts/fixtures/p25-04-prism.mjs";
import { enterWorkbenchWithoutRecovery } from "./electron-app";

for (const source of ["analytic-prism", "specified"] as const) test(`P25-06 ${source}: confirmation, atomic failure, undo and reopen`, async () => {
  test.setTimeout(120_000);
  const runId = randomUUID(), directory = await mkdtemp(join(tmpdir(), "framemind-p2506-"));
  const evidence = resolve("docs/evidence/plan2/P25-06/runs", runId), projectPath = join(directory, "project.framemind"), inputPath = join(directory, "prism.step");
  const parent = addNode(createProject(), { x: 6, y: 2, z: 1 });
  await mkdir(evidence, { recursive: true }); await writeFile(projectPath, encodeProject(parent)); await writeFile(inputPath, prismStep());
  const input = source === "specified" ? resolve("完整钢架装配.STEP") : inputPath;
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: projectPath, FRAMEMIND_E2E_STEP_PATH: input };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page);
    const action = async (name: string) => { await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: new RegExp(name) }).click(); };
    await action("打开项目"); await expect(page.getByTestId("viewport-node-count")).toHaveText("1 个节点");
    await action("导入 STEP");
    const dialog = page.getByRole("dialog", { name: "STEP 工程拓扑预览" }); await expect(dialog).toBeVisible({ timeout: 30_000 });
    const resources = dialog.getByRole("region", { name: "截面材料与刚接核验" });
    await expect(dialog.getByRole("button", { name: "确认整体导入", exact: true })).toBeDisabled();
    for (const [name, value] of [["导入材料名称", "S355JR"], ["导入材料弹性模量", "210"], ["导入材料泊松比", ".3"], ["导入材料密度", "7850"]]) await resources.getByLabel(name, { exact: true }).fill(value);
    await resources.getByLabel("确认材料来源与参数", { exact: true }).check(); await resources.getByLabel(/我明确确认/).check();
    for (const checkbox of await resources.getByRole("checkbox", { name: /^接受警告/ }).all()) await checkbox.check();
    if (source === "specified") {
      await expect(dialog.getByRole("button", { name: "检查并冻结导入草稿", exact: true })).toBeDisabled();
      await dialog.getByRole("button", { name: "保存待修复草稿", exact: true }).click();
      await expect(dialog.getByRole("status").last()).toContainText("待修复草稿已保存");
      const saved = decodeProject(await readFile(projectPath, "utf8"));
      expect(saved.nodes).toEqual(parent.nodes); expect(saved.members).toEqual([]); expect(saved.cadImportDraft?.restored).toBe(true);
      await writeFile(join(evidence, "pending.framemind"), await readFile(projectPath));
      await dialog.getByRole("button", { name: "关闭预览", exact: true }).click();
      await action("打开项目"); await action("重开 STEP 预览");
      await expect(dialog.getByText(/已恢复待修复草稿/)).toBeVisible();
      await expect(resources.getByLabel("导入材料名称", { exact: true })).toHaveValue("S355JR");
      await expect(dialog.getByRole("button", { name: "确认整体导入", exact: true })).toBeDisabled();
      await page.screenshot({ path: join(evidence, "blocked-draft.png") });
    } else {
      // A bounded transport fixture exercises confirmation; this run is explicitly replay, never online evidence.
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler("deepseek:chat");
        ipcMain.handle("deepseek:chat", (_event, request) => {
          const input = JSON.parse(request.messages.at(-1).content);
          return { status: "success", message: "P25-06 replay transport", assistant: { content: JSON.stringify({ decision: "accept", findings: input.checks.map((c: { code: string; evidence: string[] }) => ({ checkCode: c.code, decision: "accept", evidence: c.evidence, message: "Replay fixture" })) }) } };
        });
      });
      await resources.getByRole("button", { name: "生成 AI 只读核验摘要", exact: true }).click();
      await resources.getByRole("button", { name: "在线 AI 只读核验", exact: true }).click();
      await expect(resources.getByRole("status")).toContainText("accepted");
      await dialog.getByRole("button", { name: "检查并冻结导入草稿", exact: true }).click();
      await expect(dialog.getByRole("button", { name: "确认整体导入", exact: true })).toBeEnabled();
      await page.screenshot({ path: join(evidence, "confirmation.png") });
      await writeFile(inputPath, "changed since parsing");
      await dialog.getByRole("button", { name: "确认整体导入", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("字节已变化");
      await expect(page.getByTestId("viewport-node-count")).toHaveText("1 个节点");
      await writeFile(inputPath, prismStep());
      const repository = join(directory, "project-history", parent.id), lock = join(repository, "refs/heads/main.lock");
      await writeFile(lock, "P25-06 fault injection");
      await dialog.getByRole("button", { name: "确认整体导入", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("checkpoint 失败");
      await expect(page.getByTestId("viewport-node-count")).toHaveText("1 个节点");
      const failedHistory = await page.evaluate((id) => window.frameMind.listProjectCheckpoints(id), parent.id);
      expect(failedHistory.some((r) => r.kind === "step-confirmed")).toBe(false);
      await writeFile(join(evidence, "failure.json"), JSON.stringify({ faults: ["changed STEP bytes", "Git ref lock"], formalUnchanged: true, failedHistory }, null, 2));
      await rm(lock);
      await dialog.getByRole("button", { name: "确认整体导入", exact: true }).click();
      await expect(dialog).toBeHidden(); await expect(page.getByTestId("viewport-node-count")).toHaveText("2 个节点");
      await expect(page.locator('footer[role="status"]')).toContainText("未具备求解条件");
      await action("保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
      const applied = decodeProject(await readFile(projectPath, "utf8"));
      expect(applied.cadImports?.[0].mappings).toHaveLength(1); expect(applied.supports).toEqual([]); expect(applied.nodalLoads).toEqual([]);
      await writeFile(join(evidence, "before.framemind"), encodeProject(parent)); await writeFile(join(evidence, "after.framemind"), await readFile(projectPath));
      await page.getByRole("button", { name: "撤销", exact: true }).click(); await expect(page.getByTestId("viewport-node-count")).toHaveText("1 个节点");
      await action("保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
      expect(decodeProject(await readFile(projectPath, "utf8")).nodes).toEqual(parent.nodes);
      await page.getByRole("button", { name: "重做", exact: true }).click(); await expect(page.getByTestId("viewport-node-count")).toHaveText("2 个节点");
      await action("保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
      await rm(inputPath); await action("打开项目"); await expect(page.getByTestId("viewport-node-count")).toHaveText("2 个节点");
      await expect(page.getByTestId("cad-import-readiness")).toContainText("缺支座、缺荷载");
      await action("STEP 导入历史");
      const history = page.getByRole("dialog", { name: "STEP 导入历史", exact: true });
      await expect(history.getByText(/确认回执/)).toBeVisible(); await expect(history.getByText(/step-confirmed ·/)).toBeVisible();
      await page.screenshot({ path: join(evidence, "history.png") });
      const records = await page.evaluate((id) => window.frameMind.listProjectCheckpoints(id), parent.id);
      expect(records.map((r) => r.kind)).toContain("step-undo"); expect(records.map((r) => r.kind)).toContain("step-redo");
      await writeFile(join(evidence, "history.json"), JSON.stringify(records, null, 2));
      page.once("dialog", (d) => d.accept());
      await history.locator("p").filter({ hasText: /^step-before ·/ }).first().getByRole("button", { name: "恢复此 checkpoint" }).click();
      await expect(history).toBeHidden(); await expect(page.getByTestId("viewport-node-count")).toHaveText("1 个节点");
      await writeFile(join(evidence, "restored.json"), JSON.stringify({ nodeCount: 1, checkpointRestored: true }, null, 2));
      if (!resolve(repository).startsWith(resolve(directory) + sep)) throw new Error("Invalid sidecar path");
      await rm(repository, { recursive: true, force: true });
      page.once("dialog", (d) => d.accept()); await action("打开项目");
      await expect(page.getByTestId("viewport-node-count")).toHaveText("2 个节点");
      await action("STEP 导入历史"); await expect(history.getByText(/本机项目历史旁车缺失/)).toBeVisible();
    }
    const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
    const files = source === "specified" ? ["pending.framemind", "blocked-draft.png"] : ["before.framemind", "after.framemind", "failure.json", "confirmation.png", "history.json", "history.png", "restored.json"];
    const artifacts = Object.fromEntries(await Promise.all(files.map(async (file) => [file, hash(await readFile(join(evidence, file)))])));
    const sourceFiles = ["src/workspace/cad-import.ts", "src/App.tsx", "src/components/CadTopologyPreview.tsx", "electron/project-checkpoints.ts", "dist/index.html", "dist-electron/main.js", "e2e/p25-06-import.spec.ts"];
    const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, hash(await readFile(file))])));
    await writeFile(join(evidence, "run.json"), JSON.stringify({ runId, source, recordedAt: new Date().toISOString(), status: "passed", mode: source === "specified" ? "local-blocked" : "replay-transport", onlineAcceptance: false,
      inputSha256: source === "specified" ? hash(await readFile(input)) : hash(prismStep()), artifacts, sourceHashes,
      specifiedAcceptance: "pending-upstream-geometry-and-independent-reference", reverify: "npm run build && node scripts/run-e2e-isolated.cjs e2e/p25-06-import.spec.ts" }, null, 2));
  } finally {
    await app.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid test profile");
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});
