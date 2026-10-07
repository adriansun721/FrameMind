import { decodeAnalysisRun } from "./analysis-service-contract";
import { freezeAnalysisInput, sameInputValue, type AnalysisInputSnapshot, type AnalysisResult } from "./analysis";
import { initialRandomGrid, randomDensities, randomRefinementPassed, randomRefinementRun, randomVariance, refineRandomGrid } from "./random-response-evaluation";
import { validateRandomBasis, type RandomRecord } from "./random-response";

export function decodeRandomResult(value: Record<string, unknown>, input: AnalysisInputSnapshot, decode: (value: unknown) => AnalysisResult): AnalysisResult {
  const fail = (): never => { throw new Error("随机响应结果、冻结来源或收敛记录无效"); };
  if (!input.randomBasis || input.randomBasis.modal?.input.analysisCase?.method !== "modal") fail();
  const modal = decode(input.randomBasis!.modal);
  input = freezeAnalysisInput({ ...input, randomBasis: { ...input.randomBasis!, modal } });
  validateRandomBasis(input);
  const s = input.analysisCase!.settings.random!, r = value.random as RandomRecord;
  if (!r || r.coordinateSystem !== "global XYZ" || r.sidedness !== "one-sided" || r.frequencyUnit !== "Hz" || r.densityUnit !== "m²/Hz" || r.rmsUnit !== "m"
    || !sameInputValue(r.response, s.response) || r.modalAnalysisId !== modal.id || r.modeCount !== modal.modal!.modes.length
    || !Array.isArray(r.points) || r.points.length < 3 || r.points.length > s.maxFrequencyPoints || r.convergence?.status !== "converged"
    || !Array.isArray(r.convergence.runs) || r.convergence.runs.length < 2 || r.convergence.runs.length > s.maxRefinements + 1
    || !Array.isArray(value.nodes) || value.nodes.length || !Array.isArray(value.members) || value.members.length || value.modal || value.buckling || value.secondOrder || value.process || value.discretization) fail();
  const near = (actual: number, expected: number) => Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-8 * Math.max(1e-30, Math.abs(expected));
  let grid = initialRandomGrid(input), previous: { density: number[]; run: RandomRecord["convergence"]["runs"][number] } | undefined;
  let finalDensity: number[] = [];
  for (const [i, recorded] of r.convergence.runs.entries()) {
    if (i) grid = refineRandomGrid(grid);
    if (grid.length > s.maxFrequencyPoints) fail();
    const density = randomDensities(input, grid), check = randomRefinementRun(grid, density, previous);
    if (recorded.points !== grid.length || Object.keys(recorded).sort().join() !== Object.keys(check.run).sort().join()
      || Object.keys(check.run).some((key) => !near(recorded[key as keyof typeof recorded]!, check.run[key as keyof typeof check.run]!))) fail();
    const passed = previous && randomRefinementPassed(s, check, previous.run);
    if (i === r.convergence.runs.length - 1 ? !passed : passed) fail();
    previous = { density, run: check.run }; finalDensity = density;
  }
  if (r.points.length !== grid.length || r.points.some((p, i) => !p || !near(p.frequencyHz, grid[i]) || !near(p.density, finalDensity[i]))
    || !near(r.variance, previous!.run.variance) || !near(r.rms, previous!.run.rms)) fail();
  const complete = r.modeCount === modal.modal!.counts.equations, lower = complete ? r.modeCount : r.modeCount - s.modeIncrement;
  const reduced = randomDensities(input, grid, lower), reducedRms = Math.sqrt(randomVariance(grid, reduced));
  let difference = 0, peak = 0;
  for (let i = 0; i < grid.length; i++) { difference = Math.max(difference, Math.abs(finalDensity[i] - reduced[i])); peak = Math.max(peak, finalDensity[i], reduced[i]); }
  const rmsDifference = Math.abs(r.rms - reducedRms), rmsScale = Math.max(r.rms, reducedRms);
  const expected = { status: complete ? "complete-basis" : "converged", lowerModeCount: lower, upperModeCount: r.modeCount,
    curveError: difference / Math.max(1e-30, peak), rmsError: rmsDifference / Math.max(1e-30, rmsScale) };
  const c = r.convergence.modal;
  if (!c || c.status !== expected.status || c.lowerModeCount !== lower || c.upperModeCount !== r.modeCount
    || !near(c.curveError, expected.curveError) || !near(c.rmsError, expected.rmsError)
    || difference > s.absolutePsdTolerance + s.relativeTolerance * peak || rmsDifference > s.absoluteRmsTolerance + s.relativeTolerance * rmsScale) fail();
  const service = decodeAnalysisRun(value.service, input, value.id as string);
  if (!service) fail();
  return { id: value.id as string, projectId: input.projectId, projectRevision: input.projectRevision, createdAt: value.createdAt as string, status: "complete", input,
    nodes: [], members: [], random: structuredClone(r), service };
}
