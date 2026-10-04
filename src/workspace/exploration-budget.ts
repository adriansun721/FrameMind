/**
 * Deterministic limits for autonomous engineering exploration.
 * The controller owns accounting only; callers still own the actual work and
 * must check canContinue before starting a request or an analysis.
 */

export type ExplorationMode = "normal" | "deep";
export type ExplorationPhase = "running" | "paused" | "waiting-user" | "stopped";
export type ExplorationStopReason = "budget-exhausted" | "no-progress" | "repeated-failure" | "resource-limit" | "cancelled" | "completed";

export interface ExplorationBudgetLimits {
  budgetMs: number;
  maxRounds: number;
  maxToolCalls: number;
  maxCandidates: number;
  maxAnalyses: number;
  maxSingleAnalysisMs: number;
  maxResourceUnits: number;
  noProgressRoundLimit: number;
  repeatedFailureLimit: number;
}

export interface ExplorationBudgetOptions extends Partial<ExplorationBudgetLimits> {
  mode?: ExplorationMode;
  now?(): number;
}

export interface ExplorationBudgetSnapshot extends ExplorationBudgetLimits {
  mode: ExplorationMode;
  phase: ExplorationPhase;
  startedAt: number;
  elapsedMs: number;
  waitingMs: number;
  rounds: number;
  toolCalls: number;
  requests: number;
  candidates: number;
  analyses: number;
  evidenceCount: number;
  noProgressRounds: number;
  repeatedFailures: number;
  activeAnalyses: number;
  stopReason?: ExplorationStopReason;
  nextSteps: readonly string[];
}

export interface ExplorationOutcome {
  /** Stable evidence identity. A repeated identity is not new progress. */
  evidenceKey?: string;
  evidenceKeys?: readonly string[];
  /** Stable failure identity. Consecutive repeats stop autonomous retries. */
  failureKey?: string;
}

export interface ExplorationBudget {
  readonly mode: ExplorationMode;
  snapshot(): ExplorationBudgetSnapshot;
  canContinue(): boolean;
  beginRound(): boolean;
  recordToolCall(): boolean;
  recordRequest(): boolean;
  recordCandidate(): boolean;
  beginAnalysis(): boolean;
  finishAnalysis(durationMs?: number): boolean;
  recordAnalysis(durationMs?: number): boolean;
  recordOutcome(outcome: ExplorationOutcome): boolean;
  pause(): boolean;
  waitForUser(): boolean;
  resume(): boolean;
  stop(reason: ExplorationStopReason, nextSteps?: readonly string[]): void;
  /** Explicit user action only; does not happen when a budget is exhausted. */
  extend(additionalMs: number): boolean;
}

export const DEFAULT_EXPLORATION_BUDGETS: Record<ExplorationMode, ExplorationBudgetLimits> = {
  normal: {
    // The displayed value is the configured active exploration budget. Waiting
    // for the user and a paused request do not consume it.
    budgetMs: 4 * 60_000,
    maxRounds: 8,
    maxToolCalls: 64,
    maxCandidates: 20,
    maxAnalyses: 8,
    maxSingleAnalysisMs: 120_000,
    maxResourceUnits: 1,
    noProgressRoundLimit: 3,
    repeatedFailureLimit: 3,
  },
  deep: {
    budgetMs: 12 * 60_000,
    maxRounds: 16,
    maxToolCalls: 128,
    maxCandidates: 40,
    maxAnalyses: 16,
    maxSingleAnalysisMs: 300_000,
    maxResourceUnits: 1,
    noProgressRoundLimit: 4,
    repeatedFailureLimit: 4,
  },
};

const STOP_NEXT_STEPS: Record<ExplorationStopReason, readonly string[]> = {
  "budget-exhausted": ["已保留诊断、试算和失败证据；请补充输入、明确追加预算或主动开启深度探索。"],
  "no-progress": ["已停止重复尝试；请核对剩余假设和未解决对象后再继续。"],
  "repeated-failure": ["已保留重复失败证据；请检查失败阶段、相关对象和边界条件后重新规划。"],
  "resource-limit": ["已达到本任务的轮次、调用、候选或计算资源上限；请缩小范围或分拆任务。"],
  cancelled: ["已保留中断前证据；可基于这些证据重新发送任务。"],
  completed: ["可继续核对已保留证据和剩余事项。"],
};

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} 必须是正数`);
  return value;
}

function safeCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} 必须是正整数`);
  return value;
}

class ExplorationBudgetController implements ExplorationBudget {
  readonly mode: ExplorationMode;
  private readonly now: () => number;
  private limits: ExplorationBudgetLimits;
  private phase: ExplorationPhase = "running";
  private startedAt: number;
  private stoppedAt?: number;
  private waitingStartedAt?: number;
  private waitingMs = 0;
  private rounds = 0;
  private toolCalls = 0;
  private requests = 0;
  private candidates = 0;
  private analyses = 0;
  private evidenceCount = 0;
  private noProgressRounds = 0;
  private repeatedFailures = 0;
  private activeAnalyses = 0;
  private readonly evidenceKeys = new Set<string>();
  private lastFailureKey?: string;
  private stopReason?: ExplorationStopReason;
  private nextSteps: readonly string[] = [];

  constructor(options: ExplorationBudgetOptions) {
    this.mode = options.mode ?? "normal";
    const defaults = DEFAULT_EXPLORATION_BUDGETS[this.mode];
    this.limits = {
      budgetMs: options.budgetMs ?? defaults.budgetMs,
      maxRounds: options.maxRounds ?? defaults.maxRounds,
      maxToolCalls: options.maxToolCalls ?? defaults.maxToolCalls,
      maxCandidates: options.maxCandidates ?? defaults.maxCandidates,
      maxAnalyses: options.maxAnalyses ?? defaults.maxAnalyses,
      maxSingleAnalysisMs: options.maxSingleAnalysisMs ?? defaults.maxSingleAnalysisMs,
      maxResourceUnits: options.maxResourceUnits ?? defaults.maxResourceUnits,
      noProgressRoundLimit: options.noProgressRoundLimit ?? defaults.noProgressRoundLimit,
      repeatedFailureLimit: options.repeatedFailureLimit ?? defaults.repeatedFailureLimit,
    };
    finitePositive(this.limits.budgetMs, "budgetMs");
    finitePositive(this.limits.maxSingleAnalysisMs, "maxSingleAnalysisMs");
    safeCount(this.limits.maxRounds, "maxRounds");
    safeCount(this.limits.maxToolCalls, "maxToolCalls");
    safeCount(this.limits.maxCandidates, "maxCandidates");
    safeCount(this.limits.maxAnalyses, "maxAnalyses");
    safeCount(this.limits.maxResourceUnits, "maxResourceUnits");
    safeCount(this.limits.noProgressRoundLimit, "noProgressRoundLimit");
    safeCount(this.limits.repeatedFailureLimit, "repeatedFailureLimit");
    this.now = options.now ?? (() => Date.now());
    this.startedAt = this.now();
  }

  snapshot(): ExplorationBudgetSnapshot {
    this.checkLimits();
    const waitingMs = this.waitingMs + (this.waitingStartedAt === undefined ? 0 : Math.max(0, this.now() - this.waitingStartedAt));
    const elapsedMs = Math.max(0, (this.stoppedAt ?? this.now()) - this.startedAt - waitingMs);
    return { ...this.limits, mode: this.mode, phase: this.phase, startedAt: this.startedAt, elapsedMs, waitingMs,
      rounds: this.rounds, toolCalls: this.toolCalls, requests: this.requests, candidates: this.candidates, analyses: this.analyses,
      evidenceCount: this.evidenceCount, noProgressRounds: this.noProgressRounds, repeatedFailures: this.repeatedFailures,
      activeAnalyses: this.activeAnalyses, stopReason: this.stopReason, nextSteps: this.nextSteps };
  }

  canContinue(): boolean {
    this.checkLimits();
    return this.phase === "running";
  }

  beginRound(): boolean {
    if (!this.canContinue()) return false;
    if (this.rounds >= this.limits.maxRounds) { this.stop("resource-limit"); return false; }
    this.rounds += 1;
    return this.checkLimits();
  }

  recordToolCall(): boolean {
    if (!this.canContinue()) return false;
    if (this.toolCalls >= this.limits.maxToolCalls) { this.stop("resource-limit"); return false; }
    this.toolCalls += 1;
    return this.checkLimits();
  }

  recordRequest(): boolean {
    if (!this.canContinue()) return false;
    if (this.requests >= this.limits.maxToolCalls) { this.stop("resource-limit"); return false; }
    this.requests += 1;
    return true;
  }

  recordCandidate(): boolean {
    if (!this.canContinue()) return false;
    if (this.candidates >= this.limits.maxCandidates) { this.stop("resource-limit"); return false; }
    this.candidates += 1;
    return this.checkLimits();
  }

  recordAnalysis(durationMs = 0): boolean {
    if (!this.beginAnalysis()) return false;
    return this.finishAnalysis(durationMs);
  }

  beginAnalysis(): boolean {
    if (!this.canContinue()) return false;
    if (this.activeAnalyses >= this.limits.maxResourceUnits || this.analyses >= this.limits.maxAnalyses) {
      this.stop("resource-limit");
      return false;
    }
    this.activeAnalyses += 1;
    this.analyses += 1;
    return this.checkLimits();
  }

  finishAnalysis(durationMs = 0): boolean {
    if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error("分析耗时必须是非负数");
    this.activeAnalyses = Math.max(0, this.activeAnalyses - 1);
    if (durationMs > this.limits.maxSingleAnalysisMs) {
      this.stop("resource-limit");
      return false;
    }
    return this.checkLimits();
  }

  recordOutcome(outcome: ExplorationOutcome): boolean {
    if (!this.canContinue()) return false;
    const newKeys = [...new Set([...(outcome.evidenceKeys ?? []), outcome.evidenceKey ?? ""].filter((key) => key.trim()))].filter((key) => !this.evidenceKeys.has(key));
    if (newKeys.length) {
      this.evidenceCount += newKeys.length;
      this.noProgressRounds = 0;
      newKeys.forEach((key) => this.evidenceKeys.add(key));
    } else {
      this.noProgressRounds += 1;
    }
    const failureKey = outcome.failureKey?.trim();
    if (failureKey) {
      this.repeatedFailures = failureKey === this.lastFailureKey ? this.repeatedFailures + 1 : 1;
      this.lastFailureKey = failureKey;
    } else {
      this.repeatedFailures = 0;
      this.lastFailureKey = undefined;
    }
    if (this.repeatedFailures >= this.limits.repeatedFailureLimit) {
      this.stop("repeated-failure");
      return false;
    }
    if (this.noProgressRounds >= this.limits.noProgressRoundLimit) {
      this.stop("no-progress");
      return false;
    }
    return this.checkLimits();
  }

  pause(): boolean {
    if (this.phase !== "running") return false;
    this.phase = "paused";
    this.waitingStartedAt = this.now();
    this.stopReason = undefined;
    this.nextSteps = [];
    return true;
  }

  waitForUser(): boolean {
    if (this.phase !== "running" && this.phase !== "paused") return false;
    if (this.waitingStartedAt === undefined) this.waitingStartedAt = this.now();
    this.phase = "waiting-user";
    this.stopReason = undefined;
    this.nextSteps = [];
    return true;
  }

  resume(): boolean {
    if (this.phase !== "paused" && this.phase !== "waiting-user") return false;
    if (this.waitingStartedAt !== undefined) {
      this.waitingMs += Math.max(0, this.now() - this.waitingStartedAt);
      this.waitingStartedAt = undefined;
    }
    this.phase = "running";
    this.stopReason = undefined;
    this.nextSteps = [];
    return this.checkLimits();
  }

  stop(reason: ExplorationStopReason, nextSteps?: readonly string[]): void {
    if (this.phase === "stopped") return;
    if (this.waitingStartedAt !== undefined) {
      this.waitingMs += Math.max(0, this.now() - this.waitingStartedAt);
      this.waitingStartedAt = undefined;
    }
    this.phase = "stopped";
    this.stoppedAt = this.now();
    this.stopReason = reason;
    this.nextSteps = nextSteps?.length ? [...nextSteps] : STOP_NEXT_STEPS[reason];
  }

  extend(additionalMs: number): boolean {
    if (this.phase !== "stopped" || this.stopReason !== "budget-exhausted") return false;
    finitePositive(additionalMs, "additionalMs");
    const now = this.now();
    const stoppedActiveMs = Math.max(0, (this.stoppedAt ?? now) - this.startedAt - this.waitingMs);
    this.limits = { ...this.limits, budgetMs: this.limits.budgetMs + additionalMs };
    // Keep the inactive interval after exhaustion out of both active and
    // waiting-user time while preserving the elapsed active time at the stop.
    this.startedAt = now - this.waitingMs - stoppedActiveMs;
    this.stoppedAt = undefined;
    this.phase = "running";
    this.stopReason = undefined;
    this.nextSteps = [];
    return true;
  }

  private checkLimits(): boolean {
    if (this.phase !== "running") return false;
    const elapsedMs = Math.max(0, this.now() - this.startedAt - this.waitingMs);
    if (elapsedMs >= this.limits.budgetMs) { this.stop("budget-exhausted"); return false; }
    if (this.rounds > this.limits.maxRounds || this.toolCalls > this.limits.maxToolCalls || this.candidates > this.limits.maxCandidates || this.analyses > this.limits.maxAnalyses || this.activeAnalyses > this.limits.maxResourceUnits) {
      this.stop("resource-limit"); return false;
    }
    return true;
  }
}

export function createExplorationBudget(options: ExplorationBudgetOptions = {}): ExplorationBudget {
  return new ExplorationBudgetController(options);
}
