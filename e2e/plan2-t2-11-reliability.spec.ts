import { NATIVE_MESH_STATIC_SOLVER } from "../src/domain/analysis";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { encodeProject } from "../src/domain/project-file";
import { engineeringContent } from "../src/workspace/draft-coordination";
import { redactPersistence } from "../electron/persistence-redaction";
import { columns } from "../src/workspace/section-stage.fixture";
import type { AiTaskResult } from "../src/workspace/ai-task";
import type { ConversationHistory } from "../src/workspace/task-persistence";
import { createNode } from "./modeling-actions";
import { save } from "./frame-proposal-actions";
import { enterWorkbenchWithoutRecovery } from "./electron-app";

import { agentFixture, type Tool } from "./agent-integration";
const fixture = (id: string, run: Parameters<typeof agentFixture>[2]) => agentFixture(id, { task: "T2-11" }, run);

test("T2-11 state recognition after manual editing and reopening", async () => {
  test.setTimeout(360_000);
  await fixture("state", async ({ page, project, path, restart, check, ask }) => {
    await createNode(page, ["1.25", "-2", "3.5"]);
    const before = await save(page, path);
    const prompt = "请核查整个正式工程的节点和杆件总数，列出 N5 的稳定 ID 及三维坐标。不要修改模型，也不要用当前选中对象代表整个模型。";
    const rounds = [[{ name: "read_model", input: { collection: "summary" } }, { name: "read_model", input: { collection: "nodes" } }]];
    for (const phase of ["manual", "reopened"]) {
      if (phase === "reopened") {
        page = await restart();
        const restore = page.getByRole("button", { name: "恢复任务", exact: true });
        if (await restore.isVisible()) await restore.click();
      }
      const result = await ask(page, prompt, rounds, "工程有5个节点、2根杆件；N5 node_0005 坐标(1.25,-2,3.5)m。");
      const after = await save(page, path);
      check(`${phase}:stateRecognition`, result.context.projectId === project.id && result.context.modelRevision === before.revision && /node_0005/.test(result.assistant ?? "") && ["1.25", "-2", "3.5"].every((s) => result.assistant?.includes(s)) && /5.*节点|节点.*5/s.test(result.assistant ?? "") && /2.*杆件|杆件.*2/s.test(result.assistant ?? ""));
      check(`${phase}:correctTools`, result.records.some((r) => r.call.function.name === "read_model" && r.result.status === "completed") && !result.records.some((r) => /propose|create|run/.test(r.call.function.name)));
      check(`${phase}:taskCompletion`, result.status === "completed");
      check(`${phase}:noUnintendedMutation`, JSON.stringify(engineeringContent(after)) === JSON.stringify(engineeringContent(before)));
    }
  });
});

test("T2-11 whole-task confirmation, restart and requested local solve", async () => {
  test.setTimeout(360_000);
  await fixture("confirmation", async ({ page, project, path, restart, check, ask }) => {
    const prompt = "准备一份整体草案：保留现有全部几何、材料、截面、支座、自重和工况。将现有 L1、L2 节点荷载的 FX 都改为10 kN，FY、FZ及力矩不变；确认后计算 LC1。所有参数已齐全，请一次确认。";
    const input = { goal: prompt, nodalLoads: project.nodalLoads.map((load) => ({ ...load, label: undefined, force: { ...load.force, x: 10 }, source: "user" })), analysis: { requested: true, source: "user", sourceId: "LC1" } };
    const result = await ask(page, prompt, [[{ name: "propose_task", input }]], "完整草案已准备，等待一次确认。");
    const pending = await save(page, path);
    check("noUnintendedMutation", JSON.stringify(engineeringContent(pending)) === JSON.stringify(engineeringContent(project)));
    check("correctTools", result.records.some((r) => r.call.function.name === "propose_task" && r.result.status === "awaiting-confirmation"));
    check("noRepeatedQuestions", result.status === "awaiting-confirmation" && !result.taskDraft?.frame);
    page = await restart();
    await page.getByRole("button", { name: "恢复任务", exact: true }).click();
    const card = page.getByRole("region", { name: "完整任务草案" });
    await expect(card.getByRole("button", { name: "确认整体任务", exact: true })).toBeEnabled();
    check("restartUnconfirmed", (await save(page, path)).nodalLoads.every((load: any) => load.force.x === 5));
    await card.getByRole("button", { name: "确认整体任务", exact: true }).dblclick();
    await expect(page.getByTestId("ai-turn-status").last()).toContainText("本地分析完成");
    const after = await save(page, path);
    check("taskCompletion", after.analysisResults.length === 2 && after.nodalLoads.every((load: any) => load.force.x === 10) && Math.abs(after.analysisResults[1].nodes[1].displacement.x - 0.010666666666666666) < 1e-10);
    check("nativeFormalEntry", after.analysisResults[1].input.solver?.implementation === NATIVE_MESH_STATIC_SOLVER.implementation && after.analysisResults[1].service?.solver.implementation === NATIVE_MESH_STATIC_SOLVER.implementation);
    check("noDuplicateApplication", after.confirmedOperations.length === 1 && after.nodes.length === 4 && after.nodalLoads.length === 2);
    const expected = structuredClone(project);
    expected.nodalLoads.forEach((load) => { load.force.x = 10; });
    const unchanged = JSON.stringify(engineeringContent(after)) === JSON.stringify(engineeringContent(expected));
    check("noUnintendedMutation", unchanged);
    check("preservedUnrelatedData", unchanged && JSON.stringify(after.analysisResults[0]) === JSON.stringify(project.analysisResults[0]));
  });
});

test("T2-11 evidence-based diagnostic trial stays separate from formal results", async () => {
  test.setTimeout(360_000);
  await fixture("diagnostic", async ({ page, project, path, check, ask }) => {
    const prompt = "请检查当前工程的实际诊断，在独立诊断副本里验证把 L1 的 FX 改为10 kN、其余值不变这一候选。不要修改正式工程或正式计算结果。说明数值求解成功与工程有效性验证的区别，并给出来源。";
    const load = project.nodalLoads[0];
    const result = await ask(page, prompt, [
      [{ name: "inspect_diagnostics", input: {} }], [{ name: "create_diagnostic_copy", input: {} }],
      [{ name: "run_diagnostic_trial", input: { label: "L1 荷载候选", operations: [{ type: "set_nodal_load", id: load.id, nodeId: load.nodeId, loadCaseId: "LC1", force: { x: 10, y: 0, z: 0 }, moment: { x: 0, y: 0, z: 0 } }] } }],
    ], "诊断副本试算数值求解成功，不代表工程有效性已验证。正式模型与结果未修改。");
    const after = await save(page, path);
    check("correctTools", ["inspect_diagnostics", "create_diagnostic_copy", "run_diagnostic_trial"].every((name) => result.records.some((r) => r.call.function.name === name && r.result.status === "completed")));
    const expectedCandidate = structuredClone(project);
    expectedCandidate.nodalLoads[0].force.x = 10;
    check("diagnosticCandidate", Boolean(result.diagnosticCopy) && JSON.stringify(engineeringContent({ ...result.diagnosticCopy!.model, id: project.id })) === JSON.stringify(engineeringContent(expectedCandidate)));
    check("taskCompletion", result.status === "completed" && result.diagnosticTrial?.status === "complete"
      && Math.abs((result.diagnosticTrial.result?.nodes[1].displacement.x ?? NaN) - 0.010666666666666666) < 1e-10);
    check("diagnosticSource", result.diagnosticCopy?.id !== project.id && result.diagnosticCopy?.source.projectId === project.id
      && result.diagnosticTrial?.result?.projectId === result.diagnosticCopy?.id && result.diagnosticTrial?.result?.input.projectId === result.diagnosticCopy?.id
      && result.diagnosticTrial?.engineeringValidity === "numerically-solved-not-engineering-validated");
    check("nativeDiagnosticEntry", result.diagnosticTrial?.result?.input.solver?.implementation === NATIVE_MESH_STATIC_SOLVER.implementation && result.diagnosticTrial?.result?.service?.solver.implementation === NATIVE_MESH_STATIC_SOLVER.implementation);
    check("noUnintendedMutation", JSON.stringify(engineeringContent(after)) === JSON.stringify(engineeringContent(project)) && JSON.stringify(after.analysisResults) === JSON.stringify(project.analysisResults));
  });
});
