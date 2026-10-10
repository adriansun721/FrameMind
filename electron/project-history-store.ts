import { cp, mkdir, open, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { ProjectCheckpoints } from "./project-checkpoints";
import { ProjectFileStore } from "./project-files";
import type { ProjectCheckpointRequest, ProjectCheckpointRecord } from "./contracts";

interface HistoryIdentity { schemaVersion: 1; projectId: string; historyId: string; }
interface SaveJournal { schemaVersion: 1; projectId: string; before: string | null; after: string; original: string; commit: string; beforeIndex: string | null; afterIndex: string; }
const hash = (content: string) => createHash("sha256").update(content).digest("hex");
async function optionalRead(path: string): Promise<string | null> {
  try { return await readFile(path, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
function identity(content: string): { id: string; revision: number; projectHistory?: { id: string } } {
  if (typeof content !== "string" || content.length > 64 * 1024 * 1024) throw new Error("项目内容无效");
  const project = JSON.parse(content);
  if (project.format !== "framemind-project" || !/^project_[A-Za-z0-9_-]{8,100}$/.test(project.id) || !Number.isSafeInteger(project.revision) || project.revision < 0) throw new Error("项目身份或修订无效");
  if (project.projectHistory && !/^history_[a-f0-9-]{36}$/.test(project.projectHistory.id)) throw new Error("项目历史身份无效");
  return project;
}

/** Owns project paths, history identity and the recoverable file/ref/index transaction. */
export class ProjectHistoryStore {
  readonly checkpoints: ProjectCheckpoints;
  private readonly paths = new Map<string, string>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly unavailable = new Map<string, string>();
  constructor(private readonly root: string, private readonly files = new ProjectFileStore(), executable = "git") {
    this.checkpoints = new ProjectCheckpoints(root, executable);
  }
  private async serialized<T>(key: string, action: () => Promise<T>): Promise<T> {
    const pending = (this.queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(action);
    this.queues.set(key, pending);
    try { return await pending; } finally { if (this.queues.get(key) === pending) this.queues.delete(key); }
  }
  private async ensure(projectId: string, content?: string): Promise<HistoryIdentity> {
    if (this.unavailable.has(projectId)) throw new Error(this.unavailable.get(projectId));
    const repository = this.checkpoints.location(projectId);
    await mkdir(repository, { recursive: true });
    const manifestPath = join(repository, "history.json"), saved = await optionalRead(manifestPath);
    if (!saved && (await readdir(repository)).length) {
      // A legacy application-owned repository can be adopted only from a verified project snapshot.
      const head = await this.checkpoints.head(projectId);
      if (!head || identity(content!).projectHistory) throw new Error("历史目录缺少身份记录且不是空目录；请另存为并选择新历史");
      await this.checkpoints.read(projectId, head);
    }
    const manifest: HistoryIdentity = saved ? JSON.parse(saved) : { schemaVersion: 1, projectId, historyId: identity(content!).projectHistory?.id ?? `history_${randomUUID()}` };
    if (manifest.schemaVersion !== 1 || manifest.projectId !== projectId || !/^history_[a-f0-9-]{36}$/.test(manifest.historyId)) throw new Error("历史目录属于其他项目或身份无效；未使用该历史");
    if (content && identity(content).projectHistory && identity(content).projectHistory!.id !== manifest.historyId) throw new Error("项目与历史目录身份不一致；请另存为并选择新历史");
    if (!saved) await writeFile(manifestPath, JSON.stringify(manifest), { encoding: "utf8", flag: "wx" });
    return manifest;
  }
  async record(request: ProjectCheckpointRequest): Promise<ProjectCheckpointRecord[]> {
    return this.serialized(request.projectId, async () => {
      await this.ensure(request.projectId, request.snapshots[0]?.content);
      for (const snapshot of request.snapshots.slice(1)) await this.ensure(request.projectId, snapshot.content);
      return this.checkpoints.record(request);
    });
  }
  list(projectId: string) { return this.serialized(projectId, () => { if (this.unavailable.has(projectId)) throw new Error(this.unavailable.get(projectId)); return this.checkpoints.list(projectId); }); }
  read(projectId: string, commit: string) { if (this.unavailable.has(projectId)) throw new Error(this.unavailable.get(projectId)); return this.checkpoints.read(projectId, commit); }
  readEvidence(projectId: string, commit: string) { if (this.unavailable.has(projectId)) throw new Error(this.unavailable.get(projectId)); return this.checkpoints.readEvidence(projectId, commit); }

  private async recover(path: string, projectId: string): Promise<void> {
    const repository = this.checkpoints.location(projectId), journalPath = join(repository, "save-transaction.json");
    const lockPath = join(repository, "framemind.lock"), lockContent = await optionalRead(lockPath);
    if (lockContent !== null) {
      let dead = false;
      try {
        const pid = JSON.parse(lockContent).pid;
        if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("无效写锁");
        try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") dead = true; }
      } catch { /* Unknown lock ownership is never treated as stale. */ }
      if (!dead) throw new Error("项目历史写锁仍存在；关闭其他窗口后重试。无效写锁须人工复核，历史未改写");
      await unlink(lockPath);
    }
    const source = await optionalRead(journalPath); if (!source) return;
    let recoveryLock;
    try { recoveryLock = await open(lockPath, "wx"); } catch { throw new Error("项目历史正在写入；保存恢复未执行，请稍后重开"); }
    try {
    await recoveryLock.writeFile(JSON.stringify({ pid: process.pid }));
    const journal: SaveJournal = JSON.parse(source);
    if (journal.schemaVersion !== 1 || journal.projectId !== projectId || identity(journal.after).id !== projectId || !/^[a-f0-9]{40}$/.test(journal.commit)) throw new Error("保存恢复日志无效；未改写项目");
    const head = await this.checkpoints.head(projectId);
    if (head !== journal.commit && head !== journal.original) throw new Error("保存恢复引用已变化；保留日志供诊断，未改写项目");
    await this.restoreFiles(path, repository, journal, head === journal.commit);
    await unlink(journalPath);
    } finally { await recoveryLock.close(); await unlink(lockPath); }
  }
  private async restoreFiles(path: string, repository: string, journal: SaveJournal, committed: boolean): Promise<void> {
    const content = committed ? journal.after : journal.before, index = committed ? journal.afterIndex : journal.beforeIndex;
    if (content === null) { if (await optionalRead(path) !== null) await unlink(path); }
    else await this.files.save(path, content);
    const indexPath = join(repository, "saved.json");
    if (index === null) { if (await optionalRead(indexPath) !== null) await unlink(indexPath); }
    else await this.files.save(indexPath, index);
  }
  async open(path: string): Promise<{ content: string; historyWarning?: string }> {
    path = resolve(path);
    let original = await optionalRead(path);
    if (original === null) {
      const interrupted = await optionalRead(join(`${path}.git`, "save-transaction.json"));
      if (!interrupted) throw new Error("项目文件不存在，且没有可恢复的保存事务");
      original = JSON.parse(interrupted).after;
    }
    const project = identity(original!);
    return this.serialized(project.id, async () => {
      this.checkpoints.bind(project.id, `${path}.git`); this.paths.set(project.id, path);
      this.unavailable.delete(project.id);
      let warning: string | undefined;
      try {
        const manifest = await optionalRead(join(`${path}.git`, "history.json"));
        if (!manifest) warning = "项目历史目录缺失；模型仍可编辑和保存，旧 checkpoint 不可读取";
        else {
          const history: HistoryIdentity = JSON.parse(manifest);
          if (history.schemaVersion !== 1 || history.projectId !== project.id || (project.projectHistory && history.historyId !== project.projectHistory.id)) throw new Error("项目与历史目录身份不一致；未使用该历史，模型仍可打开");
          await this.recover(path, project.id);
          const index = await optionalRead(join(`${path}.git`, "saved.json"));
          if (index) {
            const saved = JSON.parse(index), content = await this.files.open(path);
            if (saved.contentSha256 !== hash(content) || hash(await this.checkpoints.read(project.id, saved.commit)) !== saved.contentSha256) throw new Error("项目文件与保存索引不一致；保留模型，历史需复核");
          }
        }
      } catch (error) { warning = error instanceof Error ? error.message : "项目历史不可读取；模型仍可打开"; }
      if (warning && !warning.includes("目录缺失")) this.unavailable.set(project.id, warning);
      return { content: await this.files.open(path), ...(warning ? { historyWarning: warning } : {}) };
    });
  }

  async save(path: string, content: string, mode: "copy" | "new" = "copy"): Promise<{ content: string; historyWarning?: string }> {
    path = resolve(path);
    const project = identity(content);
    return this.serialized(project.id, async () => {
      const destination = `${path}.git`;
      const existingManifest = await optionalRead(join(destination, "history.json"));
      if (!this.paths.has(project.id) && existingManifest && project.projectHistory?.id === JSON.parse(existingManifest).historyId && project.id === JSON.parse(existingManifest).projectId) {
        this.paths.set(project.id, path); this.checkpoints.bind(project.id, destination);
      }
      const sourceRepository = this.checkpoints.location(project.id), previousPath = this.paths.get(project.id);
      const changingPath = previousPath !== path;
      if (changingPath && existingManifest) throw new Error("目标已有独立项目历史；请选择新的文件名，避免覆盖历史");
      const sourceManifest = await optionalRead(join(sourceRepository, "history.json"));
      const oldWarning = this.unavailable.get(project.id);
      if (oldWarning && !(changingPath && mode === "new")) throw new Error(`${oldWarning}；请另存为并选择新历史`);
      let copiedFrom: { historyId: string; commit: string } | undefined;
      let createdSidecar = false;
      try {
      if (changingPath) {
        // Never merge into an unknown directory, even when it lacks a manifest.
        await mkdir(destination); createdSidecar = true;
        if (mode === "new") this.unavailable.delete(project.id);
      }
      if (changingPath && sourceManifest && mode === "copy") {
        const sourceIdentity: HistoryIdentity = JSON.parse(sourceManifest);
        if (sourceIdentity.projectId !== project.id || (project.projectHistory && sourceIdentity.historyId !== project.projectHistory.id)) throw new Error("源项目与历史身份不一致");
        const sourceLockPath = join(sourceRepository, "framemind.lock");
        let sourceLock;
        try { sourceLock = await open(sourceLockPath, "wx"); } catch { throw new Error("源历史正在写入；请稍后另存为"); }
        try {
          await sourceLock.writeFile(JSON.stringify({ pid: process.pid }));
          if (await optionalRead(join(sourceRepository, "save-transaction.json"))) throw new Error("源历史有待恢复保存；请先重新打开原项目");
          copiedFrom = { historyId: sourceIdentity.historyId, commit: await this.checkpoints.head(project.id) };
          await cp(sourceRepository, destination, { recursive: true, force: false, filter: (source) => source !== sourceLockPath });
        } finally { await sourceLock.close(); await unlink(sourceLockPath); }
      }
      this.checkpoints.bind(project.id, destination);
        if (changingPath) {
          await this.files.save(join(destination, "history.json"), JSON.stringify({ schemaVersion: 1, projectId: project.id, historyId: `history_${randomUUID()}` }));
        }
        const manifest = await this.ensure(project.id, changingPath ? JSON.stringify({ ...JSON.parse(content), projectHistory: undefined }) : content);
        const savedContent = `${JSON.stringify({ ...JSON.parse(content), projectHistory: { id: manifest.historyId } })}\n`;
        await this.recover(path, project.id);
        let journal: SaveJournal | undefined;
        const journalPath = join(destination, "save-transaction.json");
        const snapshots: ProjectCheckpointRequest["snapshots"] = [{ kind: copiedFrom?.commit ? "copied-from" : changingPath ? "initial" : "save", content: savedContent, ...(copiedFrom?.commit ? { copiedFrom } : {}) }];
        await this.checkpoints.record({ projectId: project.id, snapshots }, {
          beforePublish: async (records, original) => {
            const record = records.at(-1)!;
            journal = { schemaVersion: 1, projectId: project.id, before: await optionalRead(path), after: savedContent, original, commit: record.commit,
              beforeIndex: await optionalRead(join(destination, "saved.json")), afterIndex: JSON.stringify({ schemaVersion: 1, projectId: project.id, historyId: manifest.historyId, commit: record.commit, contentSha256: hash(savedContent) }) };
            await this.files.save(journalPath, JSON.stringify(journal));
            await this.files.save(path, savedContent);
            await this.files.save(join(destination, "saved.json"), journal.afterIndex);
          },
          rollback: async () => { if (journal) { await this.restoreFiles(path, destination, journal, false); await unlink(journalPath); } },
          committed: async () => { try { await unlink(journalPath); } catch { /* Published state is valid; next open finishes cleanup. */ } },
        });
        this.paths.set(project.id, path);
        return { content: savedContent };
      } catch (error) {
        this.checkpoints.bind(project.id, sourceRepository);
        if (oldWarning) this.unavailable.set(project.id, oldWarning);
        // Only a directory created by this save can be removed. Keep a journal if rollback failed.
        if (createdSidecar && await optionalRead(join(destination, "save-transaction.json")) === null) await rm(destination, { recursive: true, force: true });
        throw new Error(`项目保存/历史提交失败；未报告保存成功，可重新打开恢复：${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
}
