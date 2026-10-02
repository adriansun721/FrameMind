const { _electron: electron, expect } = require("@playwright/test");
const { copyFile, mkdtemp, readFile, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve, sep, basename } = require("node:path");
const assert = require("node:assert/strict");
const diagnostic = { stage: "reuse-encrypted-credential" };

async function verify() {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t24-online-"));
  const path = join(directory, "online.framemind");
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  let app;
  try {
    const source = join(process.env.APPDATA, require("../package.json").name);
    await copyFile(join(source, "deepseek.credentials"), join(directory, "deepseek.credentials"));
    await copyFile(join(source, "Local State"), join(directory, "Local State"));
    app = await electron.launch({ args: ["."], env });
    const page = await app.firstWindow();
    const settings = await page.evaluate(() => window.frameMind.getDeepSeekSettings());
    assert.equal(settings.configured, true);
    const report = { date: "2026-10-02", model: settings.model, network: "real DeepSeek HTTPS; no fetch replacement", turns: [] };
    async function collect() {
      report.turns = await page.locator(".ai-turn").evaluateAll((turns) => turns.map((turn) => ({
        prompt: turn.querySelector(".ai-user-message").textContent,
        status: turn.querySelector('[data-testid="ai-turn-status"]').textContent,
        tools: Array.from(turn.querySelectorAll(".ai-tool-record")).map((record) => ({
          name: record.querySelector("summary").textContent,
          input: JSON.parse(record.querySelector("pre").textContent), output: JSON.parse(record.querySelector(".ai-tool-output").textContent),
        })),
      })));
    }
    async function save() {
      await page.keyboard.press("Control+s");
      await expect(page.locator('footer[role="status"]')).toContainText("已保存");
      await expect(page.getByLabel("未保存修改", { exact: true })).toHaveCount(0);
      return JSON.parse(await readFile(path, "utf8"));
    }
    diagnostic.stage = "geometry-preview";
    await page.getByLabel("AI 消息草稿").fill("建立两层空间钢刚架并计算用户自定义组合：X向一跨6米，Y向一跨4米，两层层高均3米，原点(0,0,0)米；钢材S355JR，柱HEA200，梁IPE200，截面转角0度。底层z=0的四个节点UX/UY/UZ/RX/RY/RZ全部约束，不添加节点力或力矩。将已有默认LC1改名恒载（说明：结构自重），启用全结构自重，归属恒载，重力全局(0,0,-9.81)m/s²；新建活载工况（说明：屋面均布力），只在顶层(0,0,6)到(6,0,6)米的那一根梁施加全局(0,0,-2)kN/m整杆均布力，归属活载。新建用户自定义组合试算，恒载系数1、活载系数0.5，并把该组合设为确认后计算来源。这些数值均为我提供，不添加任何规范系数或其他荷载。先生成建模卡片，等我确认后再用一个分析条件阶段汇总支座、均布荷载、自重、两工况和组合，等第二次确认后自动本地求解。");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const frame = page.getByRole("region", { name: "建模参数卡片" });
    await expect(frame.getByRole("button", { name: "确认应用建模阶段", exact: true })).toBeEnabled({ timeout: 60_000 });
    await frame.getByRole("button", { name: "确认应用建模阶段", exact: true }).click();
    diagnostic.stage = "multi-case-preview";
    const card = page.getByRole("region", { name: "分析条件卡片" });
    await expect(card.getByRole("button", { name: "确认应用分析条件阶段", exact: true })).toBeEnabled({ timeout: 90_000 });
    await collect();
    const proposal = report.turns.flatMap((t) => t.tools).findLast((t) => t.output.conditions)?.output.conditions;
    assert.equal(proposal.supports.length, 4); assert.equal(proposal.nodalLoads.length, 0);
    assert.equal(proposal.uniformLoads.length, 1); assert.equal(proposal.loadCases.length, 2); assert.equal(proposal.loadCombinations.length, 1);
    assert.ok(proposal.supports.every((s) => s.restraints.every(Boolean)));
    assert.deepEqual(proposal.uniformLoads[0].intensity, { x: 0, y: 0, z: -2 });
    assert.equal(proposal.uniformLoads[0].coordinateSystem, "global");
    assert.deepEqual(proposal.selfWeight.gravity, { x: 0, y: 0, z: -9.81 });
    const before = await save();
    assert.equal(before.loadCases.length, 1); assert.equal(before.uniformLoads.length, 0); assert.equal(before.selfWeight.enabled, false);
    assert.equal(before.loadCombinations.length, 0); assert.equal(before.analysisResults.length, 0);
    const member = before.members.find((m) => m.id === proposal.uniformLoads[0].memberId);
    const ends = [member.startNodeId, member.endNodeId].map((id) => before.nodes.find((n) => n.id === id).position);
    assert.deepEqual(ends.sort((a, b) => a.x - b.x), [{ x: 0, y: 0, z: 6 }, { x: 6, y: 0, z: 6 }]);
    assert.ok(proposal.supports.every((s) => before.nodes.find((n) => n.id === s.nodeId).position.z === 0));
    diagnostic.stage = "confirm-and-combination-solve";
    await card.getByRole("button", { name: "确认应用分析条件阶段", exact: true }).click();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已完成 · 本地分析完成", { timeout: 30_000 });
    const applied = await save();
    assert.equal(applied.loadCases.length, 2); assert.equal(applied.uniformLoads.length, 1); assert.equal(applied.loadCombinations.length, 1);
    const combination = applied.loadCombinations[0];
    const dead = applied.loadCases.find((c) => c.name === "恒载");
    const live = applied.loadCases.find((c) => c.name === "活载");
    assert.equal(applied.activeLoadCombinationId, combination.id);
    assert.equal(applied.selfWeight.loadCaseId, dead.id); assert.equal(applied.uniformLoads[0].loadCaseId, live.id);
    assert.deepEqual(combination.terms.find((t) => t.loadCaseId === dead.id), { loadCaseId: dead.id, factor: 1 });
    assert.deepEqual(combination.terms.find((t) => t.loadCaseId === live.id), { loadCaseId: live.id, factor: 0.5 });
    assert.equal(applied.analysisResults.length, 1);
    const result = applied.analysisResults[0];
    assert.deepEqual(result.input.combination.definition, combination);
    assert.equal(result.input.combination.cases.length, 2);
    assert.deepEqual(result.input.combination.cases.find((c) => c.loadCase.id === live.id).uniformLoads[0].intensity, { x: 0, y: 0, z: -2 });
    await collect();
    report.verified = { previewIsolation: true, stableReferences: true, twoCases: true, userDefinedCombination: true, automaticLocalSolve: true, analysisId: result.id };
    report.analysis = result;
    await writeFile(resolve("docs/evidence/T24-online.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
    await page.screenshot({ path: resolve("docs/evidence/T24-online.png") });
    console.log(JSON.stringify({ status: "passed", model: settings.model, turns: report.turns.length, analysisId: result.id }));
  } finally {
    try { await app?.close(); } finally {
      assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep) && basename(directory).startsWith("framemind-t24-online-"));
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  }
}
verify().catch(() => { console.error(JSON.stringify({ status: "failed", ...diagnostic })); process.exitCode = 1; });
