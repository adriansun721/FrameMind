import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createNode } from "./modeling-actions";

const parameters = {
  storeys: { value: 2, source: "user" }, xSpans: { value: [6], source: "user" }, ySpans: { value: [4], source: "user" },
  storeyHeights: { value: [3, 3], source: "user" }, origin: { value: [0, 0, 0], source: "suggestion" },
  material: { value: "en10025-s355jr", source: "suggestion" }, columnSection: { value: "arcelor-hea200", source: "suggestion" },
  beamSection: { value: "arcelor-ipe200", source: "suggestion" }, rotationDegrees: { value: 0, source: "suggestion" },
};
async function desktop(run: (app: ElectronApplication, page: Page, path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t21-"));
  const path = join(directory, "proposal.framemind");
  const env = { ...process.env, FRAMEMIND_E2E_USER_DATA_PATH: directory, FRAMEMIND_E2E_PROJECT_PATH: path };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ args: ["."], env });
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "设置", exact: true });
    await settings.getByLabel("DeepSeek API Key").fill("sk-t21-fixture-only");
    await settings.getByRole("button", { name: "保存连接" }).click();
    await expect(settings.getByTestId("deepseek-feedback")).toHaveText("连接设置已保存");
    await settings.getByRole("button", { name: "关闭", exact: true }).click();
    await run(app, page, path);
  } finally {
    try { await app?.close(); } finally {
      if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid temporary directory");
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  }
}
async function replay(app: ElectronApplication, args: unknown, name = "propose_frame") {
  await app.evaluate((_electron, fixture) => {
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: request.messages.some((message: { role: string }) => message.role === "tool")
        ? { role: "assistant", content: "已拒绝方案，正式模型保持可用。" }
        : { role: "assistant", content: null, tool_calls: [{ id: "t21-proposal", index: 0, type: "function", function: { name: fixture.name, arguments: JSON.stringify(fixture.args) } }] } }] }));
    };
  }, { args: name === "propose_frame" ? { parameters: args } : args, name });
}
async function send(page: Page, prompt: string) {
  await page.getByLabel("AI 消息草稿").fill(prompt);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByTestId("ai-turn-status").last()).toHaveText(/^(等待确认|缺少输入|已完成) ·/);
}
async function save(page: Page, path: string) {
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("status")).toContainText("已保存");
  return JSON.parse(await readFile(path, "utf8"));
}

test("T21 supplements missing cards, edits and regenerates the same isolated two-storey preview", async () => {
  await desktop(async (app, page, path) => {
    await createNode(page, ["-2", "-3", "0"]);
    const before = await save(page, path);
    await replay(app, { storeys: { value: 2, source: "user" } });
    await send(page, "建立一个两层空间钢刚架");
    let card = page.getByRole("region", { name: "建模参数卡片" });
    await expect(card.getByLabel("层数", { exact: true })).toHaveValue("2");
    await expect(card.getByText("用户提供", { exact: true })).toHaveCount(1);
    await expect(card.getByText("尚缺失", { exact: true })).toHaveCount(8);
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await replay(app, parameters);
    await send(page, "X跨6米，Y跨4米，每层3米，其余请给建议");
    await expect(card.getByTestId("frame-proposal-counts")).toHaveText("将创建 12 个节点、8 根柱、8 根梁。");
    await expect(card.getByText("建议 · 待确认", { exact: true })).toHaveCount(5);
    await expect(page.getByLabel("未应用三维方案")).toContainText("12 节点 / 16 杆件");
    expect(await save(page, path)).toEqual(before);
    await card.getByLabel("X 向跨长 (m)", { exact: true }).fill("8");
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await card.getByRole("button", { name: "更新参数预览", exact: true }).click();
    await expect(card.getByLabel("X 向跨长 (m)", { exact: true })).toHaveValue("8");
    await card.getByText("涉及对象与创建内容", { exact: true }).click();
    await expect(card.getByText("预览 N12 · (8, 4, 6) m", { exact: true })).toBeVisible();
    await card.getByText("涉及对象与创建内容", { exact: true }).click();
    await card.getByRole("button", { name: "重新生成预览", exact: true }).click();
    await expect(page.getByLabel("未应用三维方案")).toContainText("16 杆件");
    for (const theme of ["dark", "light"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "设置", exact: true });
      await dialog.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      for (const width of [1440, 1080]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 900), width);
        await card.evaluate((element) => element.scrollIntoView({ block: "start" }));
        expect(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth)).toBe(true);
        // A rendered preview must actually contain its semantic color in the WebGL framebuffer.
        const pixels = await page.locator(".viewport canvas").evaluate((element) => new Promise<number>((done) => requestAnimationFrame(() => {
          const gl = (element as HTMLCanvasElement).getContext("webgl2")!;
          const buffer = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
          gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
          const color = getComputedStyle(document.documentElement).getPropertyValue("--model-preview").trim();
          const rgb = [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));
          let matches = 0;
          for (let i = 0; i < buffer.length; i += 4) if (rgb.every((value, c) => Math.abs(buffer[i + c] - value) < 25)) matches++;
          done(matches);
        })));
        expect(pixels).toBeGreaterThan(20);
        await page.screenshot({ path: `docs/evidence/T21-${theme}-${width}.png` });
      }
    }
    await card.getByRole("button", { name: "拒绝方案", exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    expect(await save(page, path)).toEqual(before);
    await createNode(page, ["1", "2", "3"]);
    await expect(page.getByTestId("viewport-node-count")).toHaveText("2 个节点");
  });
});

test("T21 clarifies conflicts, rejects bad edits, accepts natural-language corrections and refuses proposals", async () => {
  await desktop(async (app, page) => {
    await replay(app, parameters); await send(page, "两层，每层3米，X6米，Y4米");
    const card = page.getByRole("region", { name: "建模参数卡片" });
    await replay(app, { xSpans: { value: [8], source: "user" } }); await send(page, "跨度是6米还是8米？");
    await expect(card.getByRole("alert")).toContainText("当前 6 / 新值 8");
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await card.getByLabel("X 向跨长 (m)", { exact: true }).fill("-1");
    await card.getByRole("button", { name: "更新参数预览", exact: true }).click();
    await expect(card.getByRole("alert").last()).toContainText("必须全部大于零");
    await card.getByLabel("X 向跨长 (m)", { exact: true }).fill("8");
    await card.getByRole("button", { name: "更新参数预览", exact: true }).click();
    await replay(app, { storeyHeights: { value: [3, 4], source: "user", replace: true } });
    await send(page, "第二层改成4米");
    await expect(card.getByLabel("各层层高 (m)", { exact: true })).toHaveValue("3, 4");
    await expect(card.getByLabel("X 向跨长 (m)", { exact: true })).toHaveValue("8");
    await replay(app, {}, "discard_frame_proposal"); await send(page, "不要这个方案");
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId("viewport-node-count")).toHaveText("0 个节点");
  });
});

test("T21 retains current analysis while previewing and invalidates a proposal after applied edits", async () => {
  await desktop(async (app, page, path) => {
    await createNode(page, ["0", "0", "0"]); await createNode(page, ["4", "0", "0"]);
    await page.getByRole("button", { name: "创建材料与截面" }).click(); await page.getByRole("button", { name: "保存材料与截面" }).click();
    await page.getByRole("button", { name: "创建杆件" }).click(); await page.getByRole("button", { name: "添加杆件" }).click();
    await page.getByRole("button", { name: "设置支座" }).click(); await page.getByRole("button", { name: "添加支座" }).click();
    await page.getByRole("button", { name: "创建荷载" }).click(); await page.getByRole("dialog", { name: "创建节点集中荷载" }).getByLabel("FZ").fill("-3");
    await page.getByRole("button", { name: "添加节点荷载" }).click(); await page.getByRole("button", { name: "运行分析" }).click();
    await expect(page.getByRole("status")).toContainText("分析完成");
    const before = await save(page, path);
    await replay(app, parameters); await send(page, "创建两层空间钢刚架方案");
    expect(await save(page, path)).toEqual(before);
    await page.getByRole("button", { name: "运行分析" }).click(); await expect(page.getByRole("status")).toContainText("分析完成");
    const recomputed = await save(page, path);
    // Recording a successful result increments the project revision; physical inputs must stay identical.
    expect(recomputed.latestAnalysis.input).toEqual({ ...before.latestAnalysis.input, projectRevision: before.revision });
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    const card = page.getByRole("region", { name: "建模参数卡片" });
    await card.getByRole("button", { name: "重新生成预览", exact: true }).click();
    await expect(page.getByLabel("未应用三维方案")).toBeVisible();
    await createNode(page, ["10", "0", "0"]);
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await expect(page.getByText("正式模型已变化，原预览已失效。更新参数或重新生成后核对当前模型。", { exact: true })).toBeVisible();
    await replay(app, { collection: "summary" }, "read_model");
    await send(page, "读取当前已应用模型摘要");
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await card.getByRole("button", { name: "重新生成预览", exact: true }).click();
    await app.evaluate(() => {
      (globalThis as typeof globalThis & { t21Release?: () => void }).t21Release = undefined;
      globalThis.fetch = () => new Promise<Response>((done) => {
        (globalThis as typeof globalThis & { t21Release?: () => void }).t21Release = () => done(new Response(JSON.stringify({ choices: [{ message: {
          role: "assistant", content: null, tool_calls: [{ id: "late", type: "function", function: { name: "propose_frame", arguments: JSON.stringify({ parameters: { xSpans: { value: [9], source: "user", replace: true } } }) } }],
        } }] })));
      });
    });
    await page.getByLabel("AI 消息草稿").fill("X跨改成9米");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect.poll(() => app.evaluate(() => Boolean((globalThis as typeof globalThis & { t21Release?: () => void }).t21Release))).toBe(true);
    await card.getByRole("button", { name: "拒绝方案", exact: true }).click();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已取消");
    await app.evaluate(async () => {
      (globalThis as typeof globalThis & { t21Release?: () => void }).t21Release?.();
      await new Promise<void>((done) => setImmediate(done));
    });
    await expect(card).toHaveCount(0);
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
  });
});
