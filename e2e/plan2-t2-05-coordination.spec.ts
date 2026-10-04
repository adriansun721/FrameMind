import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { desktop, replay, save, send } from "./frame-proposal-actions";
import { createNode } from "./modeling-actions";
import { columns } from "../src/workspace/section-stage.fixture";
import { encodeProject } from "../src/domain/project-file";
import { addLoadCase } from "../src/domain/project";
import { openProposalView, proposalDrawer } from "./proposal-drawer-actions";

async function openExample(page: Page, path: string) {
  const project = addLoadCase(columns(), "浏览工况");
  await writeFile(path, encodeProject(project), "utf8");
  await page.keyboard.press("Control+o");
  await expect(page.locator('footer[role="status"]')).toContainText("已打开");
  return project;
}
async function pending(app: ElectronApplication, tool = "propose_section_change", args: unknown = { sectionId: "section_0002", source: "user" }) {
  await app.evaluate((_electron, fixture) => {
    globalThis.fetch = () => new Promise<Response>((resolve) => {
      (globalThis as typeof globalThis & { releaseT205?: () => void }).releaseT205 = () => resolve(new Response(JSON.stringify({ choices: [{ message: {
        role: "assistant", content: null, tool_calls: [{ id: "t205-tool", type: "function", function: { name: fixture.tool, arguments: JSON.stringify(fixture.args) } }],
      } }] })));
    });
  }, { tool, args });
}
async function release(app: ElectronApplication) {
  await app.evaluate(() => (globalThis as typeof globalThis & { releaseT205?: () => void }).releaseT205?.());
}
async function start(page: Page, prompt: string) {
  await page.getByLabel("AI 消息草稿").fill(prompt);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByRole("button", { name: "取消对话", exact: true })).toBeVisible();
}
async function editNode(page: Page, axis: string, value: string) {
  await page.getByRole("region", { name: "项目树" }).getByText("N2", { exact: true }).click();
  const properties = page.getByRole("region", { name: "对象属性" });
  await properties.getByLabel(`${axis} 坐标`).fill(value);
  await properties.getByRole("button", { name: "保存节点属性" }).click();
}

test("T2-05 binds send-time targets across selection, camera and source browsing", async () => {
  await desktop(async (app, page, path) => {
    const baseline = await openExample(page, path); await pending(app);
    await page.getByLabel("选择杆件 M1", { exact: true }).check();
    await start(page, "把这些柱改为加大截面");
    await page.getByLabel("选择杆件 M1", { exact: true }).uncheck();
    await page.getByLabel("选择杆件 M2", { exact: true }).check();
    await page.getByLabel("当前工况", { exact: true }).selectOption("LC2");
    await page.getByRole("button", { name: "适合模型", exact: true }).click();
    await expect(page.getByRole("button", { name: "取消对话", exact: true })).toBeVisible();
    await release(app);
    const card = page.getByRole("region", { name: "选柱截面修改方案" });
    await expect(card).toContainText("M1");
    await expect(card.getByRole("button", { name: "确认修改", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "定位任务目标", exact: true }).click();
    await expect(page.getByLabel("选择杆件 M1", { exact: true })).toBeChecked();
    await expect(page.getByLabel("选择杆件 M2", { exact: true })).not.toBeChecked();
    await mkdir("docs/evidence/plan2/T2-05", { recursive: true });
    const canvasChecks: { theme: string; width: number; height: number; colors: number }[] = [];
    for (const [theme, width, height] of [["dark", 1440, 900], ["light", 1080, 760]] as const) {
      await page.setViewportSize({ width, height });
      await page.getByRole("button", { name: "设置", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "设置", exact: true });
      await settings.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
      await settings.getByRole("button", { name: "关闭", exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const png = await page.locator(".viewport canvas").screenshot();
      const colors = await app.evaluate(({ nativeImage }, encoded) => {
        const bitmap = nativeImage.createFromBuffer(Buffer.from(encoded, "base64")).toBitmap();
        const colors = new Set<string>();
        for (let index = 0; index < bitmap.length; index += 16) colors.add(`${bitmap[index]},${bitmap[index + 1]},${bitmap[index + 2]}`);
        return colors.size;
      }, png.toString("base64"));
      expect(colors).toBeGreaterThan(12);
      canvasChecks.push({ theme, width, height, colors });
      await page.screenshot({ path: `docs/evidence/plan2/T2-05/targets-${theme}-${width}.png` });
    }
    await card.getByRole("button", { name: "确认修改", exact: true }).click();
    const applied = await save(page, path);
    expect(applied.members.map((member: { sectionId: string }) => member.sectionId)).toEqual(["section_0002", "section_0001"]);
    await writeFile("docs/evidence/plan2/T2-05/stable-targets.json", JSON.stringify({ baseline, submittedTargets: ["member_0001"], canvasChecks, applied }, null, 2) + "\n");
  });
});

test("T2-05 rebases compatible edits and requires a fresh review for the conflicting component", async () => {
  await desktop(async (app, page, path) => {
    await openExample(page, path);
    await replay(app, { operations: [{ type: "update_node", id: "node_0002", position: { x: 1 } }] }, "propose_model_edits");
    await send(page, "把 N2 的 X 改为1");
    const card = page.getByRole("region", { name: "基础编辑草案" });
    await editNode(page, "Y", "2");
    await expect(card.getByRole("button", { name: "确认编辑", exact: true })).toBeEnabled();
    await card.getByRole("button", { name: "确认编辑", exact: true }).click();
    expect((await save(page, path)).nodes[1].position).toEqual({ x: 1, y: 2, z: 4 });
    await replay(app, { operations: [{ type: "update_node", id: "node_0002", position: { x: 2 } }] }, "propose_model_edits");
    await send(page, "把 N2 的 X 改为2");
    await editNode(page, "X", "3");
    await expect(page.getByRole("alert")).toContainText("node_0002.position.x");
    await expect(card.getByRole("button", { name: "确认编辑", exact: true })).toBeDisabled();
    expect((await save(page, path)).nodes[1].position.x).toBe(3);
    await page.screenshot({ path: "docs/evidence/plan2/T2-05/component-conflict.png" });
    await page.getByRole("button", { name: "以当前工程重新核对草案", exact: true }).click();
    await expect(card).toContainText('"x":3');
    await expect(card).toContainText('"x":2');
    await card.getByRole("button", { name: "确认编辑", exact: true }).click();
    expect((await save(page, path)).nodes[1].position).toEqual({ x: 2, y: 2, z: 4 });
  });
});

test("T2-05 pauses a deleted target without retargeting the section draft", async () => {
  await desktop(async (app, page, path) => {
    await openExample(page, path);
    await page.getByLabel("选择杆件 M1", { exact: true }).check();
    await replay(app, { sectionId: "section_0002", source: "user" }, "propose_section_change");
    await send(page, "把这些柱改为加大截面");
    await page.getByRole("group", { name: "选中杆件操作" }).getByRole("button", { name: "删除选中", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("member_0001");
    await expect(page.getByRole("region", { name: "选柱截面修改方案" }).getByRole("button", { name: "确认修改", exact: true })).toBeDisabled();
    expect((await save(page, path)).members.map((member: { id: string }) => member.id)).toEqual(["member_0002"]);
  });
});

test("T2-05 discards the old pending operation and prepares against the latest model", async () => {
  await desktop(async (app, page, path) => {
    await openExample(page, path);
    await pending(app, "propose_model_edits", { operations: [{ type: "update_node", id: "node_0002", position: { x: 999 } }] });
    await start(page, "把 N2 的 X 改为1");
    await createNode(page, ["8", "8", "8"]);
    await replay(app, { operations: [{ type: "update_node", id: "node_0002", position: { x: 1 } }] }, "propose_model_edits");
    await release(app);
    const card = page.getByRole("region", { name: "基础编辑草案" });
    await expect(card).toBeVisible();
    await expect(card).not.toContainText("999");
    await card.getByRole("button", { name: "确认编辑", exact: true }).click();
    const applied = await save(page, path);
    expect(applied.nodes).toHaveLength(5); expect(applied.nodes[1].position.x).toBe(1);
  });
});

test("T2-05 isolates a response after opening the project again", async () => {
  await desktop(async (app, page, path) => {
    await openExample(page, path); await pending(app);
    await page.getByLabel("选择杆件 M1", { exact: true }).check();
    await start(page, "把这些柱改为加大截面");
    await page.keyboard.press("Control+o");
    await expect(page.getByRole("button", { name: "取消对话", exact: true })).toHaveCount(0);
    await replay(app, { collection: "summary" }, "read_model");
    await send(page, "读取重开后的工程");
    await release(app);
    await expect(page.getByRole("region", { name: "选柱截面修改方案" })).toHaveCount(0);
    expect((await save(page, path)).members.map((member: { sectionId: string }) => member.sectionId)).toEqual(["section_0001", "section_0001"]);
  });
});

test("T2-05 continues the requested calculation on its bound source and preserves frozen history", async () => {
  await desktop(async (app, page, path) => {
    await openExample(page, path);
    await page.getByLabel("选择杆件 M1", { exact: true }).check();
    await replay(app, { sectionId: "section_0002", source: "user" }, "propose_section_change");
    await send(page, "把这些柱改为加大截面，然后重算");
    await page.getByLabel("当前工况", { exact: true }).selectOption("LC2");
    await page.getByRole("region", { name: "选柱截面修改方案" }).getByRole("button", { name: "确认并重算", exact: true }).click();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("本地分析完成");
    const applied = await save(page, path);
    expect(applied.analysisResults).toHaveLength(2);
    expect(applied.analysisResults[1].input.loadCase.id).toBe("LC1");
    expect(applied.analysisResults[0].input.members[0].sectionId).toBe("section_0001");
    expect(applied.analysisResults[1].input.members[0].sectionId).toBe("section_0002");
    expect(applied.activeLoadCaseId).toBe("LC1");
  });
});

test("T2-05 preserves a compatible manual load edit while its condition editor is dirty", async () => {
  await desktop(async (app, page, path) => {
    const base = await openExample(page, path);
    const load = base.nodalLoads[0];
    await replay(app, { supports: [], nodalLoads: [{ id: load.id, nodeId: load.nodeId, loadCaseId: "LC1", force: { x: 10, y: 0, z: 0 }, moment: load.moment, source: "user" }] }, "propose_analysis_conditions");
    await send(page, "把荷载 P1 的 FX 改为10");
    const card = page.getByRole("region", { name: "分析条件卡片" });
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("荷载 1 FX (kN)", { exact: true }).fill("11");
    await page.getByRole("region", { name: "项目树" }).getByRole("button", { name: `${load.label} · ${base.nodes.find((node: { id: string }) => node.id === load.nodeId).label}`, exact: true }).click();
    const properties = page.getByRole("region", { name: "对象属性" });
    await properties.getByLabel("FY", { exact: true }).fill("7");
    await properties.getByLabel("FY", { exact: true }).press("Enter");
    await proposalDrawer(page).getByRole("button", { name: "更新预览", exact: true }).click();
    await expect(card.getByRole("button", { name: "确认条件", exact: true })).toBeEnabled();
    await card.getByRole("button", { name: "确认条件", exact: true }).click();
    expect((await save(page, path)).nodalLoads[0].force).toEqual({ x: 11, y: 7, z: 0 });
  });
});
