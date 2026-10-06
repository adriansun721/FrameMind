import { NATIVE_MESH_STATIC_SOLVER, memberResponsesAt, getMemberAnalysisRecord, getFrozenMemberCoefficients, sameInputValue, type AnalysisInputSnapshot, type AnalysisResult } from "./analysis";
import { requireProcessCorrespondence } from "./report-appendix";
import { createMeshPlan, meshCalculationInput, type MeshLevel, type MeshPolicy, type MeshError, type MeshRun, type DiscretizationRecord } from "./analysis-mesh";
import { decodeAnalysisRun } from "./analysis-service-contract";

function close(a: unknown, b: unknown, absolute = 1e-12, relative = 1e-9): boolean {
  if (typeof b === "number") return typeof a === "number" && Number.isFinite(a) && Math.abs(a - b) <= absolute + relative * Math.abs(b);
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((item, i) => close(a[i], item, absolute, relative));
  if (b && typeof b === "object") return Boolean(a && typeof a === "object" && Object.keys(b).every((k) => close((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], absolute, relative)));
  return a === b;
}

export function mapMeshEngineeringResult(input: AnalysisInputSnapshot, calculation: AnalysisResult, level: MeshLevel) {
  const nodes = calculation.nodes.slice(0, input.nodes.length);
  const members = input.members.map((member) => {
    const elements = level.elements.filter((e) => e.memberId === member.id);
    const first = calculation.members.find((m) => m.memberId === elements[0].elementId)!;
    const last = calculation.members.find((m) => m.memberId === elements.at(-1)!.elementId)!;
    const length = elements.at(-1)!.end;
    const nativeResponses = Array.from({ length: 17 }, (_, i) => {
      const position = length * i / 16;
      const scaled = i * level.divisions, index = Math.min(elements.length - 1, Math.floor(scaled / 16));
      const sample = calculation.members.find((m) => m.memberId === elements[index].elementId)!.nativeResponses![scaled - index * 16];
      return { ...sample, position };
    });
    return { memberId: member.id as string, length, localAxes: structuredClone(first.localAxes), localEndForces: { start: [...first.localEndForces.start] as typeof first.localEndForces.start, end: [...last.localEndForces.end] as typeof last.localEndForces.end }, nativeResponses };
  });
  return { nodes, members };
}

export function meshError(previous: ReturnType<typeof mapMeshEngineeringResult>, current: ReturnType<typeof mapMeshEngineeringResult>, p: MeshPolicy): MeshError {
  const error = { displacement: 0, reaction: 0, sectionForce: 0 };
  const compare = (a: number, b: number, absolute: number, key: keyof MeshError) => { error[key] = Math.max(error[key], Math.abs(a - b) / (absolute + p.relativeTolerance * Math.max(Math.abs(a), Math.abs(b)))); };
  for (const [i, n] of current.nodes.entries()) {
    for (const key of ["displacement", "rotation", "reaction", "reactionMoment"] as const) for (const axis of ["x", "y", "z"] as const) {
      const displacement = key === "displacement" || key === "rotation";
      compare(previous.nodes[i][key][axis], n[key][axis], displacement ? p.displacementTolerance : p.forceTolerance, displacement ? "displacement" : "reaction");
    }
  }
  for (const [i, m] of current.members.entries()) for (const [station, sample] of m.nativeResponses.entries()) {
    const before = previous.members[i].nativeResponses[station];
    for (const axis of ["x", "y", "z"] as const) compare(before.globalDisplacement[axis], sample.globalDisplacement[axis], p.displacementTolerance, "displacement");
    sample.forces.forEach((f, j) => compare(before.forces[j], f, p.forceTolerance, "sectionForce"));
  }
  return error;
}

/** Decode /3 runs first, then verify their inherited inputs, projections and convergence claims. */
export function decodeMeshResult(value: Record<string, unknown>, input: AnalysisInputSnapshot, decode: (value: unknown) => AnalysisResult): AnalysisResult {
  if (!sameInputValue(input.solver, NATIVE_MESH_STATIC_SOLVER) || !input.meshPlan) throw new Error("细分分析缺少冻结映射");
  const expectedPlan = createMeshPlan(input, input.meshPlan.policy);
  if (input.analysisCase?.settings.mesh && !sameInputValue(input.meshPlan.policy, input.analysisCase.settings.mesh)) throw new Error("冻结细分策略与分析工况设置不一致");
  if (!close(input.meshPlan, expectedPlan, 1e-12, 1e-12)) throw new Error("内部细分映射与工程输入不一致");
  const record = value.discretization as DiscretizationRecord;
  if (!record || !Array.isArray(record.runs) || !record.runs.length || record.runs.length > expectedPlan.levels.length || value.process !== undefined) throw new Error("内部计算过程记录无效");
  let previous: ReturnType<typeof mapMeshEngineeringResult> | undefined, mapped: ReturnType<typeof mapMeshEngineeringResult> | undefined;
  let converged = false;
  const runs: MeshRun[] = record.runs.map((run, i) => {
    const level = expectedPlan.levels[i];
    if (converged || !run || run.divisions !== level.divisions || run.result?.input?.solver?.implementation !== "framemind-native/3" || run.result.discretization || run.result.input.meshPlan) throw new Error("内部加密轮次无效");
    const result = decode(run.result);
    requireProcessCorrespondence(result);
    const expected = meshCalculationInput(input, level);
    if (!close(result.input, expected, 1e-12, 1e-12) || Object.keys(result.input).some((k) => !Object.hasOwn(expected, k) && (result.input as unknown as Record<string, unknown>)[k] !== undefined)
      || result.id !== value.id || result.projectId !== input.projectId || result.projectRevision !== input.projectRevision
      || result.service?.requestId !== (value.service as AnalysisResult["service"])?.requestId
      || !sameInputValue(result.service?.origin, (value.service as AnalysisResult["service"])?.origin)) throw new Error("内部单元继承或来源与冻结输入不一致");
    const process = result.process!;
    for (const member of result.members) {
      const coefficients = getFrozenMemberCoefficients(result.input, member.memberId);
      const u = getMemberAnalysisRecord(result, member.memberId).localDisplacement;
      const ends = coefficients.originalLocalStiffness.map((row, i) => row.reduce((sum, k, j) => sum + k * u[j], 0) - coefficients.originalEquivalentLocalForces[i]);
      if (!close([...member.localEndForces.start, ...member.localEndForces.end], ends, 1e-8, 1e-9)) throw new Error("内部单元端力与冻结系数和位移不一致");
      const samples = memberResponsesAt(result, member.memberId, member.nativeResponses!.map((s) => s.position));
      if (!close(member.nativeResponses, samples.map(({ analysisId: _a, memberId: _m, ...s }) => s), 1e-10, 1e-9)) throw new Error("内部单元采样与冻结系数和位移不一致");
    }
    if (process.dofs.length - process.constrainedDofs.length > expectedPlan.policy.maxEquations) throw new Error("内部方程规模超过冻结预算");
    mapped = mapMeshEngineeringResult(input, result, level);
    let error: MeshError | undefined;
    if (previous) {
      error = meshError(previous, mapped, expectedPlan.policy);
      if (!close(run.error, error, 1e-12, 1e-9)) throw new Error("内部细分误差记录不一致");
      converged = Object.values(error).every((e) => e <= 1);
    } else if (run.error !== undefined) throw new Error("单网格不能声称收敛");
    previous = mapped;
    return { divisions: run.divisions, result, ...(error ? { error: structuredClone(run.error!) } : {}) };
  });
  const last = runs.at(-1)!, process = last.result.process!;
  const counts = { engineeringNodes: input.nodes.length, engineeringMembers: input.members.length, calculationNodes: last.result.nodes.length, calculationElements: last.result.members.length, totalDofs: process.dofs.length, constrainedDofs: process.constrainedDofs.length, releaseGaugeDofs: process.releaseGaugeDofs?.length ?? 0, equations: process.freeDofs.length };
  const next = expectedPlan.levels[runs.length];
  const nextDofs = next ? (input.nodes.length + next.nodes.length) * 6 - process.constrainedDofs.length : undefined;
  const reason = converged ? "tolerance" : !next ? "max-divisions" : nextDofs! > expectedPlan.policy.maxEquations ? "equation-budget" : undefined;
  if (!reason || record.reason !== reason || record.status !== (converged ? "converged" : "budget-exhausted") || record.selectedDivisions !== last.divisions || !sameInputValue(record.counts, counts)) throw new Error("细分收敛状态、预算或实际规模不一致");
  if (!close(value.nodes, mapped!.nodes, 1e-8) || !close(value.members, mapped!.members, 1e-8)) throw new Error("工程对象结果与内部单元映射不一致");
  const id = value.id as string, createdAt = value.createdAt as string;
  if (typeof id !== "string" || !id || value.projectId !== input.projectId || value.projectRevision !== input.projectRevision || value.status !== "complete" || typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))) throw new Error("细分分析身份无效");
  const service = decodeAnalysisRun(value.service, input, id);
  if (!service || !sameInputValue(service.stages, runs[0].result.service!.stages)) throw new Error("细分分析缺少真实阶段");
  return { id, projectId: input.projectId, projectRevision: input.projectRevision, createdAt, status: "complete", input, ...structuredClone(mapped!), service,
    discretization: { status: record.status, reason, selectedDivisions: last.divisions, counts, runs } };
}
