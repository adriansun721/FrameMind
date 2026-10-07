import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateQuantity, summarizeAcceptance, collectMeasurements } from "./numerical-acceptance.mjs";

test("acceptance recalculates errors instead of trusting a passed flag", () => {
  const check = evaluateQuantity({ name: "tip", unit: "m", actual: .02, reference: .01, absoluteTolerance: 1e-11, relativeTolerance: 1e-8, nearZero: 1e-11, passed: true });
  assert.equal(check.passed, false);
  assert.equal(summarizeAcceptance([check]).passed, false);
});

test("near-zero references use absolute error without dividing by zero", () => {
  const check = evaluateQuantity({ name: "balance", unit: "kN", actual: 1e-10, reference: 0, absoluteTolerance: 1e-9, relativeTolerance: 1e-8, nearZero: 1e-9 });
  assert.equal(check.passed, true);
  assert.equal(check.relativeError, null);
});

test("nonfinite data and empty evidence cannot pass acceptance", () => {
  for (const actual of [NaN, Infinity, null, undefined]) {
    assert.equal(evaluateQuantity({ name: "bad", unit: "m", actual, reference: 1, absoluteTolerance: 1e-9, relativeTolerance: 1e-8, nearZero: 1e-11 }).passed, false);
  }
  assert.equal(summarizeAcceptance([]).passed, false);
});

test("units remain separate and an expected unconverged sample is explicitly informational", () => {
  const checks = [
    evaluateQuantity({ name: "coarse", unit: "Hz", actual: 11, reference: 10, absoluteTolerance: 1e-10, relativeTolerance: .0005, nearZero: 1e-10, required: false }),
    evaluateQuantity({ name: "force", unit: "kN", actual: 10, reference: 10, absoluteTolerance: 1e-9, relativeTolerance: 1e-8, nearZero: 1e-9 }),
  ];
  const report = summarizeAcceptance(checks);
  assert.equal(report.passed, true);
  assert.equal(report.byUnit.Hz.informational, 1);
  assert.equal(report.byUnit.kN.required, 1);
});

test("collection preserves an existing max bound and diagnoses JSON null measurements", () => {
  const checks = collectMeasurements("T2-25", { checks: [
    { name: "release-moment", unit: "kN·m", actual: 10 + 1.5e-8, expected: 10, tolerance: 1e-8, passed: true },
    { name: "bad-result", unit: "m", actual: null, expected: 1, tolerance: 1e-9, passed: true },
  ] });
  assert.equal(checks[0].passed, false);
  assert.equal(checks[0].tolerance, 1e-8);
  assert.equal(checks[1].failure, "nonfinite-or-invalid-measurement");
});

test("even informational budget samples must contain valid finite measurements", () => {
  const checks = collectMeasurements("T2-29", { checks: [
    { firstFrequencyHz: null, referenceHz: 9.05977724, relativeTolerance: .0005, convergence: "budget-exhausted" },
    { firstFrequencyHz: 9.05977724, referenceHz: 9.05977724, relativeTolerance: .0005, convergence: "converged" },
  ] });
  const report = summarizeAcceptance(checks);
  assert.equal(report.passed, false);
  assert.deepEqual(report.failed, ["T2-29/frequency-0"]);
});
