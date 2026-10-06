import { useState } from "react";
import type { AnalysisResult } from "../domain/analysis";
import { modalDampingStatus, type DampingValue, type ModalDampingInput } from "../domain/modal-damping";
import type { FrameProject } from "../domain/project";

export function ModalDampingEditor({ project, result, onCommit, onIncrease }: {
  project: FrameProject; result: AnalysisResult; onCommit(input: ModalDampingInput): void; onIncrease(count: number): void;
}) {
  const binding = project.analysisCases.find((c) => c.id === result.input.analysisCase!.id)?.damping;
  const status = modalDampingStatus(project, result);
  // New results start blank. Carrying an old numbered override requires explicit re-entry.
  const initial = status.status === "valid" ? binding : undefined;
  const [ratio, setRatio] = useState(initial ? String(initial.uniform.ratio) : "");
  const [source, setSource] = useState<DampingValue["source"]>(initial?.uniform.source ?? "user");
  const [basis, setBasis] = useState(initial?.uniform.basis ?? "");
  const [overrides, setOverrides] = useState(initial?.overrides ?? []);
  const [upper, setUpper] = useState(initial ? String(initial.truncation.upperFrequencyHz) : "");
  const [increment, setIncrement] = useState(String(initial?.truncation.modeIncrement ?? 2));
  const [budget, setBudget] = useState(String(initial?.truncation.maxModeCount ?? 50));
  const [error, setError] = useState<string>();
  const valueFields = (value: DampingValue, change: (value: DampingValue) => void, label: string) => <>
    <label className="field"><span>{label}阻尼比</span><input aria-label={`${label}阻尼比`} type="number" step="any" value={Number.isNaN(value.ratio) ? "" : value.ratio} onChange={(e) => change({ ...value, ratio: e.target.value === "" ? NaN : Number(e.target.value) })} /></label>
    <label className="field"><span>{label}来源</span><select aria-label={`${label}来源`} value={value.source} onChange={(e) => change({ ...value, source: e.target.value as DampingValue["source"] })}><option value="user">用户输入</option><option value="suggestion">建议 · 待工程核对</option></select></label>
    <label className="field"><span>{label}依据</span><input aria-label={`${label}依据`} value={value.basis} onChange={(e) => change({ ...value, basis: e.target.value })} /></label>
  </>;
  return <section className="property-section" aria-label="模态阻尼与截断">
    <h3>模态阻尼与截断核查</h3><p role="status">{status.message}</p>
    {binding && status.status !== "valid" && <p>原绑定 {binding.analysisId}；统一阻尼 {binding.uniform.ratio}（{binding.uniform.source === "user" ? "用户输入" : "建议"} · {binding.uniform.basis}），覆盖阶次 {binding.overrides.map((o) => o.modeNumber).join("、") || "无"}。请核对新模态后重新输入。</p>}
    <p>阻尼比为无量纲小数，0.02 = 2%。未填写时无有效默认阻尼。增阶步长 2、预算 50 为软件检查建议，可调整。</p>
    <form onSubmit={(e) => {
      e.preventDefault();
      try { onCommit({ uniform: { ratio: ratio === "" ? NaN : Number(ratio), source, basis }, overrides, truncation: { upperFrequencyHz: upper === "" ? NaN : Number(upper), modeIncrement: Number(increment), maxModeCount: Number(budget) } }); setError(undefined); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "阻尼设置失败"); }
    }}>
      <label className="field"><span>统一阻尼比</span><input aria-label="统一阻尼比" type="number" step="any" value={ratio} onChange={(e) => setRatio(e.target.value)} /></label>
      <label className="field"><span>统一阻尼来源</span><select aria-label="统一阻尼来源" value={source} onChange={(e) => setSource(e.target.value as DampingValue["source"])}><option value="user">用户输入</option><option value="suggestion">建议 · 待工程核对</option></select></label>
      <label className="field"><span>统一阻尼依据</span><input aria-label="统一阻尼依据" value={basis} onChange={(e) => setBasis(e.target.value)} /></label>
      {overrides.map((override, i) => <fieldset key={i}><legend>逐模态覆盖 {i + 1}</legend>
        <label className="field"><span>覆盖阶次</span><select aria-label={`覆盖阶次 ${i + 1}`} value={override.modeNumber} onChange={(e) => setOverrides(overrides.map((o, j) => j === i ? { ...o, modeNumber: Number(e.target.value) } : o))}>{result.modal!.modes.map((m) => <option key={m.number} value={m.number}>{m.number} · {m.frequencyHz.toPrecision(6)} Hz</option>)}</select></label>
        {valueFields(override.value, (value) => setOverrides(overrides.map((o, j) => j === i ? { ...o, value } : o)), `覆盖 ${i + 1} `)}
        <button className="button ghost" type="button" onClick={() => setOverrides(overrides.filter((_, j) => j !== i))}>删除覆盖 {i + 1}</button>
      </fieldset>)}
      <button className="button ghost" type="button" disabled={overrides.length >= result.modal!.modes.length} onClick={() => setOverrides([...overrides, { modeNumber: result.modal!.modes.find((m) => !overrides.some((o) => o.modeNumber === m.number))!.number, value: { ratio: NaN, source: "user", basis: "" } }])}>添加逐模态覆盖</button>
      {([['分析频段上限 Hz', upper, setUpper], ['增阶步长', increment, setIncrement], ['模态数预算', budget, setBudget]] as const).map(([label, value, change]) => <label className="field" key={label}><span>{label}</span><input aria-label={label} type="number" step="any" value={value} onChange={(e) => change(e.target.value)} /></label>)}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button primary" type="submit">核对并保存模态阻尼</button>
    </form>
    <div className="load-case-table-scroll"><table aria-label="有效模态阻尼"><thead><tr><th>阶次 / Hz</th><th>阻尼比</th><th>来源 / 依据</th></tr></thead><tbody>{status.modes.map((m) => <tr key={m.number}><td>{m.number} / {m.frequencyHz.toPrecision(6)}</td><td>{m.damping?.ratio ?? "未核对"}</td><td>{m.damping ? `${m.dampingScope === "override" ? "覆盖" : "统一"} · ${m.damping.source === "user" ? "用户输入" : "建议"} · ${m.damping.basis}` : "请设置"}</td></tr>)}</tbody></table></div>
    <p>频段覆盖：{status.truncation.frequencyCoverage === null ? "未设置频段" : status.truncation.frequencyCoverage ? "最高模态频率已覆盖频段（仅筛查）" : "频率覆盖不足，请增阶"}。最高频率 {status.truncation.maximumFrequencyHz.toPrecision(6)} Hz；返回 {status.truncation.returnedModeCount} / 请求 {status.truncation.requestedModeCount} 阶；零能 {status.truncation.zeroEnergyModes} 阶。</p>
    <p>响应精度未验证。{status.truncation.message}</p>
    <details><summary>同一结构的逐步增阶频率检查</summary><div className="load-case-table-scroll"><table aria-label="增阶检查记录"><thead><tr><th>请求 / 返回</th><th>频率加密</th><th>原频率序列变化</th></tr></thead><tbody>{status.truncation.frequencyChecks.map((check) => <tr key={check.analysisId}><td>{check.requestedModeCount} / {check.returnedModeCount}</td><td>{check.frequencyConverged ? "通过" : "未收敛"}</td><td>{check.prefixFrequencyChange === null ? "待增阶比较" : check.prefixFrequencyChange.toExponential(3)}</td></tr>)}</tbody></table></div><p>只比较结构与提取预算相同、数量增加的历史频率序列；不据频率序列确认振型身份或响应精度。参与质量与响应误差尚未评估。</p></details>
    {status.truncation.modeBudgetReached && <p role="status">模态数预算已达，不能据此宣称充分；请调整预算或明确报告截断不足。</p>}
    {status.truncation.nextModeCount !== null && <button className="button ghost" onClick={() => { try { onIncrease(status.truncation.nextModeCount!); setError(undefined); } catch (cause) { setError(cause instanceof Error ? cause.message : "增阶设置失败"); } }}>准备增至 {status.truncation.nextModeCount} 阶</button>}
    <p>增阶仅修改提取设置，请运行分析；新结果须重新核对阻尼。频率加密未收敛或存在零能模态时，请先核查预算、支座及连接。</p>
  </section>;
}
