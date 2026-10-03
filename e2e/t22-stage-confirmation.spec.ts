import { openProposalView, closeProposalDrawer, proposalDrawer } from "./proposal-drawer-actions";
import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createNode } from "./modeling-actions";
import { desktop, parameters, replay, save, send } from "./frame-proposal-actions";

test("T22 confirms one stage, synchronizes AI reads and restores the complete saved edit with undo and redo", async () => {
  await desktop(async (app, page, path) => {
    await createNode(page, ["-2", "-3", "0"]);
    const before = await save(page, path);
    await closeProposalDrawer(page);
    await replay(app, parameters); await send(page, "创建两层空间刚架预览");
    const card = page.getByRole("region", { name: "建模参数卡片" });
    await expect(card.getByRole("button", { name: "确认建模", exact: true })).toBeEnabled();
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByLabel("X 向跨长 (m)", { exact: true }).fill("8");
    await expect(card.getByRole("button", { name: "确认建模", exact: true })).toBeDisabled();
    await openProposalView(page, card, "edit");
    await proposalDrawer(page).getByRole("button", { name: "更新预览", exact: true }).click();
    await card.getByRole("button", { name: "确认建模", exact: true }).dblclick();
    await expect(page.getByTestId("ai-turn-status").last()).toHaveText("已应用 · 建模阶段已应用，可整组撤销和重做");
    await expect(page.locator(".ai-turn").last().getByRole("button", { name: "重试消息", exact: true })).toHaveCount(0);
    await expect(card).toHaveCount(0);
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await expect(page.getByTestId("viewport-node-count")).toHaveText("13 个节点");
    await page.keyboard.press("Control+s");
    let applied: typeof before;
    await expect.poll(async () => {
      try { applied = JSON.parse(await readFile(path, "utf8")); return applied.revision; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return -1; throw error; }
    }).toBe(before.revision + 1);
    expect(applied!.nodes).toHaveLength(13); expect(applied!.members).toHaveLength(16);
    expect(applied!.nodes.at(-1).position).toEqual({ x: 8, y: 4, z: 6 });
    expect(applied!.materials).toHaveLength(1); expect(applied!.sections).toHaveLength(2);
    const properties = page.getByRole("region", { name: "对象属性" });
    await expect(page.getByRole("region", { name: "项目树" }).getByText("N13", { exact: true })).toBeVisible();
    await page.getByRole("region", { name: "项目树" }).getByText("N13", { exact: true }).click();
    await expect(page.getByRole("region", { name: "对象属性" }).getByLabel("X 坐标", { exact: true })).toHaveValue("8");
    await closeProposalDrawer(page);
    await replay(app, { collection: "summary" }, "read_model"); await send(page, "读取已应用模型摘要");
    const turn = page.locator(".ai-turn").last();
    await expect(turn.locator(".ai-tool-output")).toContainText('"nodes": 13');
    await expect(turn.locator(".ai-tool-output")).toContainText('"members": 16');
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(page.getByTestId("viewport-node-count")).toHaveText("1 个节点");
    await expect(page.getByRole("region", { name: "项目树" }).getByText("N13", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Control+s");
    await expect.poll(async () => {
      try { return JSON.parse(await readFile(path, "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    }).toEqual(before);
    await closeProposalDrawer(page);
    await send(page, "撤销后再次读取摘要");
    await expect(page.locator(".ai-turn").last().locator(".ai-tool-output")).toContainText('"nodes": 1');
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await expect(page.getByTestId("viewport-node-count")).toHaveText("13 个节点");
    await page.keyboard.press("Control+s");
    await expect.poll(async () => {
      try { return JSON.parse(await readFile(path, "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    }).toEqual(applied!);
    await page.keyboard.press("Control+o");
    await expect(page.getByTestId("viewport-node-count")).toHaveText("13 个节点");
    await expect(page.getByRole("region", { name: "建模参数卡片" })).toHaveCount(0);
  });
});

test("T22 exposes failed atomic applications and leaves the existing project and history usable", async () => {
  await desktop(async (app, page, path) => {
    const before = await save(page, path);
    before.nextMemberNumber = Number.MAX_SAFE_INTEGER - 1;
    await writeFile(path, JSON.stringify(before), "utf8");
    await page.keyboard.press("Control+o");
    await expect(page.getByRole("status")).toContainText("已打开");
    await closeProposalDrawer(page);
    await replay(app, { storeys: parameters.storeys }); await send(page, "准备两层刚架草稿");
    const card = page.getByRole("region", { name: "建模参数卡片" });
    await expect(card.getByRole("button", { name: "确认建模", exact: true })).toBeDisabled();
    await closeProposalDrawer(page);
    await replay(app, parameters); await send(page, "补齐参数并生成预览");
    await closeProposalDrawer(page);
    await card.getByRole("button", { name: "确认建模", exact: true }).click();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("失败 · 项目编号状态无法安全递增");
    await expect(page.locator(".ai-turn").last().getByRole("button", { name: "重试消息", exact: true })).toHaveCount(0);
    await expect(page.locator(".ai-turn").last().getByRole("button", { name: "打开连接设置", exact: true })).toHaveCount(0);
    await closeProposalDrawer(page);
    await card.getByRole("button", { name: "确认建模", exact: true }).click();
    await expect(page.getByTestId("ai-turn-status").filter({ hasText: "失败 · 项目编号状态无法安全递增" })).toHaveCount(2);
    await expect(page.getByTestId("viewport-node-count")).toHaveText("0 个节点");
    await expect(page.getByRole("button", { name: "撤销（尚未实现）", exact: true })).toBeDisabled();
    expect(await save(page, path)).toEqual(before);
    await openProposalView(page, card, "actions");
    await proposalDrawer(page).getByRole("button", { name: "拒绝方案", exact: true }).click();
    await createNode(page, ["1", "2", "3"]);
    await expect(page.getByTestId("viewport-node-count")).toHaveText("1 个节点");
  });
});

test("T22 requires refreshing a stale model and confirming every subsequent stage", async () => {
  await desktop(async (app, page) => {
    await closeProposalDrawer(page);
    await replay(app, parameters); await send(page, "准备两层空间刚架方案");
    const card = page.getByRole("region", { name: "建模参数卡片" });
    await createNode(page, ["-2", "-3", "0"]);
    await expect(card.getByRole("button", { name: "确认建模", exact: true })).toBeDisabled();
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await openProposalView(page, card, "actions");
    await proposalDrawer(page).getByRole("button", { name: "重新生成预览", exact: true }).click();
    await expect(page.getByLabel("未应用三维方案")).toHaveCount(0);
    await openProposalView(page, card, "details");
    await expect(proposalDrawer(page)).toContainText("基础 R1");
    await closeProposalDrawer(page);
    for (const theme of ["dark", "light"]) {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "设置", exact: true });
      await dialog.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      for (const width of [1440, 1080]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 900), width);
        await card.getByRole("button", { name: "确认建模", exact: true }).scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth)).toBe(true);
        await page.screenshot({ path: `docs/evidence/T22-${theme}-${width}.png` });
      }
    }
    await closeProposalDrawer(page);
    await card.getByRole("button", { name: "确认建模", exact: true }).click();
    await expect(page.getByTestId("viewport-node-count")).toHaveText("13 个节点");
    await replay(app, { ...parameters, origin: { value: [20, 0, 0], source: "user" } });
    await closeProposalDrawer(page);
    await send(page, "在X20米处新建第二组两层刚架");
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("等待确认");
    await expect(page.getByTestId("viewport-node-count")).toHaveText("13 个节点");
    await closeProposalDrawer(page);
    await card.getByRole("button", { name: "确认建模", exact: true }).click();
    await expect(page.getByTestId("viewport-node-count")).toHaveText("25 个节点");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(page.getByTestId("viewport-node-count")).toHaveText("13 个节点");
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await expect(page.getByTestId("viewport-node-count")).toHaveText("25 个节点");
  });
});
