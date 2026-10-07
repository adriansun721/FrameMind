import type { AnalysisResult } from "./analysis";
import { ANALYSIS_CAPABILITIES, type AnalysisMethod } from "./analysis-capabilities";
import { BUCKLING_MEANING } from "./buckling";
import { SECOND_ORDER_MEANING } from "./second-order";
import { RANDOM_RESPONSE_MEANING } from "./random-response";

export function resultMethod(result: AnalysisResult): AnalysisMethod {
  return result.random ? "random" : result.buckling ? "buckling" : result.modal ? "modal" : result.secondOrder ? "second-order" : "static";
}

export function resultMeaning(result: AnalysisResult): string {
  switch (resultMethod(result)) {
    case "random": return RANDOM_RESPONSE_MEANING;
    case "buckling": return BUCKLING_MEANING;
    case "modal": return "单位广义质量归一化振型；幅值及显示缩放不是受载实际位移，符号可相反。";
    case "second-order": return SECOND_ORDER_MEANING;
    default: return "线弹性静力位移、转角与内力；图形按显示比例放大。";
  }
}

export function resultIdentity(result: AnalysisResult, current: boolean) {
  const method = resultMethod(result);
  const convergence = result.random?.convergence.status ?? result.buckling?.convergence.status ?? result.modal?.convergence.status ?? result.secondOrder?.status ?? result.discretization?.status;
  return { method, methodName: ANALYSIS_CAPABILITIES[method].name, meaning: resultMeaning(result),
    completion: convergence ?? result.status, current, inputRevision: result.input.projectRevision,
    canonicalUnits: result.input.assumptions.units, solver: result.input.solver,
    support: ANALYSIS_CAPABILITIES[method] };
}

export const PROCESS_SECTIONS = ["settings", "mesh", "stages", "coordinates", "stiffness", "mass", "geometric", "iterations"] as const;
export type ProcessSection = typeof PROCESS_SECTIONS[number];

/** Only recorded data from this run (or its explicitly identified frozen modal basis). */
export function readRecordedProcess(result: AnalysisResult, section: ProcessSection, offset = 0, limit = 50) {
  const modalBasis = result.random ? result.input.randomBasis?.modal : undefined;
  const basis = modalBasis ?? result;
  const eigen = basis.modal?.eigenproblem ?? result.buckling?.eigenproblem;
  const second = result.secondOrder?.runs.find((run) => run.divisions === result.secondOrder!.selectedDivisions)?.calculation;
  const divisions = basis.modal?.selectedDivisions ?? result.buckling?.selectedDivisions ?? result.secondOrder?.selectedDivisions ?? result.discretization?.selectedDivisions;
  const level = basis.input.meshPlan?.levels.find((item) => item.divisions === divisions);
  const staticRun = result.discretization?.runs.find((run) => run.divisions === divisions)?.result ?? result;
  const process = staticRun.process;
  let records: readonly unknown[] | null | undefined;
  switch (section) {
    case "settings": records = [{ assumptions: result.input.assumptions, solver: result.input.solver,
      settings: result.input.analysisCase?.settings, meshPolicy: result.input.meshPlan?.policy,
      ...(result.random ? { modalAnalysisId: modalBasis?.id, damping: result.input.randomBasis?.damping } : {}) }]; break;
    case "mesh": records = level?.elements; break;
    case "stages": records = result.service?.stages; break;
    case "coordinates": records = eigen?.coordinates ?? second?.coordinates ?? process?.dofs; break;
    case "stiffness": records = eigen?.stiffness ?? second?.stiffness ?? process?.assembledStiffness; break;
    case "mass": records = eigen && "mass" in eigen ? eigen.mass : undefined; break;
    case "geometric": records = result.buckling ? result.buckling.eigenproblem.referenceGeometric?.map((reference, i) => ({ reference, fixed: result.buckling!.eigenproblem.fixedGeometric?.[i] ?? null })) : second?.geometric; break;
    case "iterations": records = second?.iterations; break;
  }
  const sourceAnalysisId = modalBasis && ["mesh", "coordinates", "stiffness", "mass"].includes(section) ? modalBasis.id
    : !eigen && !second && ["coordinates", "stiffness"].includes(section) ? staticRun.id : result.id;
  const available = records != null;
  const items = records?.slice(offset, offset + limit) ?? [];
  return { section, sourceAnalysisId, origin: available ? "captured-from-run" : "not-recorded", available,
    message: available ? "本次冻结运行实际记录；矩阵、参数及混合自由度向量保留内部规范单位，不随显示单位换算。"
      : "本次运行未保存此记录（可能不适用或超过记录规模门槛）；未重建，未借用其他计算。",
    units: result.input.assumptions.units, matrixLimit: eigen?.matrixLimit ?? second?.matrixLimit ?? process?.matrixLimit,
    ...(section === "geometric" && result.buckling ? { role: "separate-fixed-and-reference" } : {}),
    total: records?.length ?? 0, offset, limit, items,
    page: { empty: !items.length, hasMore: offset + items.length < (records?.length ?? 0), nextOffset: offset + items.length } };
}
