import type { AnalysisResult } from "../domain/analysis";

export function DiscretizationSummary({ result }: { result: AnalysisResult }) {
  const d = result.discretization, p = result.input.meshPlan?.policy;
  if (!d || !p) return null;
  const c = d.counts;
  return <section className="property-section" aria-label="内部细分与收敛" data-testid="discretization-summary">
    <h3>内部细分与收敛</h3>
    <p role={d.status === "budget-exhausted" ? "alert" : undefined}>{d.status === "converged" ? "加密检查满足精度" : "计算预算内未满足精度；结果仅供核查，未收敛"} · {d.selectedDivisions} 单元 / 工程杆件</p>
    <dl><div><dt>工程节点 / 杆件</dt><dd>{c.engineeringNodes} / {c.engineeringMembers}</dd></div>
      <div><dt>计算节点 / 单元</dt><dd>{c.calculationNodes} / {c.calculationElements}</dd></div>
      <div><dt>实际自由度 / 支座约束 / 脱开转动</dt><dd>{c.totalDofs} / {c.constrainedDofs} / {c.releaseGaugeDofs}</dd></div>
      <div><dt>约束后方程规模</dt><dd>{c.equations}</dd></div>
      <div><dt>加密预算</dt><dd>最多 {p.maxDivisions} 单元 / 杆，{p.maxEquations} 方程</dd></div>
      <div><dt>精度指标</dt><dd>相对 {p.relativeTolerance}；位移 / 转角绝对 {p.displacementTolerance} m / rad；力 / 弯矩绝对 {p.forceTolerance} kN / kN·m</dd></div>
    </dl>
    <div className="member-process-dof-table"><table aria-label="细分加密误差"><thead><tr><th>每杆单元</th><th>位移</th><th>反力</th><th>截面内力</th></tr></thead><tbody>{d.runs.map((run) => <tr key={run.divisions}><td>{run.divisions}</td>{(["displacement", "reaction", "sectionForce"] as const).map((key) => <td key={key}>{run.error ? run.error[key].toPrecision(4) : "基线"}</td>)}</tr>)}</tbody></table></div>
    <p>误差为变化量 /（绝对阈值 + 相对阈值 × 响应尺度），所有指标 ≤ 1 才通过。检查工程节点及沿杆 17 个固定站点；仅证明当前静力细分稳定，不代表模态或二阶精度。内部节点仅供过程核查。</p>
  </section>;
}
