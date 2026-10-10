// @vitest-environment node
import { expect, it } from "vitest";
import { compareReverseDesignCandidates, type ReverseDesignChoice } from "./reverse-design-comparison";

function choice(taskId: string, massKg: number, sectionKinds = 2): ReverseDesignChoice {
  return { taskId, candidateId: taskId, commit: "a".repeat(40), parentCommit: "b".repeat(40), inputSha256: "c".repeat(64), resultSha256: "d".repeat(64), massKg, sectionGroups: 2, sectionKinds, feasibility: "feasible",
    checks: Object.entries({ source: 1, resources: 1, stiffness: 1, "horizontal-displacement": 15, "force-balance": 1e-7, "moment-balance": 1e-7, mass: 1e-9 }).map(([name, threshold]) => ({ name, threshold, value: ["source", "resources", "stiffness"].includes(name) ? 1 : 0, passed: true, evidenceSha256: "d".repeat(64) })) };
}
it("excludes lighter candidates with failed, forged or incomplete numeric checks", () => {
  const failed = choice("failed", 10); failed.checks[3] = { ...failed.checks[3], value: 16, passed: false };
  const forged = choice("forged", 20); forged.checks[3] = { ...forged.checks[3], value: 16, passed: true };
  const missing = choice("missing", 30); missing.checks.pop();
  const result = compareReverseDesignCandidates([failed, forged, missing, choice("valid", 1000)]);
  expect(result.eligible.map((c) => c.taskId)).toEqual(["valid"]); expect(result.selected?.taskId).toBe("valid");
});
it("uses fewer section groups then kinds at equal mass regardless of input ordering", () => {
  const fewerGroups = { ...choice("one-group", 1000), sectionGroups: 1 };
  const candidates = [choice("two-kinds", 1000), choice("one-kind", 1000, 1), fewerGroups];
  expect(compareReverseDesignCandidates(candidates).selected?.taskId).toBe("one-group");
  expect(compareReverseDesignCandidates(candidates.reverse()).selected?.taskId).toBe("one-group");
});
it("prefers a simpler scheme below 0.5% and uses the lighter scheme at the boundary", () => {
  expect(compareReverseDesignCandidates([choice("light", 1000), choice("simple", 1004.9, 1)]).selected?.taskId).toBe("simple");
  expect(compareReverseDesignCandidates([choice("light", 1000), choice("simple", 1005, 1)]).selected?.taskId).toBe("light");
});
it("retains the previous simpler feasible scheme for improvements below 0.5%", () => {
  const previous = choice("previous", 1000, 1);
  expect(compareReverseDesignCandidates([choice("new", 995.1)], previous).selected?.taskId).toBe("previous");
  expect(compareReverseDesignCandidates([choice("new", 995)], previous).selected?.taskId).toBe("new");
  const invalid = { ...previous, feasibility: "blocked" as const };
  expect(compareReverseDesignCandidates([choice("new", 995.1)], invalid).selected?.taskId).toBe("new");
});
it("does not produce a merge target for missing or non-finite mass evidence", () => {
  expect(compareReverseDesignCandidates([choice("nan", NaN), choice("infinite", Infinity), choice("zero", 0)]).selected).toBeUndefined();
});
