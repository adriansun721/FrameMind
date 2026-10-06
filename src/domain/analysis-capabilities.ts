/** Extend when an analysis method has a verified public solver. */
export const ANALYSIS_CAPABILITIES = {
  static: { name: "线性静力", available: true, loadCombination: true, responseSuperposition: true, resultComparison: true },
  "second-order": { name: "弹性二阶", available: false, loadCombination: true, responseSuperposition: false, resultComparison: false },
  buckling: { name: "特征值屈曲", available: false, loadCombination: true, responseSuperposition: false, resultComparison: false },
  modal: { name: "模态", available: true, loadCombination: false, responseSuperposition: false, resultComparison: false },
  random: { name: "随机响应", available: false, loadCombination: false, responseSuperposition: false, resultComparison: false },
} as const;
export type AnalysisMethod = keyof typeof ANALYSIS_CAPABILITIES;
export type AnalysisOperation = "loadCombination" | "responseSuperposition" | "resultComparison";
export function requireAnalysisCapability(method: string, operation?: AnalysisOperation): void {
  const capability = Object.hasOwn(ANALYSIS_CAPABILITIES, method) ? ANALYSIS_CAPABILITIES[method as AnalysisMethod] : undefined;
  if (!capability?.available) throw new Error(`分析方法 ${method} 尚未接入已验证的求解器`);
  if (operation && !capability[operation]) throw new Error(`${capability.name} 不支持 ${operation}`);
}
