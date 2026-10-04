// @vitest-environment node
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ChatHistoryStore } from "./chat-history";
import { ProjectFileStore } from "./project-files";

it("keeps complete project-linked chat local, redacts credentials and protects the prior history on write failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-chat-"));
  try {
    const store = new ChatHistoryStore(directory);
    await expect(store.load("project-A")).resolves.toBeNull();
    const turns = Array.from({ length: 25 }, (_, i) => ({ id: String(i), prompt: `消息 ${i}` }));
    await store.save("project-A", JSON.stringify([{ turns, apiKey: "private", reply: "sk-fixture-only Bearer credential" }]));
    const saved = (await store.load("project-A"))!;
    expect(JSON.parse(saved)[0].turns).toHaveLength(25);
    expect(saved).not.toContain("private"); expect(saved).not.toContain("sk-fixture"); expect(saved).not.toContain("Bearer credential");
    await expect(store.load("project-B")).resolves.toBeNull();
    const failing = new ChatHistoryStore(directory, new ProjectFileStore({ writeFile: async () => { throw new Error("disk full"); } }));
    await expect(failing.save("project-A", "[]")).rejects.toThrow("disk full");
    await expect(store.load("project-A")).resolves.toBe(saved);
    await expect(store.save("../credentials", "[]")).rejects.toThrow("项目身份");
    expect(await readdir(directory)).toHaveLength(1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
