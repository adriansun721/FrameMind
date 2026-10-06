import { useMemo, useState } from "react";
import { getMemberResponseSamples, type AnalysisResult } from "../domain/analysis";
import { SECOND_ORDER_MEANING } from "../domain/second-order";
import { secondOrderLinearResponse } from "../domain/second-order-result";
import { PagedItems } from "./ProcessDisclosure";
import { useUnits } from "./UnitPresentation";

export function SecondOrderResultSummary({ result }: { result: AnalysisResult }) {
  const r = result.secondOrder!, u = useUnits(), linear = useMemo(() => secondOrderLinearResponse(result), [result]);
  const [memberId, setMemberId] = useState(result.members[0].memberId), [axis, setAxis] = useState<"x" | "y" | "z">("y");
  const member = result.members.find((m) => m.memberId === memberId) ?? result.members[0];
  const samples = member.nativeResponses!, before = linear.members.find((m) => m.memberId === member.memberId)!.nativeResponses!;
  const values = [before, samples].map((items) => items.map((s) => s.globalDisplacement[axis])), peak = Math.max(1e-12, ...values.flat().map(Math.abs));
  const path = (v: number[]) => v.map((y, i) => `${i ? "L" : "M"}${30 + i * 420 / 16},${90 - y / peak * 65}`).join(" ");
  const final = r.runs.at(-1)!, iterations = final.calculation.iterations;
  const nearZero = (value: number) => Math.abs(value) < 1e-12;
  return <section className="property-section second-order-summary" data-testid="second-order-results">
    <h3>二阶响应与线性比较</h3><p>初应力弹性二阶近似 · 小位移 P-Δ／P-δ · 禁止响应叠加。</p>
    <p>已收敛 · 每杆 {r.selectedDivisions} 单元 · {final.calculation.vector.length} 方程 · {result.input.analysisCase!.settings.secondOrder!.loadSteps} 加载步。均衡残差 {iterations.at(-1)!.residual.toExponential(2)}。</p>
    <p>比较基础相同：结构、荷载方向与系数、约束、释放及内部网格完全相同；线性 K·u=F，二阶 (K+G[N线性])·u=F。差值 = 二阶 − 线性。</p>
    <details><summary>方法与适用边界</summary><p>{SECOND_ORDER_MEANING}</p><p>横向斜率安全上界 .05 rad，轴向应变上界 .01；不表示材料强度、承载极限或规范合格。均布横力的二阶位移使用 Hermite 场，线性基准含精确特解；两者均以相同网格及细分容差核查。</p></details>
    <label className="field"><span>比较杆件</span><select aria-label="二阶比较杆件" value={member.memberId} onChange={(e) => setMemberId(e.target.value)}>{result.input.members.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.id}</option>)}</select></label>
    <label className="field"><span>位移分量</span><select aria-label="二阶比较位移分量" value={axis} onChange={(e) => setAxis(e.target.value as typeof axis)}>{["x", "y", "z"].map((a) => <option key={a}>{a}</option>)}</select></label>
    <svg viewBox="0 0 480 195" role="img" aria-label={`同条件线性与二阶沿杆位移 ${axis} 比较`} style={{ width: "100%", display: "block" }}>
      <line x1="30" y1="90" x2="450" y2="90" stroke="currentColor" opacity=".3" />
      <path d={path(values[0])} fill="none" stroke="#8797a1" strokeWidth="2" strokeDasharray="5 4" />
      <path d={path(values[1])} fill="none" stroke="#cf6b3c" strokeWidth="2.5" />
      <g fill="currentColor" fontSize="12"><text x="30" y="180">0</text><text x="350" y="180">{u.quantity(member.length, "m")}</text><text x="30" y="15">峰值刻度 ±{u.quantity(peak, "m")}</text><text x="190" y="195">灰虚线：线性　橙实线：二阶</text></g>
    </svg>
    <details><summary>节点位移与差值</summary><div className="load-case-table-scroll"><table aria-label="二阶与线性节点比较"><thead><tr><th>节点／分量</th><th>线性</th><th>二阶</th><th>差值</th><th>比值</th></tr></thead><tbody>{result.nodes.flatMap((n) => (["x", "y", "z"] as const).map((a) => {
      const b = linear.nodes.find((v) => v.nodeId === n.nodeId)!.displacement[a], v = n.displacement[a];
      return <tr key={`${n.nodeId}:${a}`}><th>{n.nodeId} · {a}</th><td>{u.quantity(b, "m")}</td><td>{u.quantity(v, "m")}</td><td>{u.quantity(v - b, "m")}</td><td>{nearZero(b) ? "基值近零" : (v / b).toPrecision(6)}</td></tr>;
    }))}</tbody></table></div></details>
    <details><summary>所选杆端内力与差值</summary><div className="load-case-table-scroll"><table aria-label="二阶与线性杆端比较"><thead><tr><th>端／分量</th><th>线性</th><th>二阶</th><th>差值</th></tr></thead><tbody>{(["start", "end"] as const).flatMap((end) => ["N", "Vy", "Vz", "T", "My", "Mz"].map((component, i) => {
      const b = linear.members.find((m) => m.memberId === member.memberId)!.localEndForces[end][i], v = member.localEndForces[end][i], unit = i < 3 ? "kN" : "kN·m";
      return <tr key={`${end}:${component}`}><th>{end} · {component}</th><td>{u.quantity(b, unit)}</td><td>{u.quantity(v, unit)}</td><td>{u.quantity(v - b, unit)}</td></tr>;
    }))}</tbody></table></div></details>
    <details><summary>真实加载／迭代与细分过程</summary><p>初应力模型每步内矩阵固定，表中的轮次为实际平衡校正；不表示轴力再分配的非线性迭代。</p>
      <div className="load-case-table-scroll"><table aria-label="二阶细分收敛"><thead><tr><th>每杆单元</th><th>方程</th><th>位移误差</th><th>反力误差</th><th>截面力误差</th></tr></thead><tbody>{r.runs.map((run) => <tr key={run.divisions}><th>{run.divisions}</th><td>{run.calculation.vector.length}</td>{[run.error?.displacement, run.error?.reaction, run.error?.sectionForce].map((x, i) => <td key={i}>{x === undefined ? "首轮无比较" : x.toPrecision(4)}</td>)}</tr>)}</tbody></table></div>
      <PagedItems items={iterations} label="二阶加载迭代" pageSize={50}>{(page) => <div className="load-case-table-scroll"><table aria-label="二阶真实迭代记录"><thead><tr><th>步／α</th><th>轮</th><th>校正前残差</th><th>校正后残差</th><th>相对增量</th></tr></thead><tbody>{page.map((v) => <tr key={`${v.step}:${v.iteration}`}><th>{v.step} / {v.factor}</th><td>{v.iteration}</td><td>{v.residualBefore.toExponential(3)}</td><td>{v.residual.toExponential(3)}</td><td>{v.increment.toExponential(3)}</td></tr>)}</tbody></table></div>}</PagedItems>
      <p>真实线性运行：{final.calculation.linearRun.service!.requestId} · {final.calculation.linearRun.input.solver!.implementation}。残差和增量满足冻结容差才进入下一加载步。细分误差全部 ≤1；不代表一般大变形或材料非线性精度。</p>
    </details>
    <details><summary>冻结沿杆位移数值</summary><div className="load-case-table-scroll"><table aria-label="二阶沿杆位移比较"><thead><tr><th>位置</th><th>线性</th><th>二阶</th></tr></thead><tbody>{getMemberResponseSamples(result, member.memberId, 17).map((sample, i) => <tr key={i}><th>{u.quantity(sample.position, "m")}</th><td>{u.quantity(before[i].globalDisplacement[axis], "m")}</td><td>{u.quantity(sample.globalDisplacement[axis], "m")}</td></tr>)}</tbody></table></div></details>
  </section>;
}
