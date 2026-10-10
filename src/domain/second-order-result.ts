import { getFrozenMemberCoefficients, getMemberAnalysisRecord, memberResponsesAt, sameInputValue, type AnalysisInputSnapshot, type AnalysisResult } from "./analysis";
import { decodeSecondOrderService, secondOrderCalculationInput, validateSecondOrderSettings, type SecondOrderRecord } from "./second-order";
import { mapMeshEngineeringResult, meshError } from "./mesh-result";
import { requireProcessCorrespondence } from "./report-appendix";
import { recoverSecondOrderCalculation, secondOrderNear, secondOrderSystem } from "./second-order-process";
import { hermiteSlope } from "./initial-stress";
import { expandNativeResponses, expandNativeVector } from "./native-response-encoding";

export function decodeSecondOrderResult(value: Record<string, unknown>, input: AnalysisInputSnapshot, decode: (value: unknown) => AnalysisResult): AnalysisResult {
  const fail = () => { throw new Error("二阶实际加载／平衡、响应或冻结输入不一致"); };
  const service = decodeSecondOrderService(value, input), s = validateSecondOrderSettings(input.analysisCase?.settings.secondOrder), r = value.secondOrder as SecondOrderRecord;
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) fail();
  if (!r || r.method !== "initial-stress-small-displacement" || r.equation !== "(K+alpha*G[Nlinear])u=alpha*F" || r.status !== "converged" || !Array.isArray(r.runs) || r.runs.length < 2 || r.runs.length > input.meshPlan!.levels.length || value.process !== undefined || value.discretization !== undefined || value.modal !== undefined || value.buckling !== undefined) fail();
  let previous: ReturnType<typeof mapMeshEngineeringResult> | undefined, mapped: typeof previous, converged = false;
  const runs = r.runs.map((run, index) => {
    const level = input.meshPlan!.levels[index], c = run.calculation;
    expandNativeResponses(c?.members);
    if (c?.linearRun && c.linearRun.members) expandNativeResponses(c.linearRun.members);
    if (!c || run.divisions !== level.divisions || converged || !Array.isArray(c.coordinates) || !Array.isArray(c.vector) || !c.vector.length || c.vector.length > s.maxEquations || c.coordinates.length !== c.vector.length || c.vector.some((x) => !Number.isFinite(x))) fail();
    const linear = decode(c.linearRun), expectedInput = secondOrderCalculationInput(input, level.divisions);
    if (linear.secondOrder || linear.discretization || linear.buckling || linear.modal || !secondOrderNear(linear.input, expectedInput) || Object.keys(linear.input).some((k) => !Object.hasOwn(expectedInput, k) && (linear.input as unknown as Record<string, unknown>)[k] !== undefined)
      || linear.id !== value.id || linear.service?.requestId !== service.requestId || !sameInputValue(linear.service?.origin, service.origin)) fail();
    requireProcessCorrespondence(linear);
    const p = linear.process!;
    if (!p) fail();
    const unbalanced = p.loadVector.map((x) => -x);
    for (const [i, member] of linear.members.entries()) {
      const coefficients = getFrozenMemberCoefficients(linear.input, member.memberId), local = getMemberAnalysisRecord(linear, member.memberId).localDisplacement;
      const ends = coefficients.originalLocalStiffness.map((row, j) => row.reduce((sum, x, k) => sum + x * local[k], 0) - coefficients.originalEquivalentLocalForces[j]);
      if (!secondOrderNear([...member.localEndForces.start, ...member.localEndForces.end], ends)) fail();
      const samples = memberResponsesAt(linear, member.memberId, member.nativeResponses!.map((sample) => sample.position)).map(({ analysisId: _analysis, memberId: _member, ...sample }) => sample);
      if (!secondOrderNear(member.nativeResponses, samples)) fail();
      const contribution = p.members[i], nodal = contribution.globalDofIndices.map((j) => { const n = linear.nodes[Math.floor(j / 6)]; return [n.displacement.x, n.displacement.y, n.displacement.z, n.rotation.x, n.rotation.y, n.rotation.z][j % 6]; });
      contribution.globalDofIndices.forEach((j, row) => { unbalanced[j] += contribution.globalStiffness[row].reduce((sum, x, k) => sum + x * nodal[k], 0); });
    }
    const loadScale = Math.max(1, ...p.loadVector.map(Math.abs));
    if (p.freeDofs.some((i) => !Number.isFinite(unbalanced[i]) || Math.abs(unbalanced[i]) > 1e-8 * loadScale)) fail();
    const expectedCoordinates: Array<{ kind: string; id: string; dof: string }> = p.freeDofs.map((i) => ({ kind: "node", id: linear.input.nodes[Math.floor(i / 6)].id, dof: input.dofOrder[i % 6] }));
    expectedCoordinates.push(...linear.input.members.flatMap((m) => (["start", "end"] as const).flatMap((end) => (["my", "mz"] as const).filter((dof) => m.endReleases?.[end][dof]).map((dof) => ({ kind: "release", id: m.id, dof: `${end}.${dof}` })))));
    if (!sameInputValue(c.coordinates, expectedCoordinates) || !sameInputValue(c.releaseNullRotations, p.releaseNullRotations ?? []) || c.matrixLimit !== 144) fail();
    const decoded = { ...c, linearRun: linear }, system = secondOrderSystem(decoded);
    if (!secondOrderNear(c.force, system.force) || system.diagonal.some((x) => !Number.isFinite(x) || x <= 0)) fail();
    system.requireStableTangents();
    if (c.vector.length <= 144) { const [k, g] = system.matrices(); if (!secondOrderNear(c.stiffness, k) || !secondOrderNear(c.geometric, g)) fail(); }
    else if (c.stiffness !== null || c.geometric !== null) fail();
    const validVector = (v: number[]) => Array.isArray(v) && v.length === c.vector.length && v.every(Number.isFinite);
    const scaledNorm = (v: number[], force = false) => Math.hypot(...v.map((x, i) => force ? x / Math.sqrt(system.diagonal[i]) : x * Math.sqrt(system.diagonal[i])));
    const residual = (v: number[], alpha: number) => {
      const rhs = system.force.map((x) => alpha * x), product = system.multiply(v, alpha);
      return scaledNorm(rhs.map((x, i) => x - product[i]), true) / Math.max(1, scaledNorm(rhs, true));
    };
    if (!Array.isArray(c.iterations) || !c.iterations.length || c.iterations.length > s.loadSteps * s.maxIterations) fail();
    let step = 1, iteration = 1, before = c.vector.map(() => 0);
    for (const [i, record] of c.iterations.entries()) {
      record.displacement = expandNativeVector(record.displacement, c.vector.length);
      record.correction = expandNativeVector(record.correction, c.vector.length);
      const alpha = step / s.loadSteps;
      if (record.step !== step || record.factor !== alpha || record.iteration !== iteration || !validVector(record.displacement) || !validVector(record.correction) || !secondOrderNear(record.displacement, before.map((x, j) => x + record.correction[j]))) fail();
      const afterResidual = residual(record.displacement, alpha), beforeResidual = residual(before, alpha), increment = scaledNorm(record.correction) / Math.max(1e-12, scaledNorm(record.displacement));
      const priorInternal = system.multiply(before, alpha), correctionInternal = system.multiply(record.correction, alpha);
      const correctionRhs = system.force.map((x, j) => alpha * x - priorInternal[j]);
      const correctionResidual = scaledNorm(correctionInternal.map((x, j) => x - correctionRhs[j]), true) / Math.max(1, scaledNorm(correctionRhs, true));
      if (!Number.isFinite(correctionResidual) || correctionResidual > s.residualTolerance) fail();
      if (![afterResidual, beforeResidual, increment].every(Number.isFinite) || !secondOrderNear(record.residual, afterResidual) || !secondOrderNear(record.residualBefore, beforeResidual) || !secondOrderNear(record.increment, increment)) fail();
      const done = afterResidual <= s.residualTolerance && increment <= s.incrementTolerance;
      if (!done && iteration >= s.maxIterations || i === c.iterations.length - 1 && (!done || step !== s.loadSteps)) fail();
      if (done) { step++; iteration = 1; } else iteration++;
      before = record.displacement;
    }
    if (step !== s.loadSteps + 1 || !secondOrderNear(c.vector, before) || residual(c.vector, 1) > s.residualTolerance) fail();
    const recovered = recoverSecondOrderCalculation(decoded);
    for (const e of system.elements) {
      const v = recovered.localDisplacements[e.index], l = e.geometry.length;
      const axialMean = (v[6] - v[0]) / l, axialOffset = e.equivalent[0] / l / e.k[0][0];
      if (Math.max(Math.abs(axialMean + axialOffset), Math.abs(axialMean - axialOffset)) > .01) fail();
      const slopeAt = (t: number) => { const slope = hermiteSlope(l, t); return [slope[0] * v[1] + slope[1] * v[5] + slope[2] * v[7] + slope[3] * v[11], slope[0] * v[2] - slope[1] * v[4] + slope[2] * v[8] - slope[3] * v[10]]; };
      const start = slopeAt(0), end = slopeAt(1), control = slopeAt(.5).map((x, j) => 2 * x - (start[j] + end[j]) / 2);
      if ([start, end, control].some((v) => Math.hypot(...v) > .05)) fail();
    }
    if (!secondOrderNear(c.localDisplacements, recovered.localDisplacements) || !secondOrderNear(c.nodes, recovered.nodes) || !secondOrderNear(c.members, recovered.members)) fail();
    mapped = mapMeshEngineeringResult(input, { ...linear, nodes: c.nodes, members: c.members }, level);
    const error = previous ? meshError(previous, mapped, input.meshPlan!.policy) : undefined;
    if (!secondOrderNear(run.error, error)) fail();
    converged = error !== undefined && Object.values(error).every((x) => Number.isFinite(x) && x <= 1);
    previous = mapped;
    return { divisions: run.divisions, calculation: structuredClone(decoded), ...(error ? { error } : {}) };
  });
  if (!converged || r.selectedDivisions !== runs.at(-1)!.divisions || !secondOrderNear(value.nodes, mapped!.nodes) || !secondOrderNear(value.members, mapped!.members)) fail();
  return { id: value.id as string, projectId: input.projectId, projectRevision: input.projectRevision, createdAt: value.createdAt as string, status: "complete", input, ...mapped!, service, secondOrder: { ...r, runs } };
}

export function secondOrderLinearResponse(result: AnalysisResult): Pick<AnalysisResult, "nodes" | "members"> {
  if (!result.secondOrder) throw new Error("需要已收敛二阶结果");
  const r = result.secondOrder, level = result.input.meshPlan!.levels.find((l) => l.divisions === r.selectedDivisions)!, linear = r.runs.at(-1)!.calculation.linearRun;
  return mapMeshEngineeringResult(result.input, linear, level);
}
