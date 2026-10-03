import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeepSeekChatRequest, DeepSeekChatResult } from "../../electron/contracts";
import { addNode, createProject } from "../domain/project";
import { captureAiSnapshot } from "./ai-tools";
import { startAiTask, type AiProgress, type AiTransport } from "./ai-task";

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

afterEach(() => vi.useRealTimers());

describe("AI progressive output", () => {
  it("reveals Unicode text gradually and pauses/resumes locally without repeating a request", async () => {
    vi.useFakeTimers();
    const answer = "你好🙂，这是逐步显示的回答。";
    const script = replay([{ status: "success", message: "完成", assistant: { role: "assistant", content: answer } }]);
    const output: string[] = [];
    const task = startAiTask(captureAiSnapshot(createProject(), []), "你好", {
      transport: script.transport, isCurrent: () => true,
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
    const task = startAiTask(captureAiSnapshot(createProject(), []), "你好", {
      transport: script.transport, isCurrent: () => current, onOutput,
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
    const task = startAiTask(captureAiSnapshot(createProject(), []), "读取结果", {
      transport: script.transport, isCurrent: () => true, onOutput,
    });
    expect(await task.promise).toMatchObject({ status: "failed" });
    expect(onOutput).not.toHaveBeenCalled();
  });
});

describe("AI conversation task boundary", () => {
  it("pauses a pending response, resumes the same task and ignores the old response", async () => {
    const requests: DeepSeekChatRequest[] = [];
    const releases: ((response: DeepSeekChatResult) => void)[] = [];
    const cancelDeepSeekChat = vi.fn(async () => {});
    const task = startAiTask(captureAiSnapshot(createProject(), []), "你好", { isCurrent: () => true,
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
    expect(await task.promise).toMatchObject({ requestId: task.requestId, status: "completed", assistant: "你好，已继续", records: [] });
    expect(task.pause()).toBe(false);
  });

  it("continues after completed tools without replaying them, including repeated pause cycles", async () => {
    const project = addNode(createProject(), { x: 4, y: 0, z: 0 });
    const requests: DeepSeekChatRequest[] = [];
    const releases: ((response: DeepSeekChatResult) => void)[] = [];
    const task = startAiTask(captureAiSnapshot(project, [{ kind: "node", id: project.nodes[0].id }]), "读取节点", { isCurrent: () => true,
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
    expect(await task.promise).toMatchObject({ status: "completed", records: [{ result: { status: "completed" } }] });
    expect((await task.promise).records).toHaveLength(1);
  });

  it("cancels a paused task when its context changes and never resumes obsolete work", async () => {
    let current = true;
    const chatDeepSeek = vi.fn(() => new Promise<DeepSeekChatResult>(() => {}));
    const task = startAiTask(captureAiSnapshot(createProject(), []), "读取模型", { isCurrent: () => current,
      transport: { chatDeepSeek, cancelDeepSeekChat: async () => {} } });
    task.pause(); current = false; task.cancel(); task.resume();
    expect(await task.promise).toMatchObject({ status: "cancelled", records: [] });
    expect(chatDeepSeek).toHaveBeenCalledTimes(1);
  });

  it("records interruption and links a fresh retry to the original task without retaining unsafe transport errors", async () => {
    const snapshot = captureAiSnapshot(createProject(), []);
    const failed = startAiTask(snapshot, "读取模型", { isCurrent: () => true,
      transport: { chatDeepSeek: async () => { throw new Error("network sk-secret-fixture"); }, cancelDeepSeekChat: async () => {} } });
    const failure = await failed.promise;
    expect(failure).toMatchObject({ requestId: failed.requestId, status: "failed", interruption: { phase: "requesting", round: 1, completedTools: 0, draftsDiscarded: false } });
    expect(JSON.stringify(failure)).not.toContain("sk-secret-fixture");
    const script = replay([{ status: "success", message: "已恢复", assistant: { role: "assistant", content: "连接已恢复" } }]);
    const retried = startAiTask(snapshot, "读取模型", { transport: script.transport, isCurrent: () => true, retryOf: failure.requestId });
    expect(await retried.promise).toMatchObject({ status: "completed", requestId: retried.requestId, retryOf: failed.requestId });
    expect(retried.requestId).not.toBe(failed.requestId);
    expect(script.requests[0].requestId).toBe(retried.requestId);
  });

  it("discards a draft interrupted during generation and exposes no applied model change", async () => {
    const snapshot = captureAiSnapshot(createProject(), []);
    const script = replay([{ status: "success", message: "准备方案", assistant: { role: "assistant", content: null,
      tool_calls: [{ id: "draft", type: "function", function: { name: "propose_frame", arguments: '{"parameters":{"storeys":{"value":2,"source":"user"}}}' } }] } }]);
    let current = true;
    const result = await startAiTask(snapshot, "准备两层框架", { transport: script.transport, isCurrent: () => current,
      onProgress: (event) => { if (event.toolResult?.proposal) current = false; } }).promise;
    expect(result).toMatchObject({ status: "cancelled", interruption: { phase: "tool", round: 1, draftsDiscarded: true },
      records: [{ result: { status: "missing-input" } }] });
    expect(result.proposal).toBeUndefined();
    expect(snapshot.model.nodes).toHaveLength(0);
  });

  it("stops before tools or replies when their progress notification invalidates the task", async () => {
    const project = addNode(createProject(), { x: 0, y: 0, z: 0 });
    const snapshot = captureAiSnapshot(project, [{ kind: "node", id: project.nodes[0].id }]);
    for (const phase of ["requesting", "tool", "responding"] as const) {
      let current = true;
      const script = replay([phase === "responding" ? { status: "success", message: "完成", assistant: { role: "assistant", content: "回复" } } : selectedRead]);
      const result = await startAiTask(snapshot, "读取", { transport: script.transport, isCurrent: () => current,
        onProgress: (event) => { if (event.phase === phase) current = false; } }).promise;
      expect(result).toMatchObject({ status: "cancelled", records: [], interruption: { phase, completedTools: 0 } });
      expect(result.assistant).toBeUndefined();
      if (phase === "requesting") expect(script.requests).toHaveLength(0);
    }
  });

  it("labels a reply without tool evidence as an ordinary AI reply", async () => {
    const script = replay([{ status: "success", message: "完成", assistant: { role: "assistant", content: "你好" } }]);
    const result = await startAiTask(captureAiSnapshot(createProject(), []), "你好", {
      transport: script.transport, isCurrent: () => true,
    }).promise;
    expect(result).toMatchObject({ status: "completed", assistant: "你好", records: [] });
    expect(result.message).toContain("未读取模型工具");
  });

  it("replays read-only tool calls and summarizes actual model data with fresh context", async () => {
    const project = addNode(createProject("回放项目"), { x: 4, y: 0, z: 0 });
    const snapshot = captureAiSnapshot(project, [{ kind: "node", id: project.nodes[0].id }]);
    const script = replay([selectedRead, { status: "success", message: "完成", assistant: {
      role: "assistant", content: "选中 N1，坐标为 (4, 0, 0) m。",
    } }]);
    const progress: AiProgress[] = [];
    const task = startAiTask(snapshot, "这个节点在哪里？", { transport: script.transport, isCurrent: () => true,
      history: [{ role: "user", content: "查看刚架" }, { role: "assistant", content: "请选择对象" }],
      onProgress: (event) => progress.push(event) });
    const result = await task.promise;

    expect(result).toMatchObject({ status: "completed", assistant: "选中 N1，坐标为 (4, 0, 0) m。", context: snapshot.context,
      records: [{ round: 1, call: selectedRead.assistant!.tool_calls![0], result: { status: "completed" } }] });
    expect(script.requests).toHaveLength(2);
    expect(script.requests[0].messages[0]).toMatchObject({ role: "system" });
    expect(script.requests[0].messages[0].content).toContain(project.id);
    expect(script.requests[0].messages).toContainEqual({ role: "user", content: "查看刚架" });
    const toolMessage = script.requests[1].messages.find((message) => message.role === "tool")!;
    expect(JSON.parse(toolMessage.content!)).toMatchObject({ status: "completed", data: { objects: [{ id: project.nodes[0].id, position: { x: 4, y: 0, z: 0 } }] } });
    expect(progress.filter((event) => event.phase === "tool")).toHaveLength(2);
    expect(progress.some((event) => event.phase === "responding")).toBe(true);
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
      const task = startAiTask(snapshot, "读取或修改对象", { transport: script.transport, isCurrent: () => true });
      expect(await task.promise).toMatchObject({ status, records: [{ result: { status } }] });
      expect(script.requests).toHaveLength(1);
    }
    const script = replay([{ status: "cancelled", message: "请求已取消" }]);
    expect(await startAiTask(snapshot, "读取", { transport: script.transport, isCurrent: () => true }).promise)
      .toMatchObject({ status: "cancelled", message: "请求已取消" });
  });

  it("cancels pending requests immediately and suppresses late tools and progress", async () => {
    const project = addNode(createProject(), { x: 0, y: 0, z: 0 });
    const snapshot = captureAiSnapshot(project, [{ kind: "node", id: project.nodes[0].id }]);
    let finish!: (value: DeepSeekChatResult) => void;
    const cancellations: string[] = [];
    const progress: AiProgress[] = [];
    const task = startAiTask(snapshot, "读取选择", { isCurrent: () => true, onProgress: (event) => progress.push(event),
      transport: { chatDeepSeek: () => new Promise((resolve) => { finish = resolve; }),
        cancelDeepSeekChat: async (id) => { cancellations.push(id); } } });
    task.cancel();
    expect(await task.promise).toMatchObject({ status: "cancelled", records: [] });
    finish(selectedRead);
    await Promise.resolve();
    expect(cancellations).toEqual([task.requestId]);
    expect(progress.filter((event) => event.phase === "tool")).toEqual([]);
  });

  it("discards responses when the project, model, selection or session context becomes obsolete", async () => {
    const project = addNode(createProject(), { x: 0, y: 0, z: 0 });
    const snapshot = captureAiSnapshot(project, [{ kind: "node", id: project.nodes[0].id }]);
    let current = true;
    let finish!: (value: DeepSeekChatResult) => void;
    const progress: AiProgress[] = [];
    const task = startAiTask(snapshot, "读取选择", { isCurrent: () => current, onProgress: (event) => progress.push(event),
      transport: { chatDeepSeek: () => new Promise((resolve) => { finish = resolve; }), cancelDeepSeekChat: async () => {} } });
    current = false;
    finish(selectedRead);
    expect(await task.promise).toMatchObject({ status: "cancelled", records: [] });
    expect(progress.filter((event) => event.phase === "tool")).toEqual([]);

    const script = replay([selectedRead]);
    expect(await startAiTask(snapshot, "读取选择", { transport: script.transport, isCurrent: () => false }).promise)
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
    const result = await startAiTask(snapshot, "读取选择", { transport: script.transport, isCurrent: () => true }).promise;
    expect(result.status).toBe("failed");
    expect(result.message).toContain("缩小");
    expect(script.requests).toHaveLength(8);
    expect(result.records).toHaveLength(8);
    expect(result.assistant).toBeUndefined();
  });
});
