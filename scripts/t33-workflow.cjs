const { _electron: electron, expect } = require("@playwright/test");
const { copyFile, mkdtemp, readFile, writeFile, rm, mkdir, readdir } = require("node:fs/promises");
const { tmpdir, release, platform } = require("node:os");
const { join, resolve, sep, basename } = require("node:path");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const JSZip = require("jszip");
const { PDFDocument } = require("pdf-lib");
const fixture = require("../docs/fixtures/t33-demo.json");

async function installReplay(app) {
  await app.evaluate((_electron, demo) => {
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const prompt = request.messages.filter((item) => item.role === "user").at(-1).content;
      const tool = (name, args, id) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
      const comparing = prompt.includes("重算已完成") || prompt === demo.comparisonPrompt;
      const explaining = comparing || prompt === demo.explainPrompt;
      let message;
      if (explaining && request.messages.some((item) => item.role === "tool")) {
        const kind = comparing ? "comparison" : "result";
        message = { role: "assistant", content: `计算事实：[[${kind}:t33-node]]；[[${kind}:t33-reaction]]；[[${kind}:t33-member]]。原因推断：刚度与面积引起的自重共同影响响应，需结合冻结输入。不提供规范验算结论。` };
      } else if (explaining) {
        const name = comparing ? "read_comparison_result" : "read_result";
        message = { role: "assistant", content: null, tool_calls: [
          tool(comparing ? "read_comparison" : "read_results", { collection: "summary" }, "t33-summary"),
          tool(name, { kind: "node", id: "node_0010", quantity: "displacement", component: "x" }, "t33-node"),
          tool(name, { kind: "node", id: "node_0001", quantity: "reaction", component: "z" }, "t33-reaction"),
          tool(name, { kind: "member", id: "member_0001", quantity: "startEndForces", component: "N" }, "t33-member"),
        ] };
      } else if (prompt === demo.changePrompt) {
        message = { role: "assistant", content: null, tool_calls: [tool("propose_section_change", demo.sectionChange, "t33-change")] };
      } else if (prompt.includes("建模阶段已确认")) {
        message = { role: "assistant", content: null, tool_calls: [tool("propose_analysis_conditions", demo.loads, "t33-loads")] };
      } else {
        const parameters = { ...demo.parameters }; delete parameters.ySpans;
        message = { role: "assistant", content: null, tool_calls: [tool("propose_frame", { parameters }, "t33-frame")] };
      }
      return new Response(JSON.stringify({ choices: [{ message }] }));
    };
  }, fixture);
}

async function collect(page) {
  return page.locator(".ai-turn").evaluateAll((items) => items.map((item) => ({
    prompt: item.querySelector(".ai-user-message")?.textContent,
    status: item.querySelector('[data-testid="ai-turn-status"]')?.textContent,
    assistant: item.querySelector(".ai-assistant-message")?.textContent,
    renderedReferences: Array.from(item.querySelectorAll(".ai-result-reference")).map((button) => button.textContent),
    tools: Array.from(item.querySelectorAll(".ai-tool-record")).map((record) => ({
      name: record.querySelector("summary")?.textContent,
      input: JSON.parse(record.querySelector("pre").textContent),
      output: JSON.parse(record.querySelector(".ai-tool-output").textContent),
    })),
  })));
}

function verifyModel(project) {
  assert.equal(project.nodes.length, 12); assert.equal(project.members.length, 16);
  assert.deepEqual(project.nodes.map((item) => item.position), [0, 3, 6].flatMap((z) => [0, 4].flatMap((y) => [0, 6].map((x) => ({ x, y, z })))));
  assert.equal(project.materials.length, 1);
  assert.equal(project.materials[0].provenance.catalogId, fixture.parameters.material.value);
  assert.equal(project.materials[0].elasticModulusGPa, 210);
  assert.equal(project.materials[0].densityKgM3, 7850);
  assert.equal(project.sections[0].provenance.catalogId, fixture.parameters.columnSection.value);
  assert.equal(project.sections[1].provenance.catalogId, fixture.parameters.beamSection.value);
  assert.ok(project.members.every((member) => member.rotationDegrees === 0));
}

function verifyLoads(project) {
  assert.equal(project.supports.length, 4);
  assert.ok(project.supports.every((item) => item.restraints.every(Boolean) && project.nodes.find((node) => node.id === item.nodeId).position.z === 0));
  assert.equal(project.nodalLoads.length, 1); assert.equal(project.uniformLoads.length, 1);
  const nodal = project.nodalLoads[0]; const uniform = project.uniformLoads[0];
  assert.deepEqual(project.nodes.find((node) => node.id === nodal.nodeId).position, { x: 6, y: 0, z: 6 });
  assert.deepEqual(nodal.force, { x: 5, y: 0, z: 0 }); assert.deepEqual(nodal.moment, { x: 0, y: 0, z: 0 });
  const member = project.members.find((item) => item.id === uniform.memberId);
  assert.deepEqual([member.startNodeId, member.endNodeId].map((id) => project.nodes.find((node) => node.id === id).position).sort((a, b) => a.x - b.x), [{ x: 0, y: 0, z: 6 }, { x: 6, y: 0, z: 6 }]);
  assert.deepEqual(uniform.intensity, { x: 0, y: 0, z: -2 }); assert.equal(uniform.coordinateSystem, "global");
  const dead = project.loadCases.find((item) => item.name === "恒载"); const live = project.loadCases.find((item) => item.name === "演示外荷载");
  assert.ok(dead && live); assert.equal(project.loadCases.length, 2);
  assert.equal(nodal.loadCaseId, live.id); assert.equal(uniform.loadCaseId, live.id);
  assert.deepEqual(project.selfWeight, { enabled: true, loadCaseId: dead.id, gravity: { x: 0, y: 0, z: -9.81 } });
  assert.equal(project.loadCombinations.length, 1);
  assert.deepEqual(project.loadCombinations[0].terms, [{ loadCaseId: dead.id, factor: 1 }, { loadCaseId: live.id, factor: 1.5 }]);
  assert.equal(project.activeLoadCombinationId, project.loadCombinations[0].id);
}

function verifyEquilibrium(project, result) {
  // Independent global force balance: total steel volume and the fixed applied forces.
  const volume = project.members.reduce((sum, member) => {
    const ends = [member.startNodeId, member.endNodeId].map((id) => project.nodes.find((node) => node.id === id).position);
    return sum + Math.hypot(ends[1].x - ends[0].x, ends[1].y - ends[0].y, ends[1].z - ends[0].z) * project.sections.find((section) => section.id === member.sectionId).areaM2;
  }, 0);
  const reaction = result.nodes.reduce((sum, node) => ({ x: sum.x + node.reaction.x, y: sum.y + node.reaction.y, z: sum.z + node.reaction.z }), { x: 0, y: 0, z: 0 });
  const expected = { x: -7.5, y: 0, z: volume * 7850 * 9.81 / 1000 + 18 };
  for (const axis of ["x", "y", "z"]) assert.ok(Math.abs(reaction[axis] - expected[axis]) < 1e-7, `Global ${axis} force balance`);
  return { reaction, expected, toleranceKN: 1e-7 };
}

function verifyReferences(turn, before, after) {
  const expected = [
    ["node_0010", "displacement", "x"], ["node_0001", "reaction", "z"], ["member_0001", "startEndForces", "N"],
  ];
  const value = (result, id, quantity, component) => id.startsWith("node")
    ? result.nodes.find((node) => node.nodeId === id)[quantity][component]
    : result.members.find((member) => member.memberId === id).localEndForces.start[0];
  for (const [id, quantity, component] of expected) {
    const output = turn.tools.map((item) => item.output).find((item) => {
      const ref = after ? item.comparisonReference?.after : item.reference;
      return ref?.object.id === id && ref.quantity === quantity && ref.component === component;
    });
    assert.ok(output, `Missing verified ${id} ${quantity} ${component}`);
    const ref = after ? output.comparisonReference : output.reference;
    const first = after ? ref.before : ref;
    assert.equal(first.analysisId, before.id); assert.equal(first.source.id, before.input.combination.definition.id);
    assert.equal(first.value, value(before, id, quantity, component));
    const label = { displacement: "位移", reaction: "反力", startEndForces: "起点杆端作用力" }[quantity];
    const prefix = after ? `${ref.after.object.label} · ${component}：${first.value.toPrecision(8)} → ${ref.after.value.toPrecision(8)} ${ref.unit} · Δ ${ref.delta.toPrecision(8)} ${ref.unit}`
      : `${first.object.label} · ${label} ${component} = ${first.value.toPrecision(8)} ${first.unit}`;
    assert.ok(turn.renderedReferences.some((text) => text.startsWith(prefix)), `Explanation omitted visible ${id} ${quantity} ${component} reference`);
    if (after) {
      assert.equal(ref.after.analysisId, after.id); assert.equal(ref.after.value, value(after, id, quantity, component));
      assert.equal(ref.delta, ref.after.value - ref.before.value);
    }
  }
}

async function runT33({ theme, online = false, evidenceRoot = "docs/evidence/T33", executablePath }) {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t33-"));
  const mode = online ? "online" : "replay";
  const output = resolve(evidenceRoot, `${mode}-${theme}`);
  await mkdir(output, { recursive: true });
  const projectPath = join(directory, "两层空间钢刚架.framemind");
  const wordPath = join(directory, "演示计算书.docx"); const pdfPath = join(directory, "演示计算书.pdf");
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: projectPath,
    FRAMEMIND_E2E_REPORT_PATH: wordPath, FRAMEMIND_E2E_REPORT_PDF_PATH: pdfPath };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const report = { runId: randomUUID(), startedAt: new Date().toISOString(), outcome: "running",
    fixtureId: fixture.id, date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date()), theme, mode,
    network: online ? "Real DeepSeek HTTPS; no fetch replacement" : "Fixed tool HTTP replay; real local Worker solve and report export",
    environment: { platform: platform(), os: release(), architecture: process.arch }, stage: "launch", firstUse: "Pending real participant; automation is not AC-20 evidence" };
  report.fixtureSHA256 = createHash("sha256").update(await readFile(resolve("docs/fixtures/t33-demo.json"))).digest("hex");
  report.buildIndexSHA256 = createHash("sha256").update(await readFile(resolve("dist/index.html"))).digest("hex");
  let app;
  // Invalidate the prior success before any connection/application operation.
  await writeFile(join(output, "validation.json"), JSON.stringify(report, null, 2) + "\n");
  try {
    if (online) {
      const source = join(process.env.APPDATA, require("../package.json").name);
      for (const name of ["deepseek.credentials", "Local State"]) await copyFile(join(source, name), join(directory, name));
    }
    app = await electron.launch({ executablePath, args: executablePath ? [] : ["."], env }); const page = await app.firstWindow();
    if (executablePath) {
      report.installedExecutableSHA256 = createHash("sha256").update(await readFile(executablePath)).digest("hex");
      report.installedApp = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, appPath: app.getAppPath(), executable: process.execPath }));
      assert.equal(report.installedApp.packaged, true);
      report.installedArchiveSHA256 = createHash("sha256").update(await readFile(join(report.installedApp.appPath))).digest("hex");
    }
    await expect(page.getByRole("button", { name: "文件", exact: true })).toBeVisible();
    report.environment.runtime = await app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node }));
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "设置", exact: true });
    if (!online) {
      await settings.getByLabel("DeepSeek API Key").fill("sk-t33-fixture-only");
      await settings.getByRole("button", { name: "保存连接" }).click();
      await expect(settings.getByTestId("deepseek-feedback")).toHaveText("连接设置已保存");
    }
    await settings.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
    await settings.getByRole("button", { name: "关闭", exact: true }).click();
    const connection = await page.evaluate(() => window.frameMind.getDeepSeekSettings());
    assert.equal(connection.configured, true); report.model = connection.model;
    if (!online) await installReplay(app);
    async function capture(name) {
      for (const [width, height] of [[1440, 900], [1080, 680]]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
        if (await page.getByRole("dialog").count() === 0) await page.getByRole("button", { name: "适合模型", exact: true }).click();
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth), true);
        await page.screenshot({ path: join(output, `${name}-${width}.png`) });
      }
    }
    async function send(prompt) {
      await page.getByLabel("AI 消息草稿").fill(prompt);
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
    }
    async function save() {
      await page.keyboard.press("Control+s");
      await expect(page.locator('footer[role="status"]')).toContainText("已保存");
      await expect(page.getByLabel("未保存修改", { exact: true })).toHaveCount(0);
      return JSON.parse(await readFile(projectPath, "utf8"));
    }
    report.stage = "conversation-home";
    await expect(page.getByRole("region", { name: "历史对话列表" })).toBeVisible();
    await expect(page.getByRole("region", { name: "首次使用引导" })).toHaveCount(0);
    await expect(page.getByLabel("AI 消息草稿")).toHaveValue("");
    await expect(page.getByTestId("ai-turn-status")).toHaveCount(0);
    await capture("guide");
    report.stage = "parameter-completion";
    await send(fixture.initialPrompt);
    const frame = page.getByRole("region", { name: "建模参数卡片" });
    await expect(frame).toBeVisible({ timeout: 90_000 });
    const confirmFrame = frame.getByRole("button", { name: "确认建模", exact: true });
    await expect(confirmFrame).toBeDisabled();
    await frame.getByRole("button", { name: "编辑", exact: true }).click();
    const editor = page.locator(".proposal-drawer");
    await editor.getByLabel("Y 向跨长 (m)", { exact: true }).fill("4");
    await editor.getByRole("button", { name: "更新预览", exact: true }).click();
    await expect(confirmFrame).toBeEnabled();
    await expect(frame.getByTestId("frame-proposal-counts")).toContainText("12 节点 · 8 柱 · 8 梁");
    assert.equal((await save()).nodes.length, 0);
    await frame.getByText("空间刚架建模方案", { exact: true }).scrollIntoViewIfNeeded();
    await capture("frame-preview");
    report.stage = "conditions-confirmation";
    await confirmFrame.click();
    const conditions = page.getByRole("region", { name: "分析条件卡片" });
    const confirmConditions = conditions.getByRole("button", { name: "确认并计算", exact: true });
    await expect(confirmConditions).toBeEnabled({ timeout: 90_000 });
    if (online) {
      const proposed = (await collect(page)).flatMap((turn) => turn.tools).filter((tool) => tool.output.conditions).at(-1).output.conditions;
      if (!proposed.loadCases?.some((item) => item.id === "LC1" && item.name === "恒载")
          || !proposed.loadCases.some((item) => !item.id && item.name === "演示外荷载")) {
        const cases = (proposed.loadCases ?? []).map((item) => ({ ...item,
          name: item.id === "LC1" ? "恒载" : "演示外荷载", source: "user" }));
        if (!cases.some((item) => item.id === "LC1")) cases.push({ ref: "LC1", id: "LC1", name: "恒载", description: "结构自重", source: "user" });
        report.conditionCorrection = `请只补充更新当前分析条件卡片的工况名称。调用 propose_analysis_conditions，loadCases 字段使用 ${JSON.stringify(cases)}。保留原工况别名和其他所有字段，支座、荷载、自重、组合与计算来源均不变。继续保留原请求的计算意图：现在准备预览，等我确认条件后自动计算该用户组合。不创建框架。`;
        await send(report.conditionCorrection);
        await expect(confirmConditions).toBeEnabled({ timeout: 90_000 });
      }
    }
    await conditions.getByRole("button", { name: "编辑", exact: true }).click();
    if (await editor.getByLabel("组合 1 名称", { exact: true }).inputValue() !== fixture.loads.loadCombinations[0].name) {
      report.cardEdits = { ...report.cardEdits, combinationName: fixture.loads.loadCombinations[0].name };
      await editor.getByLabel("组合 1 名称", { exact: true }).fill(fixture.loads.loadCombinations[0].name);
      await editor.getByRole("button", { name: "更新预览", exact: true }).click();
      await expect(confirmConditions).toBeEnabled();
      await conditions.getByRole("button", { name: "编辑", exact: true }).click();
    }
    // Review the actual target selectors before applying any loads. AI numbering guesses are not accepted.
    for (const [label, expected] of [["荷载 1 节点", fixture.loads.nodalLoads[0].nodeId], ["均布荷载 1 杆件", fixture.loads.uniformLoads[0].memberId]]) {
      const selector = editor.getByLabel(label, { exact: true }); const actual = await selector.inputValue();
      if (actual !== expected) {
        assert.ok(online, "Replay target must match the fixed fixture");
        report.cardEdits = { ...report.cardEdits, [label]: { before: actual, after: expected, reason: "核对固定演示坐标与真实稳定身份" } };
        await selector.selectOption(expected);
        await editor.getByRole("button", { name: "更新预览", exact: true }).click();
        await expect(confirmConditions).toBeEnabled();
        await conditions.getByRole("button", { name: "编辑", exact: true }).click();
      }
    }
    await editor.getByRole("button", { name: "取消编辑", exact: true }).click();
    const geometry = await save(); verifyModel(geometry);
    assert.equal(geometry.supports.length, 0); assert.equal(geometry.nodalLoads.length, 0);
    assert.equal(geometry.uniformLoads.length, 0); assert.equal(geometry.selfWeight.enabled, false); assert.equal(geometry.analysisResults.length, 0);
    await expect(page.getByLabel("未应用三维方案")).toContainText("4 支座 / 1 节点荷载");
    await expect(page.getByLabel("待确认自重标记", { exact: true })).toBeVisible();
    await capture("conditions-preview");
    await confirmConditions.click();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已完成 · 本地分析完成", { timeout: 30_000 });
    const before = await save(); verifyModel(before); verifyLoads(before); assert.equal(before.analysisResults.length, 1);
    const first = before.analysisResults[0]; report.beforeBalance = verifyEquilibrium(before, first);
    await writeFile(join(output, "before.framemind"), JSON.stringify(before, null, 2) + "\n");
    await page.getByRole("button", { name: "查看分析结果", exact: true }).click();
    for (const view of ["变形图", "内力图"]) {
      await page.getByRole("tab", { name: view, exact: true }).click();
      await expect(page.getByLabel("视图结果图例", { exact: true })).toBeVisible();
      await capture(view === "变形图" ? "deformation" : "forces");
    }
    report.stage = "result-explanation";
    await send(fixture.explainPrompt);
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已引用所选分析", { timeout: 90_000 });
    verifyReferences((await collect(page)).at(-1), first);
    await page.locator(".ai-turn").last().locator(".ai-result-reference").first().click();
    await expect(page.getByRole("region", { name: "引用结果项" })).toContainText(first.id);
    await capture("reference");
    await page.getByRole("button", { name: "关闭引用结果", exact: true }).click();
    report.stage = "selected-column-change";
    for (const label of fixture.selectedColumns) await page.getByLabel(`选择杆件 ${label}`, { exact: true }).check();
    await send(fixture.changePrompt);
    const section = page.getByRole("region", { name: "选柱截面修改方案" });
    await expect(section).toBeVisible({ timeout: 90_000 });
    await expect(section.getByRole("button", { name: "确认并重算", exact: true })).toBeEnabled();
    await section.getByRole("button", { name: "编辑", exact: true }).click();
    if (await editor.getByLabel("新柱截面名称", { exact: true }).inputValue() !== fixture.sectionChange.section.name) {
      report.cardEdits = { ...report.cardEdits, sectionName: fixture.sectionChange.section.name };
      await editor.getByLabel("新柱截面名称", { exact: true }).fill(fixture.sectionChange.section.name);
      await editor.getByRole("button", { name: "更新预览", exact: true }).click();
    } else {
      await editor.getByRole("button", { name: "取消编辑", exact: true }).click();
    }
    await expect(page.getByLabel("未应用三维方案")).toContainText("2 根选中柱");
    assert.deepEqual((await save()).members, before.members);
    await capture("section-preview");
    await section.getByRole("button", { name: "确认并重算", exact: true }).click();
    const automaticTurn = page.locator(".ai-turn").filter({ has: page.locator(".ai-user-message").filter({ hasText: "截面修改已确认且本地重算已完成" }) });
    await expect(automaticTurn).toHaveCount(1, { timeout: 30_000 });
    await expect(automaticTurn.getByTestId("ai-turn-status")).toHaveText(/^(已完成|失败|已取消) ·/, { timeout: 90_000 });
    const automaticStatus = await automaticTurn.getByTestId("ai-turn-status").textContent();
    if (!automaticStatus.includes("已引用两次确定分析")) {
      assert.ok(online, "Replay must complete the automatic comparison");
      report.automaticComparisonInterruption = (await collect(page)).at(-1);
    }
    const after = await save(); verifyLoads(after); assert.equal(after.analysisResults.length, 2);
    const second = after.analysisResults[1]; report.afterBalance = verifyEquilibrium(after, second);
    assert.deepEqual(after.analysisResults[0], first); assert.deepEqual(after.sections.slice(0, 2), before.sections);
    assert.deepEqual(after.nodes, before.nodes); assert.deepEqual(after.supports, before.supports);
    for (const member of after.members) {
      const original = before.members.find((item) => item.id === member.id);
      if (fixture.selectedColumns.includes(member.label)) {
        const changed = after.sections.find((item) => item.id === member.sectionId);
        for (const [key, value] of Object.entries(fixture.sectionChange.section)) assert.equal(changed[key], value);
        assert.deepEqual({ ...member, sectionId: original.sectionId }, original);
      } else assert.deepEqual(member, original);
    }
    await send(fixture.comparisonPrompt);
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已引用两次确定分析", { timeout: 90_000 });
    verifyReferences((await collect(page)).at(-1), first, second);
    await page.locator(".ai-turn").last().locator(".ai-comparison-reference").first().click();
    const comparison = page.getByRole("dialog", { name: "前后结果对比", exact: true });
    await expect(comparison.getByLabel("前一份结果")).toHaveValue(first.id);
    await expect(comparison.getByLabel("后一份结果")).toHaveValue(second.id);
    await capture("comparison");
    await comparison.getByRole("button", { name: "关闭", exact: true }).click();
    report.stage = "word-pdf-export";
    await page.getByRole("button", { name: "工程计算书", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "工程计算书", exact: true });
    await dialog.getByLabel("报告分析来源").selectOption(second.id);
    await dialog.getByRole("checkbox", { name: /杆件过程（/ }).check();
    await dialog.getByRole("checkbox", { name: /附录杆件 M1 ·/ }).check();
    await dialog.getByRole("checkbox", { name: "整体约束处理与荷载向量", exact: true }).check();
    await capture("report");
    for (const format of ["Word", "PDF"]) {
      await dialog.getByRole("button", { name: `导出 ${format}`, exact: true }).click();
      await expect(page.locator('footer[role="status"]')).toContainText(`已导出 ${format} 计算书`, { timeout: 60_000 });
    }
    const word = await JSZip.loadAsync(await readFile(wordPath));
    const xml = await word.file("word/document.xml").async("string");
    for (const value of [second.id, "演示用户组合", "0.01076", "1.5", "S355JR", "HEA 200", "IPE 200"]) assert.ok(xml.includes(value), `Word omitted ${value}`);
    assert.ok(!xml.includes(first.id)); assert.ok(!xml.includes("sk-t33-fixture-only"));
    const pdfBytes = await readFile(pdfPath); assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");
    const pdf = await PDFDocument.load(pdfBytes); assert.ok(pdf.getPageCount() > 1); report.pdfPages = pdf.getPageCount();
    await copyFile(wordPath, join(output, "计算书.docx")); await copyFile(pdfPath, join(output, "计算书.pdf"));
    report.turns = await collect(page);
    await dialog.getByRole("button", { name: "关闭", exact: true }).last().click();
    report.stage = "save-reopen";
    await save(); await copyFile(projectPath, join(output, "after.framemind"));
    await page.keyboard.press("Control+o"); await expect(page.locator('footer[role="status"]')).toContainText("已打开");
    assert.deepEqual((await save()).analysisResults, after.analysisResults);
    await expect(page.getByTestId("ai-turn-status")).toHaveCount(0);
    if (!online) {
      report.stage = "network-failure";
      await app.evaluate(() => { globalThis.fetch = async () => { throw new TypeError("fixture network failure"); }; });
      await send("解释当前模型结果");
      await expect(page.getByTestId("ai-turn-status").last()).toContainText("失败", { timeout: 15_000 });
      await expect(page.getByRole("button", { name: "运行分析", exact: true })).toBeEnabled();
      const preserved = await save(); assert.deepEqual(preserved.members, after.members); assert.deepEqual(preserved.analysisResults, after.analysisResults);
      await capture("network-failure"); report.failureTurns = await collect(page);
    }
    report.stage = "passed";
    report.outcome = "passed"; report.finishedAt = new Date().toISOString();
    report.verified = { parameterCompletion: true, previewIsolation: true, multiCaseCombination: true,
      independentForceBalance: true, actualResultReferences: true, selectedColumnsOnly: true,
      immutableBeforeResult: true, comparisonReferences: true, wordPdfExport: true, saveReopen: true };
    report.artifacts = {};
    for (const name of ["before.framemind", "after.framemind", "计算书.docx", "计算书.pdf",
      ...(await readdir(output)).filter((name) => /-\d+\.png$/.test(name))]) {
      report.artifacts[name] = createHash("sha256").update(await readFile(join(output, name))).digest("hex");
    }
    await writeFile(join(output, "validation.json"), JSON.stringify(report, null, 2) + "\n");
    return report;
  } catch (error) {
    report.outcome = "failed"; report.finishedAt = new Date().toISOString();
    if (app) {
      try {
        const page = await app.firstWindow();
        try { report.turns = await collect(page); }
        catch (captureError) { report.collectionErrorType = captureError.name; }
        await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
      } catch (captureError) { report.windowErrorType = captureError.name; }
    }
    await writeFile(join(output, "failure.json"), JSON.stringify({ ...report, errorType: error.name, errorCode: error.code,
      ...(error.code === "ERR_ASSERTION" ? { assertion: error.message, stack: error.stack } : {}) }, null, 2) + "\n");
    await writeFile(join(output, "validation.json"), JSON.stringify(report, null, 2) + "\n");
    throw error;
  } finally {
    try { await app?.close(); } finally {
      assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep) && basename(directory).startsWith("framemind-t33-"));
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  }
}

module.exports = { runT33 };
