import type { AnalysisDiagnostic } from "../domain/analysis-diagnostics";

/** Failed corrections are evidence, never a displacement result. */
export function SecondOrderFailureProcess({ diagnostic }: { diagnostic: AnalysisDiagnostic }) {
  const runs = diagnostic.convergence ?? (diagnostic.iterations ? [{ divisions: undefined, iterations: diagnostic.iterations }] : []);
  if (!runs.length) return null;
  return <details><summary>失败前真实加载记录 · 未发布收敛解</summary>{runs.map((run, i) => {
    const last = run.iterations.at(-1);
    return <p key={i}>{run.divisions ? `每杆 ${run.divisions} 单元 · ` : ""}{run.iterations.length} 轮校正{last && ` · 加载步 ${last.step} / α=${last.factor.toPrecision(4)} · 残差 ${last.residual.toExponential(3)} · 相对增量 ${last.increment.toExponential(3)}`}</p>;
  })}</details>;
}
