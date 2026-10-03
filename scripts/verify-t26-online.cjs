const { _electron: electron, expect } = require("@playwright/test");
const { copyFile, mkdtemp, readFile, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve, sep, basename } = require("node:path");
const assert = require("node:assert/strict");
const diagnostic = { stage: "reuse-encrypted-credential" };

async function verify() {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t26-online-"));
  const path = join(directory, "columns.framemind");
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  let app;
  try {
    const source = join(process.env.APPDATA, require("../package.json").name);
    await copyFile(join(source, "deepseek.credentials"), join(directory, "deepseek.credentials"));
    await copyFile(join(source, "Local State"), join(directory, "Local State"));
    const input = JSON.parse(await readFile(resolve("docs/evidence/T26-replay.json"), "utf8")).input;
    await writeFile(path, JSON.stringify(input), "utf8");
    app = await electron.launch({ args: ["."], env });
    const page = await app.firstWindow();
    await expect(page.getByRole("button", { name: "文件", exact: true })).toBeVisible();
    diagnostic.stage = "inspect-existing-connection";
    const settings = await page.evaluate(() => window.frameMind.getDeepSeekSettings());
    diagnostic.settings = settings; assert.equal(settings.configured, true); delete diagnostic.settings;
    const report = { date: "2026-10-02", model: settings.model, network: "real DeepSeek HTTPS; no fetch replacement", input, turns: [] };
    await page.keyboard.press("Control+o"); await expect(page.locator('footer[role="status"]')).toContainText("已打开");
    await page.getByLabel("选择杆件 M1", { exact: true }).check();
    diagnostic.stage = "real-selected-column-preview";
    await page.getByLabel("AI 消息草稿").fill("只把当前选中的这些柱改用项目中 S2 的加大截面，保留其他杆件、共享原截面、支座和荷载不变。请核对选中对象，生成 propose_section_change 预览；我确认后继续重算并解释前后差异，包括自重面积变化。不要新建框架或条件。");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const card = page.getByRole("region", { name: "选柱截面修改方案" });
    await expect(card).toBeVisible({ timeout: 90_000 });
    await card.getByRole("button", { name: "详情", exact: true }).click();
    const details = page.locator(".proposal-drawer");
    await expect(details).toContainText("member_0001"); await expect(details).not.toContainText("member_0002");
    await expect(details).toContainText("0.01 → 0.02");
    await details.getByRole("button", { name: "关闭详情", exact: true }).click();
    await page.screenshot({ path: resolve("docs/evidence/T26-online-preview.png") });
    diagnostic.stage = "real-confirm-and-recompute";
    await card.getByRole("button", { name: /^(确认修改|确认并重算)$/ }).click();
    await expect(page.locator(".ai-comparison-reference").first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已引用两次确定分析");
    diagnostic.stage = "verify-explicit-numeric-comparison";
    await page.getByLabel("AI 消息草稿").fill("请解释前后已绑定的两次分析。先 read_comparison summary，再用 read_comparison_result 逐项核对 N2 全局 x 位移、N1 全局 z 反力与 M1 起点杆端 N 内力的前值、后值和差值，插入三项返回的对比引用标记。区分计算事实和原因推断，说明截面刚度与面积引起的自重荷载变化同时作用，不自行计算新数值或百分比，不作安全或规范符合性结论。只解释，300字以内，不再修改或计算。");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已引用两次确定分析", { timeout: 90_000 });
    const turn = page.locator(".ai-turn").last();
    const references = await turn.locator(".ai-tool-output").evaluateAll((items) => items.map((item) => JSON.parse(item.textContent)).flatMap((output) => output.comparisonReference ? [output.comparisonReference] : []));
    assert.ok(references.length >= 3);
    const expected = [
      ["node_0002", "displacement", "x", 0.005333333333333333, 0.0026666666666666666, -0.0026666666666666666],
      ["node_0001", "reaction", "z", 3.14, 6.28, 3.14],
      ["member_0001", "startEndForces", "N", 3.14, 6.28, 3.14],
    ];
    for (const [id, quantity, component, before, after, delta] of expected) {
      const ref = references.find((item) => item.after.object.id === id && item.after.quantity === quantity && item.after.component === component);
      assert.ok(ref); assert.ok(Math.abs(ref.before.value - before) < 1e-10); assert.ok(Math.abs(ref.after.value - after) < 1e-10); assert.ok(Math.abs(ref.delta - delta) < 1e-10);
      assert.equal(ref.before.analysisId, input.analysisResults[0].id); assert.equal(ref.before.source.id, "LC1"); assert.equal(ref.after.source.id, "LC1");
    }
    await page.keyboard.press("Control+s"); await expect(page.getByLabel("未保存修改", { exact: true })).toHaveCount(0);
    report.applied = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(report.applied.members.map((item) => item.sectionId), ["section_0002", "section_0001"]);
    assert.equal(report.applied.analysisResults.length, 2);
    assert.ok(references.every((ref) => ref.after.analysisId === report.applied.analysisResults[1].id));
    await turn.locator(".ai-comparison-reference").first().click();
    const dialog = page.getByRole("dialog", { name: "前后结果对比", exact: true });
    await expect(dialog.getByLabel("前一份结果")).toHaveValue(input.analysisResults[0].id);
    await expect(dialog.getByLabel("后一份结果")).toHaveValue(report.applied.analysisResults[1].id);
    await page.screenshot({ path: resolve("docs/evidence/T26-online-comparison.png") });
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    report.turns = await page.locator(".ai-turn").evaluateAll((items) => items.map((item) => ({ prompt: item.querySelector(".ai-user-message")?.textContent,
      status: item.querySelector('[data-testid="ai-turn-status"]')?.textContent, assistant: item.querySelector(".ai-assistant-message")?.textContent,
      outputs: Array.from(item.querySelectorAll(".ai-tool-output")).map((output) => JSON.parse(output.textContent)) })));
    report.verified = { selectedScope: true, explicitAnalysisIds: true, numericAgreement: true, selfWeightUpdate: true, clickableSameTable: true };
    await writeFile(resolve("docs/evidence/T26-online.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
    await page.screenshot({ path: resolve("docs/evidence/T26-online.png") });
    console.log(JSON.stringify({ status: "passed", model: settings.model, turns: report.turns.length, ...report.verified }));
  } catch (error) {
    if (app) {
      const page = await app.firstWindow();
      const turns = await page.locator(".ai-turn").evaluateAll((items) => items.map((item) => ({ prompt: item.querySelector(".ai-user-message")?.textContent,
        status: item.querySelector('[data-testid="ai-turn-status"]')?.textContent, assistant: item.querySelector(".ai-assistant-message")?.textContent,
        outputs: Array.from(item.querySelectorAll(".ai-tool-output")).map((output) => JSON.parse(output.textContent)) })));
      await writeFile(resolve("docs/evidence/T26-online-failure.json"), JSON.stringify({ stage: diagnostic.stage, turns }, null, 2) + "\n");
      await page.screenshot({ path: resolve("docs/evidence/T26-online-failure.png") });
      diagnostic.lastStatus = turns.at(-1)?.status;
    }
    throw error;
  } finally {
    try { await app?.close(); } finally {
      assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep) && basename(directory).startsWith("framemind-t26-online-"));
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  }
}
verify().catch((error) => { console.error(JSON.stringify({ status: "failed", ...diagnostic, errorType: error.name, errorCode: error.code })); process.exitCode = 1; });
