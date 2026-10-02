const { _electron: electron, expect } = require("@playwright/test");
const { copyFile, mkdtemp, readFile, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve, sep } = require("node:path");
const assert = require("node:assert/strict");
const diagnostic = { stage: "reuse-encrypted-credential" };

async function verify() {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t21-online-"));
  const projectPath = join(directory, "online.framemind");
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: projectPath };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  let app;
  try {
    const source = join(process.env.APPDATA, require("../package.json").name);
    // Copy only encrypted credential and encrypted profile key; never decrypt or print them here.
    await copyFile(join(source, "deepseek.credentials"), join(directory, "deepseek.credentials"));
    await copyFile(join(source, "Local State"), join(directory, "Local State"));
    diagnostic.stage = "launch";
    app = await electron.launch({ args: ["."], env });
    const page = await app.firstWindow();
    await expect(page.getByLabel("AI 消息草稿")).toBeVisible();
    diagnostic.stage = "settings";
    const settings = await page.evaluate(() => window.frameMind.getDeepSeekSettings());
    diagnostic.configured = settings.configured;
    diagnostic.storageAvailable = settings.storageAvailable;
    diagnostic.storageIssue = settings.issue;
    assert.equal(settings.configured, true);
    diagnostic.stage = "save-baseline";
    await page.keyboard.press("Control+s");
    await expect(page.getByRole("status")).toContainText("已保存");
    const before = await readFile(projectPath, "utf8");
    const report = { date: "2026-10-02", model: settings.model, network: "real DeepSeek HTTPS; no replay or fetch replacement", conversations: [] };
    async function ask(prompt) {
      diagnostic.stage = `conversation-${report.conversations.length + 1}`;
      await page.getByLabel("AI 消息草稿").fill(prompt);
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      const turn = page.locator(".ai-turn").last();
      await expect(turn.getByTestId("ai-turn-status")).toHaveText(/^(已完成|失败|已取消|缺少输入|等待确认) ·/, { timeout: 60_000 });
      const evidence = await turn.evaluate((element) => ({
        status: element.querySelector('[data-testid="ai-turn-status"]').textContent,
        assistant: element.querySelector(".ai-assistant-message")?.textContent,
        tools: Array.from(element.querySelectorAll(".ai-tool-record")).map((record) => ({
          label: record.querySelector("summary").textContent,
          input: JSON.parse(record.querySelector("pre").textContent), output: JSON.parse(record.querySelector(".ai-tool-output").textContent),
        })),
      }));
      diagnostic.feedback = evidence.status;
      diagnostic.toolLabels = evidence.tools.map((tool) => tool.label);
      diagnostic.proposalFields = evidence.tools.flatMap((tool) => Object.keys(tool.output.proposal?.parameters ?? {}));
      assert.ok(!/^(失败|已取消)/.test(evidence.status), "Live task failed.");
      assert.ok(evidence.tools.length > 0, "Live response must call predefined tools.");
      report.conversations.push({ prompt, ...evidence });
      return evidence.tools.find((tool) => tool.output.proposal)?.output.proposal;
    }
    const initial = await ask("建立一个两层空间钢刚架。先整理已知与缺失参数。");
    assert.equal(initial.parameters.storeys.value, 2);
    assert.equal(initial.parameters.storeys.source, "user");
    await ask("补齐参数：X向一跨6米，Y向一跨4米，两层层高均为3米，原点(0,0,0)米。钢材S355JR，柱HEA 200，梁IPE 200，截面转角0度。按这些明确参数更新当前卡片并生成预览。");
    const card = page.getByRole("region", { name: "建模参数卡片" });
    await expect(card.getByTestId("frame-proposal-counts")).toHaveText("将创建 12 个节点、8 根柱、8 根梁。");
    await card.getByLabel("X 向跨长 (m)", { exact: true }).fill("8");
    await card.getByRole("button", { name: "更新参数预览", exact: true }).click();
    const modified = await ask("第二层层高改成4米，其他参数保留当前卡片的值，重新生成预览。");
    assert.deepEqual(modified.parameters.xSpans.value, [8]);
    assert.deepEqual(modified.parameters.storeyHeights.value, [3, 4]);
    await expect(page.getByLabel("未应用三维方案")).toContainText("12 节点 / 16 杆件");
    await card.evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: resolve("docs/evidence/T21-online.png") });
    await ask("拒绝并取消这个建模方案，不要应用任何修改。");
    await expect(card).toHaveCount(0);
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await page.keyboard.press("Control+s"); await expect(page.getByRole("status")).toContainText("已保存");
    assert.equal(await readFile(projectPath, "utf8"), before);
    report.appliedProjectUnchanged = true;
    await writeFile(resolve("docs/evidence/T21-online.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ status: "passed", model: settings.model, conversations: report.conversations.length }));
  } finally {
    try { await app?.close(); } finally {
      assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
      assert.ok(require("node:path").basename(directory).startsWith("framemind-t21-online-"));
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  }
}
verify().catch(() => { console.error(JSON.stringify({ status: "failed", ...diagnostic })); process.exitCode = 1; });
