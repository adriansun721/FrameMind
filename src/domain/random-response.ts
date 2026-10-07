import { analysisInputDependencies, captureAnalysisInput, getAnalysisResultForSource, isAnalysisResultCurrent, NATIVE_RANDOM_SOLVER, sameInputValue, type AnalysisInputSnapshot, type AnalysisResult } from "./analysis";
import { dampingMatchesResult, validateModalDampingBinding, type ModalDampingBinding } from "./modal-damping";
import { decodePsdSpectrum, type PsdSpectrum } from "./psd";
import { randomActionShape } from "./random-spatial-load";
import type { FrameAnalysisCase, FrameProject, Vector3 } from "./project";

export const RANDOM_RESPONSE_MEANING = "零均值平稳随机响应；RMS 为统计均方根，不是瞬时峰值或确定性位移；输入有效频段外为零";
export interface LegacyRandomSettings {
  modalAnalysisId: string; psdSpectrumId: string;
  excitation: { nodeId: string; direction: Vector3; scale: number };
  response: { nodeId: string; component: "x" | "y" | "z" };
  bandHz: [number, number]; frequencyPoints: number; maxFrequencyPoints: number; maxRefinements: number;
  modeIncrement: number; relativeTolerance: number; absolutePsdTolerance: number; absoluteVarianceTolerance: number; absoluteRmsTolerance: number;
  integration: "trapezoidal";
}
export type RandomAction = { direction: Vector3 } & (
  { kind: "node"; nodeId: string; scale: number } | { kind: "member-uniform"; memberId: string; scalePerM: number }
  | { kind: "base-translation"; scale: number });
export interface RandomSource { sourceId: string; psdSpectrumId: string; actions: RandomAction[] }
export function randomSourceQuantity(source: RandomSource): "force" | "acceleration" {
  return source.actions.some((a) => a.kind === "base-translation") ? "acceleration" : "force";
}
export function randomResponseFrame(s: RandomSettings): "relative-to-base" | "fixed-global" {
  return randomSources(s).some((source) => randomSourceQuantity(source) === "acceleration") ? "relative-to-base" : "fixed-global";
}
export interface DistributedRandomSettings extends Omit<LegacyRandomSettings, "psdSpectrumId" | "excitation"> {
  sourceRelationship: "independent"; sources: RandomSource[];
}
export type RandomSettings = LegacyRandomSettings | DistributedRandomSettings;
export function randomSources(s: RandomSettings): RandomSource[] {
  return "sources" in s ? s.sources : [{ sourceId: "legacy-node-source", psdSpectrumId: s.psdSpectrumId, actions: [{ kind: "node", ...s.excitation }] }];
}
export const DEFAULT_RANDOM_ACCURACY = Object.freeze({ frequencyPoints: 65, maxFrequencyPoints: 20001, maxRefinements: 10, modeIncrement: 2,
  relativeTolerance: .005, absolutePsdTolerance: 1e-18, absoluteVarianceTolerance: 1e-18, absoluteRmsTolerance: 1e-12, integration: "trapezoidal" as const });
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error("随机响应设置字段不完整或含不支持的激励关系");
}
export function validateRandomSettings(value: unknown): RandomSettings {
  const distributed = Boolean(value && typeof value === "object" && "sources" in value);
  exact(value, ["modalAnalysisId", ...(distributed ? ["sourceRelationship", "sources"] : ["psdSpectrumId", "excitation"]), "response", "bandHz", ...Object.keys(DEFAULT_RANDOM_ACCURACY)]);
  exact(value.response, ["nodeId", "component"]);
  const s = value as unknown as RandomSettings;
  const identity = (id: unknown) => typeof id === "string" && id.trim().length > 0 && id.length <= 200;
  if ("sources" in s) {
    if (s.sourceRelationship !== "independent" || !Array.isArray(s.sources) || !s.sources.length || s.sources.length > 16) throw new Error("随机源须显式声明相互独立，支持 1–16 个源；不支持互谱、部分相关或相位关系");
  } else { exact(s.excitation, ["nodeId", "direction", "scale"]); }
  const sources = randomSources(s), ids = new Set<string>();
  if (sources.reduce((sum, source) => sum + (Array.isArray(source?.actions) ? source.actions.length : 129), 0) > 128) throw new Error("随机作用预算最多 128 项");
  for (const source of sources) {
    exact(source, ["sourceId", "psdSpectrumId", "actions"]);
    if (!identity(source.sourceId) || ids.has(source.sourceId) || typeof source.psdSpectrumId !== "string" || !/^PSD[1-9]\d*$/.test(source.psdSpectrumId)
      || !Array.isArray(source.actions) || !source.actions.length) throw new Error("随机源身份必须唯一，且须明确力谱和空间作用");
    ids.add(source.sourceId);
    if (randomSourceQuantity(source) === "acceleration" && source.actions.some((a) => a.kind !== "base-translation")) throw new Error("同一源不能混用力与加速度过程；基底与外力须声明为独立源");
    for (const action of source.actions) {
      const node = action?.kind === "node", base = action?.kind === "base-translation";
      exact(action, ["kind", "direction", ...(base ? ["scale"] : node ? ["nodeId", "scale"] : ["memberId", "scalePerM"])]);
      exact(action.direction, ["x", "y", "z"]);
      if ((!node && !base && action.kind !== "member-uniform") || (!base && !identity(node ? action.nodeId : (action as Extract<RandomAction, { kind: "member-uniform" }>).memberId))
        || !Number.isFinite(action.kind === "member-uniform" ? action.scalePerM : action.scale) || !Object.values(action.direction).every(Number.isFinite)
        || Math.abs(Math.hypot(...Object.values(action.direction) as number[]) - 1) > 1e-10) throw new Error("随机作用须为节点力、整杆均布力或整体平动基底，使用全局单位方向和有限有符号系数（节点／基底无量纲，杆件 1/m）");
    }
  }
  if (!identity(s.modalAnalysisId) || !identity(s.response.nodeId) || !["x", "y", "z"].includes(s.response.component)
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
export type RandomBasis = { modal: AnalysisResult; damping: ModalDampingBinding } & (
  { spectrum: PsdSpectrum } | { spectra: Array<{ sourceId: string; spectrum: PsdSpectrum }> });
export function randomSpectra(basis: RandomBasis): Array<{ sourceId: string; spectrum: PsdSpectrum }> {
  return "spectra" in basis ? basis.spectra : [{ sourceId: "legacy-node-source", spectrum: basis.spectrum }];
}
export interface RandomConvergenceRun { points: number; variance: number; rms: number; curveError?: number; varianceError?: number; rmsError?: number }
export interface RandomRecord {
  referenceFrame?: "relative-to-base";
  coordinateSystem: "global XYZ"; sidedness: "one-sided"; frequencyUnit: "Hz"; densityUnit: "m²/Hz"; rmsUnit: "m";
  response: RandomSettings["response"]; modalAnalysisId: string; modeCount: number;
  points: Array<{ frequencyHz: number; density: number }>; variance: number; rms: number;
  convergence: { status: "converged"; runs: RandomConvergenceRun[]; modal: { status: "converged" | "complete-basis"; lowerModeCount: number; upperModeCount: number; curveError: number; rmsError: number } };
}
export function captureRandomInput(project: FrameProject, definition: FrameAnalysisCase): AnalysisInputSnapshot {
  const s = validateRandomSettings(definition.settings.random);
  const modal = project.analysisResults.find((r) => r.id === s.modalAnalysisId);
  const modalCase = project.analysisCases.find((c) => c.id === modal?.input.analysisCase?.id);
  const spectra = randomSources(s).map((source) => ({ sourceId: source.sourceId, spectrum: project.psdSpectra.find((p) => p.id === source.psdSpectrumId)! }));
  if (!modal?.modal || !modalCase?.damping || getAnalysisResultForSource(project, modalCase.id)?.id !== modal.id
    || !isAnalysisResultCurrent(project, modal) || !dampingMatchesResult(modalCase.damping, modal)) throw new Error("随机工况须绑定最新有效模态与已核对的阻尼，重算后请重新绑定");
  if (spectra.some((item) => !item.spectrum)) throw new Error("随机输入谱已删除或不存在，请重新绑定");
  const base = captureAnalysisInput({ ...project, activeAnalysisCaseId: undefined, activeLoadCombinationId: undefined }, project.activeLoadCaseId);
  const input = { ...base, analysisCase: definition, solver: { ...NATIVE_RANDOM_SOLVER }, nodalLoads: [], uniformLoads: [], selfWeight: { ...base.selfWeight!, enabled: false },
    randomBasis: structuredClone({ modal, damping: modalCase.damping, ...("sources" in s ? { spectra } : { spectrum: spectra[0].spectrum }) }) };
  validateRandomBasis(input);
  return input;
}
export function validateRandomBasis(input: AnalysisInputSnapshot): RandomBasis {
  const s = validateRandomSettings(input.analysisCase?.settings.random), basis = input.randomBasis;
  if (!basis?.modal?.modal || basis.modal.input.analysisCase?.method !== "modal" || basis.modal.id !== s.modalAnalysisId
    || basis.modal.projectId !== input.projectId || basis.modal.projectRevision > input.projectRevision || !sameInputValue(input.solver, NATIVE_RANDOM_SOLVER)
    || input.analysisCase?.method !== "random" || input.nodalLoads.length || input.uniformLoads?.length || input.selfWeight?.enabled || input.combination || input.meshPlan) throw new Error("随机响应冻结模态/输入来源无效");
  const damping = validateModalDampingBinding(basis.damping), sources = randomSources(s), spectra = randomSpectra(basis);
  exact(basis, ["modal", "damping", ...("sources" in s ? ["spectra"] : ["spectrum"])]);
  if (("sources" in s) !== ("spectra" in basis) || spectra.length !== sources.length || !dampingMatchesResult(damping, basis.modal)) throw new Error("随机源与冻结力谱或模态阻尼身份不一致");
  spectra.forEach((item, i) => {
    exact(item, ["sourceId", "spectrum"]);
    const spectrum = decodePsdSpectrum(item.spectrum);
    if (item.sourceId !== sources[i].sourceId || spectrum.id !== sources[i].psdSpectrumId || spectrum.quantity !== randomSourceQuantity(sources[i])) throw new Error("随机源须绑定对应量纲自谱：外力使用力谱，整体基底使用加速度谱");
    if (!sameInputValue(s.bandHz, spectrum.band)) throw new Error("各独立源须使用相同的完整有效频段，禁止截去随机能量");
  });
  const m = basis.modal.modal;
  if (m.convergence.status !== "converged" || m.zeroEnergyModes) throw new Error("模态细分未收敛或包含零能模态，不能计算有效随机响应");
  if (damping.truncation.upperFrequencyHz < s.bandHz[1] || (m.modes.length < m.counts.equations && m.modes.at(-1)!.frequencyHz < s.bandHz[1])) throw new Error("模态频段覆盖不足，请增阶并重新核对阻尼");
  if (m.modes.length < m.counts.equations && m.modes.length <= s.modeIncrement) throw new Error("模态数不足以比较截断误差，请增阶或调整登记步长");
  if (!input.nodes.some((n) => n.id === s.response.nodeId)) throw new Error("随机响应节点已删除");
  for (const source of sources) for (const action of source.actions) {
    if (action.kind === "base-translation") {
      if (!input.supports.length || input.supports.some((support) => (["x", "y", "z"] as const).some((axis, i) => action.direction[axis] !== 0 && !support.restraints[i]))) throw new Error("整体一致基底要求所有支承约束每个非零平动方向；不支持差动支座或转动输入");
      const shapes = m.modes.flatMap((mode) => mode.members.flatMap((member) => member.samples.map((sample) => sample.translation)));
      const projection = Math.max(...shapes.map((v) => Math.abs(v.x * action.direction.x + v.y * action.direction.y + v.z * action.direction.z)));
      const shapeScale = Math.max(...shapes.map((v) => Math.hypot(v.x, v.y, v.z)));
      if (action.scale !== 0 && projection <= 1e-10 * Math.max(1e-30, shapeScale)) throw new Error("已提取模态未覆盖基底平动方向，请增阶；不能把零参与误判为收敛");
      continue;
    }
    const node = action.kind === "node";
    if (node ? !input.nodes.some((n) => n.id === action.nodeId) : !input.members.some((member) => member.id === action.memberId)) throw new Error(node ? "随机作用节点已删除" : "随机作用杆件已删除");
    const shapes = m.modes.map((_, i) => randomActionShape(basis.modal, i, action));
    const projection = Math.max(...shapes.map((v) => Math.abs(v.x * action.direction.x + v.y * action.direction.y + v.z * action.direction.z)));
    const shapeScale = Math.max(...shapes.map((v) => Math.hypot(v.x, v.y, v.z)));
    const freeDirectionNorm = node ? Math.hypot(...(["x", "y", "z"] as const).map((axis, i) => input.supports.some((support) => support.nodeId === action.nodeId && support.restraints[i]) ? 0 : action.direction[axis])) : 1;
    const scale = node ? action.scale : action.scalePerM;
    if (scale !== 0 && freeDirectionNorm > 0 && projection / freeDirectionNorm <= 1e-10 * Math.max(1e-30, shapeScale)) throw new Error(node ? "已提取模态未覆盖该节点力方向，不能把零参与误判为收敛，请增阶" : "已提取模态未覆盖杆件均布力方向，请增阶");
  }
  const equivalent = { ...input, analysisCase: basis.modal.input.analysisCase, solver: basis.modal.input.solver, randomBasis: undefined };
  if (!sameInputValue(analysisInputDependencies(equivalent), analysisInputDependencies(basis.modal.input))) throw new Error("冻结模态与随机工况的结构、质量或边界不一致");
  return { ...basis, modal: basis.modal, damping };
}
