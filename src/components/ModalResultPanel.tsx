import type { AnalysisResult } from "../domain/analysis";

export function ModalResultPanel({ result, current, modeNumber, onModeChange, scale, onScaleChange, onShowShape }: {
  result: AnalysisResult; current: boolean; modeNumber: number; onModeChange(n: number): void;
  scale: number; onScaleChange(n: number): void; onShowShape(): void;
}) {
  const modal = result.modal!, mode = modal.modes.find((m) => m.number === modeNumber) ?? modal.modes[0];
  return <div className="analysis-result-panel modal-result-panel" data-testid="modal-results">
    <div className="selection-title"><strong>结构质量与模态分析</strong></div>
    <section className="property-section"><h3>冻结来源</h3><dl>
      <div><dt>分析工况</dt><dd>{result.input.analysisCase!.id} · {result.input.analysisCase!.name}</dd></div>
      <div><dt>结果状态</dt><dd>R{result.projectRevision} · {current ? "当前" : "已过期"}</dd></div>
      <div><dt>结构质量</dt><dd>{modal.totalMassKg.toPrecision(7)} kg</dd></div>
      <div><dt>工程节点 / 杆件</dt><dd>{modal.counts.engineeringNodes} / {modal.counts.engineeringMembers}</dd></div>
      <div><dt>计算节点 / 单元 / 方程</dt><dd>{modal.counts.calculationNodes} / {modal.counts.calculationElements} / {modal.counts.equations}</dd></div>
      <div><dt>释放端独立转角</dt><dd>{modal.counts.releaseCoordinates}</dd></div>
      <div><dt>频率细分检查</dt><dd>{modal.convergence.status === "converged" ? "满足频率精度" : "预算停止 · 未收敛"} · 每杆 {modal.selectedDivisions} 单元</dd></div>
      <div><dt>结果身份</dt><dd>{result.id}</dd></div>
    </dl><p>结构质量由密度和几何形成，静力荷载与自重开关不参与模态质量。</p></section>
    <section className="property-section"><h3>频率与振型</h3>
      <label className="field"><span>当前振型</span><select aria-label="当前振型" value={mode.number} onChange={(e) => { onModeChange(Number(e.target.value)); onShowShape(); }}>{modal.modes.map((m) => <option key={m.number} value={m.number}>第 {m.number} 阶 · {m.frequencyHz.toPrecision(6)} Hz{m.kind === "zero-energy" ? " · 零能模态" : ""}</option>)}</select></label>
      <button className="button ghost" onClick={onShowShape}>显示振型</button>
      <label className="result-scale-field"><span>振型显示幅值</span><input aria-label="振型显示幅值" type="range" min="1" max="1000" value={scale} onChange={(e) => onScaleChange(Number(e.target.value))} /><output>{scale / 1000} m</output></label>
      <p>幅值仅用于显示缩放，不代表受载实际位移。原振型按单位广义质量归一化，符号可相反；重根应比较整个振型子空间。</p>
      {modal.zeroEnergyModes > 0 && <p role="status">检测到 {modal.zeroEnergyModes} 个零能模态，可能是自由刚体运动或释放机构，请核查支座与连接。</p>}
      <div className="load-case-table-scroll"><table aria-label="模态频率表"><thead><tr><th>阶次</th><th>频率 (Hz)</th><th>归一化残差</th><th>类型</th></tr></thead><tbody>{modal.modes.map((m) => <tr key={m.number}><td>{m.number}</td><td>{m.frequencyHz.toPrecision(7)}</td><td>{m.residual.toExponential(2)}</td><td>{m.kind === "zero-energy" ? "零能" : "弹性"}</td></tr>)}</tbody></table></div>
      <details><summary>当前振型的节点分量 · 归一化幅值</summary><p>平移与转角使用原求解归一化，不是实际位移或转角。纯扭转模态可通过转角分量核查。</p><div className="load-case-table-scroll"><table aria-label="振型节点分量"><thead><tr><th>节点</th><th>平移 X / Y / Z</th><th>转角 X / Y / Z</th></tr></thead><tbody>{mode.nodes.map((n) => <tr key={n.nodeId}><td>{n.nodeId}</td><td>{Object.values(n.translation).map((v) => v.toPrecision(5)).join(" / ")}</td><td>{Object.values(n.rotation).map((v) => v.toPrecision(5)).join(" / ")}</td></tr>)}</tbody></table></div></details>
    </section>
    <details className="property-section"><summary>质量来源与方法</summary><p>Euler-Bernoulli 一致质量，忽略剪切和弯曲转动惯性，保留扭转极惯性。广义对称特征值法 · {result.input.solver!.implementation}。质量正交误差 {modal.orthogonalityError.toExponential(3)}。</p>
      <div className="load-case-table-scroll"><table aria-label="结构质量来源"><thead><tr><th>杆件</th><th>材料 / 截面</th><th>密度 (kg/m³)</th><th>质量 (kg)</th></tr></thead><tbody>{modal.sources.map((s) => <tr key={s.memberId}><td>{s.memberId}</td><td>{s.materialId} / {s.sectionId}</td><td>{s.densityKgM3}</td><td>{s.massKg.toPrecision(7)}</td></tr>)}</tbody></table></div>
      <p>频率加密稳定不等于形态或后续随机响应已收敛。当前模态结果保留全部已提取振型与沿杆样本。</p>
    </details>
  </div>;
}
