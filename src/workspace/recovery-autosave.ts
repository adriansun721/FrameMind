import type { RecoverySaveRequest } from "../../electron/contracts";

interface PendingSnapshot { key: string; request: RecoverySaveRequest; state: "saving" | "saved" | "failed"; failed: boolean; }

/** Retry the latest unsaved capture for each project, including projects no longer open. */
export class RecoveryAutosave {
  private projects = new Map<string, PendingSnapshot>();
  constructor(private save: (request: RecoverySaveRequest) => Promise<void>, private onFailureChange: (failed: boolean) => void) {}

  capture(projectId: string, request: RecoverySaveRequest): void {
    const key = JSON.stringify(request);
    const previous = this.projects.get(projectId);
    if (previous?.key === key) return;
    const snapshot: PendingSnapshot = { key, request: { content: request.content, formalSave: request.formalSave ? { ...request.formalSave } : null }, state: "saving", failed: previous?.failed ?? false };
    this.projects.set(projectId, snapshot);
    this.submit(projectId, snapshot);
  }

  retryFailed(): void {
    for (const [projectId, snapshot] of this.projects) if (snapshot.state === "failed") this.submit(projectId, snapshot);
  }

  private submit(projectId: string, snapshot: PendingSnapshot): void {
    snapshot.state = "saving";
    void this.save(snapshot.request).then(() => this.resolve(projectId, snapshot, false), () => this.resolve(projectId, snapshot, true));
  }

  private resolve(projectId: string, snapshot: PendingSnapshot, failed: boolean): void {
    if (this.projects.get(projectId) !== snapshot) return;
    snapshot.state = failed ? "failed" : "saved"; snapshot.failed = failed;
    this.onFailureChange([...this.projects.values()].some((item) => item.failed));
  }
}
