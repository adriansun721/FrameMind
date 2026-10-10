import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { ProjectCheckpointRecord, ProjectCheckpointRequest } from "./contracts";

const projectIdentity = /^project_[A-Za-z0-9_-]{8,100}$/;
const commitIdentity = /^[a-f0-9]{40}$/;

/** Bare per-project repositories: no working directory, source-repo discovery, shell, or remote operations. */
export class ProjectCheckpoints {
  private readonly queues = new Map<string, Promise<unknown>>();
  constructor(private readonly root: string, private readonly executable = "git") {}

  private repository(projectId: string): string {
    if (!projectIdentity.test(projectId)) throw new Error("项目历史身份无效");
    return join(this.root, projectId);
  }

  private git(repository: string, args: string[], input?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
      const child = spawn(this.executable, ["--no-replace-objects", `--git-dir=${repository}`, ...args], { windowsHide: true, env, stdio: "pipe" });
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

  async record(request: ProjectCheckpointRequest): Promise<ProjectCheckpointRecord[]> {
    request = structuredClone(request);
    const repository = this.repository(request.projectId);
    if (!Array.isArray(request.snapshots) || request.snapshots.length < 1 || request.snapshots.length > 2) throw new Error("checkpoint 数量无效");
    for (const snapshot of request.snapshots) {
      if (!["step-before", "step-confirmed", "step-undo", "step-redo"].includes(snapshot.kind) || typeof snapshot.content !== "string" || snapshot.content.length > 64 * 1024 * 1024) throw new Error("checkpoint 内容无效");
      const project = JSON.parse(snapshot.content);
      if (project.format !== "framemind-project" || project.id !== request.projectId || !Number.isSafeInteger(project.revision) || project.revision < 0) throw new Error("checkpoint 项目身份无效");
      if (snapshot.evidence && (typeof snapshot.evidence.content !== "string" || snapshot.evidence.content.length > 64 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(snapshot.evidence.sha256))) throw new Error("checkpoint 证据无效");
    }
    const operation = (this.queues.get(request.projectId) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      await mkdir(repository, { recursive: true });
      await this.git(repository, ["init", "--bare", "--initial-branch=main", repository]);
      let parent = "";
      try { parent = (await this.git(repository, ["rev-parse", "--verify", "refs/heads/main"])).trim(); } catch { /* New repository. */ }
      const original = parent, records: ProjectCheckpointRecord[] = [];
      for (const snapshot of request.snapshots) {
        const revision = JSON.parse(snapshot.content).revision as number;
        const metadata = { schemaVersion: 1 as const, projectId: request.projectId, revision, kind: snapshot.kind, recordedAt: new Date().toISOString(),
          contentSha256: createHash("sha256").update(snapshot.content).digest("hex"), ...(snapshot.taskId ? { taskId: snapshot.taskId } : {}), ...(snapshot.inputSha256 ? { inputSha256: snapshot.inputSha256 } : {}), ...(snapshot.evidence ? { evidenceSha256: snapshot.evidence.sha256 } : {}) };
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
      await this.git(repository, ["update-ref", "refs/heads/main", parent, original || "0".repeat(40)]);
      return records;
    });
    this.queues.set(request.projectId, operation);
    try { return await operation; } finally { if (this.queues.get(request.projectId) === operation) this.queues.delete(request.projectId); }
  }

  async list(projectId: string): Promise<ProjectCheckpointRecord[]> {
    const repository = this.repository(projectId);
    let commits: string;
    try { commits = await this.git(repository, ["log", "-100", "--format=%H", "refs/heads/main"]); } catch { return []; }
    const records: ProjectCheckpointRecord[] = [];
    for (const commit of commits.trim().split("\n").filter(Boolean)) {
      const metadata = JSON.parse(await this.git(repository, ["show", `${commit}:checkpoint.json`])); records.push({ ...metadata, commit });
    }
    return records;
  }

  async read(projectId: string, commit: string): Promise<string> {
    if (!commitIdentity.test(commit)) throw new Error("checkpoint 提交身份无效");
    const repository = this.repository(projectId);
    await this.git(repository, ["merge-base", "--is-ancestor", commit, "refs/heads/main"]);
    const content = await this.git(repository, ["show", `${commit}:project.framemind`]);
    const metadata = JSON.parse(await this.git(repository, ["show", `${commit}:checkpoint.json`]));
    if (metadata.projectId !== projectId || metadata.contentSha256 !== createHash("sha256").update(content).digest("hex")) throw new Error("checkpoint 哈希或项目身份不一致");
    return content;
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
