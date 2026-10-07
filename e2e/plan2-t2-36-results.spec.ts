import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { desktop, save } from "./frame-proposal-actions";

const evidence = "docs/evidence/plan2/T2-36";
async function send(page: Page, prompt: string) {
  await page.getByLabel("AI 消息草稿").fill(prompt);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByTestId("ai-turn-status").last()).toHaveText(/^已完成 ·/, { timeout: 30000 });
}
async function cite(app: ElectronApplication, input: unknown) {
  await app.evaluate((_electron, args) => {
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const message = request.messages.some((item: { role: string }) => item.role === "tool")
        ? { role: "assistant", content: "计算事实：[[result:shape]]。归一化形态仅表示计算形态，显示缩放不代表实际位移。" }
        : { role: "assistant", content: null, tool_calls: [{ id: "shape", type: "function", function: { name: "read_result", arguments: JSON.stringify(args) } }] };
      return new Response(JSON.stringify({ choices: [{ message }] }));
    };
  }, input);
}

test("T2-36 five methods switch provenance, charts and legends; actual process and normalized citations locate frozen member stations", async () => {
  test.setTimeout(120000);
  await desktop(async (app, page, path) => {
    const rendererErrors: string[] = [];
    page.on("pageerror", (error) => rendererErrors.push(error.message));
    const fixture = JSON.parse(await readFile(join(evidence, "all-methods.framemind"), "utf8"));
    await writeFile(path, JSON.stringify(fixture)); await mkdir(evidence, { recursive: true });
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    const provenance = () => page.getByRole("region", { name: "统一结果来源", exact: true });
    const selector = page.getByLabel("当前分析工况", { exact: true });
    const checks = [];
    for (const [id, panel, legend] of [["AC5", "random-results", null], ["AC2", "modal-results", "振型"], ["AC4", "buckling-results", "屈曲形态"], ["AC1", "second-order-results", "变形"], ["AC3", null, "变形"], ["AC5", "random-results", null]] as const) {
      await selector.selectOption(id);
      const result = fixture.analysisResults.find((r: { input: { analysisCase: { id: string } } }) => r.input.analysisCase.id === id);
      await expect(provenance()).toContainText(result.id); await expect(provenance()).toContainText("R" + result.input.projectRevision);
      for (const candidate of ["modal-results", "buckling-results", "second-order-results", "random-results"]) await expect(page.getByTestId(candidate)).toHaveCount(candidate === panel ? 1 : 0);
      if (legend) await expect(page.getByLabel("视图结果图例", { exact: true })).toContainText(legend);
      else { await expect(page.getByLabel("视图结果图例", { exact: true })).toHaveCount(0); await expect(page.getByRole("img", { name: "节点平移响应 PSD 曲线", exact: true })).toBeVisible(); }
      checks.push(id);
    }
    await selector.selectOption("AC1");
    await provenance().getByText("沿杆实际位移与定位", { exact: true }).click();
    await provenance().locator("summary").filter({ hasText: /^member_0001$/ }).click();
    const stations = provenance().getByRole("table", { name: "沿杆实际位移", exact: true });
    await expect(stations).toContainText("全局位移");
    await stations.getByRole("button").nth(8).click();
    await expect(page.getByLabel("视图结果图例", { exact: true })).toContainText("变形");
    await selector.selectOption("AC3");
    await provenance().getByText("本次运行实际记录", { exact: true }).click();
    await provenance().locator("summary").filter({ hasText: /^质量矩阵$/ }).click();
    await expect(provenance()).toContainText("本次运行未保存此记录");
    await selector.selectOption("AC2");
    const modal = fixture.analysisResults.find((r: { modal?: unknown }) => r.modal), sample = modal.modal.modes[1].members[0].samples[8];
    await cite(app, { kind: "member", id: fixture.members[0].id, quantity: "shapeTranslation", component: "y", position: sample.position, modeNumber: 2 });
    await send(page, "核查第2阶振型原杆件中点的平移形态，并给出可定位引用");
    await page.getByRole("button").filter({ hasText: "归一化平移形态" }).last().click();
    await expect(page.getByRole("region", { name: "引用结果项", exact: true })).toContainText("第 2 阶");
    await expect(page.getByLabel("视图结果图例", { exact: true })).toContainText("振型");
    await page.getByLabel("单位预设", { exact: true }).selectOption("mm-N");
    await expect(page.getByRole("region", { name: "引用结果项", exact: true })).toContainText("归一化幅值");
    await page.getByRole("separator", { name: "调整属性面板高度" }).focus(); await page.getByRole("separator", { name: "调整属性面板高度" }).press("End");
    for (const theme of ["light", "dark"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click(); await page.getByRole("button", { name: theme === "light" ? "浅色" : "深色", exact: true }).click();
      await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: "关闭", exact: true }).click();
      for (const width of [1080, 1440]) { await page.setViewportSize({ width, height: 900 }); await page.screenshot({ path: join(evidence, `citation-${theme}-${width}.png`) }); }
    }
    await save(page, path);
    expect(rendererErrors).toEqual([]);
    await writeFile(join(evidence, "desktop.json"), JSON.stringify({ passed: true, switching: checks, citationMode: 2, frozenStation: sample.position, normalizedUnits: true, actualMissingRecord: true, widths: [1080, 1440], themes: ["light", "dark"], realAi: false }, null, 2));
  });
});

test("T2-36 deleted engineering members remain locatable through historical citations without becoming current objects", async () => {
  test.setTimeout(90000);
  await desktop(async (app, page, path) => {
    const rendererErrors: string[] = [];
    page.on("pageerror", (error) => rendererErrors.push(error.message));
    const fixture = JSON.parse(await readFile(join(evidence, "deleted-history.framemind"), "utf8"));
    await writeFile(path, JSON.stringify(fixture));
    await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await page.getByLabel("当前分析工况", { exact: true }).selectOption("AC2");
    const modal = fixture.analysisResults.find((r: { modal?: unknown }) => r.modal), member = modal.modal.modes[1].members[0], sample = member.samples[8];
    await cite(app, { kind: "member", id: member.memberId, quantity: "shapeTranslation", component: "y", position: sample.position, modeNumber: 2 });
    await send(page, "核查已删除原杆件的第2阶历史形态，保留来源");
    await page.getByRole("button").filter({ hasText: "归一化平移形态" }).last().click();
    const details = page.getByRole("region", { name: "引用结果项", exact: true });
    await expect(details).toContainText("对象已从当前模型删除"); await expect(details).toContainText(modal.id);
    await expect(page.getByTestId("viewport-member-count")).toContainText("1 根杆件");
    expect((await save(page, path)).members).toHaveLength(0);
    expect(rendererErrors).toEqual([]);
    await page.screenshot({ path: join(evidence, "deleted-citation.png") });
    await writeFile(join(evidence, "historical-desktop.json"), JSON.stringify({ passed: true, deletedMember: member.memberId, sourceAnalysisId: modal.id, frozenSceneMembers: 1, currentMembers: 0, realAi: false }, null, 2));
  });
});
