import { afterEach, expect, it, vi } from "vitest";
import samples from "../../docs/evidence/plan2/T2-26/wire-samples.json";
import { captureAnalysisInput, type AnalysisResult } from "../domain/analysis";
import type { AnalysisServiceRequest } from "../domain/analysis-service";
import { decodeProject } from "../domain/project-file";
import { AnalysisCancelledError, startAnalysisTask } from "./analysis-task";
import { nativeMeshTranscript as nativeTranscript } from "../validation/native-mesh-transcript";
import { createDiagnosticCopy } from "./diagnostic-trial";
import { startDiagnosticTrialTask } from "./diagnostic-analysis-task";

const sample = samples.find((entry) => entry.id === "axial")!;
const project = () => decodeProject(JSON.stringify(sample.project));
afterEach(() => vi.unstubAllGlobals());

it("contains synchronous bridge startup failures as a structured native failure", async () => {
  vi.stubGlobal("window", { frameMind: { runNativeAnalysis: () => { throw new Error("IPC context lost"); } } });
  await expect(startAnalysisTask(captureAnalysisInput(project())).promise).rejects.toMatchObject({ diagnostics: [{ code: "native-start-error" }], run: { status: "failed", stages: [] } });
});

it("settles cancellation even if a closing window has released its IPC cleanup hooks", async () => {
  vi.stubGlobal("window", { frameMind: {
    runNativeAnalysis: () => new Promise(() => {}),
    onNativeAnalysisPhase: () => () => { throw new Error("IPC context lost"); },
    cancelNativeAnalysis: () => { throw new Error("IPC context lost"); },
  } });
  const task = startAnalysisTask(captureAnalysisInput(project()));
  expect(() => task.cancel()).not.toThrow();
  await expect(task.promise).rejects.toBeInstanceOf(AnalysisCancelledError);
});

it("uses C++ for the default formal task and streams phases before the result is available", async () => {
  let listener!: (message: unknown) => void;
  let deliver!: (messages: unknown[]) => void;
  let request!: AnalysisServiceRequest;
  const unsubscribe = vi.fn();
  const phases: string[] = [];
  vi.stubGlobal("window", { frameMind: {
    onNativeAnalysisPhase: (_id: string, receive: typeof listener) => { listener = receive; return unsubscribe; },
    runNativeAnalysis: (packet: AnalysisServiceRequest) => { request = packet; return new Promise<unknown[]>((resolve) => { deliver = resolve; }); },
  } });
  const input = structuredClone(captureAnalysisInput(project()));
  const task = startAnalysisTask(input, { onPhase: (phase) => phases.push(phase) });
  input.nodes[1].position.x = 77;
  const messages = nativeTranscript(request);
  listener(messages[0]); listener(messages[1]);
  expect(phases).toEqual(["model-check", "assembly"]);
  deliver(messages);
  const result = await task.promise;
  expect(result.input.nodes[1].position.x).toBe(4);
  expect(result.input.solver!.implementation).toBe("framemind-native/4");
  expect(result.nodes[1].displacement.x).toBeCloseTo(0.000016, 12);
  expect(phases).toEqual(["model-check", "assembly", "solve", "recovery"]);
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it.each(["non-finite", "foreign-input", "partial", "wrong-solver", "stage-mismatch"])("keeps prior engineering state after invalid native output: %s", async (fault) => {
  const model = project(), before = structuredClone(model);
  vi.stubGlobal("window", { frameMind: { runNativeAnalysis: async (request: AnalysisServiceRequest) => {
    const messages = nativeTranscript(request);
    const result = (messages.at(-1) as { result: AnalysisResult }).result;
    if (fault === "non-finite") result.nodes[1].displacement.x = NaN;
    if (fault === "foreign-input") result.input.nodes[1].position.x = 99;
    if (fault === "partial") result.nodes.pop();
    if (fault === "wrong-solver") result.input.solver!.implementation = "framemind-frame/3";
    if (fault === "stage-mismatch") result.service!.stages[0].startedAt = "2020-01-01T00:00:00Z";
    return messages;
  } } });
  // Clone the fixture's stages independently to distinguish transcript and result histories.
  if (fault === "stage-mismatch") {
    window.frameMind!.runNativeAnalysis = async (request: unknown) => {
      const messages = nativeTranscript(request as AnalysisServiceRequest);
      const result = (messages.at(-1) as { result: AnalysisResult }).result;
      result.service!.stages = structuredClone(result.service!.stages); result.service!.stages[0].startedAt = "2020-01-01T00:00:00Z";
      return messages;
    };
  }
  await expect(startAnalysisTask(captureAnalysisInput(model)).promise).rejects.toMatchObject({ run: { status: "failed", solver: { implementation: "framemind-native/4" } } });
  expect(model).toEqual(before);
});

it("isolates late streamed phases after cancellation and starts a fresh native run", async () => {
  const listeners: Array<(message: unknown) => void> = [];
  const requests: AnalysisServiceRequest[] = [];
  const deliveries: Array<(messages: unknown[]) => void> = [];
  const cancel = vi.fn(async () => {});
  vi.stubGlobal("window", { frameMind: { cancelNativeAnalysis: cancel,
    onNativeAnalysisPhase: (_id: string, listener: (message: unknown) => void) => { listeners.push(listener); return () => {}; },
    runNativeAnalysis: (request: AnalysisServiceRequest) => { requests.push(request); return new Promise<unknown[]>((resolve) => deliveries.push(resolve)); },
  } });
  const phases: string[] = [];
  const first = startAnalysisTask(captureAnalysisInput(project()), { onPhase: (phase) => phases.push(phase) });
  const rejection = expect(first.promise).rejects.toBeInstanceOf(AnalysisCancelledError);
  first.cancel();
  const second = startAnalysisTask(captureAnalysisInput(project()));
  listeners[0](nativeTranscript(requests[0])[0]); deliveries[0](nativeTranscript(requests[0]));
  deliveries[1](nativeTranscript(requests[1]));
  await rejection;
  await expect(second.promise).resolves.toMatchObject({ service: { requestId: requests[1].requestId } });
  expect(phases).toEqual([]); expect(cancel).toHaveBeenCalledWith(requests[0].requestId);
});

it("executes an isolated diagnostic candidate through the same native task and retains failure evidence", async () => {
  const model = project(), copy = createDiagnosticCopy(model);
  vi.stubGlobal("window", { frameMind: { runNativeAnalysis: async (request: AnalysisServiceRequest) => nativeTranscript(request) } });
  const outcome = await startDiagnosticTrialTask(copy, { label: "原生副本", operations: [] }).promise;
  expect(outcome.trial.result!.service!.origin).toMatchObject({ kind: "diagnostic-copy", copyId: copy.id, sourceProjectId: model.id });
  expect(outcome.trial.result!.input.solver!.implementation).toBe("framemind-native/4");
  expect(model.analysisResults).toEqual(sample.project.analysisResults);
  window.frameMind!.runNativeAnalysis = async (request: unknown) => [{ kind: "error", requestId: (request as AnalysisServiceRequest).requestId,
    error: { name: "AnalysisFailure", stage: "model-check", diagnostics: [{ code: "native-resource-limit", message: "Memory exhausted", field: "native-core" }] } }];
  const failed = await startDiagnosticTrialTask(outcome.copy, { label: "故障副本", operations: [] }).promise;
  expect(failed.trial).toMatchObject({ status: "failed", evidence: { diagnostics: [{ code: "native-resource-limit" }], service: { status: "failed" } } });
  expect(failed.copy.trials[0]).toEqual(outcome.trial);
});
