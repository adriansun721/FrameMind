import { NATIVE_SECOND_ORDER_SOLVER, sameInputValue, type AnalysisInputSnapshot, type AnalysisResult } from "./analysis";
import { createMeshPlan, meshCalculationInput, type MeshError } from "./analysis-mesh";
import { decodeAnalysisRun } from "./analysis-service-contract";
import type { ModalRecord } from "./modal";

export interface SecondOrderSettings {
  loadSteps: number; maxIterations: number; residualTolerance: number; incrementTolerance: number;
  maxDivisions: number; maxEquations: number; meshTolerance: number;
}
export const DEFAULT_SECOND_ORDER_SETTINGS: Readonly<SecondOrderSettings> = Object.freeze({ loadSteps: 4, maxIterations: 20, residualTolerance: 1e-8, incrementTolerance: 1e-8, maxDivisions: 16, maxEquations: 600, meshTolerance: .005 });
export const SECOND_ORDER_MEANING = "初应力弹性二阶近似：同条件线性轴力形成几何刚度，覆盖小位移 P-Δ／P-δ；不更新参考轴或轴力再分配，不包含大转动、塑性、随动力及后屈曲。二阶响应禁止线性叠加。";
export function validateSecondOrderSettings(value: unknown): SecondOrderSettings {
  const s = value as SecondOrderSettings;
  if (!s || Object.keys(s).sort().join() !== Object.keys(DEFAULT_SECOND_ORDER_SETTINGS).sort().join()
    || !Number.isSafeInteger(s.loadSteps) || s.loadSteps < 1 || s.loadSteps > 100
    || !Number.isSafeInteger(s.maxIterations) || s.maxIterations < 1 || s.maxIterations > 100
    || !Number.isSafeInteger(s.maxEquations) || s.maxEquations < 1 || s.maxEquations > 2147483647
    || ![1, 2, 4, 8, 16].includes(s.maxDivisions)
    || [s.residualTolerance, s.incrementTolerance].some((x) => !Number.isFinite(x) || x <= 0 || x > 1e-6)
    || !Number.isFinite(s.meshTolerance) || s.meshTolerance <= 0 || s.meshTolerance > .01) throw new Error("二阶加载、迭代、容差或预算设置无效");
  return { ...s };
}
export function createSecondOrderMesh(input: AnalysisInputSnapshot) {
  const s = validateSecondOrderSettings(input.analysisCase?.settings.secondOrder);
  return createMeshPlan(input, { maxDivisions: s.maxDivisions, maxEquations: s.maxEquations, relativeTolerance: s.meshTolerance, displacementTolerance: 1e-9, forceTolerance: 1e-6 });
}
export interface SecondOrderIteration {
  step: number; factor: number; iteration: number; residualBefore: number; residual: number; increment: number;
  displacement: number[]; correction: number[];
}
export interface SecondOrderCalculation {
  coordinates: ModalRecord["eigenproblem"]["coordinates"];
  releaseNullRotations: ModalRecord["eigenproblem"]["releaseNullRotations"];
  vector: number[]; force: number[]; stiffness: number[][] | null; geometric: number[][] | null; matrixLimit: 144;
  localDisplacements: number[][]; iterations: SecondOrderIteration[];
  linearRun: AnalysisResult;
  nodes: AnalysisResult["nodes"]; members: AnalysisResult["members"];
}
export interface SecondOrderRecord {
  method: "initial-stress-small-displacement"; equation: "(K+alpha*G[Nlinear])u=alpha*F"; status: "converged";
  selectedDivisions: number;
  runs: Array<{ divisions: number; calculation: SecondOrderCalculation; error?: MeshError }>;
}

// The result decoder is defined with the process verification helpers below.
export function secondOrderLinearInput(input: AnalysisInputSnapshot) {
  const { analysisCase: _case, meshPlan: _plan, ...base } = input;
  return { ...base, solver: { implementation: "framemind-native/3", algorithm: "sparse-ldlt" as const, constraints: "free-dof-elimination" as const, relativePivotTolerance: 1e-12 } };
}
export function secondOrderBaseMatches(a: AnalysisInputSnapshot, b: AnalysisInputSnapshot): boolean {
  const base = (input: AnalysisInputSnapshot) => { const { projectRevision: _revision, ...conditions } = secondOrderLinearInput(input); return conditions; };
  return sameInputValue(base(a), base(b));
}
export function decodeSecondOrderService(value: Record<string, unknown>, input: AnalysisInputSnapshot) {
  if (!sameInputValue(input.solver, NATIVE_SECOND_ORDER_SOLVER) || !sameInputValue(input.meshPlan, createSecondOrderMesh(input))) throw new Error("二阶冻结求解器或细分映射不一致");
  const service = decodeAnalysisRun(value.service, input, value.id as string);
  if (!service) throw new Error("二阶缺少真实原生运行身份");
  return service;
}
export function secondOrderCalculationInput(input: AnalysisInputSnapshot, divisions: number) {
  const level = input.meshPlan!.levels.find((l) => l.divisions === divisions)!;
  const base = secondOrderLinearInput(input);
  return meshCalculationInput({ ...base, meshPlan: input.meshPlan }, level);
}
