import { describe, expect, it } from "vitest";
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

describe("AI conversation task boundary", () => {
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
