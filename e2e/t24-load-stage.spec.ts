import { openProposalView, closeProposalDrawer, proposalDrawer } from "./proposal-drawer-actions";
import { expect, test, type ElectronApplication } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { desktop, parameters, replay, save, send } from "./frame-proposal-actions";

const loads = {
  supports: [1, 2, 3, 4].map((n) => ({ nodeId: `node_${String(n).padStart(4, "0")}`, restraints: [true, true, true, true, true, true], source: "user" })),
  nodalLoads: [{ nodeId: "node_0012", loadCaseId: "live", force: { x: 5, y: 0, z: 0 }, moment: { x: 0, y: 0, z: 0 }, source: "user" }],
  loadCases: [{ ref: "dead", id: "LC1", name: "恒载", description: "结构自重", source: "user" }, { ref: "live", name: "活载", description: "均布力及节点力", source: "user" }],
  uniformLoads: [{ memberId: "member_0005", loadCaseId: "live", coordinateSystem: "global", intensity: { x: 0, y: 0, z: -2 }, source: "suggestion" }],
  selfWeight: { enabled: true, loadCaseId: "dead", gravity: { x: 0, y: 0, z: -9.81 }, source: "suggestion" },
  loadCombinations: [{ ref: "service", name: "用户试算", terms: [{ loadCaseId: "dead", factor: 1 }, { loadCaseId: "live", factor: 1.5 }], source: "user" }],
  analysisSourceId: "service",
};
async function workflow(app: ElectronApplication) {
  await app.evaluate((_electron, fixture) => {
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const confirmed = request.messages.at(-1).content.includes("建模阶段已确认");
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "t24-stage", type: "function",
        function: { name: confirmed ? "propose_analysis_conditions" : "propose_frame", arguments: JSON.stringify(confirmed ? fixture.loads : { parameters: fixture.parameters }) } }] } }] }));
    };
  }, { parameters, loads });
}

test("T24 edits, previews and confirms a complete multi-case load stage before automatically solving its user combination", async () => {
  test.setTimeout(90000);
  await desktop(async (app, page, path) => {
    await closeProposalDrawer(page);
    await workflow(app); await send(page, "建立两层空间刚架，配置恒载自重、活载均布力和用户组合并计算");
    await page.getByRole("button", { name: "确认建模", exact: true }).click();
    const card = page.getByRole("region", { name: "分析条件卡片" });
    await openProposalView(page, card, "edit");
    await expect(proposalDrawer(page).getByLabel("均布荷载 1 Z (kN/m)", { exact: true })).toHaveValue("-2");
    await openProposalView(page, card, "edit");
    await expect(proposalDrawer(page).getByLabel("自重工况", { exact: true })).toHaveValue("dead");
    await openProposalView(page, card, "edit");
    await expect(proposalDrawer(page).getByLabel("确认后计算来源", { exact: true })).toHaveValue("service");
    const before = await save(page, path);
    expect(before.loadCases).toHaveLength(1); expect(before.uniformLoads).toHaveLength(0); expect(before.selfWeight.enabled).toBe(false);
    expect(before.loadCombinations).toHaveLength(0); expect(before.analysisResults).toHaveLength(0);
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await expect(page.getByLabel("待确认自重标记", { exact: true })).toHaveCount(0);
    await expect(card).toContainText("恒载");
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("均布荷载 1 坐标系", { exact: true }).selectOption("local");
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("均布荷载 1 Y (kN/m)", { exact: true }).fill("-3");
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("均布荷载 1 Z (kN/m)", { exact: true }).fill("0");
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("重力 Z (m/s²)", { exact: true }).fill("-10");
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("组合 1 项 2 系数", { exact: true }).fill("-0.5");
    await expect(card.getByRole("button", { name: /^(确认条件|确认并计算)$/ })).toBeDisabled();
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByRole("button", { name: "更新预览", exact: true }).click();
    await expect(card.getByRole("button", { name: /^(确认条件|确认并计算)$/ })).toBeEnabled();
    for (const theme of ["dark", "light"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "设置", exact: true });
      await settings.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
      await settings.getByRole("button", { name: "关闭", exact: true }).click();
      for (const width of [1440, 1080]) {
        await closeProposalDrawer(page);
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 900), width);
        await page.getByRole("button", { name: "适合模型", exact: true }).click();
        await openProposalView(page, card, "edit");
        await proposalDrawer(page).getByLabel("组合 1 项 2 系数", { exact: true }).scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth)).toBe(true);
        await page.screenshot({ path: `docs/evidence/T24-${theme}-${width}.png` });
      }
    }
    await closeProposalDrawer(page);
    await card.getByRole("button", { name: /^(确认条件|确认并计算)$/ }).dblclick();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已完成 · 本地分析完成");
    const applied = await save(page, path);
    expect(applied.loadCases).toHaveLength(2); expect(applied.uniformLoads).toHaveLength(1); expect(applied.loadCombinations).toHaveLength(1);
    expect(applied.uniformLoads[0]).toMatchObject({ loadCaseId: "LC2", coordinateSystem: "local", intensity: { x: 0, y: -3, z: 0 } });
    expect(applied.nodalLoads[0].loadCaseId).toBe("LC2");
    expect(applied.selfWeight).toEqual({ enabled: true, loadCaseId: "LC1", gravity: { x: 0, y: 0, z: -10 } });
    expect(applied.activeLoadCombinationId).toBe("CB1"); expect(applied.analysisResults).toHaveLength(1);
    expect(applied.analysisResults[0].input.combination.definition.terms).toEqual([{ loadCaseId: "LC1", factor: 1 }, { loadCaseId: "LC2", factor: -0.5 }]);
    expect(applied.analysisResults[0].input.combination.cases[1].uniformLoads[0].intensity.y).toBe(-3);
    const receipt = await page.locator(".ai-turn").last().locator(".ai-tool-output").textContent();
    expect(JSON.parse(receipt!).data.analysisSourceId).toBe("CB1");
    expect(JSON.parse(receipt!).data.combination.definition.id).toBe("CB1");
    await expect(page.getByLabel("视图工况来源")).toContainText("CB1");
    await expect(page.getByLabel("自重标记", { exact: true })).toHaveCount(1);
    await expect(page.getByLabel("自重标记", { exact: true })).toContainText("组合加权");
    await expect(page.getByLabel("自重标记", { exact: true })).toContainText("(0, 0, -10)");
    const turns = await page.locator(".ai-turn").evaluateAll((elements) => elements.map((turn) => ({
      prompt: turn.querySelector(".ai-user-message")!.textContent,
      tools: [...turn.querySelectorAll(".ai-tool-record")].map((tool) => ({
        input: JSON.parse(tool.querySelector("pre")!.textContent!), output: JSON.parse(tool.querySelector(".ai-tool-output")!.textContent!),
      })),
    })));
    await writeFile("docs/evidence/T24-replay.json", JSON.stringify({ date: "2026-10-02", network: "fixed HTTP replay", turns,
      cardEdits: { uniformCoordinates: "local", intensity: { x: 0, y: -3, z: 0 }, gravity: { x: 0, y: 0, z: -10 }, liveFactor: -0.5 },
      analysis: applied.analysisResults[0] }, null, 2) + "\n");
    await page.screenshot({ path: "docs/evidence/T24-result.png" });
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    const undone = await save(page, path);
    expect(undone.loadCases).toHaveLength(1); expect(undone.uniformLoads).toHaveLength(0); expect(undone.selfWeight.enabled).toBe(false);
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await page.getByRole("button", { name: "重做", exact: true }).click();
    const redone = await save(page, path);
    expect(redone.loadCombinations).toEqual(applied.loadCombinations); expect(redone.analysisResults).toEqual(applied.analysisResults);
    await page.getByRole("button", { name: "文件", exact: true }).click();
    await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await expect(page.getByLabel("当前组合", { exact: true })).toHaveValue("CB1");
    expect((await save(page, path)).analysisResults).toEqual(applied.analysisResults);
    await page.getByLabel("当前工况", { exact: true }).selectOption("LC2");
    await expect(page.getByLabel("自重标记", { exact: true })).toHaveCount(0);
    await page.getByLabel("当前工况", { exact: true }).selectOption("LC1");
    await expect(page.getByLabel("自重标记", { exact: true })).toContainText("LC1 · 恒载");
  });
});

test("T24 partial natural-language updates preserve a card, invalid references block confirmation, and refusal leaves loads unchanged", async () => {
  await desktop(async (app, page, path) => {
    await closeProposalDrawer(page);
    await replay(app, parameters); await send(page, "建立两层刚架");
    await page.getByRole("button", { name: "确认建模", exact: true }).click();
    await closeProposalDrawer(page);
    await replay(app, loads, "propose_analysis_conditions"); await send(page, "准备多工况荷载和用户组合，先不计算");
    const card = page.getByRole("region", { name: "分析条件卡片" });
    await replay(app, { selfWeight: { ...loads.selfWeight, gravity: { x: 0, y: 0, z: -10 }, source: "user" } }, "propose_analysis_conditions");
    await closeProposalDrawer(page);
    await send(page, "重力改为全局Z负向10米每平方秒，其余保留");
    await openProposalView(page, card, "edit");
    await expect(proposalDrawer(page).getByLabel("重力 Z (m/s²)", { exact: true })).toHaveValue("-10");
    await openProposalView(page, card, "edit");
    await expect(proposalDrawer(page).getByLabel("均布荷载 1 Z (kN/m)", { exact: true })).toHaveValue("-2");
    await openProposalView(page, card, "edit");
    await expect(proposalDrawer(page).getByLabel("组合 1 项 2 系数", { exact: true })).toHaveValue("1.5");
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByRole("button", { name: "移除工况条目 2", exact: true }).click();
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByRole("button", { name: "更新预览", exact: true }).click();
    await expect(card.getByRole("button", { name: /^(确认条件|确认并计算)$/ })).toBeDisabled();
    await expect(card).toContainText("工况 live");
    await openProposalView(page, card, "actions");
    await proposalDrawer(page).getByRole("button", { name: "拒绝条件方案", exact: true }).click();
    const preserved = await save(page, path);
    expect(preserved.loadCases).toHaveLength(1); expect(preserved.uniformLoads).toHaveLength(0); expect(preserved.analysisResults).toHaveLength(0);
  });
});

test("T24 creates cases, uniform loads, self weight and a zero-factor user combination directly in the card", async () => {
  await desktop(async (app, page, path) => {
    await closeProposalDrawer(page);
    await replay(app, parameters); await send(page, "建立两层刚架");
    await page.getByRole("button", { name: "确认建模", exact: true }).click();
    await replay(app, { supports: loads.supports, nodalLoads: [] }, "propose_analysis_conditions");
    await closeProposalDrawer(page);
    await send(page, "准备支座条件，荷载和工况组合由我填卡片");
    const card = page.getByRole("region", { name: "分析条件卡片" });
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByRole("button", { name: "添加工况条目", exact: true }).click();
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("工况 1 名称", { exact: true }).fill("卡片活载");
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("工况 1 说明", { exact: true }).fill("卡片输入");
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByRole("button", { name: "添加均布荷载条目", exact: true }).click();
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("均布荷载 1 工况", { exact: true }).selectOption({ label: "卡片活载 · 待创建" });
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("均布荷载 1 Z (kN/m)", { exact: true }).fill("-2");
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByRole("button", { name: "编辑自重条目", exact: true }).click();
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("卡片启用结构自重", { exact: true }).check();
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByRole("button", { name: "添加自定义组合条目", exact: true }).click();
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("组合 1 名称", { exact: true }).fill("卡片自定义");
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByRole("button", { name: "添加组合 1 项", exact: true }).click();
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("组合 1 项 2 工况", { exact: true }).selectOption({ label: "卡片活载 · 待创建" });
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("组合 1 项 2 系数", { exact: true }).fill("0");
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("确认后计算来源", { exact: true }).selectOption({ label: "卡片自定义 · 待创建（用户自定义）" });
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByRole("button", { name: "更新预览", exact: true }).click();
    await closeProposalDrawer(page);
    await card.getByRole("button", { name: /^(确认条件|确认并计算)$/ }).click();
    const applied = await save(page, path);
    expect(applied.loadCases[1]).toMatchObject({ id: "LC2", name: "卡片活载", description: "卡片输入" });
    expect(applied.uniformLoads[0]).toMatchObject({ loadCaseId: "LC2", intensity: { x: 0, y: 0, z: -2 } });
    expect(applied.selfWeight.enabled).toBe(true); expect(applied.selfWeight.loadCaseId).toBe("LC1");
    expect(applied.loadCombinations[0].terms).toEqual([{ loadCaseId: "LC1", factor: 1 }, { loadCaseId: "LC2", factor: 0 }]);
    expect(applied.activeLoadCombinationId).toBe("CB1"); expect(applied.analysisResults).toHaveLength(0);
  });
});
