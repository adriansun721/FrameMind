const { _electron: electron, expect } = require("@playwright/test");
const { copyFile, mkdtemp, readFile, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve, sep, basename } = require("node:path");
const assert = require("node:assert/strict");
const diagnostic = { stage: "reuse-encrypted-credential" };

async function verify() {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t23-online-"));
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
    diagnostic.stage = "geometry-preview";
    await page.getByLabel("AI 消息草稿").fill("建立两层空间钢刚架并计算：X向一跨6米，Y向一跨4米，两层层高均3米，原点(0,0,0)米；钢材S355JR，柱HEA200，梁IPE200，截面转角0度。底层z=0的四个节点UX/UY/UZ/RX/RY/RZ全部约束。只在顶层坐标(6,4,6)米的节点施加FX=5、FY=-2、FZ=-10 kN，MX=1、MY=2、MZ=-3 kN·m，归属默认工况。先生成建模卡片，按阶段等我确认，然后自动计算。");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const frame = page.getByRole("region", { name: "建模参数卡片" });
    await expect(frame.getByRole("button", { name: "确认应用建模阶段", exact: true })).toBeEnabled({ timeout: 60_000 });
    await frame.getByRole("button", { name: "确认应用建模阶段", exact: true }).click();
    diagnostic.stage = "conditions-preview";
    const card = page.getByRole("region", { name: "分析条件卡片" });
    await expect(card.getByRole("button", { name: "确认应用分析条件阶段", exact: true })).toBeEnabled({ timeout: 60_000 });
    await collect();
    const conditions = report.turns.flatMap((t) => t.tools).find((t) => t.output.conditions)?.output.conditions;
    assert.equal(conditions.supports.length, 4); assert.equal(conditions.nodalLoads.length, 1);
    assert.ok(conditions.supports.every((s) => s.restraints.length === 6 && s.restraints.every(Boolean)));
    assert.deepEqual(conditions.nodalLoads[0].force, { x: 5, y: -2, z: -10 });
    assert.deepEqual(conditions.nodalLoads[0].moment, { x: 1, y: 2, z: -3 });
    await page.keyboard.press("Control+s");
    await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    const geometry = JSON.parse(await readFile(path, "utf8"));
    assert.equal(geometry.supports.length, 0); assert.equal(geometry.nodalLoads.length, 0); assert.equal(geometry.analysisResults.length, 0);
    assert.deepEqual(geometry.nodes.find((n) => n.id === conditions.nodalLoads[0].nodeId).position, { x: 6, y: 4, z: 6 });
    assert.ok(conditions.supports.every((s) => geometry.nodes.find((n) => n.id === s.nodeId).position.z === 0));
    diagnostic.stage = "local-confirm-and-solve";
    await card.getByRole("button", { name: "确认应用分析条件阶段", exact: true }).click();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已完成 · 本地分析完成", { timeout: 30_000 });
    await page.keyboard.press("Control+s");
    await expect(page.locator('footer[role="status"]')).toContainText("已保存");
    let applied;
    await expect.poll(async () => { applied = JSON.parse(await readFile(path, "utf8")); return applied.analysisResults.length; }).toBe(1);
    assert.equal(applied.supports.length, 4); assert.equal(applied.nodalLoads.length, 1);
    assert.deepEqual(applied.analysisResults[0].input.nodalLoads[0].force, { x: 5, y: -2, z: -10 });
    assert.equal(applied.nodes.length, 12); assert.equal(applied.members.length, 16);
    await collect();
    report.verified = { previewIsolation: true, stableReferences: true, sixDirections: true, twoConfirmations: true, automaticLocalSolve: true, analysisId: applied.analysisResults[0].id };
    await writeFile(resolve("docs/evidence/T23-online.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
    await page.screenshot({ path: resolve("docs/evidence/T23-online.png") });
    console.log(JSON.stringify({ status: "passed", model: settings.model, turns: report.turns.length }));
  } finally {
    try { await app?.close(); } finally {
      assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep) && basename(directory).startsWith("framemind-t23-online-"));
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  }
}
verify().catch(() => { console.error(JSON.stringify({ status: "failed", ...diagnostic })); process.exitCode = 1; });
