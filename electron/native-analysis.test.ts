// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: transport.spawn }));
import { NativeAnalysisHost, NATIVE_RUNTIME_LIMITS } from "./native-analysis";

function processFixture() {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  transport.spawn.mockReturnValue(child);
  return child;
}
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

it("queues work behind a manual process and cancels waiting work without launching another process", async () => {
  const manual = processFixture(), host = new NativeAnalysisHost("fixed.exe");
  const running = host.run(1, { requestId: "request_manual" });
  const firstSignal = new AbortController(), secondSignal = new AbortController(), started: string[] = [];
  const first = host.runQueued(2, { requestId: "request_work1" }, firstSignal.signal, () => started.push("first"));
  const second = host.runQueued(3, { requestId: "request_work2" }, secondSignal.signal, () => started.push("second"));
  const rejection = expect(second).rejects.toThrow(/取消/); secondSignal.abort(); await rejection;
  expect(transport.spawn).toHaveBeenCalledTimes(1); expect(started).toEqual([]);
  const work = processFixture();
  manual.stdout.write('{"kind":"result","requestId":"request_manual"}\n'); manual.emit("close", 0, null); await running;
  await vi.waitFor(() => expect(started).toEqual(["first"]));
  work.stdout.write('{"kind":"result","requestId":"request_work1"}\n'); work.emit("close", 0, null);
  await first;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(transport.spawn).toHaveBeenCalledTimes(2); expect(started).toEqual(["first"]);
});

it("returns a launch failure with no invented native stages", async () => {
  const child = processFixture();
  const promise = new NativeAnalysisHost("fixed.exe").run(1, { requestId: "request_test" });
  child.emit("error", new Error("ENOENT"));
  await expect(promise).resolves.toEqual([expect.objectContaining({ kind: "error", error: expect.objectContaining({ stage: "model-check", diagnostics: [expect.objectContaining({ code: "native-start-error" })] }) })]);
});

it("retains real stages when a process exits with truncated output", async () => {
  const child = processFixture();
  const promise = new NativeAnalysisHost("fixed.exe").run(1, { requestId: "request_test" });
  const first = { kind: "phase", requestId: "request_test", record: { stage: "model-check", startedAt: "2026-10-05T00:00:00Z" } };
  const phase = { kind: "phase", requestId: "request_test", record: { stage: "assembly", startedAt: "2026-10-05T00:00:00Z" } };
  child.stdout.write(JSON.stringify(first) + '\n' + JSON.stringify(phase) + '\n{"kind":"result"');
  child.emit("close", 3, null);
  await expect(promise).resolves.toEqual([first, phase, expect.objectContaining({ kind: "error", error: expect.objectContaining({ stage: "assembly", diagnostics: [expect.objectContaining({ code: "native-protocol-error" })] }) })]);
});

it("rejects a success packet from a nonzero exit and terminates over-budget requests", async () => {
  vi.useFakeTimers();
  const child = processFixture();
  const host = new NativeAnalysisHost("fixed.exe");
  const first = host.run(1, { requestId: "request_first" });
  child.stdout.write('{"kind":"result","requestId":"request_first"}\n');
  child.emit("close", 7, null);
  await expect(first).resolves.toEqual([expect.objectContaining({ kind: "error" })]);
  const next = processFixture();
  const second = host.run(1, { requestId: "request_second" });
  await vi.advanceTimersByTimeAsync(NATIVE_RUNTIME_LIMITS.timeoutMs);
  await expect(second).resolves.toEqual([expect.objectContaining({ kind: "error" })]);
  expect(next.kill).toHaveBeenCalled();
});

it("streams complete UTF-8 phase lines before process exit and retains the final transcript", async () => {
  const child = processFixture();
  const onPhase = vi.fn();
  const host = new NativeAnalysisHost("fixed.exe");
  const promise = host.run(1, { requestId: "request_stream" }, onPhase);
  const phase = { kind: "phase", requestId: "request_stream", record: { stage: "model-check", startedAt: "2026-10-05T00:00:00Z" } };
  const bytes = Buffer.from(JSON.stringify(phase) + '\n');
  child.stdout.write(bytes.subarray(0, 20));
  expect(onPhase).not.toHaveBeenCalled();
  child.stdout.write(bytes.subarray(20));
  expect(onPhase).toHaveBeenCalledWith(phase);
  child.stdout.write('{"kind":"error","requestId":"request_stream","error":{}}\n');
  child.emit("close", 1, null);
  await expect(promise).resolves.toEqual([phase, expect.objectContaining({ kind: "error" })]);
});

it("resolves cancellation even if a killed process never closes and reserves its resource until close", async () => {
  const child = processFixture();
  const host = new NativeAnalysisHost("fixed.exe");
  const promise = host.run(1, { requestId: "request_cancel" });
  host.cancelOwner(1);
  await expect(promise).resolves.toMatchObject([{ error: { diagnostics: [{ code: "native-cancelled" }] } }]);
  await expect(host.run(2, { requestId: "request_next" })).resolves.toMatchObject([{ error: { diagnostics: [{ code: "native-resource-limit" }] } }]);
  child.emit("close", null, "SIGTERM");
  const next = processFixture();
  const rerun = host.run(2, { requestId: "request_next" });
  next.stdout.write('{"kind":"result","requestId":"request_next"}\n'); next.emit("close", 0, null);
  await expect(rerun).resolves.toMatchObject([{ kind: "result" }]);
});

it.each(["foreign-id", "unknown-kind", "invalid-stage"])("terminates corrupt native streams: %s", async (fault) => {
  const child = processFixture();
  const host = new NativeAnalysisHost("fixed.exe");
  const promise = host.run(1, { requestId: "request_protocol" });
  child.stdout.write(JSON.stringify({ requestId: fault === "foreign-id" ? "request_other" : "request_protocol", kind: fault === "unknown-kind" ? "alien" : "phase", record: { stage: "solve", startedAt: new Date().toISOString() } }) + '\n');
  await expect(promise).resolves.toMatchObject([{ error: { diagnostics: [{ code: "native-protocol-error" }] } }]);
  expect(child.kill).toHaveBeenCalled();
  child.emit("close", 0, null);
});

it("enforces byte budgets and closes the service without permitting new processes", async () => {
  const host = new NativeAnalysisHost("fixed.exe");
  await expect(host.run(1, { requestId: "request_large", bytes: "x".repeat(NATIVE_RUNTIME_LIMITS.inputBytes) })).resolves.toMatchObject([{ error: { diagnostics: [{ code: "native-resource-limit" }] } }]);
  const child = processFixture();
  const promise = host.run(1, { requestId: "request_output" });
  child.stdout.write(Buffer.alloc(NATIVE_RUNTIME_LIMITS.outputBytes + 1));
  await expect(promise).resolves.toMatchObject([{ error: { diagnostics: [{ code: "native-resource-limit" }] } }]);
  child.emit("close", null, "SIGTERM");
  host.dispose();
  await expect(host.run(1, { requestId: "request_disposed" })).rejects.toThrow("已关闭");
});

it("cancels only requests owned by the calling window", async () => {
  const child = processFixture();
  const host = new NativeAnalysisHost("fixed.exe");
  const promise = host.run(1, { requestId: "request_test" });
  host.cancel(2, "request_test");
  expect(child.kill).not.toHaveBeenCalled();
  host.cancel(1, "request_test");
  expect(child.kill).toHaveBeenCalledOnce();
  child.emit("close", null, "SIGTERM");
  await promise;
});
