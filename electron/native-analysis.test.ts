// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: transport.spawn }));
import { NativeAnalysisHost } from "./native-analysis";

function processFixture() {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  transport.spawn.mockReturnValue(child);
  return child;
}
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

it("returns a launch failure with no invented native stages", async () => {
  const child = processFixture();
  const promise = new NativeAnalysisHost("fixed.exe").run(1, { requestId: "request_test" });
  child.emit("error", new Error("ENOENT"));
  await expect(promise).resolves.toEqual([expect.objectContaining({ kind: "error", error: expect.objectContaining({ stage: "model-check", diagnostics: [expect.objectContaining({ code: "native-start-error" })] }) })]);
});

it("retains real stages when a process exits with truncated output", async () => {
  const child = processFixture();
  const promise = new NativeAnalysisHost("fixed.exe").run(1, { requestId: "request_test" });
  const phase = { kind: "phase", requestId: "request_test", record: { stage: "assembly", startedAt: "2026-10-05T00:00:00Z" } };
  child.stdout.write(JSON.stringify(phase) + '\n{"kind":"result"');
  child.emit("close", 3, null);
  await expect(promise).resolves.toEqual([phase, expect.objectContaining({ kind: "error", error: expect.objectContaining({ stage: "assembly", diagnostics: [expect.objectContaining({ code: "native-runtime-error" })] }) })]);
});

it("rejects a success packet from a nonzero exit and terminates over-budget requests", async () => {
  vi.useFakeTimers();
  const child = processFixture();
  const host = new NativeAnalysisHost("fixed.exe");
  const first = host.run(1, { requestId: "request_first" });
  child.stdout.write('{"kind":"result"}\n');
  child.emit("close", 7, null);
  await expect(first).resolves.toEqual([expect.objectContaining({ kind: "error" })]);
  const next = processFixture();
  const second = host.run(1, { requestId: "request_second" });
  await vi.advanceTimersByTimeAsync(30000);
  await expect(second).resolves.toEqual([expect.objectContaining({ kind: "error" })]);
  expect(next.kill).toHaveBeenCalled();
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
