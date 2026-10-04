import { expect, it } from "vitest";
import { createProject } from "../domain/project";
import { decodeProject, encodeProject } from "../domain/project-file";
import { ProjectHistory } from "../domain/project-history";
import { proposeModelEdits, prepareModelEditConfirmation, ModelEditConfirmation } from "./model-edits";
import { persistTaskState, recoveryIssues, type ConversationHistory } from "./task-persistence";

it("allows confirmation after task metadata changes, then deduplicates after reopening and undo", () => {
  const base = createProject();
  const draft = proposeModelEdits(base, { operations: [{ type: "create_node", position: { x: -1.5, y: 0, z: 2 } }] });
  const confirmation = prepareModelEditConfirmation(base, draft);
  const updated = { ...base, taskState: persistTaskState(base.id, [], []) };
  const applied = new ModelEditConfirmation().confirm(updated, confirmation);
  expect(applied.result.status).toBe("applied");
  const reopened = decodeProject(encodeProject(applied.project));
  const retry = new ModelEditConfirmation().confirm(reopened, confirmation);
  expect(retry.result.status).toBe("applied"); expect(retry.project.nodes).toHaveLength(1);
  const history = new ProjectHistory(); history.record(updated, applied.project);
  const undone = history.undo(applied.project)!;
  const restored = decodeProject(encodeProject(undone));
  expect(new ModelEditConfirmation().confirm(restored, confirmation).project.nodes).toHaveLength(0);
});

it("reconciles an applied task awaiting calculation against its receipt and detects undo or a missing receipt", () => {
  const base = createProject();
  const draft = proposeModelEdits(base, { operations: [{ type: "create_node", position: { x: 1, y: 0, z: 0 } }] });
  const applied = new ModelEditConfirmation().confirm(base, prepareModelEditConfirmation(base, draft));
  const conversation: ConversationHistory = { id: "conversation", updatedAt: 1, sectionSelection: [], calculationRequested: true, requestPrompt: "建立并计算",
    proposalSource: base, conditionsSource: base, sectionSource: base, modelEditsSource: base, taskDraftSource: base,
    turns: [{ id: "confirmation", prompt: "确认", origin: "confirmation", context: applied.result.context, sourceProject: base,
      result: { ...applied.result, workKind: "agent", records: [{ round: 0, call: { id: "confirmation", type: "function", function: { name: "confirm_model_edits", arguments: "{}" } }, result: applied.result }] } }] };
  const project = decodeProject(encodeProject({ ...applied.project, taskState: persistTaskState(base.id, [conversation], []) }));
  expect(recoveryIssues(project, project.taskState!.conversations[0])).toEqual([]);
  const history = new ProjectHistory(); history.record(base, applied.project);
  expect(recoveryIssues(history.undo(applied.project)!, conversation).join(" ")).toContain("模型");
  expect(recoveryIssues({ ...project, confirmedOperations: [] }, conversation).join(" ")).toContain("回执");
});
