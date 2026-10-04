import { describe, expect, it } from "vitest";
import { addNode, addNodalLoad, createProject, updateMember, updateNodalLoad, updateNode } from "../domain/project";
import { deleteNode } from "../domain/project-operations";
import { columns } from "./section-stage.fixture";
import { ModelEditConfirmation, prepareModelEditConfirmation, proposeModelEdits } from "./model-edits";
import { proposeSectionChange } from "./section-stage";
import { captureAiSnapshot } from "./ai-tools";
import { proposeTask } from "./task-draft";
import { coordinateModelEdits, coordinateSection, coordinateTaskDraft } from "./draft-coordination";
import { prepareTaskDraftConfirmation, TaskDraftStageConfirmation } from "./task-confirmation";

describe("task drafts during manual edits", () => {
  it("preserves a compatible component edit, updates the review version and rejects the old confirmation", () => {
    let base = addNode(createProject(), { x: 0, y: 0, z: 0 });
    base = addNodalLoad(base, base.nodes[0].id, { x: 1, y: 2, z: 0 }, { x: 0, y: 0, z: 0 }, "LC1");
    const load = base.nodalLoads[0];
    const draft = proposeTask(captureAiSnapshot(base, []), { supports: [], nodalLoads: [{ id: load.id, nodeId: load.nodeId, loadCaseId: load.loadCaseId, force: { x: 10, y: 2, z: 0 }, moment: load.moment, source: "user" }] });
    const old = prepareTaskDraftConfirmation(base, draft);
    const current = updateNodalLoad(base, load.id, load.nodeId, { x: 1, y: 7, z: 0 }, load.moment, "LC1");
    const coordinated = coordinateTaskDraft(base, current, draft);
    expect(coordinated.conflicts).toEqual([]);
    expect(coordinated.draft.version).toBe(draft.version + 1);
    expect(coordinated.draft.conditions?.nodalLoads?.[0].force).toEqual({ x: 10, y: 7, z: 0 });
    const confirmation = new TaskDraftStageConfirmation();
    expect(confirmation.confirm(current, old).result.status).toBe("failed");
    const applied = confirmation.confirm(current, prepareTaskDraftConfirmation(current, coordinated.draft));
    expect(applied.result.status).toBe("applied");
    expect(applied.project.nodalLoads[0].force).toEqual({ x: 10, y: 7, z: 0 });
  });
  it("reports the exact conflicting component and a deleted target", () => {
    const base = columns();
    const load = base.nodalLoads[0];
    const draft = proposeTask(captureAiSnapshot(base, []), { supports: [], nodalLoads: [{ id: load.id, nodeId: load.nodeId, loadCaseId: "LC1", force: { x: 10, y: 0, z: 0 }, moment: load.moment, source: "user" }] });
    const current = updateNodalLoad(base, load.id, load.nodeId, { x: 7, y: 0, z: 0 }, load.moment);
    expect(coordinateTaskDraft(base, current, draft).conflicts).toEqual([expect.stringContaining(`${load.id}.force.x`)]);
    expect(coordinateTaskDraft(base, deleteNode(base, load.nodeId), draft).conflicts.join(" ")).toContain("删除");
    expect(current.nodalLoads[0].force.x).toBe(7);
  });
  it("keeps another member parameter and pauses conflicting section changes", () => {
    const base = columns();
    const member = base.members[0];
    const section = proposeSectionChange(captureAiSnapshot(base, [{ kind: "member", id: member.id }]), { sectionId: base.sections[1].id, source: "user" });
    const current = updateMember(base, member.id, { rotationDegrees: 25 });
    const rebased = coordinateSection(base, current, section);
    expect(rebased.conflicts).toEqual([]);
    expect(rebased.draft.memberIds).toEqual([member.id]);
    const edits = proposeModelEdits(base, { operations: [{ type: "update_member", id: member.id, changes: { rotationDegrees: 10 } }] });
    expect(coordinateModelEdits(base, current, edits).conflicts.join(" ")).toContain("rotationDegrees");
  });
  it("blocks newly added objects from being included in a stale cascade deletion", () => {
    const base = columns();
    const node = base.nodes[0];
    const draft = proposeModelEdits(base, { operations: [{ type: "delete_node", id: node.id }] });
    const current = addNodalLoad(base, node.id, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(coordinateModelEdits(base, current, draft).conflicts).toContain("删除影响已扩大，新增关联对象需要重新确认");
  });
  it("does not change a review version during result browsing", () => {
    const base = columns();
    const draft = proposeTask(captureAiSnapshot(base, []), { supports: [], nodalLoads: [], analysis: { requested: true, source: "user" } });
    expect(draft.analysis?.sourceId).toBe("LC1");
    expect(coordinateTaskDraft(base, { ...base, latestAnalysis: undefined }, draft)).toEqual({ draft, conflicts: [] });
  });
  it("applies consecutive component edits without a later operation undoing the earlier one", () => {
    const base = addNode(createProject(), { x: 0, y: 0, z: 0 });
    const node = base.nodes[0];
    const draft = proposeModelEdits(base, { operations: [
      { type: "update_node", id: node.id, position: { x: 1 } }, { type: "update_node", id: node.id, position: { y: 2 } },
    ] });
    const current = updateNode(base, node.id, { x: 0, y: 0, z: 3 });
    const coordinated = coordinateModelEdits(base, current, draft);
    expect(coordinated.conflicts).toEqual([]);
    const applied = new ModelEditConfirmation().confirm(current, prepareModelEditConfirmation(current, coordinated.draft));
    expect(applied.result.status).toBe("applied");
    expect(applied.project.nodes[0].position).toEqual({ x: 1, y: 2, z: 3 });
  });
});
