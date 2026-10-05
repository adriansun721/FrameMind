import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { createProject } from "../domain/project";
import { captureAiSnapshot, executeAiTool } from "../workspace/ai-tools";
import { AiTaskTimeline } from "./AiTaskTimeline";

test("an unapplied model request shows its waiting state and actionable read-only reason", () => {
  const snapshot = captureAiSnapshot(createProject(), []);
  const call = { id: "blocked-change", type: "function" as const,
    function: { name: "update_node", arguments: '{"id":"node_0001","position":{"x":99,"y":0,"z":0}}' } };
  const result = executeAiTool(snapshot, call);
  render(<AiTaskTimeline paused={false} turns={[{ id: "turn-1", origin: "chat", result: {
    status: result.status, workKind: "agent", message: result.message, context: snapshot.context,
    records: [{ round: 1, call, result }],
  } }]} />);

  expect(screen.getByText("等待确认")).toBeVisible();
  expect(screen.getByText(/本阶段只读/)).toBeVisible();
  expect(screen.getByText(/请使用手动编辑/)).toBeVisible();
});

test("a running diagnostic tool shows the last actual native stage", () => {
  render(<AiTaskTimeline paused={false} turns={[{ id: "native-turn", origin: "chat", progressEvents: [
    { phase: "tool", round: 1, toolCall: { id: "native-diagnostic", type: "function", function: { name: "inspect_diagnostics", arguments: "{}" } }, analysisPhase: "solve" },
  ] }]} />);
  expect(screen.getByText("正在执行：方程求解")).toBeVisible();
});
