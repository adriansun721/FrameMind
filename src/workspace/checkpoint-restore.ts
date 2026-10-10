import type { FrameProject } from "../domain/project";

/** The preview and application use the same model while keeping the current history identity. */
export function prepareCheckpointRestore(current: FrameProject, snapshot: FrameProject): FrameProject {
  if (snapshot.id !== current.id) throw new Error("恢复快照属于其他项目");
  return { ...snapshot, projectHistory: current.projectHistory, taskState: undefined,
    cadImportDraft: snapshot.cadImportDraft ? { ...snapshot.cadImportDraft, restored: true,
      resources: { ...snapshot.cadImportDraft.resources, verification: undefined } } : undefined };
}
