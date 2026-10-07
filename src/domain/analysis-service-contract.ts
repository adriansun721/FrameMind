import { sameInputValue, type AnalysisInputSnapshot, type AnalysisSolverConfig } from "./analysis";
import type { AnalysisStage } from "./analysis-diagnostics";

/** Versioned wire contract shared by the TS adapter and future native adapters. */
export const ANALYSIS_SERVICE_VERSION = "framemind-analysis/1" as const;
export const ANALYSIS_STAGE_ORDER: readonly AnalysisStage[] = ["model-check", "assembly", "solve", "recovery"];

export type AnalysisOrigin =
  | { kind: "formal-model" }
  | { kind: "diagnostic-copy"; copyId: string; sourceProjectId: string; sourceProjectRevision: number; sourceAnalysisId?: string }
  | { kind: "supplemental"; sourceAnalysisId: string };

export interface AnalysisStageRecord {
  stage: AnalysisStage;
  startedAt: string;
}

export interface AnalysisRunRecord {
  version: typeof ANALYSIS_SERVICE_VERSION;
  requestId: string;
  analysisId: string;
  projectId: string;
  projectRevision: number;
  origin: AnalysisOrigin;
  sourceId: string;
  dependencies: Array<{ loadCaseId: string; factor: number; role?: "fixed" | "reference" }>;
  solver: AnalysisSolverConfig;
  status: "complete" | "failed" | "cancelled";
  stages: AnalysisStageRecord[];
}

export function analysisDependencies(input: AnalysisInputSnapshot): AnalysisRunRecord["dependencies"] {
  if (input.analysisCase?.method === "buckling") return (["fixed", "reference"] as const).flatMap((role) => input.analysisCase!.settings.buckling![role].map((t) => ({ ...t, role })));
  return ["modal", "random"].includes(input.analysisCase?.method ?? "") ? [] : input.combination ? input.combination.definition.terms.map((term) => ({ ...term }))
    : [{ loadCaseId: input.loadCase?.id ?? "LC1", factor: 1 }];
}

export function analysisSourceId(input: AnalysisInputSnapshot): string {
  return input.analysisCase?.id ?? input.combination?.definition.id ?? input.loadCase?.id ?? "LC1";
}

export function validAnalysisOrigin(origin: AnalysisOrigin, input: AnalysisInputSnapshot): boolean {
  if (!origin || typeof origin !== "object") return false;
  const id = (value: unknown) => typeof value === "string" && value.trim().length > 0;
  if (origin.kind === "formal-model") return true;
  if (origin.kind === "supplemental") return id(origin.sourceAnalysisId);
  return origin.kind === "diagnostic-copy" && origin.copyId === input.projectId && id(origin.sourceProjectId)
    && origin.sourceProjectId !== input.projectId && Number.isSafeInteger(origin.sourceProjectRevision)
    && origin.sourceProjectRevision >= 0 && (origin.sourceAnalysisId === undefined || id(origin.sourceAnalysisId));
}

/** Old results may omit the service record; new records must agree with frozen input. */
export function decodeAnalysisRun(value: unknown, input: AnalysisInputSnapshot, analysisId: string): AnalysisRunRecord | undefined {
  if (value === undefined) return undefined;
  const run = value as AnalysisRunRecord;
  if (!run || typeof run !== "object" || run.version !== ANALYSIS_SERVICE_VERSION || run.status !== "complete"
    || typeof run.requestId !== "string" || !run.requestId.trim() || run.analysisId !== analysisId
    || run.projectId !== input.projectId || run.projectRevision !== input.projectRevision
    || !validAnalysisOrigin(run.origin, input) || run.sourceId !== analysisSourceId(input)
    || !sameInputValue(run.dependencies, analysisDependencies(input))
    || !sameInputValue(run.solver, input.solver)
    || !Array.isArray(run.stages) || run.stages.length !== ANALYSIS_STAGE_ORDER.length
    || run.stages.some((record, index) => !record || record.stage !== ANALYSIS_STAGE_ORDER[index]
      || typeof record.startedAt !== "string" || !Number.isFinite(Date.parse(record.startedAt)))) {
    throw new Error("分析服务记录与冻结输入或真实阶段不一致");
  }
  return structuredClone(run);
}
