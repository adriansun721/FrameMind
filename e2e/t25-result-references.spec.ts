import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { desktop, save } from "./frame-proposal-actions";
import { solveFrame } from "../src/domain/analysis";
import { encodeProject } from "../src/domain/project-file";
import { addLoadCase, addLoadCombination, addMaterial, addMember, addNode, addNodalLoad, addSection, addSupport, attachAnalysisResult, createProject, selectLoadCombination } from "../src/domain/project";

function example() {
  let p = addNode(createProject("T25 悬臂引用"), { x: 0, y: 0, z: 0 });
  p = addNode(p, { x: 4, y: 0, z: 0 });
  p = addMaterial(p, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  p = addSection(p, { name: "Section", areaM2: 0.01, secondMomentYM4: 0.0002, secondMomentZM4: 0.0001, torsionalConstantM4: 0.0001 });
  p = addMember(p, { startNodeId: p.nodes[0].id, endNodeId: p.nodes[1].id, materialId: p.materials[0].id, sectionId: p.sections[0].id, rotationDegrees: 0 });
  p = addSupport(p, p.nodes[0].id, [true, true, true, true, true, true]);
  p = addNodalLoad(p, p.nodes[1].id, { x: 0, y: -5, z: 0 }, { x: 0, y: 0, z: 0 });
  p = addLoadCase(p, "空工况");
  p = addLoadCombination(p, "用户试算", [{ loadCaseId: "LC1", factor: -0.5 }, { loadCaseId: "LC2", factor: 0 }]);
  p = selectLoadCombination(p, "CB1");
  return attachAnalysisResult(p, solveFrame(p));
}

async function replay(app: ElectronApplication) {
  await app.evaluate(() => {
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const output = request.messages.find((m: { role: string }) => m.role === "tool");
      return new Response(JSON.stringify({ choices: [{ message: output ? { role: "assistant", content:
        "计算事实：[[result:t25-node]]，[[result:t25-member]]。原因推断：横向荷载引起弯曲，需结合冻结输入判断；不提供安全或规范合规结论。" }
        : { role: "assistant", content: null, tool_calls: [
          { id: "t25-summary", type: "function", function: { name: "read_results", arguments: '{"collection":"summary"}' } },
          { id: "t25-node", type: "function", function: { name: "read_result", arguments: '{"kind":"node","id":"node_0002","quantity":"displacement","component":"y"}' } },
          { id: "t25-member", type: "function", function: { name: "read_result", arguments: '{"kind":"member","id":"member_0001","quantity":"sectionForces","component":"Mz","position":2}' } },
        ] } }] }));
    };
  });
}
async function send(page: Page) {
  await page.getByLabel("AI 消息草稿").fill("解释所选分析的关键位移和弯矩，引用实际结果并区分事实和推断");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
}

test("T25 reads real combination results, locates verified items and retains its bound analysis during browsing", async () => {
  test.setTimeout(90000);
  await desktop(async (app, page, path) => {
    await replay(app); await send(page);
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("无成功结果");
    await expect(page.locator(".ai-result-reference")).toHaveCount(0);
    const project = example();
    await writeFile(path, encodeProject(project), "utf8");
    await page.getByRole("button", { name: "文件", exact: true }).click();
    await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await expect(page.getByRole("status")).toContainText("已打开");
    await send(page);
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已引用所选分析");
    const refs = page.locator(".ai-result-reference");
    await expect(refs).toHaveCount(2);
    await expect(refs.first()).toContainText("0.0026666667 m");
    await expect(refs.last()).toContainText("Mz @ 2 m = 5.0000000 kN·m");
    await refs.last().click();
    const detail = page.getByRole("region", { name: "引用结果项" });
    await expect(detail).toContainText(project.analysisResults[0].id);
    await expect(detail).toContainText("CB1 · 用户试算");
    await expect(detail).toContainText("LC1 × -0.5 + LC2 × 0");
    await expect(detail).toContainText("正局部 x 面截面内力");
    await expect(page.getByRole("region", { name: "对象属性" })).toContainText("M1");
    for (const theme of ["dark", "light"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "设置", exact: true });
      await settings.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
      await settings.getByRole("button", { name: "关闭", exact: true }).click();
      await page.screenshot({ path: `test-results/t2-05-t25-${theme}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth)).toBe(true);
    }
    const records = await page.locator(".ai-tool-record").evaluateAll((items) => items.map((item) => ({
      input: JSON.parse(item.querySelector("pre")!.textContent!), output: JSON.parse(item.querySelector(".ai-tool-output")!.textContent!),
    })));
    await writeFile("test-results/t2-05-t25-replay.json", JSON.stringify({ input: project, records }, null, 2) + "\n");
    await refs.first().click();
    await page.getByLabel("X 坐标", { exact: true }).fill("8");
    await page.getByRole("button", { name: "保存节点属性" }).click();
    await expect(detail).toContainText("历史输入结果");
    await expect(detail).toContainText("(4, 0, 0) m");
    await send(page);
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已引用历史输入结果");
    await page.getByRole("button", { name: "运行分析", exact: true }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("分析完成");
    const recomputed = await save(page, path);
    await page.locator(".ai-result-reference").first().click();
    await expect(detail).toContainText(project.analysisResults[0].id);
    await page.getByRole("button", { name: "查看分析结果", exact: true }).click();
    await expect(detail).toHaveCount(0);
    await expect(page.locator(".analysis-result-panel")).toContainText("所选分析");
    await expect(page.locator(".analysis-result-panel")).toContainText(recomputed.analysisResults.at(-1).id.slice(-8));
    await page.locator(".ai-result-reference").first().click();
    await app.evaluate(() => { globalThis.fetch = () => new Promise<Response>(() => {}); });
    await send(page);
    await expect(page.getByRole("button", { name: "取消对话", exact: true })).toBeVisible();
    // Same model and object selection, different selected analysis ID.
    await detail.getByRole("button", { name: "关闭引用结果", exact: true }).click();
    await expect(page.getByRole("button", { name: "取消对话", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "取消对话", exact: true }).click();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已取消");
  });
});
