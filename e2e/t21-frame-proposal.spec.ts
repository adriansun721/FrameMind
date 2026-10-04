import { openProposalView, closeProposalDrawer, proposalDrawer } from "./proposal-drawer-actions";
import { expect, test } from "@playwright/test";
import { createNode } from "./modeling-actions";
import { desktop, parameters, replay, save, send } from "./frame-proposal-actions";

test("T21 supplements missing cards, edits and regenerates the same isolated two-storey preview", async () => {
  await desktop(async (app, page, path) => {
    await createNode(page, ["-2", "-3", "0"]);
    const before = await save(page, path);
    await replay(app, { storeys: { value: 2, source: "user" } });
    await closeProposalDrawer(page);
    await send(page, "建立一个两层空间钢刚架");
    let card = page.getByRole("region", { name: "建模参数卡片" });
    await openProposalView(page, card, "edit");
    await expect(proposalDrawer(page).getByLabel("层数", { exact: true })).toHaveValue("2");
    await openProposalView(page, card, "edit");
    await expect(proposalDrawer(page).getByText("用户提供", { exact: true })).toHaveCount(1);
    await openProposalView(page, card, "edit");
    await expect(proposalDrawer(page).getByText("尚缺失", { exact: true })).toHaveCount(8);
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await replay(app, parameters);
    await closeProposalDrawer(page);
    await send(page, "X跨6米，Y跨4米，每层3米，其余请给建议");
    await expect(card.getByTestId("frame-proposal-counts")).toHaveText("12 节点 · 8 柱 · 8 梁");
    await openProposalView(page, card, "edit");
    await expect(proposalDrawer(page).getByText("建议 · 待确认", { exact: true })).toHaveCount(5);
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    expect(await save(page, path)).toEqual(before);
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("X 向跨长 (m)", { exact: true }).fill("8");
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByRole("button", { name: "更新预览", exact: true }).click();
    await openProposalView(page, card, "edit");
    await expect(proposalDrawer(page).getByLabel("X 向跨长 (m)", { exact: true })).toHaveValue("8");
    await openProposalView(page, card, "details");
    await expect(proposalDrawer(page).getByText("预览 N12 · (8, 4, 6) m", { exact: true })).toBeVisible();
    await openProposalView(page, card, "details");
    await openProposalView(page, card, "actions");
    await proposalDrawer(page).getByRole("button", { name: "重新生成预览", exact: true }).click();
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
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
        expect(pixels).toBe(0);
        await page.screenshot({ path: `docs/evidence/T21-${theme}-${width}.png` });
      }
    }
    await openProposalView(page, card, "actions");
    await proposalDrawer(page).getByRole("button", { name: "拒绝方案", exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    expect(await save(page, path)).toEqual(before);
    await createNode(page, ["1", "2", "3"]);
    await expect(page.getByTestId("viewport-node-count")).toHaveText("2 个节点");
  });
});

test("T21 clarifies conflicts, rejects bad edits, accepts natural-language corrections and refuses proposals", async () => {
  await desktop(async (app, page) => {
    await closeProposalDrawer(page);
    await replay(app, parameters); await send(page, "两层，每层3米，X6米，Y4米");
    const card = page.getByRole("region", { name: "建模参数卡片" });
    await closeProposalDrawer(page);
    await replay(app, { xSpans: { value: [8], source: "user" } }); await send(page, "跨度是6米还是8米？");
    await expect(card.getByRole("alert")).toContainText("待澄清：[6] / [8]");
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("X 向跨长 (m)", { exact: true }).fill("-1");
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByRole("button", { name: "更新预览", exact: true }).click();
    await expect(proposalDrawer(page).getByRole("alert").last()).toContainText("必须全部大于零");
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("X 向跨长 (m)", { exact: true }).fill("8");
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByRole("button", { name: "更新预览", exact: true }).click();
    await replay(app, { storeyHeights: { value: [3, 4], source: "user", replace: true } });
    await closeProposalDrawer(page);
    await send(page, "第二层改成4米");
    await openProposalView(page, card, "edit");
    await expect(proposalDrawer(page).getByLabel("各层层高 (m)", { exact: true })).toHaveValue("3, 4");
    await openProposalView(page, card, "edit");
    await expect(proposalDrawer(page).getByLabel("X 向跨长 (m)", { exact: true })).toHaveValue("8");
    await closeProposalDrawer(page);
    await replay(app, {}, "discard_frame_proposal"); await send(page, "不要这个方案");
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId("viewport-node-count")).toHaveText("0 个节点");
  });
});

test("T21 retains current analysis and refreshes a proposal after compatible applied edits", async () => {
  await desktop(async (app, page, path) => {
    await createNode(page, ["0", "0", "0"]); await createNode(page, ["4", "0", "0"]);
    await page.getByRole("button", { name: "创建材料与截面" }).click(); await page.getByRole("button", { name: "保存材料与截面" }).click();
    await page.getByRole("button", { name: "创建杆件" }).click(); await page.getByRole("button", { name: "添加杆件" }).click();
    await page.getByRole("toolbar", { name: "建模工具" }).getByRole("button", { name: "支座", exact: true }).click(); await page.getByRole("button", { name: "添加支座" }).click();
    await page.getByRole("button", { name: "荷载", exact: true }).click(); await page.getByRole("menuitem", { name: "创建荷载" }).click(); await page.getByRole("dialog", { name: "创建节点集中荷载" }).getByLabel("FZ").fill("-3");
    await page.getByRole("button", { name: "添加节点荷载" }).click(); await page.getByRole("button", { name: "运行分析" }).click();
    await expect(page.getByRole("status")).toContainText("分析完成");
    const before = await save(page, path);
    await closeProposalDrawer(page);
    await replay(app, parameters); await send(page, "创建两层空间钢刚架方案");
    expect(await save(page, path)).toEqual(before);
    await page.getByRole("button", { name: "运行分析" }).click(); await expect(page.getByRole("status")).toContainText("分析完成");
    const recomputed = await save(page, path);
    // Recording a successful result increments the project revision; physical inputs must stay identical.
    expect(recomputed.latestAnalysis.input).toEqual({ ...before.latestAnalysis.input, projectRevision: before.revision });
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    const card = page.getByRole("region", { name: "建模参数卡片" });
    await openProposalView(page, card, "actions");
    await proposalDrawer(page).getByRole("button", { name: "重新生成预览", exact: true }).click();
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await createNode(page, ["10", "0", "0"]);
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "确认建模", exact: true })).toBeEnabled();
    await replay(app, { collection: "summary" }, "read_model");
    await closeProposalDrawer(page);
    await send(page, "读取当前已应用模型摘要");
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await openProposalView(page, card, "actions");
    await proposalDrawer(page).getByRole("button", { name: "重新生成预览", exact: true }).click();
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
    await openProposalView(page, card, "actions");
    await proposalDrawer(page).getByRole("button", { name: "拒绝方案", exact: true }).click();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已取消");
    await app.evaluate(async () => {
      (globalThis as typeof globalThis & { t21Release?: () => void }).t21Release?.();
      await new Promise<void>((done) => setImmediate(done));
    });
    await expect(card).toHaveCount(0);
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
  });
});
