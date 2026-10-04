import { expect, it } from "vitest";
import { decodeProject, encodeProject } from "./project-file";
import { columns } from "../workspace/section-stage.fixture";
import { captureAnalysisInput } from "./analysis";
import { captureAiSnapshot, executeAiTool } from "../workspace/ai-tools";
import { proposeModelEdits } from "../workspace/model-edits";
import { mergeLocalChat, persistTaskState, type ConversationHistory } from "../workspace/task-persistence";

function history(): ConversationHistory {
  const project = columns();
  return { id: "history", updatedAt: 1, turns: [{ id: "failed", origin: "chat", prompt: "继续当前任务", requestText: "LOCAL-REQUEST", context: captureAiSnapshot(project, []).context, sourceProject: project,
    result: { status: "failed", workKind: "agent", message: "网络中断", context: captureAiSnapshot(project, []).context, assistant: "LOCAL-ANSWER sk-fixture-only", records: [] } }],
    proposalSource: project, conditionsSource: project, sectionSource: project, modelEditsSource: project, taskDraftSource: project, sectionSelection: [], requestPrompt: "继续当前任务", calculationRequested: false,
    modelEdits: proposeModelEdits(project, { operations: [{ type: "update_node", id: "node_0002", position: { x: 0, y: 0, z: 5 } }] }) };
}

it("migrates version 1 without changing identities, loads, resources or historical calculation input", () => {
  const original = columns();
  const legacy = JSON.stringify({ ...original, formatVersion: 1 });
  const migrated = decodeProject(legacy);
  expect(migrated.formatVersion).toBe(2);
  expect(migrated.nodes[1]).toMatchObject({ id: "node_0002", position: { z: 4 } });
  expect(migrated.materials).toEqual(original.materials); expect(migrated.sections).toEqual(original.sections);
  expect(migrated.nodalLoads).toEqual(original.nodalLoads); expect(migrated.analysisResults).toEqual(JSON.parse(legacy).analysisResults);
  expect(migrated.taskState).toBeUndefined();
  expect(migrated.migration?.missing).toContain("task-state");
  expect(decodeProject(encodeProject(migrated)).migration).toEqual(migrated.migration);
  expect(JSON.parse(legacy).formatVersion).toBe(1);
});

it("saves completed diagnostic evidence while the next AI response is still pending", () => {
  const conversation = history(); const project = conversation.taskDraftSource;
  const call = { id: "diagnostic", type: "function" as const, function: { name: "create_diagnostic_copy", arguments: "{}" } };
  const result = executeAiTool(captureAiSnapshot(project, []), call);
  expect(result.status).toBe("completed");
  conversation.turns[0] = { ...conversation.turns[0], result: undefined, output: { assistant: "本机正文", records: [{ round: 1, call, result }] } };
  const content = encodeProject({ ...project, taskState: persistTaskState(project.id, [conversation], []) });
  expect(content).not.toContain("本机正文");
  const recovered = decodeProject(content).taskState!.conversations[0].turns[0];
  expect(recovered.result?.records[0].result.diagnosticCopy?.id).toBe(result.diagnosticCopy?.id);
  expect(recovered.result?.status).toBe("cancelled");
  expect(recovered.result?.records[0].result.context.projectId).toBe(project.id);
});

it("round-trips failed drafts, interrupted and queued tasks, and frozen calculation input without carrying local prose", () => {
  const conversation = history(); const project = conversation.taskDraftSource;
  const scheduled = ["running", "paused", "queued"].map((status, index) => ({ id: `task-${index}`, projectId: project.id, kind: index === 0 ? "analysis" as const : "agent" as const, goal: "检查工程", status: status as "running" | "paused" | "queued", queuedAt: 1, supplementCount: 0, operationCount: 1 }));
  const state = persistTaskState(project.id, [conversation], scheduled, [{ taskId: "task-0", input: captureAnalysisInput(project) }]);
  const content = encodeProject({ ...project, taskState: state });
  expect(content).not.toContain("LOCAL-ANSWER"); expect(content).not.toContain("LOCAL-REQUEST"); expect(content).not.toContain("sk-fixture");
  const reopened = decodeProject(content);
  expect(reopened.taskState!.scheduled.map((task) => task.status)).toEqual(["running", "paused", "queued"]);
  expect(reopened.taskState!.conversations[0].modelEdits?.operations[0]).toMatchObject({ type: "update_node", position: { z: 5 } });
  expect(reopened.taskState!.analyses[0].input.nodes[1].position.z).toBe(4);
  expect(reopened.nodes[1].position.z).toBe(4);
});

it("rejects malformed or cross-project recovery data before activating a project", () => {
  const conversation = history(); const project = conversation.taskDraftSource;
  const original = encodeProject({ ...project, taskState: persistTaskState(project.id, [conversation], []) });
  type RecoveryFile = { taskState: { version: number; projectId: string; conversations: { modelEdits: { operations: unknown[] }; taskDraftSource: { id: string } }[] } };
  for (const mutate of [
    (file: RecoveryFile) => { file.taskState.version = 99; },
    (file: RecoveryFile) => { file.taskState.projectId = "other-project"; },
    (file: RecoveryFile) => { file.taskState.conversations[0].modelEdits.operations = [{}]; },
    (file: RecoveryFile) => { file.taskState.conversations[0].taskDraftSource.id = "other-project"; },
    (file: RecoveryFile) => { file.taskState.conversations.push(file.taskState.conversations[0]); },
  ]) {
    const file = JSON.parse(original); mutate(file);
    expect(() => decodeProject(JSON.stringify(file))).toThrow();
  }
  expect(decodeProject(original).nodes).toHaveLength(4);
});

it("merges local prose without resurrecting a draft absent from the saved project", () => {
  const local = history(); const project = local.taskDraftSource;
  const view = mergeLocalChat(project, [], [local])[0];
  expect(view.modelEdits).toBeUndefined(); expect(view.calculationRequested).toBe(false);
  expect(view.turns[0].result?.assistant).toContain("LOCAL-ANSWER");
  expect(persistTaskState(project.id, [view], []).conversations).toHaveLength(0);
});

it("retains chat sent after a formal save and interrupted prose without importing unsaved task state", () => {
  const saved = history(); const project = saved.taskDraftSource;
  saved.turns[0] = { ...saved.turns[0], result: undefined };
  const local = { ...saved, turns: [{ ...saved.turns[0], output: { assistant: "已输出的正文", records: [] } },
    { ...saved.turns[0], id: "later", prompt: "保存后的消息", output: { assistant: "后续回复", records: [] }, modelEdits: saved.modelEdits }] };
  const merged = mergeLocalChat(project, [saved], [local])[0];
  expect(merged.turns.map((turn) => turn.prompt)).toEqual(["继续当前任务", "保存后的消息"]);
  expect(merged.turns[0].output?.assistant).toBe("已输出的正文");
  expect(merged.turns[1].result?.assistant).toBe("后续回复");
  expect(merged.turns[1].modelEdits).toBeUndefined();
  expect(persistTaskState(project.id, [merged], []).conversations[0].turns).toHaveLength(1);
});
