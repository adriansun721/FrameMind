import { expect, it } from "vitest";
import references from "./t31-references.json";
import { runInvalidBenchmarks, runNumericalBenchmark } from "./numerical-benchmarks";

it("T31 reproduces the independent axial reference through the public analysis entry", () => {
  const report = runNumericalBenchmark(references.cases[0]);
  expect(report.passed).toBe(true);
  expect(report.checks.filter((check) => !check.passed)).toEqual([]);
  expect(report.checks.find((check) => check.quantity === "node_0002.displacement.x")).toMatchObject({ reference: 0.000016, unit: "m" });
});

it.each(references.cases.slice(1))("T31 matches every registered component and balance: $id", (benchmark) => {
  const report=runNumericalBenchmark(benchmark);
  expect(report.checks.filter(check => !check.passed)).toEqual([]);
  expect(report.passed).toBe(true);
});

it("T31 rejects and locates invalid inputs and instability through the public solver", () => {
  const reports=runInvalidBenchmarks();
  expect(reports).toHaveLength(7);
  expect(reports.filter(report => !report.passed)).toEqual([]);
});
