import type { AnalysisDiagnostic } from "../domain/analysis-diagnostics";
import { useUnits } from "./UnitPresentation";

export function RandomFailureProcess({ diagnostic }: { diagnostic: AnalysisDiagnostic }) {
  const record = diagnostic.randomConvergence, u = useUnits();
  if (!record) return null;
  return <details><summary>随机响应失败检查记录 · 未发布响应</summary><p>频点预算 {record.pointBudget} · 加密预算 {record.refinementBudget} · 本轮 {record.attemptedPoints} 点。</p>
    {record.runs.map((run, i) => <p key={i}>第 {i} 轮 · {run.points} 点 · 检查 RMS {u.quantity(run.rms, "m")} · 曲线误差 {run.curveError?.toExponential(3) ?? "基线"} · 积分误差 {run.varianceError?.toExponential(3) ?? "基线"}</p>)}
    {record.detail.curveError !== undefined && <p>模态 {record.detail.lowerModeCount} → {record.detail.upperModeCount} 阶 · PSD 误差 {record.detail.curveError.toExponential(3)} · RMS 误差 {record.detail.rmsError.toExponential(3)}。</p>}
    <p>以上是失败过程的检查值，未作为成功响应保存；已有结果保留其冻结输入。</p>
  </details>;
}
