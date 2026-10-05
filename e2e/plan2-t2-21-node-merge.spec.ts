import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { nodeMergeFixture, nodeMergeInput } from "../src/validation/node-merge-fixtures";
import { decodeProject } from "../src/domain/project-file";
import { enterWorkbenchWithoutRecovery } from "./electron-app";
import { desktop, save, send } from "./frame-proposal-actions";

async function fileAction(page: Page, action: string) {
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(action) }).click();
}
test("T2-21 manual conflict review, atomic undo, native solve and restart", async () => {
  test.setTimeout(120000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t221-")); const path = join(directory, "merge.framemind");
  const project = nodeMergeFixture(true); await writeFile(path, JSON.stringify(project));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  let app = await electron.launch({ args: ["."], env });
  const evidence = "docs/evidence/plan2/T2-21"; await mkdir(evidence, { recursive: true });
  try {
    let page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await fileAction(page, "打开项目");
    await page.getByLabel("单位预设").selectOption("mm-N");
    const dialog = page.getByRole("dialog", { name: "近重合检查与节点合并" });
    const inspect = async () => {
      await page.getByRole("button", { name: "近重合检查与节点合并", exact: true }).click();
      await dialog.getByRole("button", { name: "检查近重合", exact: true }).click();
      await expect(dialog.getByLabel("近重合检查结果")).toContainText("0.00025 mm");
      await dialog.getByRole("button", { name: /node_0002 \/ node_0003/ }).click();
      await dialog.getByRole("button", { name: "检查合并影响", exact: true }).click();
    };
    await inspect(); await dialog.getByRole("button", { name: "预览成组合并" }).click();
    await expect(dialog.getByRole("alert")).toContainText("请选择保留的支座");
    await expect(dialog.getByRole("button", { name: "确认节点合并" })).toBeDisabled();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    expect((await save(page, path)).nodes).toHaveLength(3);
    const resolveConflicts = async () => {
      await dialog.getByLabel("保留支座").selectOption("none");
      for (const id of ["load_0001", "load_0002", "member_0001"]) await dialog.getByLabel(`处理 ${id}`).selectOption("keep");
      for (const id of ["member_0002", "member_0003"]) await dialog.getByLabel(`处理 ${id}`).selectOption("remove");
      for (const id of ["uniform_load_0001", "uniform_load_0002"]) await dialog.getByLabel(`移除 ${id}`).check();
      await dialog.getByLabel("接受合并几何变化").check(); await dialog.getByRole("button", { name: "预览成组合并" }).click();
    };
    for (const theme of ["dark", "light"]) {
      if (theme === "light") { await page.getByRole("button", { name: "设置", exact: true }).click(); await page.getByRole("button", { name: "浅色", exact: true }).click(); await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: "关闭", exact: true }).click(); }
      for (const width of [1440, 1080]) {
        await page.setViewportSize({ width, height: 900 }); await inspect(); await resolveConflicts();
        await dialog.getByLabel("成组合并预览").scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(evidence, `merge-${theme}-${width}.png`) });
        await dialog.getByRole("button", { name: "取消", exact: true }).click();
      }
    }
    await inspect(); await resolveConflicts(); await dialog.getByRole("button", { name: "确认节点合并" }).click();
    await expect(page.getByTestId("viewport-node-count")).toHaveText("2 个节点"); await expect(page.getByTestId("viewport-member-count")).toHaveText("1 根杆件");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    const restored = await save(page, path);
    for (const key of ["nodes", "members", "supports", "nodalLoads", "uniformLoads"] as const) expect(restored[key]).toEqual(project[key]);
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await page.getByRole("button", { name: "运行分析", exact: true }).click(); await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    const saved = await save(page, path);
    expect(saved.latestAnalysis?.input.nodes).toEqual(saved.nodes); expect(saved.latestAnalysis?.nodes.find((n) => n.nodeId === "node_0002")?.displacement.z).toBeCloseTo(-.0045, 12);
    expect(saved.nodalLoads.map((l) => l.nodeId)).toEqual(["node_0002", "node_0002"]); expect(saved.uniformLoads).toEqual([]);
    await app.close(); app = await electron.launch({ args: ["."], env }); page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await fileAction(page, "打开项目");
    await expect(page.getByTestId("viewport-node-count")).toHaveText("2 个节点");
    const reopened = await save(page, path); expect(reopened.confirmedOperations).toEqual(saved.confirmedOperations); expect(reopened.latestAnalysis).toEqual(saved.latestAnalysis);
    await writeFile(join(evidence, "desktop.json"), JSON.stringify({ passed: true, unresolvedBlocked: true, cancelIsolated: true, undoRestoresConditions: true, units: "mm-N", nativeAnalysis: saved.latestAnalysis?.id, restartPreserved: true }, null, 2));
  } finally { await app.close(); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup path"); await rm(directory, { recursive: true, force: true }); }
});

test("T2-21 agent merge proposal exposes the shared conflict receipt before confirmation", async () => {
  await desktop(async (app, page, path) => {
    const project = nodeMergeFixture(); const input = nodeMergeInput(project);
    await writeFile(path, JSON.stringify(project)); await fileAction(page, "打开项目");
    await app.evaluate((_, input) => { globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body)); const replied = request.messages.some((m: { role: string }) => m.role === "tool");
      return new Response(JSON.stringify({ choices: [{ message: replied ? { role: "assistant", content: "请核对明确保留的荷载后确认节点合并。" } : { role: "assistant", content: null, tool_calls: [{ id: "t221-merge", type: "function", function: { name: "merge_nodes", arguments: JSON.stringify(input) } }] } }] }), { status: 200 });
    }; }, input);
    await send(page, "合并近重合节点，保留目标 N2 和两个节点荷载，先预览确认");
    const card = page.getByRole("region", { name: "基础编辑草案" });
    await expect(card.getByLabel("节点合并影响")).toContainText("移除节点 node_0003 → node_0002");
    expect((await save(page, path)).nodes).toHaveLength(3);
    await card.getByRole("button", { name: "确认编辑", exact: true }).click();
    await expect(page.getByTestId("viewport-node-count")).toHaveText("2 个节点");
    const saved = await save(page, path); expect(saved.confirmedOperations?.at(-1)?.result.data).toMatchObject({ nodeMerges: [{ targetNodeId: "node_0002", removedNodeIds: ["node_0003"] }] });
    expect(decodeProject(await readFile(path, "utf8")).nodalLoads).toEqual(saved.nodalLoads);
  });
});
