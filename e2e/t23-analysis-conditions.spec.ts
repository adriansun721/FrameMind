import { openProposalView, closeProposalDrawer, proposalDrawer } from "./proposal-drawer-actions";
import { expect, test, type ElectronApplication } from "@playwright/test";
import { desktop, parameters, replay, save, send } from "./frame-proposal-actions";
import { createNode } from "./modeling-actions";

async function workflowReplay(app: ElectronApplication, supports = true) {
  await app.evaluate((_electron, fixture) => {
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const prompt = request.messages.at(-1).content;
      const name = prompt.includes("建模阶段已确认") || prompt.includes("条件") ? "propose_analysis_conditions" : "propose_frame";
      const args = name === "propose_frame" ? { parameters: fixture.parameters } : {
        supports: fixture.supports ? [1, 2, 3, 4].map((n) => ({ nodeId: `node_${String(n).padStart(4, "0")}`, restraints: [true, true, true, true, true, true], source: "suggestion" })) : [],
        nodalLoads: [{ nodeId: "node_0012", loadCaseId: "LC1", force: { x: 5, y: -2, z: -10 }, moment: { x: 1, y: 2, z: -3 }, source: "user" }],
      };
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null,
        tool_calls: [{ id: "t23-stage", type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] }));
    };
  }, { parameters, supports });
}

test("T23 continues a requested computation after two reviewed stages, and previews every later condition change", async () => {
  await desktop(async (app, page, path) => {
    await workflowReplay(app);
    await closeProposalDrawer(page);
    await send(page, "建立两层空间钢刚架并进行计算");
    await page.getByRole("button", { name: "确认建模", exact: true }).click();
    const card = page.getByRole("region", { name: "分析条件卡片" });
    await expect(card).toBeVisible();
    await openProposalView(page, card, "edit");
    await expect(proposalDrawer(page).getByLabel("荷载 1 FZ (kN)", { exact: true })).toHaveValue("-10");
    await openProposalView(page, card, "edit");
    await expect(proposalDrawer(page).getByLabel("荷载 1 MZ (kN·m)", { exact: true })).toHaveValue("-3");
    await openProposalView(page, card, "edit");
    await expect(proposalDrawer(page).getByLabel("支座 1 RX", { exact: true })).toBeChecked();
    const before = await save(page, path);
    expect(before.supports).toHaveLength(0); expect(before.nodalLoads).toHaveLength(0); expect(before.analysisResults).toHaveLength(0);
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("荷载 1 FX (kN)", { exact: true }).fill("8");
    await expect(card.getByRole("button", { name: /^(确认条件|确认并计算)$/ })).toBeDisabled();
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByRole("button", { name: "更新预览", exact: true }).click();
    for (const theme of ["dark", "light"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "设置", exact: true });
      await dialog.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      for (const width of [1440, 1080]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 900), width);
        await page.getByRole("button", { name: "适合模型", exact: true }).click();
        await card.getByRole("button", { name: /^(确认条件|确认并计算)$/ }).scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth)).toBe(true);
        await page.screenshot({ path: `docs/evidence/T23-${theme}-${width}.png` });
      }
    }
    await card.getByRole("button", { name: /^(确认条件|确认并计算)$/ }).dblclick();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已完成 · 本地分析完成");
    const computed = await save(page, path);
    expect(computed.supports).toHaveLength(4); expect(computed.nodalLoads).toHaveLength(1); expect(computed.analysisResults).toHaveLength(1);
    expect(computed.nodalLoads[0].force.x).toBe(8);
    expect(computed.analysisResults[0].input.nodalLoads[0].force.x).toBe(8);
    await expect(page.getByRole("region", { name: "对象属性" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "变形图", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.screenshot({ path: "docs/evidence/T23-result.png" });
    const update = { supports: [], nodalLoads: [{ ...computed.nodalLoads[0], label: undefined, force: { x: 16, y: -2, z: -10 }, source: "user" }] };
    await closeProposalDrawer(page);
    await replay(app, update, "propose_analysis_conditions"); await send(page, "修改节点荷载条件并计算");
    expect((await save(page, path)).nodalLoads[0].force.x).toBe(8);
    await closeProposalDrawer(page);
    await card.getByRole("button", { name: /^(确认条件|确认并计算)$/ }).click();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已完成 · 本地分析完成");
    const recomputed = await save(page, path);
    expect(recomputed.nodalLoads).toHaveLength(1); expect(recomputed.nodalLoads[0].force.x).toBe(16); expect(recomputed.analysisResults).toHaveLength(2);
    // Completed analyses remain provenance records; one undo restores the entire conditions edit.
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    const undone = await save(page, path);
    expect(undone.nodalLoads[0].force.x).toBe(8);
    expect(undone.analysisResults).toHaveLength(2);
  });
});

test("T23 honours revoking a queued computation and cannot solve from a plain assistant reply or unrequested tool", async () => {
  await desktop(async (app, page, path) => {
    await closeProposalDrawer(page);
    await replay(app, parameters); await send(page, "建立两层刚架，只准备建模");
    await page.getByRole("button", { name: "确认建模", exact: true }).click();
    await app.evaluate(() => {
      const fixture = globalThis as typeof globalThis & { releaseT23?: () => void };
      globalThis.fetch = async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        if (request.messages.at(-1).role === "tool") return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "本地请求已准备。" } }] }));
        await new Promise<void>((resolve) => { fixture.releaseT23 = resolve; });
        return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null,
          tool_calls: [{ id: "t23-request", type: "function", function: { name: "request_analysis", arguments: "{}" } }] } }] }));
      };
    });
    await page.getByLabel("AI 消息草稿").fill("请计算当前模型");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.getByRole("button", { name: "取消后续计算", exact: true }).click();
    await app.evaluate(() => (globalThis as typeof globalThis & { releaseT23?: () => void }).releaseT23!());
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已完成");
    await expect(page.getByRole("button", { name: "取消本地计算", exact: true })).toHaveCount(0);
    expect((await save(page, path)).analysisResults).toHaveLength(0);
    await closeProposalDrawer(page);
    await replay(app, {}, "request_analysis"); await send(page, "请分析计算失败的原因");
    expect((await save(page, path)).analysisResults).toHaveLength(0);
    // A completed text response after geometry confirmation must not bypass a missing conditions stage.
    await app.evaluate(() => { globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "还需要支座与节点荷载条件。" } }] })); });
    await closeProposalDrawer(page);
    await send(page, "请计算当前模型");
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("AI 回复已接收");
    expect((await save(page, path)).analysisResults).toHaveLength(0);
    await page.getByRole("button", { name: "取消后续计算", exact: true }).click();
  });
});

test("T23 selects the reviewed existing load case for continuation and honours natural-language cancellation before confirmation", async () => {
  await desktop(async (app, page, path) => {
    await page.getByRole("button", { name: "管理工况", exact: true }).click();
    const manager = page.getByRole("dialog", { name: "荷载工况管理" });
    await manager.getByRole("button", { name: "新建工况", exact: true }).click();
    await manager.getByLabel("工况名称").fill("第二工况");
    await manager.getByRole("button", { name: "创建工况", exact: true }).click();
    await manager.getByRole("button", { name: "关闭工况管理", exact: true }).click();
    await page.getByLabel("当前工况", { exact: true }).selectOption("LC1");
    await closeProposalDrawer(page);
    await workflowReplay(app); await send(page, "建立两层刚架并进行计算");
    await page.getByRole("button", { name: "确认建模", exact: true }).click();
    const card = page.getByRole("region", { name: "分析条件卡片" });
    await expect(card).toBeVisible();
    // The earlier request is explicitly revoked in the next natural-language supplement.
    await replay(app, { supports: [1, 2, 3, 4].map((n) => ({ nodeId: `node_${String(n).padStart(4, "0")}`, restraints: [true, true, true, true, true, true], source: "user" })),
      nodalLoads: [{ nodeId: "node_0012", loadCaseId: "LC2", force: { x: 8, y: 0, z: 0 }, moment: { x: 0, y: 0, z: 0 }, source: "user" }], analysisSourceId: "LC2" }, "propose_analysis_conditions");
    await closeProposalDrawer(page);
    await send(page, "不计算，只补齐支座条件和第二工况的荷载");
    await openProposalView(page, card, "edit");
    await expect(proposalDrawer(page).getByLabel("确认后计算来源", { exact: true })).toHaveValue("LC2");
    await expect(page.getByLabel("当前工况", { exact: true })).toHaveValue("LC1");
    await closeProposalDrawer(page);
    await card.getByRole("button", { name: /^(确认条件|确认并计算)$/ }).click();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已应用 · 分析条件阶段已应用");
    const confirmed = await save(page, path);
    expect(confirmed.activeLoadCaseId).toBe("LC2"); expect(confirmed.analysisResults).toHaveLength(0);
    await replay(app, { supports: [], nodalLoads: [], analysisSourceId: "LC2" }, "propose_analysis_conditions");
    await closeProposalDrawer(page);
    await send(page, "请对当前模型进行分析");
    await closeProposalDrawer(page);
    await card.getByRole("button", { name: /^(确认条件|确认并计算)$/ }).click();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已完成 · 本地分析完成");
    const solved = await save(page, path);
    expect(solved.analysisResults[0].input.loadCase.id).toBe("LC2");
    expect(solved.analysisResults[0].input.nodalLoads[0].force.x).toBe(8);
    expect(solved.activeLoadCaseId).toBe("LC2");
  });
});

test("T23 reports model-check and solve failures, retains confirmed work, and refreshes compatible conditions", async () => {
  await desktop(async (app, page, path) => {
    await closeProposalDrawer(page);
    await workflowReplay(app, false); await send(page, "建立两层刚架并计算");
    await page.getByRole("button", { name: "确认建模", exact: true }).click();
    const card = page.getByRole("region", { name: "分析条件卡片" });
    await expect(card).toBeVisible();
    await createNode(page, ["20", "0", "0"]);
    await expect(card.getByRole("button", { name: /^(确认条件|确认并计算)$/ })).toBeEnabled();
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await openProposalView(page, card, "actions");
    await proposalDrawer(page).getByRole("button", { name: "重新生成条件预览", exact: true }).click();
    await closeProposalDrawer(page);
    await card.getByRole("button", { name: /^(确认条件|确认并计算)$/ }).click();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("失败 · 模型检查失败");
    const applied = await save(page, path);
    expect(applied.nodes).toHaveLength(13); expect(applied.nodalLoads).toHaveLength(1); expect(applied.analysisResults).toHaveLength(0);
    // A single restrained DOF passes the restraint presence check but leaves a mechanism.
    await replay(app, { supports: [{ nodeId: "node_0001", restraints: [true, false, false, false, false, false], source: "user" }], nodalLoads: [] }, "propose_analysis_conditions");
    await closeProposalDrawer(page);
    await send(page, "设置支座条件并计算");
    // Remove the disconnected manual node before refreshing the stage.
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await openProposalView(page, card, "actions");
    await proposalDrawer(page).getByRole("button", { name: "重新生成条件预览", exact: true }).click();
    await closeProposalDrawer(page);
    await card.getByRole("button", { name: /^(确认条件|确认并计算)$/ }).click();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("失败 · 方程求解失败");
    expect((await save(page, path)).supports).toHaveLength(1);
  });
});

test("T23 cancels a pending local analysis in the conversation and keeps confirmed model changes", async () => {
  await desktop(async (app, page, path) => {
    await page.evaluate(() => {
      class PendingWorker { onmessage = null; onerror = null; postMessage() {} terminate() {} }
      Object.defineProperty(window, "Worker", { configurable: true, writable: true, value: PendingWorker });
    });
    await closeProposalDrawer(page);
    await workflowReplay(app); await send(page, "建立两层空间钢刚架并计算");
    await page.getByRole("button", { name: "确认建模", exact: true }).click();
    await page.getByRole("button", { name: /^(确认条件|确认并计算)$/ }).click();
    await page.getByRole("button", { name: "取消本地计算", exact: true }).click();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已取消 · 本地分析已取消");
    const saved = await save(page, path);
    expect(saved.supports).toHaveLength(4); expect(saved.nodalLoads).toHaveLength(1); expect(saved.analysisResults).toHaveLength(0);
    await page.getByRole("button", { name: "继续本地计算", exact: true }).click();
    await expect(page.getByRole("button", { name: "取消本地计算", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "取消本地计算", exact: true }).click();
    expect((await save(page, path)).nodalLoads).toHaveLength(1);
    await replay(app, { supports: [], nodalLoads: [] }, "propose_analysis_conditions");
    await closeProposalDrawer(page);
    await send(page, "准备条件，但不要计算");
    await openProposalView(page, page.getByRole("region", { name: "分析条件卡片" }), "actions");
    await proposalDrawer(page).getByRole("button", { name: "拒绝条件方案", exact: true }).click();
    expect((await save(page, path)).supports).toHaveLength(4);
  });
});
