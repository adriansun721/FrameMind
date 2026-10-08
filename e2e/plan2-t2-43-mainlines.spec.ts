import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { _electron as electron } from "@playwright/test";
import { runT33 } from "../scripts/t33-workflow.cjs";
import { agentFixture } from "./agent-integration";
import { columns } from "../src/workspace/section-stage.fixture";
import { engineeringContent } from "../src/workspace/draft-coordination";
import { save } from "./frame-proposal-actions";
import { enterWorkbenchWithoutRecovery } from "./electron-app";

const evidence = "docs/evidence/plan2/T2-43";

test.setTimeout(300_000);

test("T2-43 mainline one reopens an existing project, isolates a trial, confirms one draft and resumes analysis", async () => {
  const previousOutput = process.env.FRAMEMIND_T241_OUTPUT;
  process.env.FRAMEMIND_T241_OUTPUT = `${evidence}/mainline-one-replay`;
  try {
    await agentFixture("mainline-one", { task: "T2-41", project: columns() }, async ({ page, project, path, restart, check, ask }) => {
      const operations = [{ type: "update_node", id: "node_0002", position: { x: 3.25, y: 0.5, z: 4 } }];
      const result = await ask(page,
        "先读取已有工程事实，在诊断副本中按当前 LC1 原输入做一次隔离试算；随后准备一次确认的整体草案，把 N2 移到 (3.25, 0.5, 4) m 并继续计算 LC1。不要猜参数，不要修改正式工程。",
        [
          [{ name: "read_model", input: { collection: "summary" } }],
          [{ name: "inspect_diagnostics", input: {} }, { name: "create_diagnostic_copy", input: {} }],
          [{ name: "run_diagnostic_trial", input: { label: "续作前隔离试算", sourceId: "LC1", operations: [] } }],
          [{ name: "propose_task", input: { edits: { operations, source: "user" }, analysis: { requested: true, source: "user", sourceId: "LC1" } } }],
        ],
        "已读取已有工程并完成隔离试算；整体草案已准备，等待一次确认。",
      );
      check("readAndTrial", result.records.some((record) => record.call.function.name === "read_model")
        && result.records.some((record) => record.call.function.name === "run_diagnostic_trial"));
      check("wholeDraft", result.status === "awaiting-confirmation" && result.taskDraft?.edits?.operations.length === 1);
      check("formalUnchangedBeforeConfirm", JSON.stringify(engineeringContent(await save(page, path))) === JSON.stringify(engineeringContent(project)));

      page = await restart();
      const recovery = page.getByRole("button", { name: "恢复任务", exact: true });
      await expect(recovery).toBeVisible();
      await recovery.click();
      const card = page.getByRole("region", { name: "完整任务草案", exact: true });
      await expect(card.getByRole("button", { name: "确认整体任务", exact: true })).toBeEnabled();
      await card.getByRole("button", { name: "确认整体任务", exact: true }).click();
      await expect(page.locator('footer[role="status"]')).toContainText("分析完成", { timeout: 60_000 });
      const after = await save(page, path);
      check("resumedAndSolved", after.nodes.find((node) => node.id === "node_0002")?.position.x === 3.25
        && after.analysisResults.length === project.analysisResults.length + 1);
      check("diagnosticStayedIsolated", JSON.stringify(engineeringContent(after)).includes("3.25"));
      await page.getByRole("button", { name: "工程计算书", exact: true }).click();
      const report = page.getByRole("dialog", { name: "工程计算书", exact: true });
      await report.getByRole("button", { name: "导出 Word", exact: true }).click();
      await expect(page.locator('footer[role="status"]')).toContainText("已导出 Word 计算书");
      await report.getByRole("button", { name: "导出 PDF", exact: true }).click();
      await expect(page.locator('footer[role="status"]')).toContainText("已导出 PDF 计算书");
      check("reportExport", true);
      await report.getByRole("button", { name: "关闭", exact: true }).last().click();
    });
  } finally {
    if (previousOutput === undefined) delete process.env.FRAMEMIND_T241_OUTPUT;
    else process.env.FRAMEMIND_T241_OUTPUT = previousOutput;
  }
});

test("T2-43 mainline two runs the complete desktop model-and-report demonstration in both themes", async () => {
  await runT33({ theme: "dark", evidenceRoot: `${evidence}/mainline-two-replay` });
  await runT33({ theme: "light", evidenceRoot: `${evidence}/mainline-two-replay` });
  for (const theme of ["dark", "light"]) {
    const report = JSON.parse(await readFile(`${evidence}/mainline-two-replay/replay-${theme}/validation.json`, "utf8"));
    expect(report.outcome).toBe("passed");
    expect(report.verified).toMatchObject({ wordPdfExport: true, saveReopen: true, actualResultReferences: true });
    expect(report.firstUse).toContain("Pending real participant");
  }

  // Continue the same acceptance run with the saved advanced-analysis model.
  // This keeps the advanced result panels and report source checks explicit,
  // while the individual modeling/editing seams remain covered by T2-20—36.
  const directory = await mkdtemp(join(tmpdir(), "framemind-t243-advanced-"));
  const projectPath = join(directory, "advanced.framemind");
  const wordPath = join(directory, "advanced.docx");
  const pdfPath = join(directory, "advanced.pdf");
  const source = JSON.parse(await readFile("docs/evidence/plan2/T2-36/all-methods.framemind", "utf8"));
  await writeFile(projectPath, JSON.stringify(source));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: projectPath,
    FRAMEMIND_E2E_REPORT_PATH: wordPath, FRAMEMIND_E2E_REPORT_PDF_PATH: pdfPath };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  let app;
  try {
    app = await electron.launch({ args: ["."], env });
    const page = await app.firstWindow();
    await enterWorkbenchWithoutRecovery(page);
    await page.getByRole("button", { name: "文件", exact: true }).click();
    await page.getByRole("menuitem", { name: /打开项目/ }).click();
    const selector = page.getByLabel("当前分析工况", { exact: true });
    const panels = new Map([["AC1", "second-order-results"], ["AC2", "modal-results"], ["AC4", "buckling-results"], ["AC5", "random-results"]]);
    for (const [id, panel] of panels) {
      await selector.selectOption(id);
      await expect(page.getByTestId(panel)).toBeVisible();
    }
    await selector.selectOption("AC1");
    await page.getByRole("button", { name: "工程计算书", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "工程计算书", exact: true });
    await dialog.getByRole("button", { name: "导出 Word", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("已导出 Word 计算书");
    await dialog.getByRole("button", { name: "导出 PDF", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("已导出 PDF 计算书");
    await dialog.getByRole("button", { name: "关闭", exact: true }).last().click();
    await page.keyboard.press("Control+s");
    await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    await page.screenshot({ path: resolve(evidence, "advanced-continuity.png") });
    await app.close();
    app = await electron.launch({ args: ["."], env });
    const reopened = await app.firstWindow();
    await enterWorkbenchWithoutRecovery(reopened);
    await reopened.getByRole("button", { name: "文件", exact: true }).click();
    await reopened.getByRole("menuitem", { name: /打开项目/ }).click();
    await reopened.getByLabel("当前分析工况", { exact: true }).selectOption("AC5");
    await expect(reopened.getByTestId("random-results")).toBeVisible();
    await writeFile(resolve(evidence, "advanced-continuity.json"), `${JSON.stringify({ passed: true, methods: [...panels.keys()], reportWord: true, reportPdf: true, savedAndReopenedInput: true }, null, 2)}\n`);
  } finally {
    await app?.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid temporary directory");
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});
