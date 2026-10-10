import type { ProjectCandidate, CandidateInspection } from "./contracts";
export const REVERSE_AGENT_SCHEMA = "reverse-agents/2";
export const REVERSE_AGENT_PROMPT = "p25-11/1";
export const WORK_STRATEGIES = ["aggressive", "conservative", "independent"] as const;
export type WorkStrategy = typeof WORK_STRATEGIES[number];
export interface RoundWork {
  strategy: WorkStrategy; agentId: string; taskId: string; candidateId: string; branch: string; outputId: string;
  startedAt?: string; endedAt?: string; apiCalls: number; apiAttempts: number; status: "pending" | "completed" | "failed" | "cancelled";
  feasibility: "feasible" | "infeasible" | "blocked";
  candidate?: ProjectCandidate; massKg?: number; inputSha256?: string; resultSha256?: string; frozenInputSha256?: string; nativeResultSha256?: string;
  checks?: CandidateInspection["checks"]; changes?: unknown; unresolved: string[];
}
export interface RoundInspection {
  agentId: string; status: "completed" | "failed" | "cancelled"; apiCalls: number; apiAttempts: number; startedAt: string; endedAt: string;
  reports: Array<import("./reverse-design-comparison").ReverseDesignChoice & { severity: "info" | "error"; recommendations: string[]; balanceBasis: { coordinates: "global"; referencePointM: [0, 0, 0]; forceUnit: "kN"; momentUnit: "kN·m" }; }>;
  diagnostic?: string;
}
export interface ReverseDesignRound {
  schemaVersion: 1; runId: string; round: 1; mode: "online" | "replay"; status: "running" | "completed" | "failed" | "cancelled" | "stale";
  parentCommit: string; parentInputSha256: string; model: string; buildSha256: string; promptVersion: string; promptSha256: string; schemaVersionId: string; toolsSha256: string;
  sampling: { temperature: 0; thinking: "disabled"; maxTokens: 2048 }; startedAt: string; endedAt?: string; elapsedMs?: number; apiCalls: number; apiAttempts: number;
  main: { agentId: string; apiCalls: number; apiAttempts: number; status: "pending" | "completed" | "failed"; startedAt: string; endedAt?: string };
  works: RoundWork[]; inspection?: RoundInspection; decision: "pending" | "no-feasible" | "merge-proposed" | "blocked"; diagnostic?: string;
  comparison?: import("./reverse-design-comparison").ReverseDesignComparison;
  mergeRequest?: { taskId: string; candidateId: string; expectedCommit: string; parentCommit: string; inputSha256: string; resultSha256: string; confirmationRequired: true };
  timeline: Array<{ agentId: string; event: string; at: string }>;
  tools: Array<{ agentId: string; name: string; at: string; status: "completed" | "rejected"; evidenceSha256?: string }>;
  artifacts: Record<string, string>;
}
const tool = (name: string, description: string, properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "function", function: { name, description, parameters: { type: "object", additionalProperties: false, properties, required } } });
export const WORK_TOOLS = [
  tool("generate_candidate", "Generate this work's isolated candidate using verified catalog IDs. Only beam/column section groups may change.", { beamCatalogId: { type: "string" }, columnCatalogId: { type: "string" } }),
  tool("solve_candidate", "Queue a real local native solve of this work's frozen candidate. No other work is readable.", {}),
  tool("finish_work", "Finish after one real candidate and local solve receipt, including failed feasibility checks. Takes an EMPTY object. Do not regenerate after solving; corrections belong to the next main round.", {}),
];
export const INSPECT_TOOLS = [
  tool("read_candidate_evidence", "Independently read persisted same-round candidate, frozen native input and result; recompute program observations. Read-only.", { taskId: { type: "string" } }),
  tool("submit_inspection", "Return structured references for all three candidates after reading their evidence. Cannot change thresholds, candidates or merge.", { reports: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", additionalProperties: false, required: ["taskId", "inputSha256", "resultSha256"], properties: { taskId: { type: "string" }, inputSha256: { type: "string" }, resultSha256: { type: "string" } } } } }),
];
export const MAIN_TOOLS = [tool("read_parent", "Read the real confirmed parent snapshot and fixed rules before dispatch.", {}),
  tool("dispatch_round", "Actually dispatch three isolated work agents and independent inspect for ONE round. Returns only controlled evidence. Cannot merge or change rules.", {}),
  tool("propose_merge", "Request ONLY the program-selected feasible candidate using its exact task, commit and hashes from comparison.selected. This records a request for user confirmation; never applies it.", { taskId: { type: "string" }, expectedCommit: { type: "string" }, inputSha256: { type: "string" }, resultSha256: { type: "string" } }),
  tool("finish_main", "Finish with an EMPTY object. If comparison.selected exists, first call propose_merge with its exact identity. If none exists, finish without a merge request.", {})];
export const MAIN_PROMPT = "You are main. Call read_parent, then dispatch_round exactly once to start three isolated work agents and read-only inspect. Read the program comparison. If comparison.selected exists, call propose_merge with its taskId, commit as expectedCommit, inputSha256 and resultSha256 exactly. Otherwise no merge is allowed. Then finish_main with an EMPTY object. Text cannot pass checks or authorize merge. You cannot change rules or apply the request. User confirmation is required. Feedback rounds are not enabled yet.";
export const STRATEGY_PROMPTS: Record<WorkStrategy, string> = {
  aggressive: "Explore aggressive mass reduction: try the smallest catalog beam and column. You own only this work's tools and candidate.",
  conservative: "Explore conservative stepwise reduction: reduce one group by one available catalog step and keep the other group unchanged.",
  independent: "Explore a distinct section combination independently from the frozen parent. You cannot access other work outputs. Make your own choice from the catalog.",
};
export const WORK_PROMPT = "Each work round generates and solves exactly ONE candidate. Call generate_candidate, then solve_candidate, then finish_work with an EMPTY object. If program checks fail, finish_work still returns this round's infeasible evidence. Never regenerate or solve again after a solve: changes belong to the next main round. Text never proves success or authorizes merge. No commands, paths, credentials or other agents. Only section catalog IDs may change.";
export const INSPECT_PROMPT = "You are independent read-only inspect. Read persisted evidence for all three task IDs using read_candidate_evidence, then submit_inspection with exact hashes. Never copy work self-reported pass, change thresholds, models, or decide/merge. Program checks include values and thresholds. No commands, paths or credentials.";
