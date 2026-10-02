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

it("T31 isolates a disconnected component without introducing an identity defect", () => {
  const report=runInvalidBenchmarks().find(item => item.id === "disconnected-unrestrained")!;
  expect("diagnostics" in report.actual ? report.actual.diagnostics?.map(d => d.code) : []).toEqual(["unrestrained-component"]);
});

it("T31 converts textbook rotation and moment signs together before comparing printed values", () => {
  const benchmark=references.cases.find(item => item.id === "textbook-2-1-condensed")!;
  const node=runNumericalBenchmark(benchmark).actual.nodes[1];
  expect(node.displacement.x*100).toBeCloseTo(0.00599,5);
  expect(node.displacement.y*100).toBeCloseTo(-0.0130,4);
  expect(-node.rotation.z).toBeCloseTo(-0.000409,6);
});
