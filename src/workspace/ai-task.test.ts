import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeepSeekChatRequest, DeepSeekChatResult } from "../../electron/contracts";
import { addNode, attachAnalysisResult, createProject, updateNode } from "../domain/project";
import { decodeAnalysisResult, decodeProject } from "../domain/project-file";
import type { AnalysisServiceRequest } from "../domain/analysis-service";
import nativeSamples from "../../docs/evidence/plan2/T2-14/wire-samples.json";
import { applyProjectEdits } from "../domain/project-operations";
import { captureAiSnapshot } from "./ai-tools";
import { startAiTask, type AiProgress, type AiTransport } from "./ai-task";
import { columns } from "./section-stage.fixture";

function replay(responses: DeepSeekChatResult[]) {
  const requests: DeepSeekChatRequest[] = [];
  const cancelled: string[] = [];
  const transport: AiTransport = {
    chatDeepSeek: async (request) => { requests.push(structuredClone(request)); return responses.shift()!; },
    cancelDeepSeekChat: async (requestId) => { cancelled.push(requestId); },
  };
  return { transport, requests, cancelled };
}

const selectedRead: DeepSeekChatResult = { status: "success", message: "工具请求", assistant: {
  role: "assistant", content: null, tool_calls: [{ id: "call_selection", type: "function",
    function: { name: "read_selection", arguments: "{}" } }],
} };

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("AI progressive output", () => {
  it("lets the agent repair a missing diagnostic copy without asking the user or changing the formal model", async () => {
    const sample = nativeSamples.find((entry) => entry.id === "axial")!;
    const project = attachAnalysisResult(decodeProject(JSON.stringify(sample.project)), decodeAnalysisResult(sample.result));
    // Replay the external native transport at its public IPC boundary.
    vi.stubGlobal("window", { frameMind: { runNativeAnalysis: async (request: AnalysisServiceRequest) => {
      const result = decodeAnalysisResult(sample.result);
      result.id = request.analysisId; result.projectId = request.input.projectId; result.projectRevision = request.input.projectRevision; result.input = request.input;
      result.service = { ...result.service!, requestId: request.requestId, analysisId: request.analysisId, projectId: request.input.projectId, projectRevision: request.input.projectRevision, origin: request.origin };
      return [...result.service.stages.map((record) => ({ kind: "phase", requestId: request.requestId, record })), { kind: "result", requestId: request.requestId, result }];
    } } });
    const snapshot = captureAiSnapshot(project, []);
    const tool = (name: string, input: unknown): DeepSeekChatResult => ({ status: "success", message: "工具请求", assistant: {
      role: "assistant", content: null, tool_calls: [{ id: name, type: "function", function: { name, arguments: JSON.stringify(input) } }],
    } });
    const candidate = { label: "独立基准", operations: [] };
    const script = replay([tool("run_diagnostic_trial", candidate), tool("create_diagnostic_copy", {}), tool("run_diagnostic_trial", candidate),
      { status: "success", message: "回复", assistant: { role: "assistant", content: "数值成功不等于工程有效性验证" } }]);
    const result = await startAiTask(snapshot, "检查并隔离试算", {
      transport: script.transport, isCurrent: () => true, getCurrentSnapshot: () => snapshot, exploration: { mode: "normal" },
    }).promise;
    expect(result.status).toBe("completed");
    expect(result.records.map((record) => record.call.function.name)).toEqual(["read_model", "run_diagnostic_trial", "create_diagnostic_copy", "run_diagnostic_trial"]);
    expect(script.requests[1].messages.at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("create_diagnostic_copy") });
    expect(result.diagnosticTrial).toMatchObject({ status: "complete", engineeringValidity: "numerically-solved-not-engineering-validated" });
    expect(project.analysisResults).toHaveLength(1);
    expect(result.diagnosticCopy?.id).not.toBe(project.id);
  });

  it("stops an agent that repeatedly ignores the diagnostic-copy prerequisite", async () => {
    const snapshot = captureAiSnapshot(columns(), []);
    const response: DeepSeekChatResult = { status: "success", message: "工具请求", assistant: { role: "assistant", content: null,
      tool_calls: [{ id: "trial", type: "function", function: { name: "run_diagnostic_trial", arguments: '{"label":"重复候选","operations":[]}' } }] } };
    const script = replay([response, response, response]);
    const result = await startAiTask(snapshot, "诊断", { transport: script.transport, isCurrent: () => true, getCurrentSnapshot: () => snapshot,
      exploration: { mode: "normal", repeatedFailureLimit: 2 } }).promise;
    expect(result).toMatchObject({ status: "failed", exploration: { stopReason: "repeated-failure" } });
    expect(result.records.filter((record) => record.call.function.name === "run_diagnostic_trial")).toHaveLength(2);
    expect(script.requests).toHaveLength(2);
  });

  it("reveals Unicode text gradually and pauses/resumes locally without repeating a request", async () => {
    vi.useFakeTimers();
    const answer = "你好🙂，这是逐步显示的回答。";
    const script = replay([{ status: "success", message: "完成", assistant: { role: "assistant", content: answer } }]);
    const output: string[] = [];
    const snapshot = captureAiSnapshot(createProject(), []);
    const task = startAiTask(snapshot, "你好", {
      transport: script.transport, isCurrent: () => true, getCurrentSnapshot: () => snapshot,
      onOutput: (value) => output.push(value.assistant!),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(output).toEqual(["你好"]);
    expect(task.pause()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(output).toEqual(["你好"]);
    expect(script.cancelled).toEqual([]);
    task.resume();
    await vi.runAllTimersAsync();
    expect(await task.promise).toMatchObject({ status: "completed", assistant: answer });
    expect(output[1]).toBe("你好🙂，");
    expect(output.at(-1)).toBe(answer);
    expect(output.length).toBeGreaterThan(2);
    expect(script.requests).toHaveLength(1);
    expect(task.pause()).toBe(false);
  });

  it.each(["cancel", "context"])("stops publishing text when %s interrupts output", async (interruption) => {
    vi.useFakeTimers();
    let current = true;
    const onOutput = vi.fn();
    const script = replay([{ status: "success", message: "完成", assistant: { role: "assistant", content: "这段回答不应该继续显示。" } }]);
    const snapshot = captureAiSnapshot(createProject(), []);
    const task = startAiTask(snapshot, "你好", {
      transport: script.transport, isCurrent: () => current, getCurrentSnapshot: () => snapshot, onOutput,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(onOutput).toHaveBeenCalledTimes(1);
    if (interruption === "cancel") task.cancel(); else current = false;
    await vi.runAllTimersAsync();
    expect(await task.promise).toMatchObject({ status: "cancelled" });
    expect(onOutput).toHaveBeenCalledTimes(1);
  });

  it("does not reveal an unverified result reference", async () => {
    const onOutput = vi.fn();
    const script = replay([{ status: "success", message: "完成", assistant: { role: "assistant", content: "结果是 [[result:unknown]]。" } }]);
    const snapshot = captureAiSnapshot(createProject(), []);
    const task = startAiTask(snapshot, "读取结果", {
      transport: script.transport, isCurrent: () => true, getCurrentSnapshot: () => snapshot, onOutput,
    });
    expect(await task.promise).toMatchObject({ status: "failed" });
    expect(onOutput).not.toHaveBeenCalled();
  });
});

describe("AI conversation task boundary", () => {
  it("continues a condition draft when an unrelated submitted selection is deleted", async () => {
    let project = addNode(addNode(createProject(), { x: 0, y: 0, z: 0 }), { x: 0, y: 0, z: 4 });
    const selected = project.nodes[0].id;
    const target = project.nodes[1].id;
    const initial = captureAiSnapshot(project, [{ kind: "node", id: selected }]);
    const script = replay([
      { status: "success", message: "准备条件", assistant: { role: "assistant", content: null,
        tool_calls: [{ id: "conditions", type: "function", function: { name: "propose_analysis_conditions", arguments: JSON.stringify({ supports: [{ nodeId: target, restraints: [true, true, true, true, true, true], source: "user" }], nodalLoads: [] }) } }] } },
      { status: "success", message: "完成", assistant: { role: "assistant", content: "已保留 N2 的支座草案。" } },
    ]);
    const result = await startAiTask(initial, "给 N2 添加固定支座", {
      transport: script.transport, isCurrent: () => true, getCurrentSnapshot: () => captureAiSnapshot(project, []),
      onProgress: (event) => { if (event.toolResult?.conditions) project = applyProjectEdits(project, [{ type: "delete_node", id: selected }]).project; },
    }).promise;
    expect(result.status).toBe("completed");
    expect(result.conditions?.supports).toMatchObject([{ nodeId: target }]);
    expect(result.draftBaseProject?.nodes.map((node) => node.id)).toEqual([target]);
    expect(script.requests).toHaveLength(2);
    expect(project.supports).toHaveLength(0);
  });
  it("marks a retained result citation historical after manual input edits", async () => {
    let project = columns();
    const initial = captureAiSnapshot(project, []);
    const script = replay([
      { status: "success", message: "读取", assistant: { role: "assistant", content: null, tool_calls: [{ id: "old-result", type: "function", function: { name: "read_result", arguments: JSON.stringify({ kind: "node", id: project.nodes[1].id, quantity: "displacement", component: "x" }) } }] } },
      { status: "success", message: "引用", assistant: { role: "assistant", content: "历史结果 [[result:old-result]]。" } },
    ]);
    const result = await startAiTask(initial, "读取位移", {
      transport: script.transport, isCurrent: () => true, getCurrentSnapshot: () => captureAiSnapshot(project, [], initial.analysis),
      onProgress: (event) => { if (event.toolResult?.reference) project = updateNode(project, project.nodes[1].id, { x: 0, y: 0, z: 5 }); },
    }).promise;
    expect(result.status).toBe("completed");
    expect(result.records.find((record) => record.result.reference)?.result.reference).toMatchObject({ current: false, object: { position: { z: 4 } } });
  });
  it("pauses a draft if the same component changes in its publication callback", async () => {
    let project = addNode(createProject(), { x: 0, y: 0, z: 0 });
    const initial = captureAiSnapshot(project, []);
    const script = replay([{ status: "success", message: "工具请求", assistant: { role: "assistant", content: null,
      tool_calls: [{ id: "draft", type: "function", function: { name: "propose_model_edits", arguments: JSON.stringify({ operations: [{ type: "update_node", id: project.nodes[0].id, position: { x: 1 } }] }) } }] } }]);
    const result = await startAiTask(initial, "把X改成1", {
      transport: script.transport, isCurrent: () => true, getCurrentSnapshot: () => captureAiSnapshot(project, []),
      onProgress: (event) => { if (event.toolResult?.modelEdits) project = updateNode(project, project.nodes[0].id, { x: 9, y: 0, z: 0 }); },
    }).promise;
    expect(result.status).toBe("missing-input");
    expect(result.message).toContain("position.x");
    expect(result.draftBaseProject?.nodes[0].position.x).toBe(0);
    expect(project.nodes[0].position.x).toBe(9);
    expect(script.requests).toHaveLength(1);
  });
  it("keeps the submitted target and replans from compatible edits before using a pending response", async () => {
    let project = addNode(createProject(), { x: 0, y: 0, z: 0 });
    const target = { kind: "node" as const, id: project.nodes[0].id };
    const snapshot = captureAiSnapshot(project, [target]);
    const requests: DeepSeekChatRequest[] = [];
    const releases: ((value: DeepSeekChatResult) => void)[] = [];
    const task = startAiTask(snapshot, "读取这个节点", {
      isCurrent: () => true,
      getCurrentSnapshot: () => captureAiSnapshot(project, [{ kind: "node", id: project.nodes.at(-1)!.id }]),
      transport: { chatDeepSeek: (request) => { requests.push(request); return new Promise((resolve) => releases.push(resolve)); }, cancelDeepSeekChat: async () => {} },
    });
    project = addNode(project, { x: 5, y: 0, z: 0 });
    releases[0](selectedRead);
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    releases[1](selectedRead);
    await vi.waitFor(() => expect(requests).toHaveLength(3));
    releases[2]({ status: "success", message: "完成", assistant: { role: "assistant", content: "已读取原目标及最新工程。" } });
    const result = await task.promise;
    expect(result.status).toBe("completed");
    expect(result.context.selection).toMatchObject([target]);
    expect(result.records.find((record) => record.call.function.name === "read_selection")?.result.context.selection).toMatchObject([target]);
    expect(result.context.modelRevision).toBe(project.revision);
  });
  it("pauses a pending response, resumes the same task and ignores the old response", async () => {
    const requests: DeepSeekChatRequest[] = [];
    const releases: ((response: DeepSeekChatResult) => void)[] = [];
    const cancelDeepSeekChat = vi.fn(async () => {});
    const snapshot = captureAiSnapshot(createProject(), []);
    const task = startAiTask(snapshot, "你好", { isCurrent: () => true, getCurrentSnapshot: () => snapshot,
      transport: { chatDeepSeek: (request) => { requests.push(structuredClone(request)); return new Promise((resolve) => releases.push(resolve)); }, cancelDeepSeekChat } });
    expect(task.pause()).toBe(true);
    await vi.waitFor(() => expect(cancelDeepSeekChat).toHaveBeenCalledWith(requests[0].requestId));
    releases[0]({ status: "success", message: "旧请求", assistant: { role: "assistant", content: "旧回答" } });
    await Promise.resolve();
    expect(requests).toHaveLength(1);
    task.resume();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].messages).toEqual(requests[0].messages);
    expect(requests[1].requestId).not.toBe(requests[0].requestId);
    releases[1]({ status: "success", message: "完成", assistant: { role: "assistant", content: "你好，已继续" } });
    expect(await task.promise).toMatchObject({ requestId: task.requestId, status: "completed", assistant: "你好，已继续", records: [{ round: 0, result: { status: "completed" } }] });
    expect(task.pause()).toBe(false);
  });

  it("continues after completed tools without replaying them, including repeated pause cycles", async () => {
    const project = addNode(createProject(), { x: 4, y: 0, z: 0 });
    const requests: DeepSeekChatRequest[] = [];
    const releases: ((response: DeepSeekChatResult) => void)[] = [];
    const snapshot = captureAiSnapshot(project, [{ kind: "node", id: project.nodes[0].id }]);
    const task = startAiTask(snapshot, "读取节点", { isCurrent: () => true, getCurrentSnapshot: () => snapshot,
      transport: { chatDeepSeek: (request) => { requests.push(structuredClone(request)); return requests.length === 1 ? Promise.resolve(selectedRead) : new Promise((resolve) => releases.push(resolve)); }, cancelDeepSeekChat: async () => {} } });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    for (let count = 0; count < 2; count += 1) {
      expect(task.pause()).toBe(true);
      await Promise.resolve();
      task.resume();
      await vi.waitFor(() => expect(requests).toHaveLength(3 + count));
      expect(requests.at(-1)!.messages.filter((message) => message.role === "tool")).toHaveLength(1);
    }
    releases.at(-1)!({ status: "success", message: "完成", assistant: { role: "assistant", content: "节点已读取" } });
    expect(await task.promise).toMatchObject({ status: "completed", records: [{ round: 0, result: { status: "completed" } }, { round: 1, result: { status: "completed" } }] });
    expect((await task.promise).records).toHaveLength(2);
  });

  it("cancels a paused task when its context changes and never resumes obsolete work", async () => {
    let current = true;
    const snapshot = captureAiSnapshot(createProject(), []);
    const chatDeepSeek = vi.fn(() => new Promise<DeepSeekChatResult>(() => {}));
    const task = startAiTask(snapshot, "读取模型", { isCurrent: () => current, getCurrentSnapshot: () => snapshot,
      transport: { chatDeepSeek, cancelDeepSeekChat: async () => {} } });
    task.pause(); current = false; task.cancel(); task.resume();
    expect(await task.promise).toMatchObject({ status: "cancelled", records: [{ round: 0, result: { status: "completed" } }] });
    expect(chatDeepSeek).toHaveBeenCalledTimes(1);
  });

  it("records interruption and links a fresh retry to the original task without retaining unsafe transport errors", async () => {
    const snapshot = captureAiSnapshot(createProject(), []);
    const failed = startAiTask(snapshot, "读取模型", { isCurrent: () => true, getCurrentSnapshot: () => snapshot,
      transport: { chatDeepSeek: async () => { throw new Error("network fixture-secret"); }, cancelDeepSeekChat: async () => {} } });
    const failure = await failed.promise;
    expect(failure).toMatchObject({ requestId: failed.requestId, status: "failed", interruption: { phase: "requesting", round: 1, completedTools: 1, draftsDiscarded: false } });
    expect(JSON.stringify(failure)).not.toContain("fixture-secret");
    const script = replay([{ status: "success", message: "已恢复", assistant: { role: "assistant", content: "连接已恢复" } }]);
    const retried = startAiTask(snapshot, "读取模型", { transport: script.transport, isCurrent: () => true, getCurrentSnapshot: () => snapshot, retryOf: failure.requestId });
    expect(await retried.promise).toMatchObject({ status: "completed", requestId: retried.requestId, retryOf: failed.requestId });
    expect(retried.requestId).not.toBe(failed.requestId);
    expect(script.requests[0].requestId).toBe(retried.requestId);
  });

  it("discards a draft interrupted during generation and exposes no applied model change", async () => {
    const snapshot = captureAiSnapshot(createProject(), []);
    const script = replay([{ status: "success", message: "准备方案", assistant: { role: "assistant", content: null,
      tool_calls: [{ id: "draft", type: "function", function: { name: "propose_frame", arguments: '{"parameters":{"storeys":{"value":2,"source":"user"}}}' } }] } }]);
    let current = true;
    const result = await startAiTask(snapshot, "准备两层框架", { transport: script.transport, isCurrent: () => current, getCurrentSnapshot: () => snapshot,
      onProgress: (event) => { if (event.toolResult?.proposal) current = false; } }).promise;
    expect(result).toMatchObject({ status: "cancelled", interruption: { phase: "tool", round: 1, draftsDiscarded: true },
      records: [{ round: 0, result: { status: "completed" } }, { round: 1, result: { status: "missing-input" } }] });
    expect(result.proposal).toBeUndefined();
    expect(snapshot.model.nodes).toHaveLength(0);
  });

  it("stops before tools or replies when their progress notification invalidates the task", async () => {
    const project = addNode(createProject(), { x: 0, y: 0, z: 0 });
    const snapshot = captureAiSnapshot(project, [{ kind: "node", id: project.nodes[0].id }]);
    for (const phase of ["requesting", "tool", "responding"] as const) {
      let current = true;
      const script = replay([phase === "responding" ? { status: "success", message: "完成", assistant: { role: "assistant", content: "回复" } } : selectedRead]);
      const result = await startAiTask(snapshot, "读取", { transport: script.transport, isCurrent: () => current, getCurrentSnapshot: () => snapshot,
        onProgress: (event) => { if (event.phase === phase) current = false; } }).promise;
      expect(result).toMatchObject({ status: "cancelled", records: [{ round: 0, result: { status: "completed" } }], interruption: { phase, completedTools: 1 } });
      expect(result.assistant).toBeUndefined();
      if (phase === "requesting") expect(script.requests).toHaveLength(0);
    }
  });

  it("labels a reply without tool evidence as an ordinary AI reply", async () => {
    const script = replay([{ status: "success", message: "完成", assistant: { role: "assistant", content: "你好" } }]);
    const snapshot = captureAiSnapshot(createProject(), []);
    const result = await startAiTask(snapshot, "你好", {
      transport: script.transport, isCurrent: () => true, getCurrentSnapshot: () => snapshot,
    }).promise;
    expect(result).toMatchObject({ status: "completed", workKind: "conversation", assistant: "你好", records: [{ round: 0, result: { status: "completed" } }] });
    expect(result.message).toContain("未读取模型工具");
  });

  it("replays read-only tool calls and summarizes actual model data with fresh context", async () => {
    const project = addNode(createProject("回放项目"), { x: 4, y: 0, z: 0 });
    const snapshot = captureAiSnapshot(project, [{ kind: "node", id: project.nodes[0].id }]);
    const script = replay([selectedRead, { status: "success", message: "完成", assistant: {
      role: "assistant", content: "选中 N1，坐标为 (4, 0, 0) m。",
    } }]);
    const progress: AiProgress[] = [];
    const task = startAiTask(snapshot, "这个节点在哪里？", { transport: script.transport, isCurrent: () => true, getCurrentSnapshot: () => snapshot,
      history: [{ role: "user", content: "查看刚架" }, { role: "assistant", content: "请选择对象" }],
      onProgress: (event) => progress.push(event) });
    const result = await task.promise;

    expect(result).toMatchObject({ status: "completed", workKind: "agent", assistant: "选中 N1，坐标为 (4, 0, 0) m。", context: snapshot.context,
      records: [{ round: 0, result: { status: "completed" } }, { round: 1, call: selectedRead.assistant!.tool_calls![0], result: { status: "completed" } }] });
    expect(script.requests).toHaveLength(2);
    expect(script.requests[0].messages[0]).toMatchObject({ role: "system" });
    expect(script.requests[0].messages[0].content).toContain(project.id);
    expect(script.requests[0].messages).toContainEqual({ role: "user", content: "查看刚架" });
    const toolMessage = script.requests[1].messages.find((message) => message.role === "tool")!;
    expect(JSON.parse(toolMessage.content!)).toMatchObject({ status: "completed", data: { objects: [{ id: project.nodes[0].id, position: { x: 4, y: 0, z: 0 } }] } });
    expect(progress.filter((event) => event.phase === "tool")).toHaveLength(2);
    expect(progress.some((event) => event.phase === "responding")).toBe(true);
  });

  it("reads an existing project before the model can answer from an empty assumption", async () => {
    const project = addNode(addNode(createProject("已建模型"), { x: 0, y: 0, z: 0 }), { x: 4, y: 0, z: 0 });
    let firstRequest!: DeepSeekChatRequest;
    const snapshot = captureAiSnapshot(project, []);
    const task = startAiTask(snapshot, "当前工程有哪些节点？", { isCurrent: () => true, getCurrentSnapshot: () => snapshot,
      transport: { chatDeepSeek: async (request) => { firstRequest = structuredClone(request); return { status: "success", message: "普通文本回复", assistant: { role: "assistant", content: "已读取当前工程。" } }; }, cancelDeepSeekChat: async () => {} } });
    const result = await task.promise;
    expect(result).toMatchObject({ status: "completed", context: { projectId: project.id, projectName: "已建模型", modelRevision: project.revision, goal: "当前工程有哪些节点？" }, message: "AI 回复已接收，未读取模型工具", lifecycle: { request: { state: "initiated" }, response: { kind: "text", state: "received" }, task: { state: "completed", status: "completed" } } });
    expect(result.records[0]).toMatchObject({ round: 0, call: { function: { name: "read_model", arguments: '{"collection":"summary"}' } }, result: { status: "completed", data: { project: { id: project.id, revision: project.revision }, counts: { nodes: 2 } }, receipt: { input: { projectId: project.id, modelRevision: project.revision }, state: { model: "applied", project: "current" } } } });
    expect(firstRequest.messages.some((message) => message.role === "system" && message.content.includes("任务开始的本地状态读取回执") && message.content.includes(project.id))).toBe(true);
  });

  it("cancels a task when a reload changes the captured snapshot even if the caller flag remains true", async () => {
    const project = addNode(createProject("旧快照"), { x: 0, y: 0, z: 0 });
    let live = captureAiSnapshot(project, []);
    let finish!: (value: DeepSeekChatResult) => void;
    const task = startAiTask(live, "读取当前工程", { isCurrent: () => true, getCurrentSnapshot: () => live,
      transport: { chatDeepSeek: () => new Promise((resolve) => { finish = resolve; }), cancelDeepSeekChat: async () => {} } });
    live = captureAiSnapshot(addNode(createProject("新项目"), { x: 9, y: 0, z: 0 }), []);
    finish({ status: "success", message: "迟到回复", assistant: { role: "assistant", content: "旧快照回答" } });
    const result = await task.promise;
    expect(result).toMatchObject({ status: "cancelled", lifecycle: { task: { state: "cancelled", status: "cancelled" } } });
    expect(result.assistant).toBeUndefined();
  });

  it("preserves missing-input, failure, confirmation and transport cancellation outcomes", async () => {
    const snapshot = captureAiSnapshot(createProject(), []);
    for (const [name, input, status] of [
      ["read_selection", {}, "missing-input"], ["execute_script", { script: "eval()" }, "failed"],
      ["update_node", { id: "node_0001", x: 5 }, "awaiting-confirmation"],
    ] as const) {
      const script = replay([{ status: "success", message: "工具请求", assistant: { role: "assistant", content: "准备处理",
        tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: JSON.stringify(input) } }] } },
      { status: "success", message: "错误地声称完成", assistant: { role: "assistant", content: "已完成修改" } }]);
      const task = startAiTask(snapshot, "读取或修改对象", { transport: script.transport, isCurrent: () => true, getCurrentSnapshot: () => snapshot });
      const result = await task.promise;
      expect(result).toMatchObject({ status });
      expect(result.records.at(-1)?.result.status).toBe(status);
      expect(script.requests).toHaveLength(1);
    }
    const script = replay([{ status: "cancelled", message: "请求已取消" }]);
    expect(await startAiTask(snapshot, "读取", { transport: script.transport, isCurrent: () => true, getCurrentSnapshot: () => snapshot }).promise)
      .toMatchObject({ status: "cancelled", message: "请求已取消" });
  });

  it("cancels pending requests immediately and suppresses late tools and progress", async () => {
    const project = addNode(createProject(), { x: 0, y: 0, z: 0 });
    const snapshot = captureAiSnapshot(project, [{ kind: "node", id: project.nodes[0].id }]);
    let finish!: (value: DeepSeekChatResult) => void;
    const cancellations: string[] = [];
    const progress: AiProgress[] = [];
    const task = startAiTask(snapshot, "读取选择", { isCurrent: () => true, getCurrentSnapshot: () => snapshot, onProgress: (event) => progress.push(event),
      transport: { chatDeepSeek: () => new Promise((resolve) => { finish = resolve; }),
        cancelDeepSeekChat: async (id) => { cancellations.push(id); } } });
    task.cancel();
    expect(await task.promise).toMatchObject({ status: "cancelled", records: [{ round: 0, result: { status: "completed" } }] });
    finish(selectedRead);
    await Promise.resolve();
    expect(cancellations).toEqual([task.requestId]);
    expect(progress.filter((event) => event.phase === "tool")).toEqual([]);
  });

  it("discards responses when the owning project or task session becomes obsolete", async () => {
    const project = addNode(createProject(), { x: 0, y: 0, z: 0 });
    const snapshot = captureAiSnapshot(project, [{ kind: "node", id: project.nodes[0].id }]);
    let current = true;
    let finish!: (value: DeepSeekChatResult) => void;
    const progress: AiProgress[] = [];
    const task = startAiTask(snapshot, "读取选择", { isCurrent: () => current, getCurrentSnapshot: () => snapshot, onProgress: (event) => progress.push(event),
      transport: { chatDeepSeek: () => new Promise((resolve) => { finish = resolve; }), cancelDeepSeekChat: async () => {} } });
    current = false;
    finish(selectedRead);
    expect(await task.promise).toMatchObject({ status: "cancelled", records: [{ round: 0, result: { status: "completed" } }] });
    expect(progress.filter((event) => event.phase === "tool")).toEqual([]);

    const script = replay([selectedRead]);
    expect(await startAiTask(snapshot, "读取选择", { transport: script.transport, isCurrent: () => false, getCurrentSnapshot: () => snapshot }).promise)
      .toMatchObject({ status: "cancelled", records: [] });
    expect(script.requests).toHaveLength(0);
  });

  it("stops repeated tool rounds with retained records and an actionable failure", async () => {
    const project = addNode(createProject(), { x: 0, y: 0, z: 0 });
    const snapshot = captureAiSnapshot(project, [{ kind: "node", id: project.nodes[0].id }]);
    const script = replay(Array.from({ length: 9 }, (_, index) => ({
      ...selectedRead, assistant: { ...selectedRead.assistant!, tool_calls: [{
        ...selectedRead.assistant!.tool_calls![0], id: `call_${index}`,
      }] },
    })));
    const result = await startAiTask(snapshot, "读取选择", { transport: script.transport, isCurrent: () => true, getCurrentSnapshot: () => snapshot }).promise;
    expect(result.status).toBe("failed");
    expect(result.message).toContain("缩小");
    expect(script.requests).toHaveLength(8);
    expect(result.records).toHaveLength(9);
    expect(result.assistant).toBeUndefined();
  });
});

describe("AI exploration budget", () => {
  it("reports the selected deep mode and retains counters in the result", async () => {
    const snapshot = captureAiSnapshot(createProject(), []);
    const script = replay([{ status: "success", message: "完成", assistant: { role: "assistant", content: "已检查。" } }]);
    const result = await startAiTask(snapshot, "检查模型", {
      transport: script.transport, isCurrent: () => true, getCurrentSnapshot: () => snapshot,
      exploration: { mode: "deep" },
    }).promise;
    expect(result).toMatchObject({ status: "completed", exploration: { mode: "deep", rounds: 1, requests: 1, toolCalls: 0, phase: "running" } });
  });

  it("stops repeated tool evidence before the generic round limit", async () => {
    const project = addNode(createProject(), { x: 0, y: 0, z: 0 });
    const snapshot = captureAiSnapshot(project, [{ kind: "node", id: project.nodes[0].id }]);
    const responses = Array.from({ length: 4 }, (_, index) => ({
      ...selectedRead,
      assistant: { ...selectedRead.assistant!, tool_calls: [{ ...selectedRead.assistant!.tool_calls![0], id: `repeat_${index}` }] },
    }));
    const script = replay(responses);
    const result = await startAiTask(snapshot, "重复读取", {
      transport: script.transport, isCurrent: () => true, getCurrentSnapshot: () => snapshot,
      exploration: { mode: "normal", noProgressRoundLimit: 2 },
    }).promise;
    expect(result.status).toBe("failed");
    expect(result.message).toContain("没有新证据");
    expect(result.exploration).toMatchObject({ phase: "stopped", stopReason: "no-progress", rounds: 3, toolCalls: 3, evidenceCount: 1 });
    expect(script.requests).toHaveLength(3);
    expect(result.records).toHaveLength(4);
  });

  it("retains diagnostic state and stops repeated tool failures", async () => {
    const snapshot = captureAiSnapshot(createProject(), []);
    const responses = Array.from({ length: 3 }, (_, index) => ({
      status: "success" as const, message: "工具请求", assistant: { role: "assistant" as const, content: null,
        tool_calls: [{ id: `bad_${index}`, type: "function" as const, function: { name: "execute_script", arguments: JSON.stringify({ script: "eval()" }) } }] },
    }));
    const script = replay(responses);
    const result = await startAiTask(snapshot, "诊断失败", {
      transport: script.transport, isCurrent: () => true, getCurrentSnapshot: () => snapshot,
      exploration: { mode: "normal", repeatedFailureLimit: 2 },
    }).promise;
    expect(result).toMatchObject({ status: "failed", exploration: { stopReason: "repeated-failure", rounds: 2, toolCalls: 2 }, records: expect.any(Array) });
    expect(result.message).toContain("同一失败");
    expect(script.requests).toHaveLength(2);
  });

  it("publishes paused and cancelled budget states without accepting a late response", async () => {
    const snapshot = captureAiSnapshot(createProject(), []);
    let finish!: (value: DeepSeekChatResult) => void;
    const budgetPhases: string[] = [];
    const task = startAiTask(snapshot, "可控中断", {
      transport: { chatDeepSeek: () => new Promise((resolve) => { finish = resolve; }), cancelDeepSeekChat: async () => {} },
      isCurrent: () => true, getCurrentSnapshot: () => snapshot, exploration: { mode: "normal" },
      onExploration: (state) => budgetPhases.push(state.phase),
    });
    await Promise.resolve();
    expect(task.pause()).toBe(true);
    expect(budgetPhases).toContain("paused");
    task.cancel();
    finish({ status: "success", message: "迟到", assistant: { role: "assistant", content: "不应发布" } });
    const result = await task.promise;
    expect(result).toMatchObject({ status: "cancelled", exploration: { phase: "stopped", stopReason: "cancelled" } });
    expect(result.assistant).toBeUndefined();
  });
});
