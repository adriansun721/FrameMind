import type { FrameProject } from "../domain/project";
import { isAnalysisResultCurrent } from "../domain/analysis";
import type { RandomSettings } from "../domain/random-response";

export function RandomSettingsEditor({ project, value: s, onChange }: { project: FrameProject; value: RandomSettings; onChange(value: RandomSettings): void }) {
  const modal = project.analysisResults.filter((r) => r.modal);
  const nodeSelect = (kind: "excitation" | "response", label: string) => <label className="field"><span>{label}</span><select aria-label={label} value={s[kind].nodeId} onChange={(e) => onChange({ ...s, [kind]: { ...s[kind], nodeId: e.target.value } })}><option value="">选择节点</option>{project.nodes.map((n) => <option key={n.id} value={n.id}>{n.id} · {n.label}</option>)}</select></label>;
  return <section className="property-section" aria-label="随机响应设置">
    <p>一个平稳节点随机力源；全局 XYZ 单位方向 × 无量纲空间幅值。响应为节点平移 PSD 与统计 RMS。</p>
    <label className="field"><span>绑定模态结果</span><select aria-label="绑定模态结果" value={s.modalAnalysisId} onChange={(e) => onChange({ ...s, modalAnalysisId: e.target.value })}><option value="">选择并核对模态及阻尼</option>{modal.map((r) => <option key={r.id} value={r.id}>{r.input.analysisCase?.id} · {r.modal!.modes.length} 阶 · {isAnalysisResultCurrent(project, r) ? "当前" : "过期"} · {r.id}</option>)}</select></label>
    <label className="field"><span>随机力输入谱</span><select aria-label="随机力输入谱" value={s.psdSpectrumId} onChange={(e) => { const spectrum = project.psdSpectra.find((p) => p.id === e.target.value); onChange({ ...s, psdSpectrumId: e.target.value, bandHz: spectrum ? [...spectrum.band] : s.bandHz }); }}><option value="">选择力自谱</option>{project.psdSpectra.filter((p) => p.quantity === "force").map((p) => <option key={p.id} value={p.id}>{p.id} · {p.name} · {p.band.join("–")} Hz · kN²/Hz</option>)}</select></label>
    {nodeSelect("excitation", "随机力作用节点")}
    <div className="psd-fields">{(["x", "y", "z"] as const).map((axis) => <label className="field" key={axis}><span>方向 {axis.toUpperCase()}</span><input aria-label={`随机力方向 ${axis}`} type="number" step="any" value={s.excitation.direction[axis]} onChange={(e) => onChange({ ...s, excitation: { ...s.excitation, direction: { ...s.excitation.direction, [axis]: Number(e.target.value) } } })} /></label>)}</div>
    <label className="field"><span>空间幅值（无量纲）</span><input aria-label="随机力空间幅值" type="number" step="any" value={s.excitation.scale} onChange={(e) => onChange({ ...s, excitation: { ...s.excitation, scale: Number(e.target.value) } })} /></label>
    {nodeSelect("response", "随机响应节点")}
    <label className="field"><span>平移响应分量</span><select aria-label="平移响应分量" value={s.response.component} onChange={(e) => onChange({ ...s, response: { ...s.response, component: e.target.value as typeof s.response.component } })}>{["x", "y", "z"].map((axis) => <option key={axis}>{axis}</option>)}</select></label>
    <div className="psd-fields">{([0, 1] as const).map((i) => <label className="field" key={i}><span>响应频段{i ? "上限" : "下限"} Hz</span><input aria-label={`响应频段${i ? "上限" : "下限"} Hz`} type="number" step="any" value={s.bandHz[i]} onChange={(e) => { const bandHz: [number, number] = [...s.bandHz]; bandHz[i] = Number(e.target.value); onChange({ ...s, bandHz }); }} /></label>)}</div>
    <details><summary>频点、积分与模态截断精度</summary><p>梯形积分，加入谱折点与阻尼共振峰附近频点后逐次二分。误差与预算初值是软件建议，可编辑；频段须等于完整输入谱频段。</p>
      {([['frequencyPoints', '初始均匀频点数'], ['maxFrequencyPoints', '最大频点数'], ['maxRefinements', '最大加密轮数'], ['modeIncrement', '截断比较模态步长'], ['relativeTolerance', '随机响应相对误差'], ['absolutePsdTolerance', 'PSD 绝对误差 m²/Hz'], ['absoluteVarianceTolerance', '积分绝对误差 m²'], ['absoluteRmsTolerance', 'RMS 绝对误差 m']] as const).map(([key, label]) => <label className="field" key={key}><span>{label}</span><input aria-label={label} type="number" step="any" value={s[key]} onChange={(e) => onChange({ ...s, [key]: Number(e.target.value) })} /></label>)}
    </details>
  </section>;
}
