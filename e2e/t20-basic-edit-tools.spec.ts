import { expect, test } from "@playwright/test";
import { desktop, save, send } from "./frame-proposal-actions";
import { createNode } from "./modeling-actions";

test("T2-02 reviews a basic edit draft and applies it through the shared domain boundary", async () => {
  await desktop(async (app, page, path) => {
    await createNode(page, ["0", "0", "0"]);
    await createNode(page, ["4", "0", "0"]);
    await page.getByRole("button", { name: "创建材料与截面" }).click();
    await page.getByRole("dialog", { name: "创建材料与截面" }).getByRole("button", { name: "保存材料与截面" }).click();
    await page.getByRole("button", { name: "创建杆件" }).click();
    await page.getByRole("dialog", { name: "连接空间杆件" }).getByRole("button", { name: "添加杆件" }).click();
    await app.evaluate(() => {
      globalThis.fetch = async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        const hasToolReply = request.messages.some((message: { role: string }) => message.role === "tool");
        return new Response(JSON.stringify({ choices: [{ message: hasToolReply
          ? { role: "assistant", content: "基础编辑草案已准备，请核对后确认。" }
          : { role: "assistant", content: null, tool_calls: [{ id: "t2-02-edit", type: "function", function: { name: "propose_model_edits", arguments: JSON.stringify({ operations: [
            { type: "update_node", id: "node_0001", position: { x: -1, y: 0, z: 0 } },
            { type: "update_member", id: "member_0001", changes: { rotationDegrees: 30 } },
          ] }) } }] } }] }), { status: 200 });
      };
    });
    await send(page, "把 N1 移到 X=-1，并把 M1 转角改成30度");
    const card = page.getByRole("region", { name: "基础编辑草案" });
    await expect(card).toContainText("2 项");
    await expect(card).toContainText("node_0001");
    await expect(card).toContainText('"x":0');
    await expect(card).toContainText('"x":-1');
    await expect(card.getByRole("button", { name: "确认编辑", exact: true })).toBeEnabled();
    await card.getByRole("button", { name: "确认编辑", exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("已应用");
    await expect(page.getByRole("region", { name: "项目树" }).locator(".tree-item").filter({ has: page.getByText("N1", { exact: true }) })).toContainText("-1, 0, 0");
    const saved = await save(page, path);
    expect(saved.nodes[0].position).toEqual({ x: -1, y: 0, z: 0 });
    expect(saved.members[0].rotationDegrees).toBe(30);
  });
});
