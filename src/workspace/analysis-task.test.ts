import { afterEach, describe, expect, it, vi } from "vitest";
import { captureAnalysisInput, type AnalysisResult } from "../domain/analysis";
import { createProject } from "../domain/project";
import { AnalysisCancelledError, startAnalysisTask } from "./analysis-task";

class ControlledWorker {
  static instances: ControlledWorker[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  constructor() {
    ControlledWorker.instances.push(this);
  }

  postMessage(_input: unknown): void {}

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    if (!this.terminated) this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}

afterEach(() => {
  ControlledWorker.instances = [];
  vi.unstubAllGlobals();
});

describe("analysis task boundary", () => {
  it("cancels before a queued fallback task can produce a result", async () => {
    const task = startAnalysisTask(captureAnalysisInput(createProject()));
    task.cancel();

    await expect(task.promise).rejects.toBeInstanceOf(AnalysisCancelledError);
  });

  it("preserves solver diagnostics across the task boundary", async () => {
    const phases: string[] = [];
    const task = startAnalysisTask(captureAnalysisInput(createProject()), {
      onPhase: (phase) => phases.push(phase),
    });

    await expect(task.promise).rejects.toMatchObject({ name: "AnalysisFailure", stage: "model-check" });
    expect(phases).toEqual(["model-check"]);
  });

  it("terminates an in-flight worker and ignores its late result", async () => {
    vi.stubGlobal("Worker", ControlledWorker);
    const task = startAnalysisTask(captureAnalysisInput(createProject()));
    const worker = ControlledWorker.instances[0];
    const rejection = expect(task.promise).rejects.toBeInstanceOf(AnalysisCancelledError);

    task.cancel();
    worker.emit({ kind: "result", result: {} as AnalysisResult });

    await rejection;
    expect(worker.terminated).toBe(true);
  });

  it("keeps a rerun isolated from the cancelled task", async () => {
    vi.stubGlobal("Worker", ControlledWorker);
    const first = startAnalysisTask(captureAnalysisInput(createProject()));
    const firstWorker = ControlledWorker.instances[0];
    const second = startAnalysisTask(captureAnalysisInput(createProject()));
    const secondWorker = ControlledWorker.instances[1];
    const firstRejection = expect(first.promise).rejects.toBeInstanceOf(AnalysisCancelledError);
    const result = { id: "analysis_test" } as AnalysisResult;

    first.cancel();
    firstWorker.emit({ kind: "result", result });
    secondWorker.emit({ kind: "result", result });

    await firstRejection;
    await expect(second.promise).resolves.toBe(result);
  });
});
