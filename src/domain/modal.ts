import { createMeshPlan } from "./analysis-mesh";
import { calculateMemberGeometry } from "./member-geometry";
import { NATIVE_MODAL_SOLVER, sameInputValue, type AnalysisInputSnapshot, type AnalysisResult } from "./analysis";
import { decodeAnalysisRun } from "./analysis-service-contract";
import { validateModalShapeMapping } from "./modal-shape";

export interface ModalSettings { modeCount: number; maxDivisions: number; maxEquations: number; frequencyTolerance: number }
export const DEFAULT_MODAL_SETTINGS: Readonly<ModalSettings> = Object.freeze({ modeCount: 6, maxDivisions: 16, maxEquations: 600, frequencyTolerance: 2e-3 });
export function validateModalSettings(value: unknown): ModalSettings {
  const p = value as ModalSettings;
  if (!p || Object.keys(p).sort().join() !== Object.keys(DEFAULT_MODAL_SETTINGS).sort().join()
    || !Number.isSafeInteger(p.modeCount) || p.modeCount < 1 || p.modeCount > 50
    || ![1, 2, 4, 8, 16].includes(p.maxDivisions)
    || !Number.isSafeInteger(p.maxEquations) || p.maxEquations < 1 || p.maxEquations > 1200
    || !Number.isFinite(p.frequencyTolerance) || p.frequencyTolerance <= 0 || p.frequencyTolerance > 0.01) throw new Error("模态提取参数无效");
  return { ...p };
}
export function createModalMesh(input: AnalysisInputSnapshot) {
  const settings = validateModalSettings(input.analysisCase?.settings.modal);
  return createMeshPlan(input, { maxDivisions: settings.maxDivisions, maxEquations: settings.maxEquations, relativeTolerance: 1e-6, displacementTolerance: 1e-12, forceTolerance: 1e-8 });
}
export interface ModalShape {
  number: number; eigenvalue: number; frequencyHz: number; kind: "elastic" | "zero-energy";
  residual: number; massNorm: number;
  nodes: Array<{ nodeId: string; translation: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } }>;
  members: Array<{ memberId: string; samples: Array<{ position: number; translation: { x: number; y: number; z: number } }> }>;
}
export interface ModalRecord {
  massModel: "consistent-eb-with-torsional-inertia"; normalization: "unit-generalized-mass"; massUnit: "kN·s²/m";
  totalMassKg: number;
  sources: Array<{ memberId: string; materialId: string; sectionId: string; densityKgM3: number; lengthM: number; massKg: number }>;
  modes: ModalShape[]; orthogonalityError: number; selectedDivisions: number;
  convergence: { status: "converged" | "budget-exhausted"; reason: "frequency-tolerance" | "max-divisions" | "equation-budget"; runs: Array<{ divisions: number; equations: number; frequenciesHz: number[]; error?: number }> };
  counts: { engineeringNodes: number; engineeringMembers: number; calculationNodes: number; calculationElements: number; equations: number; releaseCoordinates: number };
  zeroEnergyModes: number;
  zeroEigenvalueTolerance: number;
  eigenproblem: { matrixLimit: 144; coordinates: Array<{ kind: "node" | "release"; id: string; dof: string }>; vectors: number[][]; stiffness: number[][] | null; mass: number[][] | null };
}

/** Modal shapes never occupy static displacement/force slots in a persisted result. */
export function modalDisplayResult(result: AnalysisResult, modeNumber: number): AnalysisResult {
  const mode = result.modal?.modes.find((m) => m.number === modeNumber) ?? result.modal?.modes[0];
  if (!mode) return result;
  const peak = Math.max(1e-30, ...mode.members.flatMap((m) => m.samples.map((s) => Math.hypot(s.translation.x, s.translation.y, s.translation.z))));
  const factor = 0.001 / peak;
  const scale = (v: { x: number; y: number; z: number }) => ({ x: v.x * factor, y: v.y * factor, z: v.z * factor });
  const zero = { x: 0, y: 0, z: 0 };
  return { ...result, nodes: mode.nodes.map((n) => ({ nodeId: n.nodeId, displacement: scale(n.translation), rotation: scale(n.rotation), reaction: zero, reactionMoment: zero })),
    members: mode.members.map((m) => {
      const frame = result.input.meshPlan!.frames[m.memberId];
      return { memberId: m.memberId, length: frame.length, localAxes: { x: frame.localX, y: frame.localY, z: frame.localZ }, localEndForces: { start: [0, 0, 0, 0, 0, 0], end: [0, 0, 0, 0, 0, 0] },
        nativeResponses: m.samples.map((s) => ({ position: s.position, forces: [0, 0, 0, 0, 0, 0], globalDisplacement: scale(s.translation), localDisplacement: zero })) };
    }) };
}

export function decodeModalResult(value: Record<string, unknown>, input: AnalysisInputSnapshot): AnalysisResult {
  const fail = () => { throw new Error("模态结果、质量来源或冻结映射无效"); };
  const modal = value.modal as ModalRecord;
  const settings = validateModalSettings(input.analysisCase?.settings.modal);
  if (input.analysisCase?.method !== "modal" || !sameInputValue(input.solver, NATIVE_MODAL_SOLVER)
    || input.nodalLoads.length || input.uniformLoads?.length || input.selfWeight?.enabled || input.combination
    || !sameInputValue(input.meshPlan, createModalMesh(input)) || !modal || modal.massModel !== "consistent-eb-with-torsional-inertia"
    || modal.normalization !== "unit-generalized-mass" || modal.massUnit !== "kN·s²/m" || !Array.isArray(modal.sources)
    || !Array.isArray(modal.modes) || !modal.modes.length || modal.modes.length > settings.modeCount
    || !Number.isFinite(modal.orthogonalityError) || modal.orthogonalityError < 0 || modal.orthogonalityError > 1e-8) fail();
  const expectedSources = input.members.map((m) => {
    const material = input.materials.find((x) => x.id === m.materialId)!, section = input.sections.find((x) => x.id === m.sectionId)!;
    const lengthM = calculateMemberGeometry(input.nodes.find((n) => n.id === m.startNodeId)!.position, input.nodes.find((n) => n.id === m.endNodeId)!.position, m.rotationDegrees).length;
    return { memberId: m.id, materialId: m.materialId, sectionId: m.sectionId, densityKgM3: material.densityKgM3, lengthM, massKg: material.densityKgM3 * section.areaM2 * lengthM };
  });
  const near = (a: number, b: number) => Number.isFinite(a) && Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(b));
  if (modal.sources.length !== expectedSources.length || modal.sources.some((s, i) => Object.keys(expectedSources[i]).some((key) => {
    const k = key as keyof typeof s, expected = expectedSources[i][k]; return typeof expected === "number" ? !near(s[k] as number, expected) : s[k] !== expected;
  })) || !near(modal.totalMassKg, expectedSources.reduce((sum, s) => sum + s.massKg, 0))) fail();
  const finite3 = (v: { x: number; y: number; z: number }) => v && [v.x, v.y, v.z].every(Number.isFinite);
  for (const [i, m] of modal.modes.entries()) {
    if (m.number !== i + 1 || !Number.isFinite(m.eigenvalue) || m.eigenvalue < 0 || !near(m.frequencyHz, Math.sqrt(m.eigenvalue) / (2 * Math.PI))
      || i > 0 && m.frequencyHz < modal.modes[i - 1].frequencyHz || m.kind !== (m.eigenvalue === 0 ? "zero-energy" : "elastic")
      || !Number.isFinite(m.residual) || m.residual < 0 || m.residual > 1e-8 || !near(m.massNorm, 1)
      || !Array.isArray(m.nodes) || m.nodes.length !== input.nodes.length || !Array.isArray(m.members) || m.members.length !== input.members.length) fail();
    if (m.nodes.some((n, j) => n.nodeId !== input.nodes[j].id || !finite3(n.translation) || !finite3(n.rotation))) fail();
    for (const [j, member] of m.members.entries()) {
      const source = expectedSources[j];
      if (member.memberId !== source.memberId || !Array.isArray(member.samples) || member.samples.length !== 17
        || member.samples.some((s, k) => !near(s.position, source.lengthM * k / 16) || !finite3(s.translation))) fail();
    }
  }
  const level = input.meshPlan!.levels.find((l) => l.divisions === modal.selectedDivisions);
  const c = modal.counts, convergence = modal.convergence;
  if (!level || !c || c.engineeringNodes !== input.nodes.length || c.engineeringMembers !== input.members.length
    || c.calculationNodes !== input.nodes.length + level.nodes.length || c.calculationElements !== level.elements.length
    || !Number.isSafeInteger(c.equations) || c.equations < modal.modes.length || c.equations > settings.maxEquations
    || !Number.isSafeInteger(c.releaseCoordinates) || c.releaseCoordinates < 0 || !Number.isSafeInteger(modal.zeroEnergyModes) || modal.zeroEnergyModes < 0
    || !convergence || !Array.isArray(convergence.runs) || !convergence.runs.length) fail();
  for (const [i, run] of convergence.runs.entries()) {
    if (![1, 2].includes(convergence.runs[0].divisions) || run.divisions !== convergence.runs[0].divisions * 2 ** i || run.divisions > modal.selectedDivisions || !Number.isSafeInteger(run.equations) || run.equations < 1 || run.equations > settings.maxEquations
      || !Array.isArray(run.frequenciesHz) || run.frequenciesHz.length !== Math.min(settings.modeCount, run.equations) || run.frequenciesHz.some((f, j) => !Number.isFinite(f) || f < 0 || j > 0 && f < run.frequenciesHz[j - 1])
      || run.error !== undefined && (!Number.isFinite(run.error) || run.error < 0)) fail();
    const previous = convergence.runs[i - 1];
    if (previous && run.frequenciesHz.length === settings.modeCount && previous.frequenciesHz.length === settings.modeCount) {
      const error = Math.max(...run.frequenciesHz.map((f, j) => Math.abs(f - previous.frequenciesHz[j]) / Math.max(1e-8, f, previous.frequenciesHz[j])));
      if (!near(run.error!, error)) fail();
    } else if (run.error !== undefined) fail();
  }
  const last = convergence.runs.at(-1)!;
  if (last.divisions !== modal.selectedDivisions || last.equations !== c.equations || !sameInputValue(last.frequenciesHz, modal.modes.map((m) => m.frequencyHz))) fail();
  if (convergence.status === "converged") {
    if (convergence.reason !== "frequency-tolerance" || convergence.runs.length < 2 || modal.modes.length !== settings.modeCount || last.error === undefined || last.error > settings.frequencyTolerance) fail();
  } else if (convergence.status !== "budget-exhausted" || !["max-divisions", "equation-budget"].includes(convergence.reason)) fail();
  const estimate = (divisions: number) => {
    const candidate = input.meshPlan!.levels.find((l) => l.divisions === divisions);
    if (!candidate) return undefined;
    const constrained = new Set(input.supports.flatMap((s) => s.restraints.flatMap((r, i) => r ? [`${s.nodeId}:${i}`] : []))).size;
    const releases = input.members.reduce((sum, m) => sum + [m.endReleases?.start.my, m.endReleases?.start.mz, m.endReleases?.end.my, m.endReleases?.end.mz].filter(Boolean).length, 0);
    return (input.nodes.length + candidate.nodes.length) * 6 - constrained + releases;
  };
  if (convergence.runs[0].divisions === 2 && estimate(1) !== 0
    || convergence.reason === "max-divisions" && modal.selectedDivisions !== settings.maxDivisions
    || convergence.reason === "equation-budget" && !(estimate(modal.selectedDivisions * 2)! > settings.maxEquations)) fail();
  if (!Number.isFinite(modal.zeroEigenvalueTolerance) || modal.zeroEigenvalueTolerance <= 0 || modal.zeroEnergyModes > c.equations
    || modal.modes.filter((m) => m.kind === "zero-energy").length !== Math.min(modal.zeroEnergyModes, modal.modes.length)) fail();
  const problem = modal.eigenproblem;
  if (!problem || problem.matrixLimit !== 144 || !Array.isArray(problem.coordinates) || problem.coordinates.length !== c.equations
    || !Array.isArray(problem.vectors) || problem.vectors.length !== modal.modes.length
    || problem.vectors.some((v) => !Array.isArray(v) || v.length !== c.equations || v.some((x) => !Number.isFinite(x)))) fail();
  const nodeIds = new Set([...input.nodes.map((n) => n.id as string), ...level!.nodes.map((n) => n.nodeId)]);
  const elementIds = new Set(level!.elements.map((e) => e.elementId));
  const coordinateIds = new Set<string>();
  for (const coordinate of problem.coordinates) {
    const key = `${coordinate.kind}:${coordinate.id}:${coordinate.dof}`;
    if (coordinateIds.has(key) || !(coordinate.kind === "node" ? nodeIds.has(coordinate.id) && input.dofOrder.includes(coordinate.dof as typeof input.dofOrder[number])
      : coordinate.kind === "release" && elementIds.has(coordinate.id) && ["start.my", "start.mz", "end.my", "end.mz"].includes(coordinate.dof))) fail();
    coordinateIds.add(key);
  }
  if (problem.coordinates.filter((coordinate) => coordinate.kind === "release").length !== c.releaseCoordinates) fail();
  const matrix = (m: number[][] | null) => {
    if (c.equations > 144) { if (m !== null) fail(); return; }
    if (!Array.isArray(m) || m.length !== c.equations || m.some((row) => !Array.isArray(row) || row.length !== c.equations || row.some((x) => !Number.isFinite(x)))) fail();
    for (let i = 0; i < c.equations; i++) for (let j = 0; j < i; j++) if (!near(m![i][j], m![j][i])) fail();
  };
  matrix(problem.stiffness); matrix(problem.mass);
  if (problem.stiffness && problem.mass) {
    const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);
    const product = (m: number[][], v: number[]) => m.map((row) => dot(row, v));
    const norm = (v: number[]) => Math.hypot(...v);
    const kNorm = Math.hypot(...problem.stiffness.flat());
    const massVectors = problem.vectors.map((v) => product(problem.mass!, v));
    for (const [i, v] of problem.vectors.entries()) {
      const lambda = modal.modes[i].eigenvalue, kv = product(problem.stiffness, v), mv = massVectors[i];
      const residual = norm(kv.map((x, j) => x - lambda * mv[j])) / Math.max(1e-30, kNorm * norm(v) + Math.abs(lambda) * norm(mv));
      if (residual > 1e-8 || !near(dot(v, mv), 1)) fail();
      for (let j = 0; j < i; j++) if (Math.abs(dot(v, massVectors[j])) > 1e-8) fail();
    }
  }
  validateModalShapeMapping(input, level!, problem, modal.modes);
  if (!Array.isArray(value.nodes) || value.nodes.length || !Array.isArray(value.members) || value.members.length || value.process || value.discretization) fail();
  const service = decodeAnalysisRun(value.service, input, value.id as string);
  if (!service) fail();
  return { id: value.id as string, projectId: input.projectId, projectRevision: input.projectRevision, createdAt: value.createdAt as string, status: "complete", input, nodes: [], members: [], modal: structuredClone(modal), service };
}
