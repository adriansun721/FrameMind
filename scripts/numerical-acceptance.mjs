/** Acceptance decisions use registered numeric limits, never upstream success flags. */
export function evaluateQuantity(input) {
  const { actual, reference, absoluteTolerance, relativeTolerance, nearZero } = input;
  const finite = [actual, reference, absoluteTolerance, relativeTolerance, nearZero].every(Number.isFinite)
    && absoluteTolerance >= 0 && relativeTolerance >= 0 && nearZero >= 0;
  const absoluteError = finite ? Math.abs(actual - reference) : null;
  const tolerance = finite ? absoluteTolerance + relativeTolerance * Math.abs(reference) : null;
  const valid = finite && Number.isFinite(absoluteError) && Number.isFinite(tolerance);
  return { ...input, actual: Number.isFinite(actual) ? actual : null, reference: Number.isFinite(reference) ? reference : null,
    required: input.required !== false, nearZeroReference: valid && Math.abs(reference) <= nearZero,
    absoluteError, relativeError: valid && Math.abs(reference) > nearZero ? absoluteError / Math.abs(reference) : null,
    tolerance, passed: valid && absoluteError <= tolerance, ...(!valid ? { failure: "nonfinite-or-invalid-measurement" } : {}) };
}

export function summarizeAcceptance(checks) {
  const byUnit = {};
  for (const check of checks) {
    const summary = byUnit[check.unit] ??= { required: 0, informational: 0, failed: 0, maxAbsoluteError: 0, maxRelativeError: null, worstToleranceRatio: 0 };
    if (!check.required) {
      summary.informational++;
      if (check.failure) summary.failed++;
      continue;
    }
    summary.required++;
    if (!check.passed) summary.failed++;
    if (Number.isFinite(check.absoluteError) && check.absoluteError >= summary.maxAbsoluteError) {
      summary.maxAbsoluteError = check.absoluteError; summary.maxAbsoluteQuantity = check.name;
    }
    if (Number.isFinite(check.relativeError) && check.relativeError >= (summary.maxRelativeError ?? 0)) {
      summary.maxRelativeError = check.relativeError; summary.maxRelativeQuantity = check.name;
    }
    if (check.tolerance > 0 && Number.isFinite(check.absoluteError) && check.absoluteError / check.tolerance >= summary.worstToleranceRatio) {
      summary.worstToleranceRatio = check.absoluteError / check.tolerance; summary.worstToleranceQuantity = check.name;
    }
  }
  const failed = checks.filter((c) => (c.required || c.failure) && !c.passed).map((c) => c.name);
  return { passed: checks.some((c) => c.required) && failed.length === 0, checks: checks.length, failed, byUnit };
}

// Labels below belong to registered benchmark scripts, not product result labels.
function quantityUnit(task, name) {
  if (task === "T2-22" || task === "T2-23") {
    if (/legacy-native-rx/.test(name)) return "rad";
    if (/legacy-native-/.test(name)) return "m";
    if (/-(ux|uy|uz)(-|$)|dimension-edit/.test(name)) return "m";
    if (/-rx-/.test(name)) return "rad";
    if (/-moment-/.test(name)) return "kN·m";
    if (/-(force|reaction)-/.test(name)) return "kN";
  }
  if (task === "T2-27" || task === "T2-28") {
    if (/residual|orthogonality|subspace|shape/.test(name)) return "1";
    if (/mass|line:(structural|additional|total)|fixed-node:total/.test(name)) return "kg";
    if (/frequency|density:|rotation-invariance|frame-repeated|continuum:/.test(name)) return "Hz";
  }
  if (task === "T2-30") return /prestress/.test(name) ? "kN" : "1";
  if (task === "T2-31") {
    if (/moment/.test(name)) return "kN·m";
    if (/equilibrium/.test(name)) return "kN";
    return "m";
  }
  throw new Error(`Missing registered unit: ${task}/${name}`);
}

export function collectMeasurements(task, report) {
  const rows = [], add = (name, unit, actual, reference, absoluteTolerance, relativeTolerance, nearZero, required = true) =>
    rows.push(evaluateQuantity({ name: `${task}/${name}`, unit, actual, reference, absoluteTolerance, relativeTolerance, nearZero, required }));
  const checks = task === "T2-14" ? report.cases.flatMap((c) => c.checks ?? []) : report.checks;
  if (!Array.isArray(checks) || checks.length === 0) throw new Error(`${task}: missing checks`);
  for (const [index, check] of checks.entries()) {
    const name = check.name ?? check.quantity ?? check.id ?? `frequency-${index}`;
    if ("actual" in check) {
      const unit = check.unit ?? quantityUnit(task, name), reference = check.reference ?? check.expected;
      if ("tolerance" in check) {
        // Legacy scripts use max(abs,rel*reference). Preserve that EXACT bound.
        const floor = task === "T2-14" ? ["m", "rad"].includes(unit) ? 1e-11 : 1e-9
          : task === "T2-25" || task === "T2-26" ? ["m", "rad"].includes(unit) ? 1e-12 : 1e-8 : 1e-12;
        add(name, unit, check.actual, reference, check.tolerance, 0, floor);
      } else {
        const absolute = check.absolute ?? (/orthogonality/.test(name) ? 1e-8 : undefined);
        add(name, unit, check.actual, reference, absolute, check.relative ?? 0, absolute);
      }
    } else if ("residual" in check) {
      add(name, "1", check.residual, 0, 1e-8, 0, 1e-8);
    } else if ("referenceRms" in check) {
      const relative = check.rmsTolerance ?? check.tolerance;
      add(`${name}/rms`, "m", check.rmsM, check.referenceRms, 0, relative, 1e-12);
      add(`${name}/psd-max-error`, "m²/Hz", check.maxAbsolutePsdError, 0, (check.curveTolerance ?? check.tolerance) * check.referencePeakPsd, 0, 1e-18);
      rows.at(-1).peakNormalizedError = check.curveError;
      rows.at(-1).referencePeakPsd = check.referencePeakPsd;
    } else if ("referenceHz" in check) {
      // T2-29 deliberately includes coarse, budget-exhausted samples.
      add(name, "Hz", check.firstFrequencyHz, check.referenceHz, 0, check.relativeTolerance, 1e-10, check.convergence === "converged");
    }
  }
  return rows;
}
