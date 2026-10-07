import { analysisInputDependencies, captureAnalysisInput, getAnalysisResultForSource, isAnalysisResultCurrent, NATIVE_RANDOM_SOLVER, sameInputValue, type AnalysisInputSnapshot, type AnalysisResult } from "./analysis";
import { dampingMatchesResult, validateModalDampingBinding, type ModalDampingBinding } from "./modal-damping";
import { decodePsdSpectrum, type PsdSpectrum } from "./psd";
import type { FrameAnalysisCase, FrameProject, Vector3 } from "./project";

export const RANDOM_RESPONSE_MEANING = "零均值平稳随机响应；RMS 为统计均方根，不是瞬时峰值或确定性位移；输入有效频段外为零";
export interface RandomSettings {
  modalAnalysisId: string; psdSpectrumId: string;
  excitation: { nodeId: string; direction: Vector3; scale: number };
  response: { nodeId: string; component: "x" | "y" | "z" };
  bandHz: [number, number]; frequencyPoints: number; maxFrequencyPoints: number; maxRefinements: number;
  modeIncrement: number; relativeTolerance: number; absolutePsdTolerance: number; absoluteVarianceTolerance: number; absoluteRmsTolerance: number;
  integration: "trapezoidal";
}
export const DEFAULT_RANDOM_ACCURACY = Object.freeze({ frequencyPoints: 65, maxFrequencyPoints: 20001, maxRefinements: 10, modeIncrement: 2,
  relativeTolerance: .005, absolutePsdTolerance: 1e-18, absoluteVarianceTolerance: 1e-18, absoluteRmsTolerance: 1e-12, integration: "trapezoidal" as const });
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error("随机响应设置字段不完整或含不支持的激励关系");
}
export function validateRandomSettings(value: unknown): RandomSettings {
  exact(value, ["modalAnalysisId", "psdSpectrumId", "excitation", "response", "bandHz", ...Object.keys(DEFAULT_RANDOM_ACCURACY)]);
  exact(value.excitation, ["nodeId", "direction", "scale"]); exact(value.excitation.direction, ["x", "y", "z"]); exact(value.response, ["nodeId", "component"]);
  const s = value as unknown as RandomSettings;
  if (typeof s.modalAnalysisId !== "string" || !s.modalAnalysisId.trim() || typeof s.psdSpectrumId !== "string" || !/^PSD[1-9]\d*$/.test(s.psdSpectrumId)
    || ![s.excitation.nodeId, s.response.nodeId].every((id) => typeof id === "string" && id.trim().length > 0 && id.length <= 200)
    || !["x", "y", "z"].includes(s.response.component) || !Number.isFinite(s.excitation.scale)
    || !Object.values(s.excitation.direction).every(Number.isFinite) || Math.abs(Math.hypot(...Object.values(s.excitation.direction)) - 1) > 1e-10
    || !Array.isArray(s.bandHz) || s.bandHz.length !== 2 || !s.bandHz.every(Number.isFinite) || s.bandHz[0] < 0 || s.bandHz[1] <= s.bandHz[0]
    || !Number.isSafeInteger(s.frequencyPoints) || s.frequencyPoints < 3 || s.frequencyPoints > 10001
    || !Number.isSafeInteger(s.maxFrequencyPoints) || s.maxFrequencyPoints < s.frequencyPoints || s.maxFrequencyPoints > 20001
    || !Number.isSafeInteger(s.maxRefinements) || s.maxRefinements < 1 || s.maxRefinements > 12
    || !Number.isSafeInteger(s.modeIncrement) || s.modeIncrement < 1 || s.modeIncrement > 49
    || !Number.isFinite(s.relativeTolerance) || s.relativeTolerance <= 0 || s.relativeTolerance > .01
    || ![s.absolutePsdTolerance, s.absoluteVarianceTolerance, s.absoluteRmsTolerance].every((n) => Number.isFinite(n) && n > 0)
    || s.absolutePsdTolerance > 1e-12 || s.absoluteVarianceTolerance > 1e-12 || s.absoluteRmsTolerance > 1e-6
    || s.integration !== "trapezoidal") throw new Error("随机响应需明确节点、全局单位方向、有限幅值、频段、频点、积分及合法误差/预算");
  return structuredClone(s);
}
export interface RandomBasis { modal: AnalysisResult; damping: ModalDampingBinding; spectrum: PsdSpectrum }
export interface RandomConvergenceRun { points: number; variance: number; rms: number; curveError?: number; varianceError?: number; rmsError?: number }
export interface RandomRecord {
  coordinateSystem: "global XYZ"; sidedness: "one-sided"; frequencyUnit: "Hz"; densityUnit: "m²/Hz"; rmsUnit: "m";
  response: RandomSettings["response"]; modalAnalysisId: string; modeCount: number;
  points: Array<{ frequencyHz: number; density: number }>; variance: number; rms: number;
  convergence: { status: "converged"; runs: RandomConvergenceRun[]; modal: { status: "converged" | "complete-basis"; lowerModeCount: number; upperModeCount: number; curveError: number; rmsError: number } };
}
export function captureRandomInput(project: FrameProject, definition: FrameAnalysisCase): AnalysisInputSnapshot {
  const s = validateRandomSettings(definition.settings.random);
  const modal = project.analysisResults.find((r) => r.id === s.modalAnalysisId);
  const modalCase = project.analysisCases.find((c) => c.id === modal?.input.analysisCase?.id);
  const spectrum = project.psdSpectra.find((p) => p.id === s.psdSpectrumId);
  if (!modal?.modal || !modalCase?.damping || getAnalysisResultForSource(project, modalCase.id)?.id !== modal.id
    || !isAnalysisResultCurrent(project, modal) || !dampingMatchesResult(modalCase.damping, modal)) throw new Error("随机工况须绑定最新有效模态与已核对的阻尼，重算后请重新绑定");
  if (!spectrum) throw new Error("随机输入谱已删除或不存在，请重新绑定");
  const base = captureAnalysisInput({ ...project, activeAnalysisCaseId: undefined, activeLoadCombinationId: undefined }, project.activeLoadCaseId);
  const input = { ...base, analysisCase: definition, solver: { ...NATIVE_RANDOM_SOLVER }, nodalLoads: [], uniformLoads: [], selfWeight: { ...base.selfWeight!, enabled: false },
    randomBasis: structuredClone({ modal, damping: modalCase.damping, spectrum }) };
  validateRandomBasis(input);
  return input;
}
export function validateRandomBasis(input: AnalysisInputSnapshot): RandomBasis {
  const s = validateRandomSettings(input.analysisCase?.settings.random), basis = input.randomBasis;
  if (!basis?.modal?.modal || basis.modal.input.analysisCase?.method !== "modal" || basis.modal.id !== s.modalAnalysisId
    || basis.modal.projectId !== input.projectId || basis.modal.projectRevision > input.projectRevision || !sameInputValue(input.solver, NATIVE_RANDOM_SOLVER)
    || input.analysisCase?.method !== "random" || input.nodalLoads.length || input.uniformLoads?.length || input.selfWeight?.enabled || input.combination || input.meshPlan) throw new Error("随机响应冻结模态/输入来源无效");
  const damping = validateModalDampingBinding(basis.damping), spectrum = decodePsdSpectrum(basis.spectrum);
  if (!dampingMatchesResult(damping, basis.modal) || spectrum.id !== s.psdSpectrumId || spectrum.quantity !== "force") throw new Error("随机响应仅支持一个节点随机力源，需核对力谱与模态阻尼身份");
  const m = basis.modal.modal;
  if (m.convergence.status !== "converged" || m.zeroEnergyModes) throw new Error("模态细分未收敛或包含零能模态，不能计算有效随机响应");
  if (!sameInputValue(s.bandHz, spectrum.band)) throw new Error("响应频段必须完整覆盖并等于输入谱有效频段，不能截去随机能量");
  if (damping.truncation.upperFrequencyHz < s.bandHz[1] || (m.modes.length < m.counts.equations && m.modes.at(-1)!.frequencyHz < s.bandHz[1])) throw new Error("模态频段覆盖不足，请增阶并重新核对阻尼");
  if (m.modes.length < m.counts.equations && m.modes.length <= s.modeIncrement) throw new Error("模态数不足以比较截断误差，请增阶或调整登记步长");
  if (![s.excitation.nodeId, s.response.nodeId].every((id) => input.nodes.some((n) => n.id === id))) throw new Error("随机作用或响应节点已删除");
  const sourceShapes = m.modes.map((mode) => mode.nodes.find((n) => n.nodeId === s.excitation.nodeId)!.translation);
  const freeDirectionNorm = Math.hypot(...(["x", "y", "z"] as const).map((axis, i) => input.supports.some((support) => support.nodeId === s.excitation.nodeId && support.restraints[i]) ? 0 : s.excitation.direction[axis]));
  const projection = Math.max(...sourceShapes.map((v) => Math.abs(v.x * s.excitation.direction.x + v.y * s.excitation.direction.y + v.z * s.excitation.direction.z)));
  const shapeScale = Math.max(...sourceShapes.map((v) => Math.hypot(v.x, v.y, v.z)));
  if (s.excitation.scale !== 0 && freeDirectionNorm > 0 && projection / freeDirectionNorm <= 1e-10 * Math.max(1e-30, shapeScale)) throw new Error("已提取模态未覆盖该节点力方向，不能把零参与误判为收敛，请增阶");
  const equivalent = { ...input, analysisCase: basis.modal.input.analysisCase, solver: basis.modal.input.solver, randomBasis: undefined };
  if (!sameInputValue(analysisInputDependencies(equivalent), analysisInputDependencies(basis.modal.input))) throw new Error("冻结模态与随机工况的结构、质量或边界不一致");
  return { modal: basis.modal, damping, spectrum };
}
