import { describe, expect, it } from "vitest";
import { addNode, createProject } from "../domain/project";
import { ProjectHistory } from "../domain/project-history";
import { decodeProject, encodeProject } from "../domain/project-file";
import { captureAiSnapshot, executeAiTool } from "./ai-tools";
import { FrameStageConfirmation, prepareFrameConfirmation } from "./frame-confirmation";

const parameters = {
  storeys: { value: 2, source: "user" }, xSpans: { value: [6], source: "user" }, ySpans: { value: [4], source: "user" },
  storeyHeights: { value: [3, 3], source: "user" }, origin: { value: [0, 0, 0], source: "suggestion" },
  material: { value: "en10025-s355jr", source: "suggestion" }, columnSection: { value: "arcelor-hea200", source: "suggestion" },
  beamSection: { value: "arcelor-ipe200", source: "suggestion" }, rotationDegrees: { value: 0, source: "suggestion" },
};
const project = addNode(createProject(), { x: -2, y: -3, z: 0 });
const proposal = executeAiTool(captureAiSnapshot(project, []), { id: "plan", type: "function",
  function: { name: "propose_frame", arguments: JSON.stringify({ parameters }) } }).proposal!;

describe("confirmed AI stage through public project, tool and history boundaries", () => {
  it("applies the reviewed geometry as one persistent transaction and restores it with one undo/redo", () => {
    const confirmation = prepareFrameConfirmation(project, proposal);
    const stage = new FrameStageConfirmation();
    const outcome = stage.confirm(project, confirmation);
    expect(outcome.result.status).toBe("applied");
    expect(outcome.project.revision).toBe(project.revision + 1);
    expect(outcome.project.nodes).toHaveLength(13);
    expect(outcome.project.members).toHaveLength(16);
    expect(outcome.project.nodes.at(-1)?.position).toEqual({ x: 6, y: 4, z: 6 });
    expect(outcome.project.nodes[0]).toEqual(project.nodes[0]);
    expect(outcome.project.nodes.some((node) => node.id.startsWith(proposal.id))).toBe(false);
    expect(decodeProject(encodeProject(outcome.project))).toEqual(outcome.project);
    const summary = executeAiTool(captureAiSnapshot(outcome.project, []), { id: "read", type: "function",
      function: { name: "read_model", arguments: '{"collection":"summary"}' } });
    expect(summary).toMatchObject({ status: "completed", data: { counts: { nodes: 13, members: 16 } } });
    const history = new ProjectHistory(); history.record(project, outcome.project);
    const restored = history.undo(outcome.project)!;
    expect(restored).toMatchObject(project);
    expect(history.canUndo).toBe(false);
    expect(history.redo(restored)).toEqual(outcome.project);
  });

  it("does not repeat a successful request even after undo or another edit", () => {
    const stage = new FrameStageConfirmation();
    const confirmation = prepareFrameConfirmation(project, proposal);
    const applied = stage.confirm(project, confirmation).project;
    expect(stage.confirm(applied, confirmation)).toMatchObject({ project: applied, result: { status: "applied" } });
    expect(stage.confirm(project, confirmation).project).toBe(project);
    const changed = addNode(applied, { x: 20, y: 0, z: 0 });
    expect(stage.confirm(changed, prepareFrameConfirmation(changed, proposal)).project).toBe(changed);
  });

  it("requires a refreshed preview after a model edit or switching projects, and rejects incomplete drafts", () => {
    const stage = new FrameStageConfirmation();
    const confirmation = prepareFrameConfirmation(project, proposal);
    const edited = addNode(project, { x: 10, y: 0, z: 0 });
    expect(stage.confirm(edited, confirmation)).toMatchObject({ project: edited, result: { status: "failed", message: expect.stringContaining("重新生成") } });
    const other = createProject();
    expect(stage.confirm(other, confirmation)).toMatchObject({ project: other, result: { status: "failed" } });
    const refreshed = prepareFrameConfirmation(edited, proposal);
    expect(stage.confirm(edited, refreshed).project.nodes).toHaveLength(14);
    const draft = { ...proposal, id: "incomplete", parameters: { storeys: proposal.parameters.storeys } };
    expect(stage.confirm(project, prepareFrameConfirmation(project, draft))).toMatchObject({ project, result: { status: "failed" } });
  });

  it("freezes the reviewed content rather than applying later changes to the card", () => {
    const mutable = structuredClone(proposal);
    const confirmation = prepareFrameConfirmation(project, mutable);
    mutable.parameters.xSpans!.value = [8];
    const outcome = new FrameStageConfirmation().confirm(project, confirmation);
    expect(outcome.project.nodes.at(-1)?.position).toEqual({ x: 6, y: 4, z: 6 });
    expect(Object.isFrozen(confirmation.proposal.parameters.xSpans!.value)).toBe(true);
  });

  it("rolls back resources, nodes, counters and history when a later member fails", () => {
    const limited = { ...project, nextMemberNumber: Number.MAX_SAFE_INTEGER - 1 };
    const before = encodeProject(limited);
    const stage = new FrameStageConfirmation();
    const confirmation = prepareFrameConfirmation(limited, proposal);
    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = stage.confirm(limited, confirmation);
      expect(outcome).toMatchObject({ project: limited, result: { status: "failed" } });
      expect(outcome.project).toBe(limited);
      expect(encodeProject(limited)).toBe(before);
      const history = new ProjectHistory(); history.record(limited, outcome.project);
      expect(history.canUndo).toBe(false);
    }
  });
});
