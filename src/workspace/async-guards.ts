import type { FrameProject, ProjectId } from "../domain/project";

export interface ProjectCheckpoint {
  id: ProjectId;
  revision: number;
  sessionId: number;
}

export function captureProjectCheckpoint(
  project: FrameProject,
  sessionId: number,
): ProjectCheckpoint {
  return { id: project.id, revision: project.revision, sessionId };
}

export function isProjectCheckpointCurrent(
  checkpoint: ProjectCheckpoint,
  project: FrameProject,
  activeSessionId: number,
  match: "identity" | "exact",
): boolean {
  if (checkpoint.sessionId !== activeSessionId || checkpoint.id !== project.id) return false;
  return match === "identity" || checkpoint.revision === project.revision;
}
