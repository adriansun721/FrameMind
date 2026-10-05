import { ANALYSIS_DOF_ORDER, ANALYSIS_SOLVER, freezeAnalysisInput, sameInputValue, solveFrame, type AnalysisInputSnapshot, type AnalysisResult } from "./analysis";
import { AnalysisFailure, type AnalysisDiagnostic, type AnalysisStage } from "./analysis-diagnostics";
import { ANALYSIS_SERVICE_VERSION, analysisDependencies, analysisSourceId, validAnalysisOrigin, type AnalysisOrigin, type AnalysisRunRecord, type AnalysisStageRecord } from "./analysis-service-contract";

export interface AnalysisServiceRequest {
  version: typeof ANALYSIS_SERVICE_VERSION;
  requestId: string;
  analysisId: string;
  origin: AnalysisOrigin;
  sourceId: string;
  dependencies: AnalysisRunRecord["dependencies"];
  input: AnalysisInputSnapshot;
}

export class AnalysisServiceFailure extends AnalysisFailure {
  constructor(stage: AnalysisStage, diagnostics: AnalysisDiagnostic[], public readonly run?: AnalysisRunRecord) {
    super(stage, diagnostics);
  }
}

export function createAnalysisRequest(input: AnalysisInputSnapshot, origin: AnalysisOrigin = { kind: "formal-model" }): AnalysisServiceRequest {
  const snapshot = structuredClone(input);
  snapshot.solver ??= { ...ANALYSIS_SOLVER };
  const request: AnalysisServiceRequest = {
    version: ANALYSIS_SERVICE_VERSION, requestId: `request_${crypto.randomUUID()}`,
    analysisId: `analysis_${crypto.randomUUID()}`, origin: structuredClone(origin), input: snapshot,
    sourceId: analysisSourceId(snapshot), dependencies: analysisDependencies(snapshot),
  };
  // Freeze before asynchronous dispatch, even when callers pass a mutable snapshot.
  freezeAnalysisInput(snapshot);
  Object.freeze(request.origin);
  request.dependencies.forEach(Object.freeze);
  Object.freeze(request.dependencies);
  return Object.freeze(request);
}

export function analysisRunRecord(request: AnalysisServiceRequest, status: AnalysisRunRecord["status"], stages: readonly AnalysisStageRecord[]): AnalysisRunRecord | undefined {
  try {
    if (!request?.input || request.version !== ANALYSIS_SERVICE_VERSION
      || typeof request.requestId !== "string" || !request.requestId.trim()
      || typeof request.analysisId !== "string" || !request.analysisId.trim()
      || typeof request.input.projectId !== "string" || !request.input.projectId.trim()
      || !Number.isSafeInteger(request.input.projectRevision) || request.input.projectRevision < 0
      || !request.input.solver || !validAnalysisOrigin(request.origin, request.input)) return undefined;
    return {
      version: request.version, requestId: request.requestId, analysisId: request.analysisId,
      projectId: request.input.projectId, projectRevision: request.input.projectRevision,
      origin: structuredClone(request.origin), sourceId: analysisSourceId(request.input),
      dependencies: analysisDependencies(request.input), solver: { ...request.input.solver },
      status, stages: structuredClone([...stages]),
    };
  } catch { return undefined; }
}

export function analysisServiceFailure(request: AnalysisServiceRequest, stages: readonly AnalysisStageRecord[], error: unknown, code = "service-error"): AnalysisServiceFailure {
  if (error instanceof AnalysisServiceFailure) return error;
  const stage = error instanceof AnalysisFailure ? error.stage : stages.at(-1)?.stage ?? "model-check";
  const diagnostics = error instanceof AnalysisFailure ? error.diagnostics
    : [{ code, message: error instanceof Error ? error.message : String(error), field: "analysis-service" }];
  // A malformed protocol packet may have no readable engineering identity.
  // Return its structured diagnostic without inventing provenance or throwing again.
  return new AnalysisServiceFailure(stage, diagnostics, analysisRunRecord(request, "failed", stages));
}

/** Synchronous adapter body, run only in an isolated Worker in the desktop app. */
export function executeAnalysisRequest(request: AnalysisServiceRequest, onStage?: (record: AnalysisStageRecord) => void): AnalysisResult {
  const stages: AnalysisStageRecord[] = [];
  try {
    if (!request || typeof request !== "object" || !request.input || typeof request.input !== "object"
      || !Array.isArray(request.input.dofOrder) || !request.input.assumptions) {
      throw new AnalysisFailure("model-check", [{ code: "unsupported-analysis-contract", message: "分析请求缺少可读取的冻结输入、自由度或理论设置", field: "input" }]);
    }
    const { input } = request;
    if (request.version !== ANALYSIS_SERVICE_VERSION || !request.requestId || !request.analysisId
      || !validAnalysisOrigin(request.origin, input) || !input.projectId
      || request.sourceId !== analysisSourceId(input) || !sameInputValue(request.dependencies, analysisDependencies(input))
      || !Number.isSafeInteger(input.projectRevision) || input.projectRevision < 0
      || input.dofOrder.join(",") !== ANALYSIS_DOF_ORDER.join(",")
      || input.assumptions.theory !== "3d-euler-bernoulli-frame" || input.assumptions.units !== "m-kN-kN·m"
      || input.assumptions.shearDeformation !== "neglected" || input.assumptions.rigidJoints !== true
      || input.assumptions.localAxis !== "member-geometry"
      || !sameInputValue(input.solver, ANALYSIS_SOLVER)) {
      throw new AnalysisFailure("model-check", [{ code: "unsupported-analysis-contract", message: "分析协议、来源、自由度、单位或求解设置不受支持", field: "analysis-service" }]);
    }
    const result = solveFrame(input, (stage) => {
      const record = { stage, startedAt: new Date().toISOString() };
      stages.push(record);
      onStage?.(record);
    });
    return { ...result, id: request.analysisId, service: analysisRunRecord(request, "complete", stages) };
  } catch (error) {
    throw analysisServiceFailure(request, stages, error);
  }
}
