import { describe, expect, it } from "vitest";
import { addNode, createProject } from "../domain/project";
import { captureProjectCheckpoint, isProjectCheckpointCurrent } from "./async-guards";

describe("asynchronous project operation guards", () => {
  it("rejects a save response after the active project has changed", () => {
    const original = createProject("Project A");
    const checkpoint = captureProjectCheckpoint(original);
    const replacement = createProject("Project B");

    expect(isProjectCheckpointCurrent(checkpoint, replacement, "identity")).toBe(false);
  });

  it("allows a save response for the same project while keeping later edits unsaved", () => {
    const original = createProject("Project A");
    const checkpoint = captureProjectCheckpoint(original);
    const editedDuringSave = addNode(original, { x: 1, y: 2, z: 3 });

    expect(isProjectCheckpointCurrent(checkpoint, editedDuringSave, "identity")).toBe(true);
    expect(isProjectCheckpointCurrent(checkpoint, editedDuringSave, "exact")).toBe(false);
  });
});
