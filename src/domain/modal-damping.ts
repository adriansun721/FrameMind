import { analysisInputDependencies, getAnalysisResultForSource, isAnalysisResultCurrent, sameInputValue, type AnalysisResult } from "./analysis";
import { updateAnalysisCase, type FrameProject } from "./project";

export interface DampingValue { ratio: number; source: "user" | "suggestion"; basis: string }
export interface ModalDampingInput {
  uniform: DampingValue;
  overrides: Array<{ modeNumber: number; value: DampingValue }>;
  truncation: { upperFrequencyHz: number; modeIncrement: number; maxModeCount: number };
}
export interface ModalDampingBinding extends ModalDampingInput {
  analysisId: string; createdAt: string; frequenciesHz: number[];
}
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join() !== keys.sort().join()) throw new Error("阻尼设置字段不完整或含未定义字段");
}
function dampingValue(value: unknown): DampingValue {
  exact(value, ["ratio", "source", "basis"]);
  if (typeof value.ratio !== "number" || !Number.isFinite(value.ratio) || value.ratio <= 0 || value.ratio >= 1)
    throw new Error("阻尼比须为 0 与 1 之间的有限数值（不含端点），例如 0.02 表示 2%；请核对阻尼条件");
  if (!["user", "suggestion"].includes(String(value.source)) || typeof value.basis !== "string" || !value.basis.trim() || value.basis.length > 500)
    throw new Error("请注明用户输入或建议及其依据");
  return { ratio: value.ratio, source: value.source as DampingValue["source"], basis: value.basis.trim() };
}
export function validateModalDampingInput(value: unknown): ModalDampingInput {
  exact(value, ["uniform", "overrides", "truncation"]);
  const uniform = dampingValue(value.uniform);
  if (!Array.isArray(value.overrides) || value.overrides.length > 50) throw new Error("逐模态覆盖须为至多 50 项的数组");
  const numbers = new Set<number>();
  const overrides = value.overrides.map((item) => {
    exact(item, ["modeNumber", "value"]);
    if (typeof item.modeNumber !== "number" || !Number.isSafeInteger(item.modeNumber) || item.modeNumber < 1 || item.modeNumber > 50 || numbers.has(item.modeNumber)) throw new Error("覆盖阶次须为不重复的 1 至 50 整数");
    numbers.add(item.modeNumber);
    return { modeNumber: item.modeNumber, value: dampingValue(item.value) };
  });
  exact(value.truncation, ["upperFrequencyHz", "modeIncrement", "maxModeCount"]);
  const t = value.truncation;
  if (typeof t.upperFrequencyHz !== "number" || !Number.isFinite(t.upperFrequencyHz) || t.upperFrequencyHz <= 0
    || typeof t.modeIncrement !== "number" || !Number.isSafeInteger(t.modeIncrement) || t.modeIncrement < 1 || t.modeIncrement > 50
    || typeof t.maxModeCount !== "number" || !Number.isSafeInteger(t.maxModeCount) || t.maxModeCount < 1 || t.maxModeCount > 50) throw new Error("请提供正有限的分析频段上限 Hz、1 至 50 的增阶步长与模态预算");
  return { uniform, overrides, truncation: { upperFrequencyHz: t.upperFrequencyHz, modeIncrement: t.modeIncrement, maxModeCount: t.maxModeCount } };
}
export function validateModalDampingBinding(value: unknown): ModalDampingBinding {
  exact(value, ["uniform", "overrides", "truncation", "analysisId", "createdAt", "frequenciesHz"]);
  const { analysisId, createdAt, frequenciesHz, ...input } = value;
  if (typeof analysisId !== "string" || !analysisId || typeof createdAt !== "string" || !createdAt
    || !Array.isArray(frequenciesHz) || !frequenciesHz.length || frequenciesHz.length > 50 || frequenciesHz.some((f, i) => typeof f !== "number" || !Number.isFinite(f) || f < 0 || i > 0 && f < frequenciesHz[i - 1])) throw new Error("阻尼绑定的模态身份或频率无效");
  const validated = validateModalDampingInput(input);
  if (validated.overrides.some((o) => o.modeNumber > frequenciesHz.length)) throw new Error("覆盖阶次不在绑定模态集合中，请重新核对");
  return { ...validated, analysisId, createdAt, frequenciesHz: [...frequenciesHz] };
}
export function dampingMatchesResult(binding: ModalDampingBinding, result: AnalysisResult): boolean {
  return binding.analysisId === result.id && binding.createdAt === result.createdAt && Boolean(result.modal)
    && sameInputValue(binding.frequenciesHz, result.modal!.modes.map((m) => m.frequencyHz));
}
export function setModalDamping(project: FrameProject, caseId: string, analysisId: string, input: ModalDampingInput): FrameProject {
  const result = getAnalysisResultForSource(project, caseId), definition = project.analysisCases.find((c) => c.id === caseId);
  if (!definition || definition.method !== "modal" || !result?.modal || result.id !== analysisId || !isAnalysisResultCurrent(project, result)) throw new Error("请重读并计算该工况最新有效模态，再重新核对阻尼覆盖");
  const damping = validateModalDampingBinding({ ...validateModalDampingInput(input), analysisId, createdAt: result.createdAt, frequenciesHz: result.modal.modes.map((m) => m.frequencyHz) });
  if (damping.truncation.maxModeCount < result.input.analysisCase!.settings.modal!.modeCount) throw new Error("模态数预算不能小于当前请求阶数，请提高预算或重新设置提取数量");
  return updateAnalysisCase(project, caseId, { ...definition, damping });
}
export function modalDampingStatus(project: FrameProject, result: AnalysisResult) {
  const definition = project.analysisCases.find((c) => c.id === result.input.analysisCase?.id), binding = definition?.damping;
  const latest = definition && getAnalysisResultForSource(project, definition.id);
  const valid = Boolean(binding && dampingMatchesResult(binding, result) && latest?.id === result.id && isAnalysisResultCurrent(project, result));
  return { status: !binding ? "missing" as const : valid ? "valid" as const : "needs-review" as const,
    analysisId: result.id, boundAnalysisId: binding?.analysisId,
    message: !binding ? "请设置统一阻尼及分析频段，核对所需覆盖" : valid ? "阻尼已核对至该模态结果" : "模态重算、过期或身份变化，请重读频率与振型并重新设置；旧覆盖未应用",
    modes: result.modal!.modes.map((m) => ({ number: m.number, frequencyHz: m.frequencyHz,
      damping: valid ? binding!.overrides.find((o) => o.modeNumber === m.number)?.value ?? binding!.uniform : null,
      dampingScope: valid ? binding!.overrides.some((o) => o.modeNumber === m.number) ? "override" : "uniform" : null })),
    truncation: { ...modalTruncationCheck(result, valid ? binding : undefined), frequencyChecks: modalFrequencyChecks(project, result) } };
}
/** Only the extraction count may change in a comparable sequence; frequencies do not identify shapes. */
function modalFrequencyChecks(project: FrameProject, result: AnalysisResult) {
  const basis = (r: AnalysisResult) => analysisInputDependencies({ ...r.input, analysisCase: { ...r.input.analysisCase!, settings: { ...r.input.analysisCase!.settings, modal: { ...r.input.analysisCase!.settings.modal!, modeCount: 1 } } } });
  const comparable = project.analysisResults.filter((r) => r.modal && sameInputValue(basis(r), basis(result)));
  const stop = comparable.findIndex((r) => r.id === result.id);
  const sequence = stop < 0 ? [] : comparable.slice(0, stop + 1);
  return sequence.map((r, i) => {
    const previous = sequence[i - 1], count = r.input.analysisCase!.settings.modal!.modeCount;
    const grew = Boolean(previous && count > previous.input.analysisCase!.settings.modal!.modeCount);
    const prefixFrequencyChange = grew ? Math.max(...previous!.modal!.modes.map((m, j) => {
      const f = r.modal!.modes[j]?.frequencyHz;
      return f === undefined ? Infinity : Math.abs(f - m.frequencyHz) / Math.max(1e-8, f, m.frequencyHz);
    })) : null;
    return { analysisId: r.id, requestedModeCount: count, returnedModeCount: r.modal!.modes.length,
      frequencyConverged: r.modal!.convergence.status === "converged", grew,
      prefixFrequencyChange: Number.isFinite(prefixFrequencyChange) ? prefixFrequencyChange : null,
      responseChange: null, responseAccuracy: "not-verified" };
  });
}
export function modalTruncationCheck(result: AnalysisResult, input?: ModalDampingInput) {
  const modal = result.modal!, count = result.input.analysisCase!.settings.modal!.modeCount;
  const maximumFrequencyHz = modal.modes.at(-1)!.frequencyHz;
  const frequencyCoverage = input ? maximumFrequencyHz >= input.truncation.upperFrequencyHz : null;
  const nextModeCount = input && count < input.truncation.maxModeCount ? Math.min(count + input.truncation.modeIncrement, input.truncation.maxModeCount) : null;
  return { requestedModeCount: count, returnedModeCount: modal.modes.length, maximumFrequencyHz,
    upperFrequencyHz: input?.truncation.upperFrequencyHz ?? null, frequencyCoverage,
    frequencyConverged: modal.convergence.status === "converged", zeroEnergyModes: modal.zeroEnergyModes,
    participatingMass: "not-evaluated" as const, responseComponents: "not-selected" as const,
    nextModeCount, modeBudgetReached: Boolean(input && nextModeCount === null),
    responseAccuracy: "not-verified" as const,
    message: "频率覆盖仅是筛查；须逐步增阶分别比较所选响应 PSD 与 RMS，并核查参与度／有效质量及频点积分收敛。预算耗尽仍未满足误差则报告不足。T2-33 执行响应数值验证，返回指定阶数不代表充分。" };
}
