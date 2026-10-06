// @vitest-environment node
import { expect, it } from "vitest";
import { DeepSeekConnection } from "./deepseek";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

it.each(["准备带限白噪声输入谱，先确认", "导入 PSD CSV，保存为随机输入谱", "修改 PSD1 的谱密度", "删除输入谱 PSD1", "Create a PSD spectrum"])("exposes spectrum preparation and reviewed edits for %s", async (prompt) => {
  const directory = await mkdtemp(join(tmpdir(), "psd-tools-"));
  try {
    const bodies: unknown[] = [];
    const connection = new DeepSeekConnection(join(directory, "settings.json"), { isAvailable: () => true, encrypt: (value) => Buffer.from(value), decrypt: (value) => value.toString() }, async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "核对输入谱。" } }] }));
    });
    await connection.save({ apiKey: "sk-fixture", model: "deepseek-flash" });
    expect((await connection.chat({ requestId: "psd-tools", messages: [{ role: "user", content: prompt }] })).status).toBe("success");
    const request = bodies[0] as { tools: { function: { name: string } }[] };
    expect(request.tools.map((t) => t.function.name)).toContain("prepare_psd_input");
    expect(request.tools.map((t) => t.function.name)).toContain("propose_model_edits");
  } finally {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid temporary directory");
    await rm(directory, { recursive: true, force: true });
  }
});
