import { afterEach, describe, expect, it, vi } from "vitest";
import { captureAnalysisInput, type AnalysisResult } from "../domain/analysis";
import { createProject } from "../domain/project";
import { executeAnalysisRequest, type AnalysisServiceRequest } from "../domain/analysis-service";
import { reportFixture } from "../domain/engineering-report.fixture";
import { AnalysisCancelledError, startAnalysisTask } from "./analysis-task";

class ControlledWorker {
  static instances: ControlledWorker[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  request!: AnalysisServiceRequest;

  constructor() {
    ControlledWorker.instances.push(this);
  }

  postMessage(input: AnalysisServiceRequest): void { this.request = input; }

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
  it("fails native startup without silently using the TypeScript solver", async () => {
    vi.stubGlobal("window", {});
    const task = startAnalysisTask(captureAnalysisInput(reportFixture()), { backend: "native-single-member" });
    await expect(task.promise).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: "native-start-error" })], run: { solver: { implementation: "framemind-native/1" }, status: "failed", stages: [] } });
  });

  it("rejects native transcripts that end at a phase or belong to another request", async () => {
    for (const wrongId of [false, true]) {
      vi.stubGlobal("window", { frameMind: { runNativeAnalysis: async (request: AnalysisServiceRequest) => [
        { kind: "phase", requestId: wrongId ? "request_other" : request.requestId, record: { stage: "model-check", startedAt: new Date().toISOString() } },
      ] } });
      const task = startAnalysisTask(captureAnalysisInput(reportFixture()), { backend: "native-single-member" });
      await expect(task.promise).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: "invalid-service-output" })], run: { status: "failed" } });
    }
  });

  it("forwards native cancellation and ignores late results", async () => {
    let deliver!: (messages: unknown[]) => void;
    const cancelNativeAnalysis = vi.fn(async () => {});
    vi.stubGlobal("window", { frameMind: { runNativeAnalysis: () => new Promise<unknown[]>((resolve) => { deliver = resolve; }), cancelNativeAnalysis } });
    const task = startAnalysisTask(captureAnalysisInput(reportFixture()), { backend: "native-single-member" });
    const rejection = expect(task.promise).rejects.toBeInstanceOf(AnalysisCancelledError);
    task.cancel(); deliver([{ kind: "result", result: {} }]);
    await rejection;
    expect(cancelNativeAnalysis).toHaveBeenCalledOnce();
  });

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
    worker.onmessage?.({ data: { requestId: worker.request.requestId, kind: "result", result: {} as AnalysisResult } } as MessageEvent<unknown>);

    await rejection;
    expect(worker.terminated).toBe(true);
  });

  it("keeps a rerun isolated from the cancelled task", async () => {
    vi.stubGlobal("Worker", ControlledWorker);
    const first = startAnalysisTask(captureAnalysisInput(createProject()));
    const firstWorker = ControlledWorker.instances[0];
    const second = startAnalysisTask(captureAnalysisInput(reportFixture()));
    const secondWorker = ControlledWorker.instances[1];
    const firstRejection = expect(first.promise).rejects.toBeInstanceOf(AnalysisCancelledError);
    const result = executeAnalysisRequest(secondWorker.request);

    first.cancel();
    firstWorker.emit({ requestId: firstWorker.request.requestId, kind: "result", result });
    result.service!.stages.forEach((record) => secondWorker.emit({ requestId: secondWorker.request.requestId, kind: "phase", record }));
    secondWorker.emit({ requestId: secondWorker.request.requestId, kind: "result", result });

    await firstRejection;
    await expect(second.promise).resolves.toBe(result);
  });

  it("captures mutable input before asynchronous dispatch and records cancellation at the last real phase", async () => {
    vi.stubGlobal("Worker", ControlledWorker);
    const input = structuredClone(captureAnalysisInput(reportFixture()));
    const task = startAnalysisTask(input);
    const worker = ControlledWorker.instances[0];
    input.nodes[1].position.x = 99;
    expect(worker.request.input.nodes[1].position.x).toBe(4);
    worker.emit({ requestId: worker.request.requestId, kind: "phase", record: { stage: "model-check", startedAt: new Date().toISOString() } });
    const rejection = expect(task.promise).rejects.toMatchObject({ run: { status: "cancelled", stages: [expect.objectContaining({ stage: "model-check" })] } });
    task.cancel();
    await rejection;
  });

  it("returns structured transport errors at the observed stage and preserves project identity", async () => {
    vi.stubGlobal("Worker", ControlledWorker);
    const project = reportFixture();
    const task = startAnalysisTask(captureAnalysisInput(project));
    const worker = ControlledWorker.instances[0];
    worker.emit({ requestId: worker.request.requestId, kind: "phase", record: { stage: "model-check", startedAt: new Date().toISOString() } });
    worker.emit({ requestId: worker.request.requestId, kind: "phase", record: { stage: "assembly", startedAt: new Date().toISOString() } });
    worker.onerror?.({ message: "injected worker fault" } as ErrorEvent);
    await expect(task.promise).rejects.toMatchObject({ stage: "assembly", diagnostics: [expect.objectContaining({ code: "worker-error" })], run: { projectId: project.id, status: "failed" } });
    expect(project.latestAnalysis!.nodes[1].displacement.x).toBeCloseTo(0.00002, 12);
  });

  it("restores a solver's node, DOF and numerical evidence across the worker protocol", async () => {
    vi.stubGlobal("Worker", ControlledWorker);
    const input = structuredClone(captureAnalysisInput(reportFixture()));
    input.supports[0].restraints = [true, true, true, false, false, false];
    const task = startAnalysisTask(input);
    const worker = ControlledWorker.instances[0];
    try {
      executeAnalysisRequest(worker.request, (record) => worker.emit({ requestId: worker.request.requestId, kind: "phase", record }));
    } catch (error) {
      worker.emit({ requestId: worker.request.requestId, kind: "error", error });
    }
    await expect(task.promise).rejects.toMatchObject({ stage: "solve", diagnostics: [expect.objectContaining({ code: "singular-system", target: { kind: "node", id: "node_0002" }, dof: "rx", evidence: expect.any(Object) })], run: { stages: [expect.any(Object), expect.any(Object), expect.objectContaining({ stage: "solve" })] } });
  });

  it.each(["foreign-input", "non-finite", "partial-result"])("does not accept invalid output as a successful run: %s", async (fault) => {
    vi.stubGlobal("Worker", ControlledWorker);
    const task = startAnalysisTask(captureAnalysisInput(reportFixture()));
    const worker = ControlledWorker.instances[0];
    const result = executeAnalysisRequest(worker.request);
    if (fault === "foreign-input") result.input = { ...result.input, projectRevision: 99 };
    if (fault === "non-finite") result.nodes[1].displacement.x = NaN;
    if (fault === "partial-result") result.nodes.pop();
    worker.emit({ requestId: worker.request.requestId, kind: "result", result });
    await expect(task.promise).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: "invalid-service-output" })], run: { status: "failed" } });
    expect(worker.terminated).toBe(true);
  });

  it("rejects fabricated stage history in an otherwise valid result", async () => {
    vi.stubGlobal("Worker", ControlledWorker);
    const task = startAnalysisTask(captureAnalysisInput(reportFixture()));
    const worker = ControlledWorker.instances[0];
    worker.emit({ requestId: worker.request.requestId, kind: "result", result: executeAnalysisRequest(worker.request) });
    await expect(task.promise).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: "invalid-service-output" })] });
  });

  it.each([
    { name: "AnalysisFailure", stage: "made-up", diagnostics: [{ code: "x", message: "x" }] },
    { name: "AnalysisFailure", stage: "solve", diagnostics: [{}] },
    { name: "AnalysisFailure", stage: "solve", diagnostics: [{ code: "x", message: "x", target: { kind: "node" } }] },
  ])("rejects malformed worker diagnostics without exposing unusable UI data: %j", async (error) => {
    vi.stubGlobal("Worker", ControlledWorker);
    const task = startAnalysisTask(captureAnalysisInput(reportFixture()));
    const worker = ControlledWorker.instances[0];
    worker.emit({ requestId: worker.request.requestId, kind: "error", error });
    await expect(task.promise).rejects.toMatchObject({ stage: "model-check", diagnostics: [expect.objectContaining({ code: "invalid-service-output" })] });
  });
});
