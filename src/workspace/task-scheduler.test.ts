import { describe, expect, it, vi } from "vitest";
import { AmbiguousTaskAssignmentError, TaskScheduler, type ScheduledTaskEvent } from "./task-scheduler";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("project task scheduler", () => {
  it("runs one operation at a time and reads queued input only when it starts", async () => {
    const scheduler = new TaskScheduler<{ revision: number }, string>({ createId: (() => { let index = 0; return () => `task_${++index}`; })() });
    let revision = 1;
    const first = deferred<string>();
    const starts: number[] = [];
    const running = scheduler.submit({ projectId: "p", kind: "analysis", goal: "第一份", getInput: () => ({ revision }), execute: async (input) => { starts.push(input.revision); return first.promise; } });
    const second = scheduler.submit({ projectId: "p", kind: "analysis", goal: "第二份", queuedRevision: revision, getInput: () => ({ revision }), execute: async (input) => { starts.push(input.revision); return `R${input.revision}`; } });
    await Promise.resolve();
    expect(starts).toEqual([1]);
    revision = 2;
    first.resolve("R1");
    await expect(running.promise).resolves.toBe("R1");
    await expect(second.promise).resolves.toBe("R2");
    expect(starts).toEqual([1, 2]);
    expect(scheduler.get(second.ownerTaskId)).toMatchObject({ status: "completed", startedRevision: 2 });
  });

  it("attaches a supplement to the active main task and keeps one ownership identity", async () => {
    const scheduler = new TaskScheduler<{ value: string }, string>();
    const first = deferred<string>();
    const calls: string[] = [];
    const main = scheduler.submit({ projectId: "p", kind: "agent", goal: "建立模型", getInput: () => ({ value: "main" }), execute: async (input) => { calls.push(input.value); return first.promise; } });
    const supplement = scheduler.submit({ projectId: "p", kind: "agent", relation: "supplement", goal: "补充支座", getInput: () => ({ value: "supplement" }), execute: async (input) => { calls.push(input.value); return "supplemented"; } });
    expect(supplement.ownerTaskId).toBe(main.ownerTaskId);
    expect(supplement.relation).toBe("supplement");
    first.resolve("main");
    await expect(main.promise).resolves.toBe("main");
    await expect(supplement.promise).resolves.toBe("supplemented");
    expect(calls).toEqual(["main", "supplement"]);
    expect(scheduler.get(main.ownerTaskId)).toMatchObject({ supplementCount: 1, operationCount: 2, lastGoal: "补充支座", status: "completed" });
  });

  it("rejects ambiguous assignment with the visible active candidates", async () => {
    const scheduler = new TaskScheduler<null, null>();
    scheduler.submit({ projectId: "p", kind: "agent", goal: "主任务", getInput: () => null, execute: async () => new Promise<null>(() => {}) });
    expect(() => scheduler.submit({ projectId: "p", kind: "agent", relation: "ambiguous", goal: "补充", getInput: () => null, execute: async () => null }))
      .toThrow(AmbiguousTaskAssignmentError);
    try {
      scheduler.submit({ projectId: "p", kind: "agent", relation: "ambiguous", goal: "补充", getInput: () => null, execute: async () => null });
    } catch (error) {
      expect(error).toMatchObject({ projectId: "p", candidates: [{ status: "running" }] });
    }
  });

  it("publishes project/task ownership for phases and results", async () => {
    const scheduler = new TaskScheduler<{ revision: number }, { analysisId: string }>();
    const events: ScheduledTaskEvent<{ analysisId: string }>[] = [];
    scheduler.subscribe((event) => events.push(event));
    const handle = scheduler.submit({ projectId: "project_a", kind: "analysis", goal: "计算", getInput: () => ({ revision: 7 }), execute: async (_input, context) => {
      context.reportPhase("solve"); context.bindAnalysis("analysis_1");
      return { analysisId: "analysis_1" };
    } });
    await expect(handle.promise).resolves.toEqual({ analysisId: "analysis_1" });
    expect(events.map((event) => event.type)).toEqual(["created", "status", "phase", "result", "status", "finished"]);
    expect(events.every((event) => event.ownership.projectId === "project_a" && event.ownership.taskId === handle.ownerTaskId)).toBe(true);
    expect(events.find((event) => event.type === "result")?.ownership.analysisId).toBe("analysis_1");
    expect(scheduler.get(handle.ownerTaskId)).toMatchObject({ startedRevision: 7, analysisId: "analysis_1" });
  });

  it("keeps a task waiting for confirmation without blocking the next resource job", async () => {
    const scheduler = new TaskScheduler<null, string>();
    const waiting = scheduler.submit({ projectId: "p", kind: "agent", goal: "等待确认", getInput: () => null, execute: async (_input, context) => { context.setStatus("waiting-confirmation"); return "draft"; } });
    const next = scheduler.submit({ projectId: "p", kind: "analysis", goal: "独立计算", getInput: () => null, execute: async () => "result" });
    await expect(waiting.promise).resolves.toBe("draft");
    expect(scheduler.get(next.taskId)).toMatchObject({ status: "queued" });
    expect(scheduler.get(waiting.taskId)).toMatchObject({ status: "waiting-confirmation" });
    const supplement = scheduler.submit({ projectId: "p", kind: "agent", relation: "supplement", goal: "确认后继续", getInput: () => null, execute: async () => "done" });
    await expect(supplement.promise).resolves.toBe("done");
    await expect(next.promise).resolves.toBe("result");
    expect(scheduler.get(waiting.taskId)).toMatchObject({ status: "completed", supplementCount: 1 });
  });

  it("keeps ordinary conversation work distinct from engineering tasks", async () => {
    const scheduler = new TaskScheduler<null, string>();
    const handle = scheduler.submit({ projectId: "p", kind: "agent", goal: "打招呼", getInput: () => null, execute: async (_input, context) => { context.setKind("conversation"); return "你好"; } });
    await expect(handle.promise).resolves.toBe("你好");
    expect(scheduler.get(handle.taskId)).toMatchObject({ kind: "conversation", status: "completed" });
  });

  it("cancels queued work without invoking it and prevents a late result from completing the task", async () => {
    const scheduler = new TaskScheduler<null, string>();
    const first = deferred<string>();
    const execute = vi.fn(async () => "second");
    const active = scheduler.submit({ projectId: "p", kind: "analysis", goal: "运行中", getInput: () => null, execute: async (_input, context) => { await first.promise; if (context.signal.aborted) throw new Error("aborted"); return "first"; } });
    const queued = scheduler.submit({ projectId: "p", kind: "analysis", goal: "等待中", getInput: () => null, execute });
    scheduler.cancel(queued.ownerTaskId);
    await expect(queued.promise).rejects.toThrow("任务已取消");
    first.resolve("done");
    await expect(active.promise).resolves.toBe("first");
    expect(execute).not.toHaveBeenCalled();
    expect(scheduler.get(queued.ownerTaskId)).toMatchObject({ status: "cancelled" });
  });

  it("cancels only a supplement while preserving a waiting owner", async () => {
    const scheduler = new TaskScheduler<null, string>();
    const supplementResult = deferred<string>();
    const main = scheduler.submit({ projectId: "p", kind: "agent", goal: "等待确认", getInput: () => null,
      execute: async (_input, context) => { context.setStatus("waiting-confirmation"); return "draft"; } });
    await expect(main.promise).resolves.toBe("draft");
    const supplement = scheduler.submit({ projectId: "p", kind: "agent", relation: "supplement", goal: "补充参数", getInput: () => null,
      execute: async () => supplementResult.promise });
    supplement.cancel();
    await expect(supplement.promise).rejects.toThrow("任务已取消");
    expect(scheduler.get(main.taskId)).toMatchObject({ status: "waiting-confirmation", supplementCount: 1 });
    supplementResult.resolve("迟到结果");
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduler.get(main.taskId)).toMatchObject({ status: "waiting-confirmation" });
    scheduler.complete(main.taskId);
    expect(scheduler.get(main.taskId)).toMatchObject({ status: "completed" });
  });

  it("preserves a waiting owner when every one of several supplements is cancelled", async () => {
    const scheduler = new TaskScheduler<null, string>();
    const firstSupplementResult = deferred<string>();
    const secondExecute = vi.fn(async () => "should-not-run");
    const main = scheduler.submit({ projectId: "p", kind: "agent", goal: "等待确认", getInput: () => null,
      execute: async (_input, context) => { context.setStatus("waiting-confirmation"); return "draft"; } });
    await expect(main.promise).resolves.toBe("draft");
    const firstSupplement = scheduler.submit({ projectId: "p", kind: "agent", relation: "supplement", goal: "第一补充", getInput: () => null,
      execute: async () => firstSupplementResult.promise });
    const secondSupplement = scheduler.submit({ projectId: "p", kind: "agent", relation: "supplement", goal: "第二补充", getInput: () => null,
      execute: secondExecute });
    firstSupplement.cancel();
    secondSupplement.cancel();
    await expect(firstSupplement.promise).rejects.toThrow("任务已取消");
    await expect(secondSupplement.promise).rejects.toThrow("任务已取消");
    firstSupplementResult.resolve("迟到结果");
    await Promise.resolve();
    await Promise.resolve();
    expect(secondExecute).not.toHaveBeenCalled();
    expect(scheduler.get(main.taskId)).toMatchObject({ status: "waiting-confirmation", supplementCount: 2 });
    scheduler.complete(main.taskId);
    expect(scheduler.get(main.taskId)).toMatchObject({ status: "completed" });
  });

  it("rejects supplements that cross project or task kind boundaries", async () => {
    const scheduler = new TaskScheduler<null, string>();
    const main = scheduler.submit({ projectId: "project_a", kind: "agent", goal: "主任务", getInput: () => null,
      execute: async () => new Promise<string>(() => {}) });
    expect(() => scheduler.submit({ projectId: "project_b", kind: "agent", relation: "supplement", parentTaskId: main.taskId,
      goal: "跨项目", getInput: () => null, execute: async () => "bad" })).toThrow("当前没有可补充");
    expect(() => scheduler.submit({ projectId: "project_a", kind: "analysis", relation: "supplement", parentTaskId: main.taskId,
      goal: "跨类型", getInput: () => null, execute: async () => "bad" })).toThrow("当前没有可补充");
  });

  it("completes a waiting task without leaving queued supplements pending", async () => {
    const scheduler = new TaskScheduler<null, string>();
    const main = scheduler.submit({ projectId: "p", kind: "agent", goal: "等待输入", getInput: () => null,
      execute: async (_input, context) => { context.setStatus("waiting-input"); return "draft"; } });
    await expect(main.promise).resolves.toBe("draft");
    const blocker = scheduler.submit({ projectId: "q", kind: "analysis", goal: "占用资源", getInput: () => null,
      execute: async () => new Promise<string>(() => {}) });
    await Promise.resolve();
    const supplement = scheduler.submit({ projectId: "p", kind: "agent", relation: "supplement", goal: "尚未执行", getInput: () => null,
      execute: async () => "never" });
    scheduler.complete(main.taskId);
    await expect(supplement.promise).rejects.toThrow("任务已取消");
    expect(scheduler.get(main.taskId)).toMatchObject({ status: "completed" });
    blocker.cancel();
    await expect(blocker.promise).rejects.toThrow("任务已取消");
  });

  it.each(["waiting-input", "paused"] as const)("retains the %s lifecycle state until explicitly completed", async (status) => {
    const scheduler = new TaskScheduler<null, string>();
    const handle = scheduler.submit({ projectId: "p", kind: "agent", goal: status, getInput: () => null,
      execute: async (_input, context) => { context.setStatus(status); return "stopped"; } });
    await expect(handle.promise).resolves.toBe("stopped");
    expect(scheduler.get(handle.taskId)).toMatchObject({ status });
    scheduler.complete(handle.taskId);
    expect(scheduler.get(handle.taskId)).toMatchObject({ status: "completed" });
  });

  it("records failed tasks and aborts running work on cancellation", async () => {
    const scheduler = new TaskScheduler<null, string>();
    const failed = scheduler.submit({ projectId: "failed", kind: "analysis", goal: "失败", getInput: () => null,
      execute: async () => { throw new Error("solver failed"); } });
    await expect(failed.promise).rejects.toThrow("solver failed");
    expect(scheduler.get(failed.taskId)).toMatchObject({ status: "failed", error: "solver failed" });

    let aborted = false;
    const running = scheduler.submit({ projectId: "running", kind: "analysis", goal: "取消", getInput: () => null,
      execute: async (_input, context) => new Promise<string>((_resolve, reject) => {
        context.signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
      }) });
    await Promise.resolve();
    running.cancel();
    await expect(running.promise).rejects.toThrow("任务已取消");
    expect(aborted).toBe(true);
    expect(scheduler.get(running.taskId)).toMatchObject({ status: "cancelled" });
  });

  it("cancels every task in a project and ignores late results", async () => {
    const scheduler = new TaskScheduler<null, string>();
    const late = deferred<string>();
    const events: ScheduledTaskEvent<string>[] = [];
    scheduler.subscribe((event) => events.push(event));
    const first = scheduler.submit({ projectId: "p", kind: "analysis", goal: "迟到", getInput: () => null,
      execute: async () => late.promise });
    const second = scheduler.submit({ projectId: "p", kind: "analysis", goal: "队列", getInput: () => null,
      execute: async () => "should-not-run" });
    await Promise.resolve();
    scheduler.cancelProject("p");
    await expect(first.promise).rejects.toThrow("任务已取消");
    await expect(second.promise).rejects.toThrow("任务已取消");
    late.resolve("late");
    await Promise.resolve();
    expect(events.filter((event) => event.type === "result")).toHaveLength(0);
    expect(scheduler.get(first.taskId)).toMatchObject({ status: "cancelled" });
    expect(scheduler.get(second.taskId)).toMatchObject({ status: "cancelled" });
  });
});
