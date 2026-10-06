import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { secondOrderColumn } from "../src/validation/second-order-fixtures";
import { enterWorkbenchWithoutRecovery } from "./electron-app";
import { save } from "./frame-proposal-actions";
import { decodeProject } from "../src/domain/project-file";

test("T2-31 manual native second-order case, identical linear curves, real process, themes and reopening", async () => {
  test.setTimeout(150000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t231-")), path = join(directory, "second-order.framemind");
  const original = secondOrderColumn();
  await writeFile(path, JSON.stringify({ ...original, analysisCases: [], activeAnalysisCaseId: undefined, nextAnalysisCaseNumber: 1 }));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const evidence = "docs/evidence/plan2/T2-31"; await mkdir(evidence, { recursive: true });
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page);
    const open = async () => { await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click(); };
    await open(); await page.getByRole("button", { name: "管理分析工况", exact: true }).click();
    const manager = page.getByRole("dialog", { name: "分析工况管理", exact: true });
    await manager.getByLabel("分析工况名称", { exact: true }).fill("同条件二阶响应");
    await manager.getByLabel("分析方法", { exact: true }).selectOption("second-order");
    await expect(manager).toContainText("初应力弹性二阶近似");
    await manager.getByLabel("二阶加载步数", { exact: true }).fill("3");
    await manager.getByRole("button", { name: "创建分析工况", exact: true }).click();
    await expect(manager.getByRole("listitem")).toContainText("弹性二阶");
    await manager.getByRole("button", { name: "计算此分析工况", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("弹性二阶已收敛", { timeout: 30000 });
    const panel = page.getByTestId("second-order-results");
    await expect(panel).toContainText("比较基础相同");
    await expect(panel.getByRole("img")).toBeVisible();
    await panel.getByText("节点位移与差值", { exact: true }).click();
    await expect(panel.getByRole("table", { name: "二阶与线性节点比较", exact: true })).toContainText("2.191");
    await panel.getByText("所选杆端内力与差值", { exact: true }).click();
    await expect(panel.getByRole("table", { name: "二阶与线性杆端比较", exact: true })).toContainText("Mz");
    await panel.getByText("真实加载／迭代与细分过程", { exact: true }).click();
    await expect(panel.getByRole("table", { name: "二阶真实迭代记录", exact: true })).toContainText("0.333");
    const saved = await save(page, path);
    expect(saved.latestAnalysis!.secondOrder!.runs.at(-1)!.calculation.iterations.at(-1)!.step).toBe(3);
    expect(saved.latestAnalysis!.nodes[1].displacement.y).toBeGreaterThan(.0005);
    expect(saved.nodes).toHaveLength(2); expect(saved.members).toHaveLength(1);
    await page.getByRole("separator", { name: "调整属性面板高度" }).focus(); await page.getByRole("separator", { name: "调整属性面板高度" }).press("End");
    for (const detail of ["节点位移与差值", "所选杆端内力与差值", "真实加载／迭代与细分过程"]) await panel.getByText(detail, { exact: true }).click();
    for (const theme of ["light", "dark"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click(); await page.getByRole("button", { name: theme === "light" ? "浅色" : "深色", exact: true }).click();
      await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: /关闭/ }).click();
      for (const width of [1080, 1440]) { await page.setViewportSize({ width, height: 900 }); await panel.getByRole("img").scrollIntoViewIfNeeded(); await page.screenshot({ path: join(evidence, `second-order-${theme}-${width}.png`) }); }
    }
    await app.close(); app = await electron.launch({ args: ["."], env }); page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await open();
    await page.getByRole("button", { name: "查看分析结果", exact: true }).click();
    await expect(page.getByTestId("second-order-results")).toContainText("已收敛");
    const reopened = decodeProject(await readFile(path, "utf8"));
    expect(reopened.latestAnalysis!.secondOrder).toEqual(saved.latestAnalysis!.secondOrder);
    await writeFile(join(evidence, "desktop.json"), JSON.stringify({ passed: true, native: reopened.latestAnalysis!.input.solver!.implementation, selectedDivisions: reopened.latestAnalysis!.secondOrder!.selectedDivisions, sameInputLinearRun: true, trueIterations: true, themes: ["light", "dark"], widths: [1080, 1440], reopened: true }, null, 2));
  } finally { await app.close(); }
});

test("T2-31 iteration and mesh nonconvergence fail without replacing converged history", async () => {
  test.setTimeout(90000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t231-fail-")), path = join(directory, "failure.framemind");
  await writeFile(path, JSON.stringify(secondOrderColumn()));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path }; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page);
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await page.getByRole("button", { name: "运行分析", exact: true }).click(); await expect(page.getByTestId("second-order-results")).toContainText("已收敛", { timeout: 30000 });
    const saved = await save(page, path), oldId = saved.latestAnalysis!.id;
    for (const limit of ["iteration", "mesh"]) {
      await page.getByRole("button", { name: "管理分析工况", exact: true }).click(); const manager = page.getByRole("dialog", { name: "分析工况管理", exact: true });
      await manager.getByLabel("二阶每步迭代上限").fill(limit === "iteration" ? "1" : "20");
      await manager.getByLabel("二阶每杆最大单元").selectOption(limit === "iteration" ? "16" : "1");
      await manager.getByRole("button", { name: "保存分析工况", exact: true }).click(); await manager.getByRole("button", { name: "计算此分析工况", exact: true }).click();
      await expect(page.getByRole("region", { name: "分析诊断", exact: true })).toContainText(limit === "iteration" ? "iteration limit" : "did not converge", { timeout: 30000 });
      await expect(page.getByRole("region", { name: "分析诊断", exact: true })).toContainText("失败前真实加载记录");
      const failed = await save(page, path); expect(failed.latestAnalysis!.id).toBe(oldId); expect(failed.analysisResults).toHaveLength(1);
      await page.getByRole("button", { name: "关闭分析诊断", exact: true }).click();
    }
  } finally { await app.close(); }
});
