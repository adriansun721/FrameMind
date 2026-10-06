import { BUCKLING_MEANING } from "../domain/buckling";
import type { AnalysisResult } from "../domain/analysis";
import { useUnits } from "./UnitPresentation";

export function BucklingResultPanel({ result, current, modeNumber, onModeChange, scale, onScaleChange, onShowShape, onLocate }: {
  result: AnalysisResult; current: boolean; modeNumber: number; onModeChange(n: number): void;
  scale: number; onScaleChange(n: number): void; onShowShape(): void; onLocate(selection: { kind: "node" | "member"; id: string }): void;
}) {
  const b = result.buckling!, u = useUnits(), mode = b.modes.find((m) => m.number === modeNumber) ?? b.modes[0];
  return <div className="analysis-result-panel" data-testid="buckling-results">
    <div className="selection-title"><strong>固定预荷载与特征值屈曲</strong></div>
    <section className="property-section"><h3>冻结输入与适用范围</h3><dl>
      <div><dt>分析工况</dt><dd>{result.input.analysisCase!.id} · {result.input.analysisCase!.name}</dd></div>
      <div><dt>状态</dt><dd>R{result.projectRevision} · {current ? "当前" : "已过期"}</dd></div>
      <div><dt>方程</dt><dd>(K + G固定 + λG参考)φ = 0</dd></div>
      <div><dt>工程节点 / 杆件</dt><dd>{b.counts.engineeringNodes} / {b.counts.engineeringMembers}</dd></div>
      <div><dt>计算节点 / 单元 / 方程</dt><dd>{b.counts.calculationNodes} / {b.counts.calculationElements} / {b.counts.equations}</dd></div>
      <div><dt>释放端独立转角</dt><dd>{b.counts.releaseCoordinates}</dd></div>
      <div><dt>因子细分检查</dt><dd>{b.convergence.status === "converged" ? "满足因子精度" : "预算停止 · 未收敛"} · 每杆 {b.selectedDivisions} 单元</dd></div>
      <div><dt>结果身份</dt><dd>{result.id}</dd></div>
    </dl><p>{BUCKLING_MEANING}</p><p>仅轴力引起的杆系弯曲整体稳定；不包含随动力、扭转预应力、局部屈曲、塑性与后屈曲。固定基态须稳定。</p>
    {(["fixed", "reference"] as const).map((role) => <details key={role}><summary>{role === "fixed" ? "固定预荷载" : "参考荷载"}来源、方向与系数</summary>
      {!result.input.bucklingLoads![role] && <p>固定预荷载为零</p>}
      {result.input.bucklingLoads![role]?.combination?.cases.map((c, i) => <div key={c.loadCase.id}><strong>{c.loadCase.id} · {c.loadCase.name} · 系数 {result.input.analysisCase!.settings.buckling![role][i].factor}</strong>
        {c.nodalLoads.map((l) => <p key={l.id}>{l.label} · <button className="button ghost" onClick={() => onLocate({ kind: "node", id: l.nodeId })}>{l.nodeId}</button> · 全局力 {Object.values(l.force).map((v) => u.quantity(v, "kN")).join(" / ")} · 矩 {Object.values(l.moment).map((v) => u.quantity(v, "kN·m")).join(" / ")}</p>)}
        {c.uniformLoads.map((l) => <p key={l.id}>{l.label} · <button className="button ghost" onClick={() => onLocate({ kind: "member", id: l.memberId })}>{l.memberId}</button> · {l.coordinateSystem} · {Object.values(l.intensity).map((v) => u.quantity(v, "kN/m")).join(" / ")}</p>)}
        {c.selfWeight.enabled && <p>自重 · 全局重力 {Object.values(c.selfWeight.gravity).map((v) => u.quantity(v, "m/s²")).join(" / ")}</p>}
      </div>)}
    </details>)}</section>
    <section className="property-section"><h3>屈曲因子与形态</h3>
      <label className="field"><span>当前屈曲形态</span><select aria-label="当前屈曲形态" value={mode.number} onChange={(e) => { onModeChange(Number(e.target.value)); onShowShape(); }}>{b.modes.map((m) => <option key={m.number} value={m.number}>第 {m.number} 阶 · λ = {m.factor.toPrecision(7)}</option>)}</select></label>
      <button className="button ghost" onClick={onShowShape}>显示屈曲形态</button>
      <label className="result-scale-field"><span>屈曲形态显示幅值</span><input aria-label="屈曲形态显示幅值" type="range" min="1" max="1000" value={scale} onChange={(e) => onScaleChange(Number(e.target.value))} /><output>{u.quantity(scale / 1000, "m")}</output></label>
      <p>单位计算向量归一化。显示缩放不代表真实位移；符号可相反，重根应核对形态子空间。</p>
      <div className="load-case-table-scroll"><table aria-label="屈曲因子表"><thead><tr><th>阶次</th><th>λ（无量纲）</th><th>归一化残差</th></tr></thead><tbody>{b.modes.map((m) => <tr key={m.number}><td>{m.number}</td><td>{m.factor.toPrecision(8)}</td><td>{m.residual.toExponential(2)}</td></tr>)}</tbody></table></div>
      <details><summary>当前形态节点分量与定位</summary><div className="load-case-table-scroll"><table><thead><tr><th>节点</th><th>归一化平移 X / Y / Z</th><th>归一化转角 X / Y / Z</th></tr></thead><tbody>{mode.nodes.map((n) => <tr key={n.nodeId}><td><button className="button ghost" onClick={() => onLocate({ kind: "node", id: n.nodeId })}>{n.nodeId}</button></td><td>{Object.values(n.translation).map((v) => v.toPrecision(5)).join(" / ")}</td><td>{Object.values(n.rotation).map((v) => v.toPrecision(5)).join(" / ")}</td></tr>)}</tbody></table></div></details>
    </section>
    <details className="property-section"><summary>实际预应力与细分过程</summary><p>轴力以拉为正，沿单元线性变化；三点高斯积分构造 Hermite 斜率几何刚度。</p>
      <div className="load-case-table-scroll"><table aria-label="屈曲预应力表"><thead><tr><th>工程杆件 / 位置</th><th>固定轴力起 / 终</th><th>参考轴力起 / 终</th></tr></thead><tbody>{b.prestress.map((v) => <tr key={v.elementId}><td><button className="button ghost" onClick={() => onLocate({ kind: "member", id: v.memberId })}>{v.memberId}</button> · {u.quantity(v.start, "m")}—{u.quantity(v.end, "m")}</td><td>{u.quantity(v.fixedAxialStartKN, "kN")} / {u.quantity(v.fixedAxialEndKN, "kN")}</td><td>{u.quantity(v.referenceAxialStartKN, "kN")} / {u.quantity(v.referenceAxialEndKN, "kN")}</td></tr>)}</tbody></table></div>
      <p>{b.convergence.runs.map((r) => `${r.divisions} 单元 · ${r.equations} 方程 · λ ${r.factors.map((f) => f.toPrecision(6)).join(", ")}${r.error === undefined ? "" : ` · 变化 ${r.error.toExponential(2)}`}`).join("；")}</p>
    </details>
  </div>;
}
