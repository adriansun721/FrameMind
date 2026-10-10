import type { CandidateInspection } from "./contracts";

export interface ReverseDesignChoice {
  taskId: string; candidateId: string; commit: string; parentCommit: string; inputSha256: string; resultSha256: string;
  massKg: number; sectionGroups: number; sectionKinds: number; checks: CandidateInspection["checks"];
  feasibility: "feasible" | "infeasible" | "blocked";
}
export interface ReverseDesignComparison {
  eligible: ReverseDesignChoice[]; excluded: string[]; selected?: ReverseDesignChoice;
  reason: "no-feasible" | "minimum-mass" | "simpler-within-0.5-percent" | "retain-previous";
}
const simplicity = (a: ReverseDesignChoice, b: ReverseDesignChoice) => a.sectionGroups - b.sectionGroups || a.sectionKinds - b.sectionKinds;
const identity = (a: ReverseDesignChoice, b: ReverseDesignChoice) => a.taskId.localeCompare(b.taskId);
const limits: Record<string, number> = { source: 1, resources: 1, stiffness: 1, "horizontal-displacement": 15, "force-balance": 1e-7, "moment-balance": 1e-7, mass: 1e-9 };
function eligible(choice: ReverseDesignChoice): boolean {
  return choice.feasibility === "feasible" && Number.isFinite(choice.massKg) && choice.massKg > 0
    && Number.isSafeInteger(choice.sectionGroups) && choice.sectionGroups > 0 && Number.isSafeInteger(choice.sectionKinds) && choice.sectionKinds > 0
    && choice.checks.length === 7 && new Set(choice.checks.map((c) => c.name)).size === 7
    && choice.checks.every((c) => c.passed && c.threshold === limits[c.name] && Number.isFinite(c.value) && c.value >= 0 && c.evidenceSha256 === choice.resultSha256 && (["source", "resources", "stiffness"].includes(c.name) ? c.value === 1 : c.value <= c.threshold));
}
/** Input is program inspection, never work claims or AI prose. The optional previous choice must still be feasible. */
export function compareReverseDesignCandidates(choices: ReverseDesignChoice[], previous?: ReverseDesignChoice): ReverseDesignComparison {
  const passed = choices.filter(eligible).sort((a, b) => a.massKg - b.massKg || simplicity(a, b) || identity(a, b));
  const result: ReverseDesignComparison = { eligible: passed, excluded: choices.filter((c) => !eligible(c)).map((c) => c.taskId), reason: "no-feasible" };
  if (!passed.length) {
    if (previous && eligible(previous)) { result.selected = previous; result.reason = "retain-previous"; }
    return result;
  }
  const lightest = passed[0];
  // A simpler scheme may cost strictly less than 0.5% of the lightest feasible mass.
  result.selected = passed.filter((c) => (c.massKg - lightest.massKg) / lightest.massKg < 0.005)
    .sort((a, b) => simplicity(a, b) || a.massKg - b.massKg || identity(a, b))[0];
  result.reason = result.selected.taskId === lightest.taskId ? "minimum-mass" : "simpler-within-0.5-percent";
  if (previous && eligible(previous)) {
    const improvement = (previous.massKg - result.selected.massKg) / previous.massKg;
    if (improvement < 0 || improvement < 0.005 && simplicity(previous, result.selected) <= 0) {
      result.selected = previous; result.reason = "retain-previous";
    }
  }
  return result;
}
