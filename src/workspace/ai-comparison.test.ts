import { expect, it } from "vitest";
import { solveFrame } from "../domain/analysis";
import { attachAnalysisResult, selectLoadCase, addLoadCase, updateNodalLoad } from "../domain/project";
import { captureAiSnapshot, executeAiTool } from "./ai-tools";
import { prepareSectionConfirmation, SectionStageConfirmation } from "./section-stage";
import { columns, call } from "./section-stage.fixture";
import { startAiTask } from "./ai-task";

it("uses two explicit analyses and returns the table's exact difference with both frozen sources and changed self weight", () => {
  const p = columns(); const selection = [{ kind: "member" as const, id: p.members[0].id }];
  const change = executeAiTool(captureAiSnapshot(p, selection), call("propose_section_change", { sectionId: p.sections[1].id, source: "user" })).sectionChange!;
  const applied = new SectionStageConfirmation().confirm(p, selection, prepareSectionConfirmation(p, selection, change)).project;
  const after = solveFrame(applied); const computed = attachAnalysisResult(applied, after);
  const pair = { beforeId: p.analysisResults[0].id, afterId: after.id };
  const snapshot = captureAiSnapshot(computed, [], after, pair);
  const summary = executeAiTool(snapshot, call("read_comparison", { collection: "summary" }));
  expect(summary.status).toBe("completed");
  expect(summary.data).toMatchObject({ compatible: true, sectionAndSelfWeightOnly: true, pairMatchesCurrentInput: true,
    before: { analysisId: pair.beforeId }, after: { analysisId: pair.afterId },
    objects: { nodes: [{ id: "node_0001", label: "N1" }, { id: "node_0002", label: "N2" }, { id: "node_0003", label: "N3" }, { id: "node_0004", label: "N4" }] },
    selfWeight: { before: { totalWeightKN: expect.closeTo(6.28, 10) }, after: { totalWeightKN: expect.closeTo(9.42, 10) } } });
  const output = executeAiTool(snapshot, call("read_comparison_result", { kind: "node", id: p.nodes[1].id, quantity: "displacement", component: "x" }));
  expect(output.comparisonReference).toMatchObject({ token: "[[comparison:t26]]", before: { analysisId: pair.beforeId }, after: { analysisId: pair.afterId }, unit: "m" });
  expect(output.comparisonReference?.delta).toBeCloseTo(-0.0026666666666666666, 12);
  // A comparison emits one actionable token; nested single-result tokens must not mislead the provider.
  expect(output.comparisonReference?.before).not.toHaveProperty("token");
  expect(output.comparisonReference?.after).not.toHaveProperty("token");
  expect(executeAiTool(snapshot, call("read_comparison_result", { beforeId: "forged", kind: "node", id: p.nodes[1].id, quantity: "displacement", component: "x" })).status).toBe("failed");
  expect(executeAiTool(captureAiSnapshot(computed, []), call("read_comparison", { collection: "summary" })).status).toBe("missing-input");
});

it("replays comparison evidence and rejects forged or missing delta citations", async () => {
  const p = columns(); const after = solveFrame(p); const computed = attachAnalysisResult(p, after);
  const snapshot = captureAiSnapshot(computed, [], after, { beforeId: p.analysisResults[0].id, afterId: after.id });
  for (const [reply, expected] of [["计算事实：[[comparison:t26]]。原因推断：输入相同。", "completed"], ["[[comparison:forged]]", "failed"], ["变化了100米。", "failed"]] as const) {
    let requests = 0;
    const task = startAiTask(snapshot, "解释前后差异", { isCurrent: () => true, getCurrentSnapshot: () => snapshot, transport: { cancelDeepSeekChat: async () => {},
      chatDeepSeek: async () => ({ status: "success", message: "回放", assistant: ++requests === 1 ? { role: "assistant", content: null,
        tool_calls: [call("read_comparison_result", { kind: "node", id: p.nodes[1].id, quantity: "displacement", component: "x" })] } : { role: "assistant", content: reply } }) } });
    const result = await task.promise;
    expect(result.status).toBe(expected);
    if (expected === "failed") expect(result.assistant).toBeUndefined();
  }
});

it("never describes different load cases as a section effect", () => {
  const p = columns(); const other = selectLoadCase(addLoadCase(p, "其他工况"), "LC2");
  const after = solveFrame(other); const computed = attachAnalysisResult(other, after);
  const snapshot = captureAiSnapshot(computed, [], after, { beforeId: p.analysisResults[0].id, afterId: after.id });
  expect(executeAiTool(snapshot, call("read_comparison", { collection: "summary" })).data).toMatchObject({ compatible: false, sectionAndSelfWeightOnly: false });
  expect(executeAiTool(snapshot, call("read_comparison_result", { kind: "node", id: p.nodes[1].id, quantity: "displacement", component: "x" })).status).toBe("failed");
});

it("does not infer that the current model needs calculation from a pair of older analyses", () => {
  const first = columns();
  const second = attachAnalysisResult(first, solveFrame(first));
  const changed = updateNodalLoad(second, second.nodalLoads[0].id, second.nodalLoads[0].nodeId, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, "LC1");
  const current = attachAnalysisResult(changed, solveFrame(changed));
  const snapshot = captureAiSnapshot(current, [], current.analysisResults[2], { beforeId: current.analysisResults[0].id, afterId: current.analysisResults[1].id });
  expect(snapshot.analysisCurrent).toBe(true);
  const output = executeAiTool(snapshot, call("read_comparison", { collection: "summary" }));
  expect(output.data).not.toHaveProperty("currentModelNeedsRecompute");
  expect(output.data).toMatchObject({ pairMatchesCurrentInput: false, before: { current: false }, after: { current: false } });
});
