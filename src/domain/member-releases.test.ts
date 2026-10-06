import { describe, expect, it } from "vitest";
import { sectionCantilever } from "../validation/section-fixtures";
import { captureAiSnapshot, executeAiTool } from "../workspace/ai-tools";
import { ModelEditConfirmation, prepareModelEditConfirmation } from "../workspace/model-edits";
import { decodeProject, encodeProject } from "./project-file";
import { ProjectHistory } from "./project-history";
import { applyProjectEdits, duplicateMember } from "./project-operations";
import { updateMember } from "./project";

describe("reviewed local member end releases", () => {
  it("confirms independent ends, saves them, and undoes the entire change without changing supports", () => {
    const project = sectionCantilever();
    const endReleases = { start: { my: true, mz: false }, end: { my: false, mz: true } };
    const draft = executeAiTool(captureAiSnapshot(project, []), { id: "release", type: "function", function: {
      name: "update_member", arguments: JSON.stringify({ id: project.members[0].id, changes: { endReleases } }),
    } });
    expect(draft.status).toBe("awaiting-confirmation");
    const applied = new ModelEditConfirmation().confirm(project, prepareModelEditConfirmation(project, draft.modelEdits!));
    expect(applied.result.status).toBe("applied");
    expect(applied.project.members[0]).toMatchObject({ endReleases });
    expect(applied.project.supports).toEqual(project.supports);
    expect(decodeProject(encodeProject(applied.project)).members).toEqual(applied.project.members);
    const history = new ProjectHistory(); history.record(project, applied.project);
    expect(history.undo(applied.project)!.members).toEqual(project.members);
    expect(history.redo(project)!.members).toEqual(applied.project.members);
  });

  it("reads the declared release fields and rejects unsupported releases before preparing a draft", () => {
    const p = sectionCantilever(), releases = { start: { my: true, mz: true }, end: { my: false, mz: true } };
    const edited = updateMember(p, p.members[0].id, { endReleases: releases });
    expect(duplicateMember(edited, edited.members[0].id).members[1].endReleases).toEqual(releases);
    const read = executeAiTool(captureAiSnapshot(edited, []), { id: "read", type: "function", function: {
      name: "read_model", arguments: JSON.stringify({ collection: "members", fields: ["id", "endReleases"] }),
    } });
    expect(read.status).toBe("completed");
    expect(JSON.stringify(read.data)).toContain('"my":true');
    for (const endReleases of [null, { start: { my: true }, end: {} }, { ...releases, rx: true }, { start: { my: "true", mz: false }, end: releases.end }]) {
      const draft = executeAiTool(captureAiSnapshot(p, []), { id: "bad", type: "function", function: {
        name: "propose_model_edits", arguments: JSON.stringify({ operations: [{ type: "update_member", id: p.members[0].id, changes: { endReleases } }] }),
      } });
      expect(draft.status).toBe("failed");
      expect(draft.modelEdits).toBeUndefined();
    }
    const reset = applyProjectEdits(edited, [{ type: "update_member", id: edited.members[0].id, changes: { endReleases: { start: { my: false, mz: false }, end: { my: false, mz: false } } } }]);
    expect(reset.project.members[0].endReleases!.start.my).toBe(false);
    expect(p.members[0].endReleases).toBeUndefined();
  });
});
