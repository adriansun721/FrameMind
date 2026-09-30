import type { FrameProject, ProjectId } from "../domain/project";

export interface ProjectCheckpoint {
  id: ProjectId;
  revision: number;
}

export function captureProjectCheckpoint(project: FrameProject): ProjectCheckpoint {
  return { id: project.id, revision: project.revision };
}

export function isProjectCheckpointCurrent(
  checkpoint: ProjectCheckpoint,
  project: FrameProject,
  match: "identity" | "exact",
): boolean {
  if (checkpoint.id !== project.id) return false;
  return match === "identity" || checkpoint.revision === project.revision;
}
