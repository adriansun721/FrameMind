import type { AnalysisInputSnapshot } from "./analysis";
import { randomSources, randomSpectra, type RandomConvergenceRun, type RandomSettings } from "./random-response";
import { randomActionShape } from "./random-spatial-load";

/** Verification of frozen native records; this is never the desktop solver. */
export function randomTransferData(input: AnalysisInputSnapshot) {
  const basis = input.randomBasis!, s = input.analysisCase!.settings.random!;
  return basis.modal.modal!.modes.map((m, modeIndex) => {
    const response = m.nodes.find((n) => n.nodeId === s.response.nodeId)!.translation[s.response.component];
    const coefficients = randomSources(s).map((source) => {
      const generalized = source.actions.reduce((sum, action) => {
      const force = randomActionShape(basis.modal, modeIndex, action);
      const projection = force.x * action.direction.x + force.y * action.direction.y + force.z * action.direction.z;
      const scale = action.kind === "node" ? action.scale : action.scalePerM, contribution = scale * projection;
      if (!Number.isFinite(contribution) || (contribution === 0 && scale !== 0 && projection !== 0)) throw new Error("随机空间作用或响应超出有限数值范围");
        if (!Number.isFinite(sum + contribution)) throw new Error("随机广义力求和溢出");
        return sum + contribution;
      }, 0);
      const coefficient = generalized * response;
      if (coefficient === 0 && generalized !== 0 && response !== 0) throw new Error("随机源模态系数非零下溢");
      return coefficient;
    });
    if (!coefficients.every(Number.isFinite)) throw new Error("随机空间作用或响应超出有限数值范围");
    return { frequency: m.frequencyHz, omega: Math.sqrt(m.eigenvalue), coefficients,
      damping: basis.damping.overrides.find((o) => o.modeNumber === m.number)?.value.ratio ?? basis.damping.uniform.ratio };
  });
}
export function initialRandomGrid(input: AnalysisInputSnapshot): number[] {
  const s = input.analysisCase!.settings.random!, [lo, hi] = s.bandHz;
  const points = randomSpectra(input.randomBasis!).flatMap(({ spectrum }) => spectrum.points.map((p) => p.frequency));
  for (let i = 1; i < s.frequencyPoints - 1; i++) points.push(lo + (hi - lo) * i / (s.frequencyPoints - 1));
  for (const m of randomTransferData(input)) for (const n of [0, -1, 1, -2, 2, -4, 4, -8, 8]) {
    const f = m.frequency + n * m.damping * m.frequency;
    if (f > lo && f < hi) points.push(f);
  }
  return [...new Set(points)].sort((a, b) => a - b);
}
export function refineRandomGrid(grid: number[]): number[] {
  const result = [grid[0]];
  for (let i = 1; i < grid.length; i++) {
    const mid = grid[i - 1] + (grid[i] - grid[i - 1]) / 2;
    if (!(mid > grid[i - 1] && mid < grid[i])) throw new Error("随机频率网格超出浮点分辨率");
    result.push(mid, grid[i]);
  }
  return result;
}
export function randomDensities(input: AnalysisInputSnapshot, grid: number[], count = input.randomBasis!.modal.modal!.modes.length): number[] {
  const modes = randomTransferData(input).slice(0, count), spectra = randomSpectra(input.randomBasis!);
  return grid.map((f) => spectra.reduce((total, { spectrum }, sourceIndex) => {
    let lo = 0, hi = spectrum.points.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (spectrum.points[mid].frequency < f) lo = mid; else hi = mid; }
    const a = spectrum.points[lo], b = spectrum.points[hi], t = (f - a.frequency) / (b.frequency - a.frequency);
    const density = a.density * (1 - t) + b.density * t;
    let real = 0, imaginary = 0;
    const omega = 2 * Math.PI * f;
    for (const m of modes) {
      const re = m.omega ** 2 - omega ** 2, im = 2 * m.damping * m.omega * omega, denominator = re ** 2 + im ** 2;
      if (!(denominator > 0) || !Number.isFinite(denominator)) throw new Error("随机空间作用或响应超出有限数值范围");
      real += m.coefficients[sourceIndex] * re / denominator; imaginary -= m.coefficients[sourceIndex] * im / denominator;
    }
    const result = (real ** 2 + imaginary ** 2) * density;
    if (!Number.isFinite(result) || result < 0 || (result === 0 && density > 0 && (real !== 0 || imaginary !== 0)) || !Number.isFinite(total + result)) throw new Error("随机空间作用或响应超出有限数值范围");
    return total + result;
  }, 0));
}
export function randomVariance(grid: number[], density: number[]): number {
  let sum = 0;
  for (let i = 1; i < grid.length; i++) {
    const height = density[i - 1] / 2 + density[i] / 2, part = height * (grid[i] - grid[i - 1]);
    if (!Number.isFinite(part) || (part === 0 && (density[i - 1] > 0 || density[i] > 0))) throw new Error("随机积分溢出或非零下溢");
    sum += part;
  }
  if (!Number.isFinite(sum)) throw new Error("随机均方值溢出");
  return sum;
}
export function randomRefinementRun(grid: number[], density: number[], previous?: { density: number[]; run: RandomConvergenceRun }) {
  const variance = randomVariance(grid, density), rms = Math.sqrt(variance);
  const run: RandomConvergenceRun = { points: grid.length, variance, rms };
  let curveDifference = 0, varianceDifference = 0, rmsDifference = 0;
  const peak = Math.max(...density);
  if (previous) {
    for (let i = 1; i < density.length; i += 2) curveDifference = Math.max(curveDifference, Math.abs(density[i] - (previous.density[(i - 1) / 2] / 2 + previous.density[(i + 1) / 2] / 2)));
    varianceDifference = Math.abs(variance - previous.run.variance); rmsDifference = Math.abs(rms - previous.run.rms);
    run.curveError = curveDifference / Math.max(1e-30, peak);
    run.varianceError = varianceDifference / Math.max(1e-30, variance, previous.run.variance);
    run.rmsError = rmsDifference / Math.max(1e-30, rms, previous.run.rms);
  }
  return { run, curveDifference, varianceDifference, rmsDifference, peak };
}
export function randomRefinementPassed(s: RandomSettings, check: ReturnType<typeof randomRefinementRun>, previous: RandomConvergenceRun): boolean {
  return check.curveDifference <= s.absolutePsdTolerance + s.relativeTolerance * check.peak
    && check.varianceDifference <= s.absoluteVarianceTolerance + s.relativeTolerance * Math.max(check.run.variance, previous.variance)
    && check.rmsDifference <= s.absoluteRmsTolerance + s.relativeTolerance * Math.max(check.run.rms, previous.rms);
}
