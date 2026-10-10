import { spawn } from "node:child_process";
import { mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { ProjectCheckpointRecord, ProjectCheckpointRequest } from "./contracts";

const projectIdentity = /^project_[A-Za-z0-9_-]{8,100}$/;
const commitIdentity = /^[a-f0-9]{40}$/;

/** Bare per-project repositories: no working directory, source-repo discovery, shell, or remote operations. */
export class ProjectCheckpoints {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly repositories = new Map<string, string>();
  constructor(private readonly root: string, private readonly executable = "git") {}

  private repository(projectId: string): string {
    if (!projectIdentity.test(projectId)) throw new Error("项目历史身份无效");
    return this.repositories.get(projectId) ?? join(this.root, projectId);
  }

  bind(projectId: string, repository: string): void { this.repository(projectId); this.repositories.set(projectId, repository); }
  location(projectId: string): string { return this.repository(projectId); }
  async head(projectId: string): Promise<string> {
    try { return (await this.git(this.repository(projectId), ["rev-parse", "--verify", "refs/heads/main"])).trim(); }
    catch { return ""; }
  }
  async mainReference(projectId: string): Promise<string> {
    return (await this.git(this.repository(projectId), ["for-each-ref", "--format=%(objectname)", "refs/heads/main"])).trim();
  }

  private git(repository: string, args: string[], input?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
      env.GIT_CONFIG_NOSYSTEM = "1"; env.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
      const child = spawn(this.executable, ["--no-replace-objects", "-c", "core.hooksPath=", "-c", "commit.gpgSign=false", `--git-dir=${repository}`, ...args], { cwd: repository, windowsHide: true, env, stdio: "pipe" });
      let output = "", error = "", size = 0;
      const timer = setTimeout(() => { child.kill(); reject(new Error("项目 Git checkpoint 超时；正式模型未应用")); }, 15_000);
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { size += Buffer.byteLength(chunk); if (size > 64 * 1024 * 1024) child.kill(); else output += chunk; });
      child.stderr.on("data", (chunk: string) => { if (error.length < 8192) error += chunk; });
      child.on("error", () => { clearTimeout(timer); reject(new Error("本机 Git 不可用，无法创建项目 checkpoint；正式模型未应用")); });
      child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`项目 Git checkpoint 失败：${error.slice(0, 1000)}`)); });
      child.stdin.on("error", () => undefined); child.stdin.end(input);
    });
  }

  async record(request: ProjectCheckpointRequest, transaction?: {
    beforePublish(records: ProjectCheckpointRecord[], original: string): Promise<void>;
    rollback(): Promise<void>;
    committed(): Promise<void>;
    validatePublished?(): void;
  }, branch?: { name: string; parentCommit: string; guard(): void }): Promise<ProjectCheckpointRecord[]> {
    request = structuredClone(request);
    const repository = this.repository(request.projectId);
    if (branch && (!/^candidate\/task_[a-f0-9-]{36}$/.test(branch.name) || !commitIdentity.test(branch.parentCommit))) throw new Error("候选分支身份无效");
    const reference = branch ? `refs/heads/${branch.name}` : "refs/heads/main";
    if (!Array.isArray(request.snapshots) || request.snapshots.length < 1 || request.snapshots.length > 2) throw new Error("checkpoint 数量无效");
    for (const snapshot of request.snapshots) {
      if (!["initial", "save", "copied-from", "confirmation-before", "confirmation-after", "candidate-round", "candidate", "merge-before", "merge-after", "restore", "step-before", "step-confirmed", "step-undo", "step-redo"].includes(snapshot.kind) || typeof snapshot.content !== "string" || snapshot.content.length > 64 * 1024 * 1024) throw new Error("checkpoint 内容无效");
      const project = JSON.parse(snapshot.content);
      if (project.format !== "framemind-project" || project.id !== request.projectId || !Number.isSafeInteger(project.revision) || project.revision < 0) throw new Error("checkpoint 项目身份无效");
      if (snapshot.evidence && (typeof snapshot.evidence.content !== "string" || snapshot.evidence.content.length > 64 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(snapshot.evidence.sha256))) throw new Error("checkpoint 证据无效");
      for (const hash of [snapshot.inputSha256, snapshot.resultSha256]) if (hash !== undefined && !/^[a-f0-9]{64}$/.test(hash)) throw new Error("checkpoint 输入/结果哈希无效");
      if (snapshot.evidenceIndex && (!Array.isArray(snapshot.evidenceIndex) || snapshot.evidenceIndex.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_.:/-]{1,200}$/.test(id) || id.includes("..") || id.startsWith("/") || /^[A-Za-z]:/.test(id)))) throw new Error("checkpoint 证据索引无效");
    }
    const operation = (this.queues.get(request.projectId) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      await mkdir(repository, { recursive: true });
      const lockPath = join(repository, "framemind.lock");
      let lock;
      try { lock = await open(lockPath, "wx"); } catch { throw new Error("项目历史正在写入或上次写入中断；请确认无其他窗口写入后重试"); }
      let published = false;
      try {
      await lock.writeFile(JSON.stringify({ pid: process.pid }));
      await this.git(repository, ["init", "--bare", "--initial-branch=main", repository]);
      let parent = "";
      try { parent = (await this.git(repository, ["rev-parse", "--verify", reference])).trim(); } catch { /* New repository/branch. */ }
      const original = parent, records: ProjectCheckpointRecord[] = [];
      if (branch) { await this.read(request.projectId, branch.parentCommit); parent ||= branch.parentCommit; }
      for (const snapshot of request.snapshots) {
        const project = JSON.parse(snapshot.content), revision = project.revision as number;
        const engineeringFields = ["id", "units", "nodes", "members", "materials", "sections", "supports", "nodalLoads", "uniformLoads", "selfWeight", "loadCases", "loadCombinations", "analysisCases", "psdSpectra"];
        const engineering = Object.fromEntries(engineeringFields.map((key) => [key, project[key]]));
        const inputSha256 = snapshot.inputSha256 ?? createHash("sha256").update(JSON.stringify(engineering)).digest("hex");
        const resultSha256 = snapshot.resultSha256 ?? (project.analysisResults ? createHash("sha256").update(JSON.stringify(project.analysisResults)).digest("hex") : undefined);
        const metadata = { schemaVersion: 1 as const, projectId: request.projectId, revision, kind: snapshot.kind, recordedAt: new Date().toISOString(),
          contentSha256: createHash("sha256").update(snapshot.content).digest("hex"), inputSha256, ...(snapshot.taskId ? { taskId: snapshot.taskId } : {}), ...(snapshot.evidence ? { evidenceSha256: snapshot.evidence.sha256 } : {}),
          ...(snapshot.candidateId ? { candidateId: snapshot.candidateId } : {}), ...(resultSha256 ? { resultSha256 } : {}), ...(snapshot.evidenceIndex ? { evidenceIndex: snapshot.evidenceIndex } : {}), ...(snapshot.copiedFrom ? { copiedFrom: snapshot.copiedFrom } : {}) };
        const contentBlob = (await this.git(repository, ["hash-object", "-w", "--stdin"], snapshot.content)).trim();
        const metadataBlob = (await this.git(repository, ["hash-object", "-w", "--stdin"], JSON.stringify(metadata))).trim();
        const evidenceBlob = snapshot.evidence ? (await this.git(repository, ["hash-object", "-w", "--stdin"], snapshot.evidence.content)).trim() : undefined;
        const tree = (await this.git(repository, ["mktree"], `${evidenceBlob ? `100644 blob ${evidenceBlob}\tcad-draft.json\n` : ""}100644 blob ${metadataBlob}\tcheckpoint.json\n100644 blob ${contentBlob}\tproject.framemind\n`)).trim();
        parent = (await this.git(repository, ["-c", "user.name=FrameMind", "-c", "user.email=local@framemind.invalid", "commit-tree", tree, ...(parent ? ["-p", parent] : [])], snapshot.kind)).trim();
        // Verify candidate objects before publication: failures cannot leave a visible confirmed import.
        if (await this.git(repository, ["show", `${parent}:project.framemind`]) !== snapshot.content) throw new Error("checkpoint 项目回读不一致");
        if (snapshot.evidence) {
          const persisted = await this.git(repository, ["show", `${parent}:cad-draft.json`]);
          if (persisted !== snapshot.evidence.content || createHash("sha256").update(persisted).digest("hex") !== snapshot.evidence.sha256) throw new Error("checkpoint 证据回读哈希不一致");
        }
        records.push({ ...metadata, commit: parent });
      }
      // A single compare-and-swap publishes the whole pair. Earlier failures leave only unreachable objects.
      try { if (transaction) await transaction.beforePublish(records, original); branch?.guard(); await this.git(repository, ["update-ref", reference, parent, original || "0".repeat(40)]); }
      catch (cause) {
        // A subprocess timeout is not proof that the reference was never published.
        const actual = (await this.git(repository, ["for-each-ref", "--format=%(objectname)", reference])).trim();
        if (actual !== parent) {
          if (actual === original) { if (transaction) await transaction.rollback(); throw cause; }
          throw new Error("checkpoint 发布结果无法确认；保留保存恢复日志，未回滚文件，请重新打开项目复核");
        }
      }
      try { transaction?.validatePublished?.(); }
      catch (cause) {
        // Cancellation may arrive while update-ref is running. Compensate before reporting success.
        await this.git(repository, ["update-ref", reference, original || "0".repeat(40), parent]);
        await transaction!.rollback(); throw cause;
      }
      published = true;
      if (transaction) await transaction.committed();
      return records;
      } finally {
        try { await lock.close(); await unlink(lockPath); }
        catch (error) { if (!published) throw error; /* A cleanup failure cannot undo the published transaction. */ }
      }
    });
    this.queues.set(request.projectId, operation);
    try { return await operation; } finally { if (this.queues.get(request.projectId) === operation) this.queues.delete(request.projectId); }
  }

  async list(projectId: string): Promise<ProjectCheckpointRecord[]> {
    const repository = this.repository(projectId);
    let commits: string;
    try { commits = await this.git(repository, ["log", "-100", "--format=%H", "refs/heads/main"]); } catch { return []; }
    const records: ProjectCheckpointRecord[] = [], identities = commits.trim().split("\n").filter(Boolean);
    for (let offset = 0; offset < identities.length; offset += 4) {
      const page = await Promise.all(identities.slice(offset, offset + 4).map(async (commit) => {
        const { metadata } = await this.snapshot(repository, projectId, commit);
        return { ...metadata, commit };
      }));
      records.push(...page);
    }
    return records;
  }

  async read(projectId: string, commit: string): Promise<string> {
    if (!commitIdentity.test(commit)) throw new Error("checkpoint 提交身份无效");
    const repository = this.repository(projectId);
    await this.git(repository, ["merge-base", "--is-ancestor", commit, "refs/heads/main"]);
    return (await this.snapshot(repository, projectId, commit)).content;
  }

  async readCandidate(projectId: string, branch: string, commit: string): Promise<string> {
    if (!/^candidate\/task_[a-f0-9-]{36}$/.test(branch) || !commitIdentity.test(commit)) throw new Error("候选分支或提交身份无效");
    const repository = this.repository(projectId);
    await this.git(repository, ["merge-base", "--is-ancestor", commit, `refs/heads/${branch}`]);
    return (await this.snapshot(repository, projectId, commit)).content;
  }

  private async snapshot(repository: string, projectId: string, commit: string): Promise<{ content: string; metadata: Omit<ProjectCheckpointRecord, "commit"> }> {
    const [content, metadataContent] = await Promise.all([this.git(repository, ["show", `${commit}:project.framemind`]), this.git(repository, ["show", `${commit}:checkpoint.json`])]);
    const metadata = JSON.parse(metadataContent);
    const project = JSON.parse(content);
    if (project.format !== "framemind-project" || project.id !== projectId || project.revision !== metadata.revision || metadata.projectId !== projectId || metadata.contentSha256 !== createHash("sha256").update(content).digest("hex")) throw new Error("checkpoint 哈希或项目身份不一致");
    return { content, metadata };
  }

  async readEvidence(projectId: string, commit: string): Promise<string> {
    if (!commitIdentity.test(commit)) throw new Error("checkpoint 提交身份无效");
    const repository = this.repository(projectId);
    await this.git(repository, ["merge-base", "--is-ancestor", commit, "refs/heads/main"]);
    const metadata = JSON.parse(await this.git(repository, ["show", `${commit}:checkpoint.json`]));
    if (metadata.projectId !== projectId || !metadata.evidenceSha256) throw new Error("checkpoint 完整中间态证据缺失");
    const content = await this.git(repository, ["show", `${commit}:cad-draft.json`]);
    if (createHash("sha256").update(content).digest("hex") !== metadata.evidenceSha256) throw new Error("checkpoint 证据哈希不一致");
    return content;
  }
}
