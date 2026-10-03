const { _electron: electron, expect } = require("@playwright/test");
const { copyFile, mkdtemp, readFile, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve, sep } = require("node:path");
const assert = require("node:assert/strict");
const diagnostic = { stage: "reuse-encrypted-credential" };

async function verify() {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t22-online-"));
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
    await ask("建立一个两层空间钢刚架：X向一跨6米，Y向一跨4米，两层层高均为3米，原点(0,0,0)米。钢材S355JR，柱HEA 200，梁IPE 200，截面转角0度。按这些明确参数生成预览，等待我确认。");
    const card = page.getByRole("region", { name: "建模参数卡片" });
    await expect(card.getByTestId("frame-proposal-counts")).toHaveText("将创建 12 个节点、8 根柱、8 根梁。");
    assert.equal(await readFile(projectPath, "utf8"), before);
    diagnostic.stage = "local-confirmation";
    await card.getByRole("button", { name: "确认建模", exact: true }).click();
    await expect(page.getByTestId("ai-turn-status").last()).toHaveText("已应用 · 建模阶段已应用，可整组撤销和重做");
    report.confirmation = JSON.parse(await page.locator(".ai-turn").last().locator(".ai-tool-output").textContent());
    assert.equal(report.confirmation.status, "applied");
    assert.equal(report.confirmation.data.objects.nodes.length, 12);
    assert.equal(report.confirmation.data.objects.members.length, 16);
    await expect(card).toHaveCount(0);
    await page.keyboard.press("Control+s");
    let applied;
    await expect.poll(async () => {
      try { applied = JSON.parse(await readFile(projectPath, "utf8")); return applied.nodes.length; }
      catch (error) { if (error.code === "ENOENT") return -1; throw error; }
    }).toBe(12);
    assert.equal(applied.members.length, 16);
    await ask("通过read_model读取summary，核对当前已应用的节点和杆件数量，不再提出新方案。");
    const reading = report.conversations.at(-1).tools.find((tool) => tool.output.data?.counts);
    assert.equal(reading.output.data.counts.nodes, 12);
    assert.equal(reading.output.data.counts.members, 16);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(page.getByTestId("viewport-node-count")).toHaveText("0 个节点");
    await ask("通过read_model读取summary，核对撤销后当前模型的节点和杆件数量，不创建方案。");
    const undone = report.conversations.at(-1).tools.find((tool) => tool.output.data?.counts);
    assert.equal(undone.output.data.counts.nodes, 0);
    assert.equal(undone.output.data.counts.members, 0);
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await expect(page.getByTestId("viewport-node-count")).toHaveText("12 个节点");
    await ask("通过read_model读取summary，核对重做后当前已应用的节点和杆件数量，不创建方案。");
    const redone = report.conversations.at(-1).tools.find((tool) => tool.output.data?.counts);
    assert.equal(redone.output.data.counts.nodes, 12);
    assert.equal(redone.output.data.counts.members, 16);
    await page.screenshot({ path: resolve("docs/evidence/T22-online.png") });
    report.verified = { atomicRevision: applied.revision === JSON.parse(before).revision + 1, undoRead: true, redoRead: true, previewIsolation: true };
    assert.equal(report.verified.atomicRevision, true);
    await writeFile(resolve("docs/evidence/T22-online.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ status: "passed", model: settings.model, conversations: report.conversations.length }));
  } finally {
    try { await app?.close(); } finally {
      assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
      assert.ok(require("node:path").basename(directory).startsWith("framemind-t22-online-"));
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  }
}
verify().catch(() => { console.error(JSON.stringify({ status: "failed", ...diagnostic })); process.exitCode = 1; });
