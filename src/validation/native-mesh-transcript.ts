import samples from "../../docs/evidence/plan2/T2-26/wire-samples.json";
import { meshCalculationInput } from "../domain/analysis-mesh";
import { analysisRunRecord, type AnalysisServiceRequest } from "../domain/analysis-service";
import { decodeAnalysisResult } from "../domain/project-file";
import type { AnalysisTaskMessage } from "../workspace/analysis-task";

/** Recorded native IPC fixture for task lifecycle tests, not a numerical solver. */
export function nativeMeshTranscript(request: AnalysisServiceRequest): AnalysisTaskMessage[] {
  const result = decodeAnalysisResult(samples.find((s) => s.id === "axial")!.result);
  result.id = request.analysisId; result.projectId = request.input.projectId; result.projectRevision = request.input.projectRevision;
  result.input = structuredClone(request.input);
  result.service = analysisRunRecord(request, "complete", result.service!.stages)!;
  for (const run of result.discretization!.runs) {
    const inner = run.result;
    inner.id = request.analysisId; inner.projectId = request.input.projectId; inner.projectRevision = request.input.projectRevision;
    inner.input = meshCalculationInput(request.input, request.input.meshPlan!.levels.find((l) => l.divisions === run.divisions)!);
    inner.service = analysisRunRecord({ ...request, input: inner.input }, "complete", inner.service!.stages)!;
  }
  return [...result.service.stages.map((record) => ({ kind: "phase" as const, requestId: request.requestId, record })), { kind: "result", requestId: request.requestId, result }];
}
