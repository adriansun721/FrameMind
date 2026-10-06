import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modalCantilever } from "../src/validation/modal-fixtures";
import { DEFAULT_MODAL_SETTINGS } from "../src/domain/modal";
import { enterWorkbenchWithoutRecovery } from "./electron-app";
import { desktop, replay, save, send } from "./frame-proposal-actions";
import { decodeProject } from "../src/domain/project-file";

test("T2-29 manual damping, provenance, incremental budget, invalidation and reopening", async () => {
  test.setTimeout(150000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t229-")), path = join(directory, "damping.framemind");
  await writeFile(path, JSON.stringify(modalCantilever({ ...DEFAULT_MODAL_SETTINGS, modeCount: 3 })));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const evidence = "docs/evidence/plan2/T2-29"; await mkdir(evidence, { recursive: true });
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page);
    const open = async () => { await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click(); };
    await open(); await page.getByRole("button", { name: "运行分析", exact: true }).click();
    let editor = page.getByRole("region", { name: "模态阻尼与截断", exact: true });
    await expect(editor).toContainText("请设置统一阻尼", { timeout: 30000 });
    await editor.getByRole("button", { name: "核对并保存模态阻尼", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText("阻尼比");
    const fill = async () => {
      await editor.getByLabel("统一阻尼比", { exact: true }).fill("0.02");
      await editor.getByLabel("统一阻尼依据", { exact: true }).fill("试验给定值");
      await editor.getByLabel("分析频段上限 Hz", { exact: true }).fill("1000000");
      await editor.getByLabel("增阶步长", { exact: true }).fill("2");
      await editor.getByLabel("模态数预算", { exact: true }).fill("5");
    };
    await fill(); await editor.getByRole("button", { name: "添加逐模态覆盖", exact: true }).click();
    await editor.getByLabel("覆盖阶次 1", { exact: true }).selectOption("2");
    await editor.getByLabel("覆盖 1 阻尼比", { exact: true }).fill("0.04");
    await editor.getByLabel("覆盖 1 来源", { exact: true }).selectOption("suggestion");
    await editor.getByLabel("覆盖 1 依据", { exact: true }).fill("第二阶建议，待核对");
    await editor.getByRole("button", { name: "核对并保存模态阻尼", exact: true }).click();
    await expect(editor).toContainText("阻尼已核对至该模态结果");
    await expect(editor.getByRole("table", { name: "有效模态阻尼", exact: true })).toContainText("0.04");
    await expect(editor).toContainText("频率覆盖不足");
    const before = await save(page, path), oldId = before.latestAnalysis!.id;
    await editor.getByRole("button", { name: "准备增至 5 阶", exact: true }).click();
    await expect(editor).toContainText("旧覆盖未应用");
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(editor).toContainText("新模态后重新输入", { timeout: 30000 });
    await expect(editor.getByLabel("统一阻尼比", { exact: true })).toHaveValue("");
    await fill(); await editor.getByRole("button", { name: "核对并保存模态阻尼", exact: true }).click();
    await expect(editor).toContainText("模态数预算已达"); await expect(editor).toContainText("响应精度未验证");
    const saved = await save(page, path);
    expect(saved.latestAnalysis!.id).not.toBe(oldId); expect(saved.analysisCases[0].damping!.overrides).toEqual([]);
    expect(saved.analysisCases[0].damping!.analysisId).toBe(saved.latestAnalysis!.id);
    const separator = page.getByRole("separator", { name: "调整属性面板高度" }); await separator.focus(); await separator.press("End");
    for (const theme of ["light", "dark"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page.getByRole("button", { name: theme === "light" ? "浅色" : "深色", exact: true }).click();
      await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: /关闭/ }).click();
      for (const width of [1080, 1440]) { await page.setViewportSize({ width, height: 900 }); await editor.getByRole("heading").scrollIntoViewIfNeeded(); await page.screenshot({ path: join(evidence, `damping-${theme}-${width}.png`) }); }
    }
    await app.close(); app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await open();
    await page.getByRole("button", { name: "查看分析结果", exact: true }).click();
    editor = page.getByRole("region", { name: "模态阻尼与截断", exact: true });
    await expect(editor).toContainText("阻尼已核对至该模态结果"); await expect(editor).toContainText("模态数预算已达");
    await expect(editor.getByLabel("统一阻尼比", { exact: true })).toHaveValue("0.02");
    await writeFile(join(evidence, "desktop.json"), JSON.stringify({ passed: true, priorAnalysisId: oldId, boundAnalysisId: saved.latestAnalysis!.id, returnedModes: saved.latestAnalysis!.modal!.modes.length, damping: saved.analysisCases[0].damping, reopened: true, responseAccuracy: "not-verified", themes: ["light", "dark"], widths: [1080, 1440] }, null, 2));
  } finally { await app.close(); }
});

test("T2-29 agent damping draft stays confirmable and persists its bound modal source", async () => {
  await desktop(async (app, page, path) => {
    await writeFile(path, JSON.stringify(modalCantilever({ ...DEFAULT_MODAL_SETTINGS, modeCount: 3 })));
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.getByTestId("modal-results")).toContainText("满足频率精度", { timeout: 30000 });
    const analyzed = await save(page, path);
    const properties = { uniform: { ratio: .02, source: "suggestion", basis: "AI 测试建议，须用户核对" }, overrides: [{ modeNumber: 2, value: { ratio: .04, source: "user", basis: "用户给定第二阶" } }], truncation: { upperFrequencyHz: 100, modeIncrement: 2, maxModeCount: 5 } };
    await replay(app, { operations: [{ type: "set_modal_damping", id: "AC1", analysisId: analyzed.latestAnalysis!.id, properties }] }, "propose_model_edits");
    await send(page, "准备统一及第二阶阻尼草案，先等我确认");
    const card = page.getByRole("region", { name: "基础编辑草案", exact: true });
    await card.getByText("查看逐项变化", { exact: true }).click();
    await expect(card).toContainText("suggestion"); await expect(card).toContainText(analyzed.latestAnalysis!.id);
    await expect(card.getByRole("button", { name: "确认编辑", exact: true })).toBeEnabled();
    const before = decodeProject(JSON.stringify(await save(page, path)));
    expect(before.analysisCases[0].damping).toBeUndefined();
    expect(before.taskState!.conversations.some((c) => c.modelEdits?.operations.some((o) => o.type === "set_modal_damping"))).toBe(true);
    await card.getByRole("button", { name: "确认编辑", exact: true }).click();
    const after = decodeProject(JSON.stringify(await save(page, path)));
    expect(after.analysisCases[0].damping).toMatchObject({ analysisId: analyzed.latestAnalysis!.id, ...properties });
    expect(after.confirmedOperations).toHaveLength(1);
  });
});
