import { describe, expect, it } from "vitest";
import { createExplorationBudget, DEFAULT_EXPLORATION_BUDGETS, type ExplorationBudget } from "./exploration-budget";

function clock() {
  let time = 0;
  return { now: () => time, advance: (ms: number) => { time += ms; } };
}

describe("exploration budget", () => {
  it("uses explicit normal and deep budgets and reports the timing basis", () => {
    expect(DEFAULT_EXPLORATION_BUDGETS.normal.budgetMs).toBe(4 * 60_000);
    expect(DEFAULT_EXPLORATION_BUDGETS.deep.budgetMs).toBe(12 * 60_000);
    const normal = createExplorationBudget({ mode: "normal", now: () => 10 });
    expect(normal.snapshot()).toMatchObject({ mode: "normal", budgetMs: 240_000, phase: "running", elapsedMs: 0, waitingMs: 0 });
  });

  it("registers rounds, calls, candidates and analyses against configured limits", () => {
    const budget = createExplorationBudget({ mode: "normal", maxRounds: 2, maxToolCalls: 2, maxCandidates: 1, maxAnalyses: 1 });
    expect(budget.beginRound()).toBe(true);
    expect(budget.recordRequest()).toBe(true);
    expect(budget.recordToolCall()).toBe(true);
    expect(budget.recordCandidate()).toBe(true);
    expect(budget.recordAnalysis(25)).toBe(true);
    expect(budget.beginRound()).toBe(true);
    expect(budget.recordToolCall()).toBe(true);
    expect(budget.beginRound()).toBe(false);
    expect(budget.snapshot()).toMatchObject({ phase: "stopped", stopReason: "resource-limit", rounds: 2, requests: 1, toolCalls: 2, candidates: 1, analyses: 1 });
  });

  it("does not spend active time while paused or waiting for the user", () => {
    const time = clock();
    const budget = createExplorationBudget({ mode: "normal", now: time.now });
    time.advance(1_000);
    budget.pause();
    time.advance(60_000);
    expect(budget.snapshot()).toMatchObject({ phase: "paused", elapsedMs: 1_000, waitingMs: 60_000 });
    budget.resume();
    time.advance(500);
    budget.waitForUser();
    time.advance(90_000);
    expect(budget.snapshot()).toMatchObject({ phase: "waiting-user", elapsedMs: 1_500, waitingMs: 150_000 });
    budget.resume();
    time.advance(500);
    expect(budget.snapshot().elapsedMs).toBe(2_000);
  });

  it("stops repeated failures and no-progress rounds while retaining next steps", () => {
    const repeated = createExplorationBudget({ mode: "normal", repeatedFailureLimit: 2 });
    expect(repeated.recordOutcome({ failureKey: "singular-system" })).toBe(true);
    expect(repeated.recordOutcome({ failureKey: "singular-system" })).toBe(false);
    expect(repeated.snapshot()).toMatchObject({ phase: "stopped", stopReason: "repeated-failure", nextSteps: expect.arrayContaining([expect.stringContaining("失败证据")]) });

    const noProgress = createExplorationBudget({ mode: "normal", noProgressRoundLimit: 2 });
    expect(noProgress.recordOutcome({ evidenceKey: "same-read" })).toBe(true);
    expect(noProgress.recordOutcome({ evidenceKey: "same-read" })).toBe(true);
    expect(noProgress.recordOutcome({ evidenceKey: "same-read" })).toBe(false);
    expect(noProgress.snapshot()).toMatchObject({ phase: "stopped", stopReason: "no-progress", evidenceCount: 1, nextSteps: expect.arrayContaining([expect.stringContaining("剩余")]) });
  });

  it("requires an explicit extension after exhaustion and preserves counters", () => {
    const time = clock();
    const budget: ExplorationBudget = createExplorationBudget({ mode: "normal", budgetMs: 100, now: time.now });
    time.advance(101);
    expect(budget.canContinue()).toBe(false);
    expect(budget.snapshot().stopReason).toBe("budget-exhausted");
    time.advance(10_000);
    expect(budget.extend(50)).toBe(true);
    expect(budget.snapshot()).toMatchObject({ phase: "running", budgetMs: 150, rounds: 0, elapsedMs: 101, waitingMs: 0 });
    time.advance(20);
    expect(budget.snapshot().elapsedMs).toBe(121);
    budget.stop("cancelled");
    expect(budget.canContinue()).toBe(false);
    expect(budget.snapshot().stopReason).toBe("cancelled");
  });

  it("enforces single-analysis duration and the registered analysis resource", () => {
    const slow = createExplorationBudget({ mode: "normal", maxSingleAnalysisMs: 10 });
    expect(slow.beginAnalysis()).toBe(true);
    expect(slow.finishAnalysis(11)).toBe(false);
    expect(slow.snapshot()).toMatchObject({ stopReason: "resource-limit", analyses: 1, activeAnalyses: 0 });

    const limited = createExplorationBudget({ mode: "normal", maxResourceUnits: 1, maxAnalyses: 2 });
    expect(limited.beginAnalysis()).toBe(true);
    expect(limited.beginAnalysis()).toBe(false);
    expect(limited.snapshot()).toMatchObject({ stopReason: "resource-limit", analyses: 1, activeAnalyses: 1 });
  });
});
