import { mkdir, open, readdir, readFile, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { RecoveryEntry, RecoveryListing, RecoverySaveRequest } from "./contracts";
import { redactPersistence } from "./persistence-redaction";

interface RecoverySnapshot extends RecoveryEntry { version: 1; content: string; checksum: string; }
export interface RecoveryFileOperations {
  write(path: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}
const checksum = (content: string) => createHash("sha256").update(content).digest("hex");
const generationPattern = /^\d{13}-[a-f0-9-]{36}\.json$/;
function formalSource(value: RecoverySaveRequest["formalSave"]): RecoverySaveRequest["formalSave"] {
  if (value === null) return null;
  if (!value || typeof value.path !== "string" || !value.path || typeof value.savedAt !== "string" || !Number.isFinite(Date.parse(value.savedAt))) throw new Error("正式保存来源无效");
  return { ...value };
}
function orderedContent(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item)) return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
    return item;
  });
}

/** Immutable generations: a torn write can never replace the last complete model + receipt ledger. */
export class RecoveryStore {
  private writes: Promise<void> = Promise.resolve();
  private lastTimestamp = 0;
  private files: RecoveryFileOperations;
  constructor(private directory: string, overrides: Partial<RecoveryFileOperations> = {}) {
    this.files = { write: async (path, content) => {
      const file = await open(path, "wx");
      try { await file.writeFile(content, "utf8"); await file.sync(); } finally { await file.close(); }
    }, rename, ...overrides };
  }

  save(request: RecoverySaveRequest): Promise<void> {
    // Capture and redact before queuing, so later edits cannot change this generation.
    if (!request || typeof request.content !== "string") throw new Error("恢复快照内容无效");
    const project = this.project(request.content);
    const content = JSON.stringify(redactPersistence(project));
    const capturedSource = formalSource(request.formalSave);
    const write = this.writes.catch(() => {}).then(async () => {
      await mkdir(this.directory, { recursive: true });
      const generations = (await readdir(this.directory)).filter((name) => generationPattern.test(name));
      const latestTimestamp = generations.reduce((latest, name) => Math.max(latest, Number(name.slice(0, 13))), this.lastTimestamp);
      this.lastTimestamp = Math.max(Date.now(), latestTimestamp + 1);
      const id = `${this.lastTimestamp}-${randomUUID()}.json`;
      const data = { version: 1 as const, id, source: "automatic-snapshot" as const, projectId: project.id,
        projectName: project.name, createdAt: new Date(this.lastTimestamp).toISOString(), formalSave: capturedSource, content };
      const snapshot: RecoverySnapshot = { ...data, checksum: checksum(JSON.stringify(data)) };
      const temporary = join(this.directory, `${id}.tmp`);
      try {
        await this.files.write(temporary, JSON.stringify(snapshot));
        await this.files.rename(temporary, join(this.directory, id));
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
      // Retain three complete generations per project; pruning runs only after a successful commit.
      const { snapshots } = await this.scan();
      for (const old of snapshots.filter((item) => item.projectId === project.id).slice(3)) await unlink(join(this.directory, old.id));
    });
    this.writes = write;
    return write;
  }

  async list(): Promise<RecoveryListing> {
    await this.writes.catch(() => {});
    const { snapshots, issues } = await this.scan();
    // All retained versions are available for semantic-validation fallback in the renderer.
    const entries: RecoveryEntry[] = [];
    for (const { content, checksum: _checksum, version: _version, ...entry } of snapshots) {
      if (entry.formalSave) {
        try {
          const formalContent = orderedContent(redactPersistence(JSON.parse(await readFile(entry.formalSave.path, "utf8"))));
          entry.matchesFormalSave = formalContent === orderedContent(JSON.parse(content));
        } catch { /* A missing formal file never prevents recovery. */ }
      }
      entries.push(entry);
    }
    return { entries, issues };
  }

  async read(id: string): Promise<string> {
    await this.writes.catch(() => {});
    return (await this.load(id)).content;
  }

  private project(content: string): { id: string; name: string } {
    const project = JSON.parse(content);
    if (!project || project.format !== "framemind-project" || project.formatVersion !== 2 || typeof project.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(project.id)
      || typeof project.name !== "string" || !project.name || !Array.isArray(project.nodes) || !Number.isSafeInteger(project.revision) || project.revision < 0
      || project.taskState && project.taskState.projectId !== project.id) throw new Error("恢复快照项目身份或状态无效");
    return project;
  }

  private async load(id: string): Promise<RecoverySnapshot> {
    if (typeof id !== "string" || !generationPattern.test(id)) throw new Error("恢复快照身份无效");
    const value: RecoverySnapshot = JSON.parse(await readFile(join(this.directory, id), "utf8"));
    if (!value || typeof value !== "object") throw new Error("恢复快照损坏");
    const { checksum: digest, ...data } = value;
    if (!value || value.version !== 1 || value.id !== id || value.source !== "automatic-snapshot" || typeof value.content !== "string"
      || checksum(JSON.stringify(data)) !== digest || !Number.isFinite(Date.parse(value.createdAt))) throw new Error("恢复快照损坏或版本不受支持");
    const project = this.project(value.content);
    if (value.projectId !== project.id || value.projectName !== project.name) throw new Error("恢复快照项目身份不一致");
    formalSource(value.formalSave);
    return value;
  }

  private async scan(): Promise<{ snapshots: RecoverySnapshot[]; issues: string[] }> {
    let names: string[];
    try { names = await readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { snapshots: [], issues: [] }; throw error; }
    const snapshots: RecoverySnapshot[] = []; const issues: string[] = [];
    for (const id of names.filter((name) => generationPattern.test(name)).sort().reverse()) {
      try { snapshots.push(await this.load(id)); }
      catch { issues.push(`快照 ${id} 无法读取，已跳过；可选择较早的完整快照或打开正式项目。`); }
    }
    return { snapshots, issues };
  }
}
