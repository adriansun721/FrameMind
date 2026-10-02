const { _electron: electron, expect } = require("@playwright/test");
const { copyFile, mkdtemp, mkdir, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const diagnostic = { stage: "launch" };

async function verify() {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t20-online-"));
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  let app;
  let summary;
  try {
    // Reuse encrypted credential and its encrypted profile key before Electron initializes OSCrypt.
    // Neither file is decrypted, logged or committed by this script.
    const manifest = require("../package.json");
    const source = join(process.env.APPDATA, manifest.productName ?? manifest.name);
    diagnostic.stage = "reuse-encrypted-credential";
    await copyFile(join(source, "deepseek.credentials"), join(directory, "deepseek.credentials"));
    await copyFile(join(source, "Local State"), join(directory, "Local State"));
    diagnostic.stage = "launch";
    app = await electron.launch({ args: ["."], env });
    const page = await app.firstWindow();
    await expect(page.getByLabel("AI 消息草稿")).toBeVisible();
    diagnostic.stage = "load-settings";
    const settings = await page.evaluate(() => window.frameMind.getDeepSeekSettings());
    diagnostic.configured = settings.configured;
    diagnostic.storageAvailable = settings.storageAvailable;
    diagnostic.storageIssue = settings.issue;
    assert.equal(settings.configured, true, "Configure the key in FrameMind settings first.");
    diagnostic.stage = "test-connection";
    const connection = await page.evaluate(() => window.frameMind.testDeepSeekConnection());
    diagnostic.connectionStatus = connection.status;
    assert.equal(connection.status, "success", connection.message);
    const gitOptions = { cwd: resolve(__dirname, ".."), encoding: "utf8" };
    const revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], gitOptions).trim();
    const changed = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "electron", "src"], gitOptions).trim();
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const report = { date, baseline: revision + (changed ? " + uncommitted application changes" : ""), model: settings.model,
      platform: process.platform, network: "real DeepSeek HTTPS; no replay or fetch replacement",
      connection: { status: connection.status, message: connection.message }, conversations: [] };

    async function node(coordinates) {
      await page.getByRole("button", { name: "创建节点", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "创建空间节点" });
      for (const [index, label] of ["X 坐标", "Y 坐标", "Z 坐标"].entries()) {
        await dialog.getByLabel(label, { exact: true }).fill(String(coordinates[index]));
      }
      await dialog.getByRole("button", { name: "添加到模型", exact: true }).click();
    }
    diagnostic.stage = "create-fixture";
    await node([1.25, -2, 3.5]);
    await node([5.25, -2, 3.5]);
    await page.getByRole("button", { name: "创建材料与截面", exact: true }).click();
    await page.getByRole("button", { name: "保存材料与截面", exact: true }).click();
    await page.getByRole("button", { name: "创建杆件", exact: true }).click();
    await page.getByRole("button", { name: "添加杆件", exact: true }).click();
    const properties = page.getByRole("region", { name: "对象属性" });
    const panel = page.getByRole("complementary", { name: "AI 对话", exact: true });
    async function ask(prompt) {
      diagnostic.stage = `conversation-${report.conversations.length + 1}`;
      await page.getByLabel("AI 消息草稿").fill(prompt);
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      const turn = panel.locator(".ai-turn").last();
      await expect(turn.getByTestId("ai-turn-status")).toHaveText(/^(已完成|失败|已取消|缺少输入|等待确认) ·/, { timeout: 60_000 });
      diagnostic.feedback = await turn.getByTestId("ai-turn-status").textContent();
      assert.ok(diagnostic.feedback.startsWith("已完成"), "The live conversation did not complete.");
      const evidence = await turn.evaluate((element) => ({
        context: JSON.parse(element.querySelector(".ai-context-details pre").textContent),
        status: element.querySelector('[data-testid="ai-turn-status"]').textContent,
        assistant: element.querySelector(".ai-assistant-message").textContent,
        tools: Array.from(element.querySelectorAll(".ai-tool-record")).map((record) => ({
          label: record.querySelector("summary").textContent,
          input: JSON.parse(record.querySelector("pre").textContent),
          output: JSON.parse(record.querySelector(".ai-tool-output").textContent),
        })),
      }));
      assert.ok(evidence.tools.length, "The live answer must contain actual tool evidence.");
      report.conversations.push({ prompt, ...evidence });
      return evidence;
    }
    const objects = (evidence) => evidence.tools.flatMap((tool) => tool.output.data?.objects ?? []);
    const replyText = (evidence) => evidence.assistant.replace(/\u2212/g, "-").replace(/\\_/g, "_");

    await page.getByRole("region", { name: "项目树" }).getByText("N1", { exact: true }).click();
    const selectedNode = await ask("请调用 read_selection 读取这个节点，回复它的稳定 ID 和真实三维坐标（m），不要猜测或修改模型。");
    assert.equal(selectedNode.context.selection[0].id, "node_0001");
    assert.deepEqual(objects(selectedNode)[0].position, { x: 1.25, y: -2, z: 3.5 });
    assert.ok(replyText(selectedNode).includes("node_0001"));
    for (const value of ["1.25", "-2", "3.5"]) assert.ok(replyText(selectedNode).includes(value));

    await page.getByRole("region", { name: "项目树" }).getByText("M1", { exact: true }).click();
    const selectedMember = await ask("请调用 read_selection 读取这根梁，回复稳定 ID、两端节点 ID、长度（m）、截面转角（度）、材料弹性模量（GPa）和截面面积（m²）。所有数值必须来自工具，不修改模型。");
    const member = objects(selectedMember)[0];
    assert.equal(member.id, "member_0001");
    assert.equal(member.geometry.length, 4);
    assert.equal(member.rotationDegrees, 0);
    assert.equal(member.material.elasticModulusGPa, 206);
    assert.equal(member.section.areaM2, 0.01);
    for (const value of ["member_0001", "node_0001", "node_0002", "206", "0.01"]) {
      assert.ok(replyText(selectedMember).includes(value));
    }

    await properties.getByLabel("截面转角（°）", { exact: true }).fill("45");
    await properties.getByRole("button", { name: "保存杆件属性", exact: true }).click();
    await expect(page.getByTestId("viewport-member-details")).toContainText("45°");
    const editedMember = await ask("请重新调用 read_selection 读取这根梁的当前已应用参数，回复稳定 ID、截面转角（度）和长度（m）。使用本次工具输出，不沿用之前的回答。");
    assert.equal(objects(editedMember)[0].rotationDegrees, 45);
    assert.equal(objects(editedMember)[0].geometry.length, 4);
    assert.ok(editedMember.context.modelRevision > selectedMember.context.modelRevision);
    assert.ok(replyText(editedMember).includes("45"));
    await expect(properties.getByLabel("截面转角（°）", { exact: true })).toHaveValue("45");
    await expect(panel.locator(".ai-turn").nth(1).locator(".ai-stale")).toHaveText("历史版本");

    const output = resolve("docs/evidence");
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "T20-online.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
    await page.screenshot({ path: join(output, "T20-online.png") });
    summary = { status: "passed", model: report.model, connection: connection.status,
      conversations: report.conversations.length, tools: report.conversations.map((turn) => turn.tools.length) };
  } finally {
    try {
      await app?.close();
    } finally {
      assert.equal(resolve(directory).startsWith(resolve(tmpdir()) + require("node:path").sep), true);
      assert.ok(require("node:path").basename(directory).startsWith("framemind-t20-online-"));
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  }
  console.log(JSON.stringify(summary));
}

verify().catch(() => {
  // Do not print an error object: provider errors or environment details may contain secrets.
  console.error(JSON.stringify({ status: "failed", ...diagnostic }));
  process.exitCode = 1;
});
