import { useState } from "react";
import type { AnalysisResult } from "../domain/analysis";
import { RANDOM_RESPONSE_MEANING, randomSources } from "../domain/random-response";
import { useUnits } from "./UnitPresentation";

export function RandomResultPanel({ result, current, onLocate, onLocateMember }: { result: AnalysisResult; current: boolean; onLocate(id: string): void; onLocateMember(id: string): void }) {
  const u = useUnits(), r = result.random!, s = result.input.analysisCase!.settings.random!, basis = result.input.randomBasis!;
  const [page, setPage] = useState(0);
  const peak = Math.max(...r.points.map((p) => p.density)), [lo, hi] = s.bandHz;
  // A bounded display envelope retains extrema in every bucket; saved data is complete.
  const plotted = r.points.length <= 1000 ? r.points : r.points.flatMap((_, i) => {
    if (i % Math.ceil(r.points.length / 500)) return [];
    const bucket = r.points.slice(i, i + Math.ceil(r.points.length / 500));
    const min = bucket.reduce((a, b) => b.density < a.density ? b : a), max = bucket.reduce((a, b) => b.density > a.density ? b : a);
    return min === max ? [min] : [min, max].sort((a, b) => a.frequencyHz - b.frequencyHz);
  });
  const curve = plotted.map((p) => `${36 + 548 * (p.frequencyHz - lo) / (hi - lo)},${176 - 144 * p.density / Math.max(1e-30, peak)}`).join(" ");
  return <div className="analysis-result-panel random-result-panel" data-testid="random-results">
    <header className="results-header"><div><h2>随机响应 PSD / RMS</h2><p>{result.input.analysisCase!.id} · {result.input.analysisCase!.name} · {current ? "当前有效" : "历史结果 · 依赖已过期"}</p></div></header>
    <p>{RANDOM_RESPONSE_MEANING}。不显示为受载变形，不进行 RMS 线性叠加。</p>
    <section className="property-section"><h3>{s.response.nodeId} · 平移 {s.response.component.toUpperCase()}</h3>
      <p>RMS：<strong data-testid="random-rms">{u.quantity(r.rms, "m")}</strong> · 全局 XYZ · 单边 Hz</p>
      <button className="button ghost" onClick={() => onLocate(s.response.nodeId)}>定位响应节点</button>
      <svg viewBox="0 0 620 210" role="img" aria-label="节点平移响应 PSD 曲线"><path d="M36 24V176H584" fill="none" stroke="currentColor" opacity=".4" /><polyline points={curve} fill="none" stroke="var(--accent, #519edb)" strokeWidth="2" /><text x="36" y="202" fill="currentColor" fontSize="18">{lo} Hz</text><text x="542" y="202" fill="currentColor" fontSize="18">{hi} Hz</text><text x="40" y="20" fill="currentColor" fontSize="18">{u.quantity(peak, "m²/Hz")}（曲线最大 PSD）</text></svg>
      <p>输入源间关系：独立；同源空间作用相干相加。</p>
      {randomSources(s).map((source) => <div key={source.sourceId}><p>源 {source.sourceId} · {source.psdSpectrumId} · kN²/Hz（规范力自谱）</p>{source.actions.map((action, i) => <p key={i}>{action.kind === "node" ? '节点 ' + action.nodeId : '整杆均布 ' + action.memberId} · 全局方向 ({Object.values(action.direction).join(", ")}) · 系数 {action.kind === "node" ? action.scale : u.quantity(action.scalePerM, "1/m")} <button className="button ghost" onClick={() => action.kind === "node" ? onLocate(action.nodeId) : onLocateMember(action.memberId)}>定位作用 {source.sourceId} / {i + 1}</button></p>)}</div>)}
      <p>积分频段 {s.bandHz.join("–")} Hz · 梯形积分 · {r.points.length} 个实际频点。曲线超过 1000 点时仅显示分桶极值，原始数值完整保存。</p>
    </section>
    <details className="property-section"><summary>模态、阻尼和精度来源</summary><p>模态结果：{basis.modal.id} · {basis.modal.createdAt} · {r.modeCount} 阶 · 每杆 {basis.modal.modal!.selectedDivisions} 单元。</p>
      <p>统一阻尼：{basis.damping.uniform.ratio} · {basis.damping.uniform.source} · {basis.damping.uniform.basis}</p>
      {basis.damping.overrides.map((o) => <p key={o.modeNumber}>第 {o.modeNumber} 阶覆盖：{o.value.ratio} · {o.value.source} · {o.value.basis}</p>)}
      <p>模态检查：{r.convergence.modal.status === "complete-basis" ? "完整方程基底，无模态截断" : `${r.convergence.modal.lowerModeCount} → ${r.convergence.modal.upperModeCount} 阶响应变化通过`} · PSD 误差 {r.convergence.modal.curveError.toExponential(3)} · RMS 误差 {r.convergence.modal.rmsError.toExponential(3)}。</p>
      <p>相对误差目标 {s.relativeTolerance}；绝对 PSD / 积分 / RMS 目标 {s.absolutePsdTolerance} m²/Hz / {s.absoluteVarianceTolerance} m² / {s.absoluteRmsTolerance} m。预算 {s.maxFrequencyPoints} 点 / {s.maxRefinements} 轮。</p>
      <div className="load-case-table-scroll"><table aria-label="随机响应精度检查"><thead><tr><th>频点</th><th>RMS ({u.unit("m")})</th><th>曲线误差</th><th>积分误差</th></tr></thead><tbody>{r.convergence.runs.map((run, i) => <tr key={i}><td>{run.points}</td><td>{u.value(run.rms, "m").toPrecision(7)}</td><td>{run.curveError?.toExponential(3) ?? "基线"}</td><td>{run.varianceError?.toExponential(3) ?? "基线"}</td></tr>)}</tbody></table></div>
      <p>收敛为冻结模态集合内的登记比较证据；不能证明未提取模态的贡献全部为零。有限带输入的频段外功率由用户定义为零。</p>
    </details>
    <details className="property-section"><summary>响应 PSD 数值</summary><div className="load-case-table-scroll"><table aria-label="随机响应 PSD 数值"><thead><tr><th>频率 (Hz)</th><th>PSD ({u.unit("m²/Hz")})</th></tr></thead><tbody>{r.points.slice(page * 50, (page + 1) * 50).map((p) => <tr key={p.frequencyHz}><td>{p.frequencyHz.toPrecision(8)}</td><td>{u.value(p.density, "m²/Hz").toExponential(7)}</td></tr>)}</tbody></table></div><div className="load-case-actions"><button className="button ghost" disabled={!page} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1} / {Math.ceil(r.points.length / 50)}</span><button className="button ghost" disabled={(page + 1) * 50 >= r.points.length} onClick={() => setPage(page + 1)}>下一页</button></div></details>
  </div>;
}
