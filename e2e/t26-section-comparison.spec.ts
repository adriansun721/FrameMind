import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { desktop, save } from "./frame-proposal-actions";
import { columns } from "../src/workspace/section-stage.fixture";
import { encodeProject } from "../src/domain/project-file";
import { solveFrame } from "../src/domain/analysis";
import { attachAnalysisResult, updateMember } from "../src/domain/project";

async function replay(app: ElectronApplication) {
  await app.evaluate(() => {
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const prompt = request.messages.filter((message: { role: string }) => message.role === "user").at(-1).content;
      const comparison = prompt.includes("重算已完成") || prompt.startsWith("解释前后");
      const tool = (name: string, args: unknown, id: string) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
      const message = comparison ? request.messages.some((message: { role: string }) => message.role === "tool")
        ? { role: "assistant", content: "计算事实：[[comparison:t26-node]]，[[comparison:t26-reaction]]。原因推断：截面刚度与面积产生的自重同时变化，需结合冻结输入；线弹性结果不提供安全或规范合格结论。" }
        : { role: "assistant", content: null, tool_calls: [tool("read_comparison", { collection: "summary" }, "t26-summary"),
          tool("read_comparison_result", { kind: "node", id: "node_0002", quantity: "displacement", component: "x" }, "t26-node"),
          tool("read_comparison_result", { kind: "node", id: "node_0001", quantity: "reaction", component: "z" }, "t26-reaction")] }
        : { role: "assistant", content: null, tool_calls: [tool("propose_section_change", { sectionId: "section_0002", source: "user" }, "t26-section")] };
      return new Response(JSON.stringify({ choices: [{ message }] }));
    };
  });
}
async function send(page: Page, prompt: string) {
  await page.getByLabel("AI 消息草稿").fill(prompt); await page.getByRole("button", { name: "发送消息", exact: true }).click();
}
async function openExample(page: Page, path: string) {
  const p = columns(); await writeFile(path, encodeProject(p), "utf8");
  await page.keyboard.press("Control+o"); await expect(page.locator('footer[role="status"]')).toContainText("已打开");
  return p;
}

test("T26 confirms selected column sections, automatically recomputes self weight and cites the same fixed comparison after undo", async () => {
  test.setTimeout(90000);
  await desktop(async (app, page, path) => {
    const before = await openExample(page, path); await replay(app);
    await send(page, "把这些柱改为加大截面，然后重算并解释前后差异");
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("请先选择");
    await page.getByLabel("选择杆件 M1", { exact: true }).check();
    await send(page, "把这些柱改为加大截面，然后重算并解释前后差异");
    const card = page.getByRole("region", { name: "选柱截面修改方案" });
    await expect(card).toContainText("member_0001"); await expect(card).not.toContainText("member_0002");
    await expect(card).toContainText("0.01 → 0.02");
    await expect(page.getByLabel("未应用三维方案")).toContainText("1 根选中柱");
    expect((await save(page, path)).members).toEqual(before.members);
    for (const theme of ["dark", "light"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click(); const settings = page.getByRole("dialog", { name: "设置", exact: true });
      await settings.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click(); await settings.getByRole("button", { name: "关闭", exact: true }).click();
      await page.screenshot({ path: `docs/evidence/T26-${theme}-preview.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth)).toBe(true);
    }
    await card.getByRole("button", { name: "确认应用截面修改阶段", exact: true }).click();
    await expect(page.locator(".ai-comparison-reference")).toHaveCount(2);
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已引用两次确定分析");
    const after = await save(page, path);
    expect(after.members.map((m: { sectionId: string }) => m.sectionId)).toEqual(["section_0002", "section_0001"]);
    expect(after.analysisResults).toHaveLength(2);
    expect(after.analysisResults[1].nodes[0].reaction.z).toBeCloseTo(6.28, 10);
    await page.locator(".ai-comparison-reference").first().click();
    const dialog = page.getByRole("dialog", { name: "前后结果对比", exact: true });
    await expect(dialog.getByLabel("前一份结果")).toHaveValue(before.analysisResults[0].id);
    await expect(dialog.getByLabel("后一份结果")).toHaveValue(after.analysisResults[1].id);
    await expect(dialog).toContainText("-0.00266667");
    await page.screenshot({ path: "docs/evidence/T26-comparison.png" });
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    const undone = await save(page, path);
    expect(undone.members).toEqual(before.members); expect(undone.analysisResults).toHaveLength(2);
    await page.locator(".ai-comparison-reference").last().click();
    await expect(dialog.getByLabel("后一份结果")).toHaveValue(after.analysisResults[1].id);
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "重做", exact: true }).click();
    expect((await save(page, path)).members).toEqual(after.members);
    const records = await page.locator(".ai-tool-record").evaluateAll((items) => items.map((item) => ({ input: item.querySelector("pre")?.textContent,
      output: JSON.parse(item.querySelector(".ai-tool-output")!.textContent!) })));
    await writeFile("docs/evidence/T26-replay.json", JSON.stringify({ input: before, applied: after, undone, records }, null, 2) + "\n");
    await page.keyboard.press("Control+o"); await expect(page.locator('footer[role="status"]')).toContainText("已打开");
    expect((await save(page, path)).analysisResults).toHaveLength(2);
  });
});

test("T26 cancels a pending comparison when the selected analysis pair changes", async () => {
  await desktop(async (app, page, path) => {
    let p = columns();
    p = updateMember(p, p.members[0].id, { ...p.members[0], sectionId: p.sections[1].id });
    p = attachAnalysisResult(p, solveFrame(p));
    await writeFile(path, encodeProject(p), "utf8"); await page.keyboard.press("Control+o");
    await expect(page.locator('footer[role="status"]')).toContainText("已打开");
    await page.getByRole("button", { name: "历史分析与前后对比", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "前后结果对比", exact: true });
    await expect(dialog.getByLabel("前一份结果")).toHaveValue(p.analysisResults[0].id);
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await app.evaluate(() => { globalThis.fetch = () => new Promise<Response>(() => {}); });
    await send(page, "解释前后差异"); await expect(page.getByRole("button", { name: "取消对话", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "历史分析与前后对比", exact: true }).click();
    await dialog.getByLabel("前一份结果").selectOption(p.analysisResults[1].id);
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已取消");
  });
});

test("T26 invalidates changed selections, supports card edits and rejection without modifying the shared model", async () => {
  await desktop(async (app, page, path) => {
    const before = await openExample(page, path); await replay(app);
    await page.getByLabel("选择杆件 M1", { exact: true }).check(); await send(page, "增大这些柱的截面");
    const card = page.getByRole("region", { name: "选柱截面修改方案" });
    await expect(card.getByRole("button", { name: "确认应用截面修改阶段", exact: true })).toBeEnabled();
    await page.getByLabel("选择杆件 M2", { exact: true }).check();
    await expect(card.getByRole("button", { name: "确认应用截面修改阶段", exact: true })).toBeDisabled();
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await card.getByRole("button", { name: "重新生成截面预览", exact: true }).click();
    await expect(card).toContainText("2 根柱");
    await card.getByLabel("目标柱截面").selectOption("custom");
    await card.getByLabel("新柱截面 A (m²)", { exact: true }).fill("0.03");
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await card.getByRole("button", { name: "更新截面预览", exact: true }).click();
    await expect(card).toContainText("0.01 → 0.03");
    await card.getByRole("button", { name: "拒绝截面方案", exact: true }).click();
    await expect(card).toHaveCount(0); expect((await save(page, path)).members).toEqual(before.members);
    expect((await save(page, path)).analysisResults).toHaveLength(1);
  });
});
