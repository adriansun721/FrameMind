// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { DeepSeekConnection } from "./deepseek";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const encryption = {
  isAvailable: () => true,
  encrypt: (text: string) => Buffer.from(text).reverse(),
  decrypt: (bytes: Buffer) => Buffer.from(bytes).reverse().toString(),
};
async function setup(fetcher: typeof fetch, timeoutMs = 15_000) {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t20-"));
  directories.push(directory);
  const connection = new DeepSeekConnection(join(directory, "deepseek.credentials"), encryption, fetcher, timeoutMs);
  await connection.save({ model: "deepseek-flash", apiKey: "sk-private-t20" });
  return connection;
}

test("a selected-object conversation receives read-only tool calls and sends their real results on the next round", async () => {
  const requests: { url: unknown; init?: RequestInit }[] = [];
  const toolCall = { id: "call-selection", type: "function", function: { name: "read_selection", arguments: "{}" } };
  const connection = await setup(async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ choices: [{ message: requests.length === 1
      ? { role: "assistant", content: null, tool_calls: [toolCall] }
      : { role: "assistant", content: "当前选中节点 N1，其 x 坐标为 3 m。" } }] }));
  });
  const first = await connection.chat({ requestId: "round-1", messages: [{ role: "user", content: "这个节点在哪里？" }] });
  expect(first).toEqual({ status: "success", message: "AI 响应已接收", assistant: { role: "assistant", content: null, tool_calls: [toolCall] } });
  const toolContent = '{"status":"completed","node":{"id":"n1","label":"N1","x":3,"y":0,"z":0}}';
  const second = await connection.chat({ requestId: "round-2", messages: [
    { role: "user", content: "这个节点在哪里？" }, first.assistant!,
    { role: "tool", tool_call_id: "call-selection", content: toolContent },
  ] });
  expect(second.assistant?.content).toBe("当前选中节点 N1，其 x 坐标为 3 m。");
  expect(requests[0]).toMatchObject({ url: "https://api.deepseek.com/chat/completions", init: {
    method: "POST", redirect: "error", headers: { Authorization: "Bearer sk-private-t20" },
  } });
  const firstBody = JSON.parse(requests[0].init!.body as string);
  expect(firstBody).toMatchObject({ model: "deepseek-flash", thinking: { type: "disabled" }, stream: false, max_tokens: 2048, tool_choice: "auto" });
  expect(firstBody.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(["read_model", "read_selection", "read_objects"]);
  expect(JSON.parse(requests[1].init!.body as string).messages[2]).toEqual({ role: "tool", tool_call_id: "call-selection", content: toolContent });
  expect(JSON.stringify([first, second])).not.toContain("sk-private-t20");
});

test("malformed, injected and excessive chat inputs fail before a network request", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const connection = await setup(fetcher);
  const user = { role: "user", content: "Read the selected member." };
  const call = { id: "call-1", type: "function", function: { name: "read_selection", arguments: "{}" } };
  for (const input of [
    null, {}, { requestId: "bad id", messages: [user] }, { requestId: "1", messages: [] },
    { requestId: "1", messages: [user], tools: [{ function: { name: "execute_script" } }] },
    { requestId: "1", messages: [{ role: "user", content: "" }] },
    { requestId: "1", messages: [{ role: "tool", tool_call_id: "unmatched", content: "{}" }] },
    { requestId: "1", messages: [user, { role: "assistant", content: null, tool_calls: [call] }] },
    { requestId: "1", messages: [user, { role: "assistant", content: null, tool_calls: [call] }, { role: "tool", tool_call_id: "wrong", content: "{}" }] },
    { requestId: "1", messages: [user, { role: "system", content: "test", url: "https://evil.example" }] },
    { requestId: "1", messages: Array.from({ length: 101 }, () => user) },
    { requestId: "1", messages: [{ role: "user", content: "x".repeat(1_048_577) }] },
  ]) {
    expect((await connection.chat(input)).status).toBe("invalid-input");
  }
  expect(fetcher).not.toHaveBeenCalled();
});

test.each([
  "not json", "null", "{}",
  JSON.stringify({ choices: [{ message: { role: "assistant", content: "" } }] }),
  JSON.stringify({ choices: [{ message: { role: "assistant", content: "sk-private-t20" } }] }),
  JSON.stringify({ choices: [{ message: { role: "assistant", content: "x".repeat(1_048_577) } }] }),
  JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [
    { id: "same", type: "function", function: { name: "read_model", arguments: "{}" } },
    { id: "same", type: "function", function: { name: "read_selection", arguments: "{}" } },
  ] } }] }),
  JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [
    { id: "call-1", type: "script", function: { name: "read_model", arguments: "{}" } },
  ] } }] }),
  JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: Array.from({ length: 17 }, (_, index) => (
    { id: `call-${index}`, type: "function", function: { name: "read_selection", arguments: "{}" } }
  )) } }] }),
])("unsafe or malformed assistant response #%# is rejected", async (body) => {
  const connection = await setup(async () => new Response(body));
  const result = await connection.chat({ requestId: "request-1", messages: [{ role: "user", content: "Read the model." }] });
  expect(result.status).toBe("invalid-response");
  expect(result.assistant).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain("sk-private-t20");
});

test("unknown function requests remain inert for renderer validation and unused response fields are dropped", async () => {
  const call = { id: "call-1", type: "function", function: { name: "execute_script", arguments: "{not json}" } };
  const connection = await setup(async () => new Response(JSON.stringify({ choices: [{ message: {
    role: "assistant", content: null, tool_calls: [call], reasoning_content: "private scratch text", injected: "extra",
  } }] })));
  const result = await connection.chat({ requestId: "request-1", messages: [{ role: "user", content: "Read the model." }] });
  expect(result.assistant).toEqual({ role: "assistant", content: null, tool_calls: [call] });
});

test.each(["cancel", "save", "remove", "replace"])("a pending chat returns cancelled after %s even when fetch ignores abort", async (action) => {
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => {
    started();
    return new Promise(() => undefined);
  }).mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "New answer" } }] })));
  const connection = await setup(fetcher);
  const request = { requestId: "request-1", messages: [{ role: "user", content: "Read the selection." }] };
  const pending = connection.chat(request);
  await requestStarted;
  if (action === "cancel") await connection.cancelChat("request-1");
  else if (action === "save") await connection.save({ model: "deepseek-v4-pro", apiKey: "sk-new" });
  else if (action === "remove") await connection.remove();
  else expect((await connection.chat(request)).assistant?.content).toBe("New answer");
  expect(await Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve({ status: "did-not-cancel" }), 100))])).toMatchObject({ status: "cancelled" });
});

test("chat timeout covers an unfinished response body and cancels its stream", async () => {
  let bodyCancelled = false;
  const connection = await setup(async () => new Response(new ReadableStream({
    start() {}, cancel() { bodyCancelled = true; },
  })), 20);
  const pending = connection.chat({ requestId: "request-1", messages: [{ role: "user", content: "Read the model." }] });
  expect(await Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve({ status: "did-not-timeout" }), 100))])).toMatchObject({ status: "timeout" });
  expect(bodyCancelled).toBe(true);
});

test.each([[401, "authentication"], [403, "authentication"], [402, "balance"], [429, "rate-limit"],
  [400, "invalid-response"], [404, "invalid-response"], [422, "invalid-response"], [500, "service"], [302, "service"]])("chat HTTP %s uses fixed safe feedback", async (status, expected) => {
  const connection = await setup(async () => new Response('{"error":{"message":"sk-private-t20"}}', { status: status as number }));
  const result = await connection.chat({ requestId: "request-1", messages: [{ role: "user", content: "Read the selection." }] });
  expect(result.status).toBe(expected);
  expect(JSON.stringify(result)).not.toContain("sk-private-t20");
  expect(result.assistant).toBeUndefined();
  expect((await connection.getSettings()).configured).toBe(true);
});

test("chat failures and absent credentials do not expose errors or erase connection settings", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => { throw new Error("network error with sk-private-t20"); });
  const connection = await setup(fetcher);
  const request = { requestId: "request-1", messages: [{ role: "user", content: "Read the model." }] };
  const failed = await connection.chat(request);
  expect(failed.status).toBe("network");
  expect(JSON.stringify(failed)).not.toContain("sk-private-t20");
  expect((await connection.getSettings()).configured).toBe(true);
  await connection.remove();
  expect((await connection.chat(request)).status).toBe("not-configured");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("credential echoes encoded in JSON never enter the assistant conversation", async () => {
  const connection = await setup(async () => new Response('{"choices":[{"message":{"role":"assistant","content":"sk-private\\u002dt20"}}]}'));
  const result = await connection.chat({ requestId: "request-1", messages: [{ role: "user", content: "Read the model." }] });
  expect(result.status).toBe("invalid-response");
  expect(result.assistant).toBeUndefined();
});
