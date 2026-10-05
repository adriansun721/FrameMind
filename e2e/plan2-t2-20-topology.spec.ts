import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { topologyFixture } from "../src/validation/topology-fixtures";
import { decodeProject } from "../src/domain/project-file";
import { enterWorkbenchWithoutRecovery } from "./electron-app";
import { desktop, save, send } from "./frame-proposal-actions";

async function fileAction(page: Page, action: string) {
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(action) }).click();
}
test("T2-20 manual explicit connection preview, units, undo, native analysis and restart", async () => {
  test.setTimeout(120000);
  const directory = await mkdtemp(join(tmpdir(), "framemind-t220-")); const path = join(directory, "topology.framemind");
  const project = topologyFixture(true); await writeFile(path, JSON.stringify(project));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  let app = await electron.launch({ args: ["."], env });
  const evidence = "docs/evidence/plan2/T2-20"; await mkdir(evidence, { recursive: true });
  try {
    let page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await fileAction(page, "打开项目");
    await page.getByLabel("单位预设").selectOption("mm-N");
    await page.getByRole("button", { name: "显式连接与工程分割", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "显式连接与工程分割" });
    await dialog.getByLabel("拓扑操作").selectOption("connect_members");
    await dialog.getByLabel("拓扑杆件").selectOption(["member_0001", "member_0002"]);
    await dialog.getByRole("button", { name: "预览影响" }).click();
    await expect(dialog.getByLabel("拓扑影响预览")).toContainText("node_0005");
    await expect(dialog).toContainText("uniform_load_0001 → uniform_load_0003、uniform_load_0004");
    await expect(page.getByTestId("viewport-member-count")).toHaveText("2 根杆件");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await fileAction(page, "保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    expect(decodeProject(await readFile(path, "utf8")).members).toHaveLength(2);
    // Review both themes and widths using the actual dialog.
    for (const theme of ["dark", "light"]) {
      if (theme === "light") { await page.getByRole("button", { name: "设置", exact: true }).click(); await page.getByRole("button", { name: "浅色", exact: true }).click(); await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: "关闭", exact: true }).click(); }
      for (const width of [1440, 1080]) {
        await page.setViewportSize({ width, height: 900 });
        await page.getByRole("button", { name: "显式连接与工程分割", exact: true }).click();
        await dialog.getByLabel("拓扑操作").selectOption("connect_members"); await dialog.getByLabel("拓扑杆件").selectOption(["member_0001", "member_0002"]);
        await dialog.getByRole("button", { name: "预览影响" }).click();
        await page.screenshot({ path: join(evidence, `topology-${theme}-${width}.png`) });
        await dialog.getByRole("button", { name: "取消", exact: true }).click();
      }
    }
    await page.getByRole("button", { name: "显式连接与工程分割", exact: true }).click();
    // Exercise endpoint rejection, then split at an exact numeric internal point in mm.
    await dialog.getByLabel("拓扑 X 坐标").fill("-2000"); await dialog.getByRole("button", { name: "预览影响" }).click();
    await expect(dialog.getByRole("alert")).toContainText("不能使用端点");
    await dialog.getByLabel("拓扑 X 坐标").fill("-500"); await dialog.getByRole("button", { name: "预览影响" }).click();
    await dialog.getByRole("button", { name: "确认拓扑变更" }).click();
    await expect(page.getByTestId("viewport-member-count")).toHaveText("3 根杆件");
    await page.getByRole("button", { name: "撤销", exact: true }).click(); await expect(page.getByTestId("viewport-node-count")).toHaveText("4 个节点");
    await page.getByRole("button", { name: "重做", exact: true }).click(); await expect(page.getByTestId("viewport-node-count")).toHaveText("5 个节点");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.getByRole("button", { name: "显式连接与工程分割", exact: true }).click();
    await dialog.getByLabel("拓扑操作").selectOption("connect_members"); await dialog.getByLabel("拓扑杆件").selectOption(["member_0001", "member_0002"]);
    await dialog.getByRole("button", { name: "预览影响" }).click(); await dialog.getByRole("button", { name: "确认拓扑变更" }).click();
    await expect(page.getByTestId("viewport-member-count")).toHaveText("4 根杆件");
    await page.getByRole("button", { name: "运行分析", exact: true }).click(); await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    await fileAction(page, "保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    const saved = decodeProject(await readFile(path, "utf8")); expect(saved.uniformLoads).toHaveLength(4);
    expect(saved.latestAnalysis?.input.members).toEqual(saved.members); expect(saved.supports).toEqual(project.supports);
    await app.close(); app = await electron.launch({ args: ["."], env }); page = await app.firstWindow(); await enterWorkbenchWithoutRecovery(page); await fileAction(page, "打开项目");
    await expect(page.getByTestId("viewport-member-count")).toHaveText("4 根杆件");
    await fileAction(page, "保存项目"); await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    const reopened = decodeProject(await readFile(path, "utf8")); expect(reopened.members).toEqual(saved.members); expect(reopened.nodes).toEqual(saved.nodes); expect(reopened.confirmedOperations).toEqual(saved.confirmedOperations);
    await writeFile(join(evidence, "desktop.json"), JSON.stringify({ passed: true, previewIsolated: true, units: "mm-N", undoRedo: true, nativeAnalysis: saved.latestAnalysis?.id, restartPreserved: true, nodes: saved.nodes, members: saved.members }, null, 2));
  } finally { await app.close(); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup path"); await rm(directory, { recursive: true, force: true }); }
});

test("T2-20 agent topology tool exposes the same review mapping before applying", async () => {
  await desktop(async (app, page, path) => {
    await writeFile(path, JSON.stringify(topologyFixture())); await fileAction(page, "打开项目");
    await app.evaluate(() => { globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body)); const replied = request.messages.some((m: { role: string }) => m.role === "tool");
      return new Response(JSON.stringify({ choices: [{ message: replied ? { role: "assistant", content: "请核对共享节点和杆件替换映射后确认。" } : { role: "assistant", content: null, tool_calls: [{ id: "t220-connect", type: "function", function: { name: "connect_members", arguments: JSON.stringify({ memberIds: ["member_0001", "member_0002"], position: { x: 0, y: 0, z: 0 } }) } }] } }] }), { status: 200 });
    }; });
    await send(page, "在原点显式连接 M1 和 M2，先预览工程拓扑影响");
    const card = page.getByRole("region", { name: "基础编辑草案" });
    await expect(card.getByLabel("拓扑身份映射")).toContainText("member_0001 → member_0003");
    await expect(card).toContainText("共享节点 node_0005");
    expect((await save(page, path)).members).toHaveLength(2);
    await card.getByRole("button", { name: "确认编辑", exact: true }).click();
    await expect(page.getByTestId("viewport-member-count")).toHaveText("4 根杆件");
    const saved = await save(page, path); expect(saved.confirmedOperations?.at(-1)?.result.data).toMatchObject({ topology: [{ sharedNodeId: "node_0005" }] });
  });
});
