import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { createNode } from "./modeling-actions";
import { createPerformanceModel, PERFORMANCE_MODELS } from "../src/validation/performance-models";
import { encodeProject } from "../src/domain/project-file";

const executablePath = process.env.FRAMEMIND_INSTALLED_EXE;
test.skip(!executablePath, "Requires the installed Windows executable; run npm run evidence:t34");

async function save(page: Page, path: string) {
  await page.keyboard.press("Control+s");
  await expect(page.locator('footer[role="status"]')).toContainText("已保存");
  return JSON.parse(await readFile(path, "utf8"));
}

for (const mode of ["unconfigured", "removed", "disconnected"] as const) {
  test(`T34 installed ${mode}: manually models, solves, exports and restarts offline`, async () => {
    test.setTimeout(120_000);
    const directory = await mkdtemp(join(tmpdir(), "framemind-t34-"));
    const projectPath = join(directory, "中文离线工程.framemind");
    const wordPath = join(directory, "中文计算书.docx");
    const pdfPath = join(directory, "中文计算书.pdf");
    const output = resolve("docs/evidence/T34", mode);
    await mkdir(output, { recursive: true });
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,
      FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: projectPath,
      FRAMEMIND_E2E_REPORT_PATH: wordPath, FRAMEMIND_E2E_REPORT_PDF_PATH: pdfPath };
    for (const name of ["ELECTRON_RUN_AS_NODE", "VITE_DEV_SERVER_URL", "NODE_PATH", "NODE_OPTIONS"]) delete env[name];
    let app: ElectronApplication | undefined;
    const report: Record<string, unknown> = { runId: randomUUID(), startedAt: new Date().toISOString(), mode, outcome: "running", executablePath,
      network: "Chromium offline plus rejected main-process HTTPS; not an OS network disconnect", cleanMachine: false };
    await writeFile(join(output, "validation.json"), JSON.stringify(report, null, 2));
    const launch = async () => {
      app = await electron.launch({ executablePath, args: [], cwd: directory, env });
      const page = await app.firstWindow();
      await page.context().setOffline(true);
      await app.evaluate(() => { globalThis.fetch = async () => { throw new TypeError("T34 offline network boundary"); }; });
      return page;
    };
    try {
      let page = await launch();
      report.runtime = await app!.evaluate(({ app }) => ({ packaged: app.isPackaged, appPath: app.getAppPath(), executable: process.execPath, versions: process.versions }));
      expect((report.runtime as { packaged: boolean }).packaged).toBe(true);
      report.archiveSHA256 = createHash("sha256").update(await readFile((report.runtime as { appPath: string }).appPath)).digest("hex");
      await page.getByRole("button", { name: "设置", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "设置", exact: true });
      await expect(settings.getByRole("button", { name: "测试连接", exact: true })).toBeDisabled();
      if (mode !== "unconfigured") {
        await settings.getByLabel("DeepSeek API Key").fill("sk-t34-offline-fixture");
        await settings.getByRole("button", { name: "保存连接", exact: true }).click();
        await expect(settings.getByTestId("deepseek-feedback")).toHaveText("连接设置已保存");
        expect((await readFile(join(directory, "deepseek.credentials"))).includes(Buffer.from("sk-t34-offline-fixture"))).toBe(false);
        if (mode === "removed") {
          await settings.getByRole("button", { name: "移除本机凭据", exact: true }).click();
          await expect(settings.getByTestId("deepseek-feedback")).toHaveText("本机凭据已移除");
          await expect(readFile(join(directory, "deepseek.credentials"))).rejects.toMatchObject({ code: "ENOENT" });
        } else {
          await settings.getByRole("button", { name: "测试连接", exact: true }).click();
          await expect(settings.getByTestId("deepseek-feedback")).toContainText("网络");
        }
      }
      await settings.getByRole("button", { name: "浅色", exact: true }).click();
      await settings.getByRole("button", { name: "关闭", exact: true }).click();
      await page.getByRole("button", { name: "运行分析", exact: true }).click();
      await expect(page.getByRole("region", { name: "分析诊断" })).toContainText("模型没有杆件");
      await createNode(page, ["0", "0", "0"]);
      await createNode(page, ["4", "0", "0"]);
      await page.getByRole("button", { name: "创建材料与截面", exact: true }).click();
      await page.getByLabel("弹性模量 E").fill("200");
      await page.getByLabel("面积 A", { exact: true }).fill("0.01");
      await page.getByLabel("惯性矩 Iy").fill("0.0002");
      await page.getByLabel("惯性矩 Iz").fill("0.0001");
      await page.getByLabel("扭转常数 J").fill("0.00015");
      await page.getByRole("button", { name: "保存材料与截面", exact: true }).click();
      await page.getByRole("button", { name: "创建杆件", exact: true }).click();
      await page.getByRole("button", { name: "添加杆件", exact: true }).click();
      await page.getByRole("toolbar", { name: "建模工具" }).getByRole("button", { name: "支座", exact: true }).click();
      await page.getByRole("button", { name: "添加支座", exact: true }).click();
      await page.getByRole("button", { name: "荷载", exact: true }).click(); await page.getByRole("menuitem", { name: "创建荷载", exact: true }).click();
      await page.getByRole("dialog", { name: "创建节点集中荷载" }).getByLabel("FY", { exact: true }).fill("6");
      await page.getByRole("button", { name: "添加节点荷载", exact: true }).click();
      await page.getByRole("button", { name: "运行分析", exact: true }).click();
      await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
      const saved = await save(page, projectPath);
      expect(saved.analysisResults).toHaveLength(1);
      // Independent Euler-Bernoulli cantilever: Fy L^3 / (3 E Iz) = 0.0064 m.
      expect(saved.analysisResults[0].nodes[1].displacement.y).toBeCloseTo(0.0064, 10);
      expect(saved.analysisResults[0].nodes[0].reaction.y).toBeCloseTo(-6, 10);
      await page.getByLabel("AI 消息草稿").fill("读取当前模型");
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await expect(page.getByTestId("ai-turn-status").last()).toContainText("失败");
      expect((await save(page, projectPath)).analysisResults).toEqual(saved.analysisResults);
      await page.getByRole("button", { name: "工程计算书", exact: true }).click();
      const reportDialog = page.getByRole("dialog", { name: "工程计算书", exact: true });
      await reportDialog.getByRole("button", { name: "导出 Word", exact: true }).click();
      await expect(page.locator('footer[role="status"]')).toContainText("已导出 Word 计算书");
      await reportDialog.getByRole("button", { name: "导出 PDF", exact: true }).click();
      await expect(page.locator('footer[role="status"]')).toContainText("已导出 PDF 计算书");
      const word = await readFile(wordPath); const pdf = await readFile(pdfPath);
      const xml = await (await JSZip.loadAsync(word)).file("word/document.xml")!.async("string");
      expect(xml).toContain(saved.analysisResults[0].id);
      expect(xml).toContain("0.0064");
      expect(xml).not.toContain("sk-t34-");
      expect(await PDFDocument.load(pdf).then((doc) => doc.getPageCount())).toBeGreaterThan(0);
      expect(JSON.stringify(saved)).not.toContain("sk-t34-");
      await reportDialog.getByRole("button", { name: "关闭", exact: true }).last().click();
      await page.screenshot({ path: join(output, "light.png") });
      await app!.close(); app = undefined;
      page = await launch();
      await expect(page.locator(":root")).toHaveCSS("color-scheme", "light");
      await page.keyboard.press("Control+o");
      await expect(page.locator('footer[role="status"]')).toContainText("已打开");
      const reopened = await save(page, projectPath);
      expect(reopened.nodes).toEqual(saved.nodes);
      expect(reopened.analysisResults).toEqual(saved.analysisResults);
      await expect(page.getByTestId("ai-turn-status")).toHaveCount(0);
      await page.getByRole("button", { name: "设置", exact: true }).click();
      const reloadedSettings = page.getByRole("dialog", { name: "设置", exact: true });
      if (mode === "disconnected") await expect(reloadedSettings.getByRole("button", { name: "测试连接", exact: true })).toBeEnabled();
      else await expect(reloadedSettings.getByRole("button", { name: "测试连接", exact: true })).toBeDisabled();
      await expect(reloadedSettings.getByLabel("DeepSeek API Key")).toHaveValue("");
      await page.getByRole("button", { name: "深色", exact: true }).click();
      await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: "关闭", exact: true }).click();
      await page.screenshot({ path: join(output, "dark.png") });
      for (const [name, bytes] of [["工程.framemind", Buffer.from(JSON.stringify(saved, null, 2))], ["计算书.docx", word], ["计算书.pdf", pdf]] as const) {
        await writeFile(join(output, name), bytes);
      }
      report.artifacts = Object.fromEntries(await Promise.all(["工程.framemind", "计算书.docx", "计算书.pdf", "light.png", "dark.png"].map(async (name) => [name, createHash("sha256").update(await readFile(join(output, name))).digest("hex")])));
      report.outcome = "passed";
    } catch (error) {
      report.outcome = "failed";
      throw error;
    } finally {
      report.finishedAt = new Date().toISOString();
      await writeFile(join(output, "validation.json"), JSON.stringify(report, null, 2) + "\n");
      await app?.close();
      if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup path");
      await rm(directory, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}

test("T34 installed: cancels a real large-model Worker and recovers with unchanged saved input", async () => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t34-cancel-"));
  const path = join(directory, "取消恢复.framemind");
  const model = createPerformanceModel(PERFORMANCE_MODELS[2]);
  await writeFile(path, encodeProject(model));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const recordPath = "docs/evidence/T34/cancellation.json";
  const record: Record<string, unknown> = { runId: randomUUID(), startedAt: new Date().toISOString(), outcome: "running",
    executablePath, members: model.members.length, worker: "real bundled Worker" };
  await mkdir("docs/evidence/T34", { recursive: true });
  await writeFile(recordPath, JSON.stringify(record, null, 2) + "\n");
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ executablePath, args: [], cwd: directory, env });
    const appPath = await app.evaluate(({ app }) => app.getAppPath());
    record.archiveSHA256 = createHash("sha256").update(await readFile(appPath)).digest("hex");
    const page = await app.firstWindow();
    await page.context().setOffline(true);
    await page.getByRole("button", { name: "文件", exact: true }).click();
    await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("已打开");
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await page.getByRole("button", { name: "取消计算", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析已取消");
    expect((await save(page, path)).analysisResults).toHaveLength(0);
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成", { timeout: 30_000 });
    const saved = await save(page, path);
    expect(saved.members).toEqual(model.members);
    expect(saved.analysisResults).toHaveLength(1);
    record.outcome = "passed"; record.resultsAfterCancellation = 0; record.resultsAfterRetry = 1;
  } catch (error) {
    record.outcome = "failed";
    throw error;
  } finally {
    record.finishedAt = new Date().toISOString();
    await writeFile(recordPath, JSON.stringify(record, null, 2) + "\n");
    await app?.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup path");
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});
