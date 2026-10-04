import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ProjectFileStore } from "./project-files";
import { redactPersistence } from "./persistence-redaction";

/** Local prose is separate from portable engineering task state and credentials. */
export class ChatHistoryStore {
  private writes = new Map<string, Promise<void>>();
  constructor(private directory: string, private files = new ProjectFileStore()) {}

  private path(projectId: string): string {
    if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(projectId)) throw new Error("聊天记录项目身份无效");
    return join(this.directory, `${projectId}.json`);
  }

  async load(projectId: string): Promise<string | null> {
    const path = this.path(projectId);
    await this.writes.get(projectId);
    try { return await this.files.open(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }

  async save(projectId: string, content: string): Promise<void> {
    const path = this.path(projectId);
    const history: unknown = JSON.parse(content);
    if (!Array.isArray(history)) throw new Error("聊天记录无效");
    const clean = JSON.stringify(redactPersistence(history));
    const write = (this.writes.get(projectId) ?? Promise.resolve()).catch(() => {}).then(async () => {
      await mkdir(this.directory, { recursive: true });
      await this.files.save(path, clean);
    });
    this.writes.set(projectId, write);
    try { await write; } finally { if (this.writes.get(projectId) === write) this.writes.delete(projectId); }
  }
}
