import type { FrameProject } from "../domain/project";
import { normalizeCheckpointRestore } from "../../electron/candidate-model";

/** The preview and application use the same model while keeping the current history identity. */
export function prepareCheckpointRestore(current: FrameProject, snapshot: FrameProject): FrameProject {
  return normalizeCheckpointRestore(current, snapshot);
}
