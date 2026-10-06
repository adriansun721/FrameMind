import { buildCombinationInput, getFrozenMemberCoefficients, getMemberAnalysisRecord, NATIVE_BUCKLING_SOLVER, sameInputValue, type AnalysisInputSnapshot, type AnalysisResult, type CombinationCaseInput } from "./analysis";
import { createMeshPlan, meshCalculationInput } from "./analysis-mesh";
import { requireProcessCorrespondence } from "./report-appendix";
import { validateBucklingMatrixCorrespondence } from "./buckling-matrices";
import { decodeAnalysisRun } from "./analysis-service-contract";
import { eigenShapeDisplayResult, type ModalRecord, type ModalShape } from "./modal";
import { validateModalShapeMapping } from "./modal-shape";
import { validateLoadCombination, type FrameProject, type LoadCombinationTerm } from "./project";

export interface BucklingSettings {
  fixed: LoadCombinationTerm[]; reference: LoadCombinationTerm[];
  modeCount: number; maxDivisions: number; maxEquations: number; factorTolerance: number;
}
export const DEFAULT_BUCKLING_SETTINGS: Readonly<BucklingSettings> = Object.freeze({ fixed: [], reference: [{ loadCaseId: "LC1", factor: 1 }], modeCount: 3, maxDivisions: 16, maxEquations: 600, factorTolerance: .002 });
export type BucklingLoadPattern = Pick<AnalysisInputSnapshot, "loadCase" | "nodalLoads" | "uniformLoads" | "selfWeight" | "combination">;
export function validateBucklingSettings(project: Pick<FrameProject, "loadCases">, value: unknown): BucklingSettings {
  const s = value as BucklingSettings;
  if (!s || Object.keys(s).sort().join() !== Object.keys(DEFAULT_BUCKLING_SETTINGS).sort().join()
    || !Number.isSafeInteger(s.modeCount) || s.modeCount < 1 || s.modeCount > 20
    || ![1, 2, 4, 8, 16].includes(s.maxDivisions) || !Number.isSafeInteger(s.maxEquations) || s.maxEquations < 1 || s.maxEquations > 1200
    || !Number.isFinite(s.factorTolerance) || s.factorTolerance <= 0 || s.factorTolerance > .01
    || !Array.isArray(s.fixed) || !Array.isArray(s.reference)) throw new Error("屈曲求解设置无效");
  const terms = (items: LoadCombinationTerm[], allowZero: boolean) => {
    if (allowZero && !items.length) return [];
    return validateLoadCombination(project, { id: "CB1", name: "屈曲荷载", terms: items }).terms;
  };
  const fixed = terms(s.fixed, true), reference = terms(s.reference, false);
  if (!reference.some((t) => t.factor !== 0)) throw new Error("屈曲参考荷载系数不能全部为零");
  return { ...s, fixed, reference };
}
export function bucklingPattern(base: AnalysisInputSnapshot, terms: LoadCombinationTerm[], cases: CombinationCaseInput[]): BucklingLoadPattern | null {
  if (!terms.length) return null;
  const built = buildCombinationInput(base, { id: "CB1", name: "屈曲荷载输入", terms }, cases);
  return { loadCase: built.loadCase, nodalLoads: built.nodalLoads, uniformLoads: built.uniformLoads, selfWeight: built.selfWeight, combination: built.combination };
}
export function createBucklingMesh(input: AnalysisInputSnapshot) {
  const s = input.analysisCase!.settings.buckling!;
  return createMeshPlan(input, { maxDivisions: s.maxDivisions, maxEquations: s.maxEquations, relativeTolerance: 1e-6, displacementTolerance: 1e-12, forceTolerance: 1e-8 });
}
export interface BucklingMode extends Pick<ModalShape, "number" | "nodes" | "members" | "residual"> { factor: number }
export interface BucklingRecord {
  equation: "(K+Gfixed+lambda*Greference)phi=0";
  geometricStiffness: "axial-force-hermite-dead-load";
  normalization: "unit-euclidean-calculation-vector";
  modes: BucklingMode[]; selectedDivisions: number;
  preloadRuns: { fixed: AnalysisResult; reference: AnalysisResult };
  prestress: Array<{ elementId: string; memberId: string; start: number; end: number; fixedAxialStartKN: number; fixedAxialEndKN: number; referenceAxialStartKN: number; referenceAxialEndKN: number }>;
  convergence: { status: "converged" | "budget-exhausted"; reason: "factor-tolerance" | "max-divisions" | "equation-budget"; runs: Array<{ divisions: number; equations: number; factors: number[]; error?: number }> };
  counts: ModalRecord["counts"];
  eigenproblem: Omit<ModalRecord["eigenproblem"], "mass"> & { fixedGeometric: number[][] | null; referenceGeometric: number[][] | null };
}
export const BUCKLING_MEANING = "λ 只放大参考荷载，固定预荷载保持不变；形态幅值仅为显示缩放，不是真实位移。线性特征值屈曲不能给出极限承载力、统一安全系数或规范合格结论，因子不接受静力式叠加。";
export function bucklingDisplayResult(result: AnalysisResult, number: number): AnalysisResult {
  const mode = result.buckling!.modes.find((m) => m.number === number) ?? result.buckling!.modes[0];
  return eigenShapeDisplayResult(result, mode);
}
export function validateBucklingInput(input: AnalysisInputSnapshot): void {
  const loads = input.bucklingLoads;
  if (!loads || !loads.reference || input.nodalLoads.length || input.uniformLoads?.length || input.selfWeight?.enabled || input.combination) throw new Error("屈曲固定／参考冻结荷载无效");
  const cases = [...loads.fixed?.combination?.cases ?? [], ...loads.reference.combination?.cases ?? []];
  const settings = validateBucklingSettings({ loadCases: cases.map((c) => c.loadCase) }, input.analysisCase!.settings.buckling);
  for (const role of ["fixed", "reference"] as const) {
    const pattern = loads[role];
    if (!sameInputValue(pattern, bucklingPattern({ ...input, analysisCase: undefined, bucklingLoads: undefined }, settings[role], pattern?.combination?.cases ?? []))) throw new Error("屈曲冻结有效荷载与来源系数不一致");
  }
}
export function decodeBucklingResult(value: Record<string, unknown>, input: AnalysisInputSnapshot, decode: (value: unknown) => AnalysisResult): AnalysisResult {
  const fail = () => { throw new Error("屈曲结果、预应力或冻结形态映射无效"); };
  validateBucklingInput(input);
  const b = value.buckling as BucklingRecord, s = input.analysisCase!.settings.buckling!;
  if (input.analysisCase?.method !== "buckling" || !sameInputValue(input.solver, NATIVE_BUCKLING_SOLVER) || !sameInputValue(input.meshPlan, createBucklingMesh(input))
    || !b || b.equation !== "(K+Gfixed+lambda*Greference)phi=0" || b.geometricStiffness !== "axial-force-hermite-dead-load" || b.normalization !== "unit-euclidean-calculation-vector"
    || !Array.isArray(b.modes) || !b.modes.length || b.modes.length > s.modeCount || value.modal || value.process || value.discretization || !Array.isArray(value.nodes) || value.nodes.length || !Array.isArray(value.members) || value.members.length) fail();
  const level = input.meshPlan!.levels.find((l) => l.divisions === b.selectedDivisions);
  const c = b.counts, p = b.eigenproblem;
  if (!level || !c || c.engineeringNodes !== input.nodes.length || c.engineeringMembers !== input.members.length || c.calculationNodes !== input.nodes.length + level.nodes.length || c.calculationElements !== level.elements.length
    || !Number.isSafeInteger(c.equations) || c.equations < 1 || c.equations > s.maxEquations || !Number.isSafeInteger(c.releaseCoordinates) || c.releaseCoordinates < 0
    || !p || p.matrixLimit !== 144 || !Array.isArray(p.coordinates) || p.coordinates.length !== c.equations || !Array.isArray(p.vectors) || p.vectors.length !== b.modes.length) fail();
  const finite3 = (v: { x: number; y: number; z: number }) => v && [v.x, v.y, v.z].every(Number.isFinite);
  for (const [i, m] of b.modes.entries()) {
    if (m.number !== i + 1 || !Number.isFinite(m.factor) || m.factor <= 0 || i > 0 && m.factor < b.modes[i - 1].factor || !Number.isFinite(m.residual) || m.residual < 0 || m.residual > 1e-8
      || !Array.isArray(m.nodes) || m.nodes.length !== input.nodes.length || m.nodes.some((n, j) => n.nodeId !== input.nodes[j].id || !finite3(n.translation) || !finite3(n.rotation))
      || !Array.isArray(m.members) || m.members.length !== input.members.length || m.members.some((member, j) => member.memberId !== input.members[j].id || !Array.isArray(member.samples) || member.samples.length !== 17 || member.samples.some((sample, k) => !finite3(sample.translation) || Math.abs(sample.position - input.meshPlan!.frames[member.memberId].length * k / 16) > 1e-9))) fail();
    const vector = p.vectors[i];
    if (!Array.isArray(vector) || vector.length !== c.equations || vector.some((x) => !Number.isFinite(x)) || Math.abs(Math.hypot(...vector) - 1) > 1e-9) fail();
  }
  if (p.coordinates.filter((v) => v.kind === "release").length !== c.releaseCoordinates) fail();
  validateModalShapeMapping(input, level!, p, b.modes);
  if (!Array.isArray(b.prestress) || b.prestress.length !== level!.elements.length || b.prestress.some((v, i) => {
    const e = level!.elements[i]; return v.elementId !== e.elementId || v.memberId !== e.memberId || v.start !== e.start || v.end !== e.end || ![v.fixedAxialStartKN, v.fixedAxialEndKN, v.referenceAxialStartKN, v.referenceAxialEndKN].every(Number.isFinite);
  })) fail();
  if (!b.preloadRuns) fail();
  for (const role of ["fixed", "reference"] as const) {
    const { analysisCase: _case, bucklingLoads: _loads, ...base } = input;
    const expected = meshCalculationInput({ ...base, ...input.bucklingLoads![role] }, level!);
    const run = decode(b.preloadRuns[role]);
    if (!sameInputValue(run.input, expected) || run.id !== value.id || run.service?.requestId !== (value.service as AnalysisResult["service"])?.requestId || !sameInputValue(run.service?.origin, (value.service as AnalysisResult["service"])?.origin)) fail();
    requireProcessCorrespondence(run);
    const unbalanced = Array.from({ length: run.input.nodes.length * 6 }, (_, i) => -run.process!.loadVector[i]);
    for (const [i, member] of run.members.entries()) {
      const coefficients = getFrozenMemberCoefficients(run.input, member.memberId), local = getMemberAnalysisRecord(run, member.memberId).localDisplacement;
      const ends = coefficients.originalLocalStiffness.map((row, r) => row.reduce((sum, x, j) => sum + x * local[j], 0) - coefficients.originalEquivalentLocalForces[r]);
      const captured = [...member.localEndForces.start, ...member.localEndForces.end];
      if (captured.some((x, j) => Math.abs(x - ends[j]) > 1e-8 + Math.abs(ends[j]) * 1e-9)) fail();
      const record = b.prestress[i], start = role === "fixed" ? record.fixedAxialStartKN : record.referenceAxialStartKN, end = role === "fixed" ? record.fixedAxialEndKN : record.referenceAxialEndKN;
      if (Math.abs(start + ends[0]) > 1e-8 + Math.abs(start) * 1e-9 || Math.abs(end - ends[6]) > 1e-8 + Math.abs(end) * 1e-9) fail();
      const contribution = run.process!.members[i], nodal = contribution.globalDofIndices.map((index) => {
        const n = run.nodes[Math.floor(index / 6)]; return [...Object.values(n.displacement), ...Object.values(n.rotation)][index % 6];
      });
      for (let row = 0; row < 12; row++) unbalanced[contribution.globalDofIndices[row]] += contribution.globalStiffness[row].reduce((sum, x, j) => sum + x * nodal[j], 0);
    }
    const forceScale = Math.max(1, ...run.process!.loadVector.map(Math.abs));
    if (run.process!.freeDofs.some((i) => !Number.isFinite(unbalanced[i]) || Math.abs(unbalanced[i]) > 1e-7 * forceScale)) fail();
  }
  const matrices = [p.stiffness, p.fixedGeometric, p.referenceGeometric];
  for (const matrix of matrices) {
    if (c.equations > 144) { if (matrix !== null) fail(); continue; }
    if (!Array.isArray(matrix) || matrix.length !== c.equations || matrix.some((row) => !Array.isArray(row) || row.length !== c.equations || row.some((x) => !Number.isFinite(x)))) fail();
    for (let i = 0; i < c.equations; i++) for (let j = 0; j < i; j++) if (Math.abs(matrix![i][j] - matrix![j][i]) > 1e-9 * Math.max(1, Math.abs(matrix![i][j]))) fail();
  }
  validateBucklingMatrixCorrespondence(input, b);
  if (p.stiffness && p.fixedGeometric && p.referenceGeometric) for (const [i, vector] of p.vectors.entries()) {
    const product = (matrix: number[][]) => matrix.map((row) => row.reduce((sum, x, j) => sum + x * vector[j], 0));
    const kv = product(p.stiffness), fv = product(p.fixedGeometric), rv = product(p.referenceGeometric), factor = b.modes[i].factor;
    const denominator = Math.hypot(...p.stiffness.flat()) + Math.hypot(...p.fixedGeometric.flat()) + factor * Math.hypot(...p.referenceGeometric.flat());
    const residual = Math.hypot(...kv.map((x, j) => x + fv[j] + factor * rv[j])) / Math.max(1e-30, denominator);
    if (!Number.isFinite(denominator) || [kv, fv, rv].some((v) => v.some((x) => !Number.isFinite(x)))) fail();
    const av = kv.map((x, j) => x + fv[j]), energy = vector.reduce((sum, x, j) => sum + x * av[j], 0);
    if (!Number.isFinite(energy) || energy <= 0) fail();
    for (let other = 0; other < i; other++) {
      const v = p.vectors[other];
      const bv = p.stiffness.map((row, r) => row.reduce((sum, x, j) => sum + (x + p.fixedGeometric![r][j]) * v[j], 0));
      const otherEnergy = v.reduce((sum, x, j) => sum + x * bv[j], 0), inner = v.reduce((sum, x, j) => sum + x * av[j], 0);
      if (!Number.isFinite(otherEnergy) || otherEnergy <= 0 || !Number.isFinite(inner) || Math.abs(inner) / Math.sqrt(energy) / Math.sqrt(otherEnergy) > 1e-8) fail();
    }
    if (!Number.isFinite(residual) || residual > 1e-8) fail();
  }
  const basis: number[][] = [];
  for (const vector of p.vectors) {
    const independent = [...vector];
    for (const v of basis) { const projection = v.reduce((sum, x, j) => sum + x * independent[j], 0); independent.forEach((x, j) => { independent[j] = x - projection * v[j]; }); }
    const norm = Math.hypot(...independent); if (!Number.isFinite(norm) || norm < 1e-12) fail();
    basis.push(independent.map((x) => x / norm));
  }
  const convergence = b.convergence;
  if (!convergence || convergence.status !== "converged" || !Array.isArray(convergence.runs) || !convergence.runs.length) fail();
  for (const [i, run] of convergence.runs.entries()) {
    if (![1, 2].includes(convergence.runs[0].divisions) || run.divisions !== convergence.runs[0].divisions * 2 ** i || run.divisions > b.selectedDivisions || !Number.isSafeInteger(run.equations) || run.equations < 1 || run.equations > s.maxEquations || !Array.isArray(run.factors) || !run.factors.length || run.factors.length > s.modeCount || run.factors.some((f, j) => !Number.isFinite(f) || f <= 0 || j > 0 && f < run.factors[j - 1])) fail();
    const previous = convergence.runs[i - 1];
    const error = previous && previous.factors.length === s.modeCount && run.factors.length === s.modeCount ? Math.max(...run.factors.map((f, j) => Math.abs(f - previous.factors[j]) / Math.max(f, previous.factors[j]))) : undefined;
    if (error === undefined ? run.error !== undefined : !Number.isFinite(run.error) || Math.abs(run.error! - error) > 1e-10) fail();
  }
  const last = convergence.runs.at(-1)!;
  if (last.divisions !== b.selectedDivisions || last.equations !== c.equations || !sameInputValue(last.factors, b.modes.map((m) => m.factor))) fail();
  if (convergence.status === "converged") { if (convergence.reason !== "factor-tolerance" || last.error === undefined || last.error > s.factorTolerance || b.modes.length !== s.modeCount) fail(); }
  else if (convergence.status !== "budget-exhausted" || !["max-divisions", "equation-budget"].includes(convergence.reason) || convergence.reason === "max-divisions" && b.selectedDivisions !== s.maxDivisions) fail();
  const estimate = (divisions: number) => {
    const candidate = input.meshPlan!.levels.find((l) => l.divisions === divisions);
    if (!candidate) return undefined;
    const restraints = new Set(input.supports.flatMap((support) => support.restraints.flatMap((r, i) => r ? [`${support.nodeId}:${i}`] : []))).size;
    const releases = input.members.reduce((sum, m) => sum + [m.endReleases?.start.my, m.endReleases?.start.mz, m.endReleases?.end.my, m.endReleases?.end.mz].filter(Boolean).length, 0);
    return (input.nodes.length + candidate.nodes.length) * 6 - restraints + releases;
  };
  if (convergence.runs[0].divisions === 2 && estimate(1) !== 0 || convergence.reason === "equation-budget" && !(estimate(b.selectedDivisions * 2)! > s.maxEquations)
    || convergence.runs.slice(0, -1).some((r) => r.error !== undefined && r.error <= s.factorTolerance)) fail();
  const service = decodeAnalysisRun(value.service, input, value.id as string); if (!service) fail();
  return { id: value.id as string, projectId: input.projectId, projectRevision: input.projectRevision, createdAt: value.createdAt as string, status: "complete", input, nodes: [], members: [], buckling: structuredClone(b), service };
}
