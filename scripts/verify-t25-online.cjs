const { _electron: electron, expect } = require("@playwright/test");
const { copyFile, mkdtemp, readFile, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve, sep, basename } = require("node:path");
const assert = require("node:assert/strict");
const diagnostic = { stage: "reuse-encrypted-credential" };

async function verify() {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t25-online-"));
  const path = join(directory, "results.framemind");
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  let app;
  try {
    const source = join(process.env.APPDATA, require("../package.json").name);
    await copyFile(join(source, "deepseek.credentials"), join(directory, "deepseek.credentials"));
    await copyFile(join(source, "Local State"), join(directory, "Local State"));
    const project = JSON.parse(await readFile(resolve("docs/evidence/T25-replay.json"), "utf8")).input;
    await writeFile(path, JSON.stringify(project), "utf8");
    app = await electron.launch({ args: ["."], env });
    const page = await app.firstWindow();
    const settings = await page.evaluate(() => window.frameMind.getDeepSeekSettings());
    assert.equal(settings.configured, true);
    const report = { date: "2026-10-02", model: settings.model, network: "real DeepSeek HTTPS; no fetch replacement", turns: [] };
    await page.getByRole("button", { name: "文件", exact: true }).click();
    await page.getByRole("menuitem", { name: /打开项目/ }).click();
    await expect(page.locator('footer[role="status"]')).toContainText("已打开");
    async function ask(prompt) {
      diagnostic.step = "wait-reply";
      await page.getByLabel("AI 消息草稿").fill(prompt);
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await expect(page.getByTestId("ai-turn-status").last()).toHaveText(/^(已完成|失败|缺少输入|等待确认|已取消) ·/, { timeout: 90_000 });
      diagnostic.outcome = await page.getByTestId("ai-turn-status").last().textContent();
      assert.ok(diagnostic.outcome.startsWith("已完成"));
      const turn = page.locator(".ai-turn").last();
      const data = await turn.evaluate((element) => ({ prompt: element.querySelector(".ai-user-message").textContent,
        status: element.querySelector('[data-testid="ai-turn-status"]').textContent,
        assistant: element.querySelector(".ai-assistant-message")?.textContent,
        outputs: Array.from(element.querySelectorAll(".ai-tool-output")).map((output) => JSON.parse(output.textContent)),
      }));
      report.turns.push(data);
      const refs = data.outputs.flatMap((output) => output.reference ? [output.reference] : []);
      diagnostic.step = "verify-references";
      diagnostic.references = refs.map((ref) => ({ kind: ref.object.kind, quantity: ref.quantity, component: ref.component, position: ref.position }));
      assert.ok(refs.length >= 2);
      assert.ok(refs.every((ref) => ref.analysisId === project.analysisResults[0].id && ref.source.id === "CB1"));
      const node = refs.find((ref) => ref.object.kind === "node" && ref.quantity === "displacement" && ref.component === "y");
      const member = refs.find((ref) => ref.object.kind === "member" && ref.quantity === "sectionForces" && ref.component === "Mz" && ref.position === 2);
      assert.ok(node && member);
      assert.ok(Math.abs(node.value - 0.0026666666666666666) < 1e-12);
      assert.ok(Math.abs(member.value - 5) < 1e-10);
      await expect(turn.locator(".ai-result-reference")).toHaveCount(refs.length);
      delete diagnostic.outcome; delete diagnostic.references; delete diagnostic.step;
      return { turn, refs };
    }
    diagnostic.stage = "actual-combination-explanation";
    const first = await ask("请先读取当前所选组合的真实分析结果，再解释 N2 的全局 y 位移和 M1 距起点2米处的局部 Mz 截面内力。逐项用 read_result 核对并插入返回引用标记，说明对象位置、工况或组合和冻结输入；区分计算事实与原因推断，说明线弹性结果不能用于安全或规范合格判定。不重新计算、不修改模型，回答控制在300字以内。");
    assert.ok(first.refs.every((ref) => ref.current));
    const nodeButton = first.turn.locator(".ai-result-reference").filter({ hasText: "N2" }).first();
    await nodeButton.click();
    const details = page.getByRole("region", { name: "引用结果项" });
    await expect(details).toContainText("(4, 0, 0) m");
    await expect(details).toContainText(project.analysisResults[0].id);
    diagnostic.stage = "historical-input-explanation";
    await page.getByLabel("X 坐标", { exact: true }).fill("8");
    await page.getByRole("button", { name: "保存节点属性", exact: true }).click();
    const second = await ask("我已将当前 N2 的 x 坐标改为8米，但没有重算。请先读所选结果，只解释这份历史输入的 N2 全局 y 位移和 M1 距起点2米处局部 Mz 截面内力，用 read_result 返回的引用标记核对。明确原输入的对象位置、分析ID、组合及冻结版本，说明当前模型需重新计算，不把旧数值称为当前响应。区分事实与推断，不提供安全或规范结论，300字以内。不要计算或修改。");
    assert.ok(second.refs.every((ref) => !ref.current));
    assert.deepEqual(second.refs.find((ref) => ref.object.kind === "node").object.position, { x: 4, y: 0, z: 0 });
    await second.turn.locator(".ai-result-reference").last().click();
    await expect(details).toContainText("历史输入结果");
    report.verified = { numericAgreement: true, clickableLocation: true, frozenPositions: true, historicalInput: true, analysisId: project.analysisResults[0].id };
    await writeFile(resolve("docs/evidence/T25-online.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
    await page.screenshot({ path: resolve("docs/evidence/T25-online.png") });
    console.log(JSON.stringify({ status: "passed", model: settings.model, turns: report.turns.length, ...report.verified }));
  } finally {
    try { await app?.close(); } finally {
      assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep) && basename(directory).startsWith("framemind-t25-online-"));
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  }
}
verify().catch(() => { console.error(JSON.stringify({ status: "failed", ...diagnostic })); process.exitCode = 1; });
