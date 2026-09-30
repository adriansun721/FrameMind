import { describe, expect, it } from "vitest";
import { addNode, createProject } from "../domain/project";
import { captureProjectCheckpoint, isProjectCheckpointCurrent } from "./async-guards";

describe("asynchronous project operation guards", () => {
  it("rejects a save response after the active project has changed", () => {
    const original = createProject("Project A");
    const checkpoint = captureProjectCheckpoint(original, 4);
    const replacement = createProject("Project B");

    expect(isProjectCheckpointCurrent(checkpoint, replacement, 5, "identity")).toBe(false);
  });

  it("rejects a response after opening a copied project with the same domain identity", () => {
    const original = createProject("Original path");
    const copiedFile = { ...original, name: "Copied path" };
    const checkpoint = captureProjectCheckpoint(original, 8);

    expect(isProjectCheckpointCurrent(checkpoint, copiedFile, 9, "identity")).toBe(false);
  });

  it("allows a save response for the same project while keeping later edits unsaved", () => {
    const original = createProject("Project A");
    const checkpoint = captureProjectCheckpoint(original, 12);
    const editedDuringSave = addNode(original, { x: 1, y: 2, z: 3 });

    expect(isProjectCheckpointCurrent(checkpoint, editedDuringSave, 12, "identity")).toBe(true);
    expect(isProjectCheckpointCurrent(checkpoint, editedDuringSave, 12, "exact")).toBe(false);
  });
});
