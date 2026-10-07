import { useEffect, useRef, useState } from "react";
import { useUnits } from "./UnitPresentation";
import { convertQuantity, unitDimension } from "../domain/units";
import type { FrameProject } from "../domain/project";
import { parsePsdNumber } from "../domain/psd";
import { isAnalysisResultCurrent } from "../domain/analysis";
import { randomSourceQuantity, randomSources, type RandomAction, type RandomSource, type DistributedRandomSettings, type RandomSettings } from "../domain/random-response";

function RandomNumericInput({ value, onChange, unit, ...props }: { value: number; unit?: string; onChange(value: number): void; "aria-label": string }) {
  const u = useUnits(), displayedUnit = unit ? u.unit(unit) : undefined;
  const displayed = unit && Number.isFinite(value) ? u.value(value, unit) : value;
  const [text, setText] = useState(String(displayed)), last = useRef(displayed);
  useEffect(() => {
    if (!Object.is(displayed, last.current)) { last.current = displayed; setText(Number.isFinite(displayed) ? String(displayed) : ""); }
  }, [displayed]);
  return <input {...props} type="text" inputMode="decimal" value={text} onChange={(e) => {
    const next = e.target.value; setText(next);
    let parsed: number;
    try { parsed = parsePsdNumber(next); } catch { parsed = Number.NaN; }
    last.current = parsed;
    try { onChange(unit && Number.isFinite(parsed) ? convertQuantity(parsed, unitDimension(unit), displayedUnit!, unit) : parsed); } catch { onChange(Number.NaN); }
  }} />;
}

export function RandomSettingsEditor({ project, value: s, onChange }: { project: FrameProject; value: RandomSettings; onChange(value: RandomSettings): void }) {
  const modal = project.analysisResults.filter((r) => r.modal);
  const nodeSelect = (kind: "response", label: string) => <label className="field"><span>{label}</span><select aria-label={label} value={s[kind].nodeId} onChange={(e) => onChange({ ...s, [kind]: { ...s[kind], nodeId: e.target.value } })}><option value="">选择节点</option>{project.nodes.map((n) => <option key={n.id} value={n.id}>{n.id} · {n.label}</option>)}</select></label>;
  return <section className="property-section" aria-label="随机响应设置">
    <p>同源作用共享随机过程；不同源相互独立，PSD 相加后求统计 RMS。整体基底使用加速度谱，所有支承须约束每个非零平动方向并共享运动。基底与外力须为独立源。含基底激励时输出为全局 XYZ 相对基底节点平移，纯外力使用固定全局参考系；不支持差动支座或转动基底。</p>
    <label className="field"><span>绑定模态结果</span><select aria-label="绑定模态结果" value={s.modalAnalysisId} onChange={(e) => onChange({ ...s, modalAnalysisId: e.target.value })}><option value="">选择并核对模态及阻尼</option>{modal.map((r) => <option key={r.id} value={r.id}>{r.input.analysisCase?.id} · {r.modal!.modes.length} 阶 · {isAnalysisResultCurrent(project, r) ? "当前" : "过期"} · {r.id}</option>)}</select></label>
    {"excitation" in s ? <>
    <label className="field"><span>随机力输入谱</span><select aria-label="随机力输入谱" value={s.psdSpectrumId} onChange={(e) => { const spectrum = project.psdSpectra.find((p) => p.id === e.target.value); onChange({ ...s, psdSpectrumId: e.target.value, bandHz: spectrum ? [...spectrum.band] : s.bandHz }); }}><option value="">选择力自谱</option>{project.psdSpectra.filter((p) => p.quantity === "force").map((p) => <option key={p.id} value={p.id}>{p.id} · {p.name} · {p.band.join("–")} Hz · kN²/Hz</option>)}</select></label>
    <label className="field"><span>随机力作用节点</span><select aria-label="随机力作用节点" value={s.excitation.nodeId} onChange={(e) => onChange({ ...s, excitation: { ...s.excitation, nodeId: e.target.value } })}><option value="">选择节点</option>{project.nodes.map((n) => <option key={n.id} value={n.id}>{n.id} · {n.label}</option>)}</select></label>
    <div className="psd-fields">{(["x", "y", "z"] as const).map((axis) => <label className="field" key={axis}><span>方向 {axis.toUpperCase()}</span><RandomNumericInput aria-label={`随机力方向 ${axis}`} value={s.excitation.direction[axis]} onChange={(number) => onChange({ ...s, excitation: { ...s.excitation, direction: { ...s.excitation.direction, [axis]: number } } })} /></label>)}</div>
    <label className="field"><span>空间幅值（无量纲）</span><RandomNumericInput aria-label="随机力空间幅值" value={s.excitation.scale} onChange={(number) => onChange({ ...s, excitation: { ...s.excitation, scale: number } })} /></label>
      <button type="button" className="button ghost" onClick={() => { const { excitation: _excitation, psdSpectrumId: _spectrum, ...base } = s; onChange({ ...base, sourceRelationship: "independent", sources: randomSources(s).map((source) => ({ ...source, sourceId: "RS1" })) }); }}>编辑空间分布与独立源</button>
    </> : <RandomSourcesEditor project={project} value={s} onChange={onChange} />}
    {nodeSelect("response", "随机响应节点")}
    <label className="field"><span>平移响应分量</span><select aria-label="平移响应分量" value={s.response.component} onChange={(e) => onChange({ ...s, response: { ...s.response, component: e.target.value as typeof s.response.component } })}>{["x", "y", "z"].map((axis) => <option key={axis}>{axis}</option>)}</select></label>
    <div className="psd-fields">{([0, 1] as const).map((i) => <label className="field" key={i}><span>响应频段{i ? "上限" : "下限"} Hz</span><RandomNumericInput aria-label={`响应频段${i ? "上限" : "下限"} Hz`} value={s.bandHz[i]} onChange={(number) => { const bandHz: [number, number] = [...s.bandHz]; bandHz[i] = number; onChange({ ...s, bandHz }); }} /></label>)}</div>
    <details><summary>频点、积分与模态截断精度</summary><p>梯形积分，加入谱折点与阻尼共振峰附近频点后逐次二分。误差与预算初值是软件建议，可编辑；频段须等于完整输入谱频段。</p>
      {([['frequencyPoints', '初始均匀频点数'], ['maxFrequencyPoints', '最大频点数'], ['maxRefinements', '最大加密轮数'], ['modeIncrement', '截断比较模态步长'], ['relativeTolerance', '随机响应相对误差'], ['absolutePsdTolerance', 'PSD 绝对误差 m²/Hz'], ['absoluteVarianceTolerance', '积分绝对误差 m²'], ['absoluteRmsTolerance', 'RMS 绝对误差 m']] as const).map(([key, label]) => <label className="field" key={key}><span>{label}</span><RandomNumericInput aria-label={label} value={s[key]} onChange={(number) => onChange({ ...s, [key]: number })} /></label>)}
    </details>
  </section>;
}

function RandomSourcesEditor({ project, value: s, onChange }: { project: FrameProject; value: DistributedRandomSettings; onChange(value: DistributedRandomSettings): void }) {
  const u = useUnits();
  const update = (index: number, source: RandomSource) => onChange({ ...s, sources: s.sources.map((item, i) => i === index ? source : item) });
  const total = s.sources.reduce((sum, source) => sum + source.actions.length, 0);
  return <div aria-label="随机空间源编辑器">
    <p>源间关系：相互独立。同一源内完全同源；负系数表示反向，不接受互谱、部分相关或相位。最多 16 个源、128 项作用。各源须有相同完整频段。</p>
    {s.sources.map((source, index) => <fieldset key={index} aria-label={'随机源 ' + (index + 1)}><legend>随机源 {index + 1}</legend>
      <label className="field"><span>源身份</span><input aria-label={'源 ' + (index + 1) + ' 身份'} value={source.sourceId} onChange={(e) => update(index, { ...source, sourceId: e.target.value })} /></label>
      <label className="field"><span>{randomSourceQuantity(source) === "acceleration" ? "加速度自谱 (m/s²)²/Hz" : "力自谱 kN²/Hz"}（规范存储）</span><select aria-label={'源 ' + (index + 1) + ' 输入谱'} value={source.psdSpectrumId} onChange={(e) => { const spectrum = project.psdSpectra.find((p) => p.id === e.target.value); onChange({ ...s, bandHz: index === 0 && spectrum ? [...spectrum.band] : s.bandHz, sources: s.sources.map((item, i) => i === index ? { ...source, psdSpectrumId: e.target.value } : item) }); }}><option value="">选择对应自谱</option>{project.psdSpectra.filter((p) => p.quantity === randomSourceQuantity(source)).map((p) => <option key={p.id} value={p.id}>{p.id} · {p.name} · {p.band.join("–")} Hz</option>)}</select></label>
      {source.actions.map((action, actionIndex) => {
        const label = '源 ' + (index + 1) + ' 作用 ' + (actionIndex + 1);
        const change = (next: RandomAction) => update(index, { ...source, actions: source.actions.map((a, i) => i === actionIndex ? next : a) });
        return <div className="condition-entry" key={actionIndex} aria-label={label}>
          <label className="field"><span>作用范围</span><select aria-label={label + ' 类型'} value={action.kind} onChange={(e) => change(e.target.value === "base-translation" ? { kind: "base-translation", direction: action.direction, scale: 1 } : e.target.value === "node" ? { kind: "node", nodeId: project.nodes[0]?.id ?? "", direction: action.direction, scale: 1 } : { kind: "member-uniform", memberId: project.members[0]?.id ?? "", direction: action.direction, scalePerM: 1 })}><option value="node">节点力</option><option value="member-uniform">整杆均布力</option><option value="base-translation">整体一致平动基底</option></select></label>
          {action.kind === "base-translation" ? <p>适用支承：{project.supports.map((support) => support.nodeId).join(", ")} · 全部共享运动 · 相对基底响应</p> : <label className="field"><span>工程对象</span><select aria-label={label + ' 对象'} value={action.kind === "node" ? action.nodeId : action.memberId} onChange={(e) => change(action.kind === "node" ? { ...action, nodeId: e.target.value } : { ...action, memberId: e.target.value })}><option value="">选择对象</option>{(action.kind === "node" ? project.nodes : project.members).map((item) => <option key={item.id} value={item.id}>{item.id} · {item.label}</option>)}</select></label>}
          <div className="psd-fields">{(["x", "y", "z"] as const).map((axis) => <label className="field" key={axis}><span>全局方向 {axis}</span><RandomNumericInput aria-label={label + ' 方向 ' + axis} value={action.direction[axis]} onChange={(number) => change({ ...action, direction: { ...action.direction, [axis]: number } })} /></label>)}</div>
          <label className="field"><span>有符号空间系数（{action.kind === "member-uniform" ? u.unit("1/m") : "无量纲"}）</span><RandomNumericInput aria-label={label + ' 空间系数'} unit={action.kind === "member-uniform" ? "1/m" : undefined} value={action.kind === "member-uniform" ? action.scalePerM : action.scale} onChange={(number) => change(action.kind === "member-uniform" ? { ...action, scalePerM: number } : { ...action, scale: number })} /></label>
          <button type="button" className="button ghost" disabled={source.actions.length === 1} onClick={() => update(index, { ...source, actions: source.actions.filter((_, i) => i !== actionIndex) })}>移除 {label}</button>
        </div>;
      })}
      <button type="button" className="button ghost" disabled={total >= 128} onClick={() => update(index, { ...source, actions: [...source.actions, source.actions[0].kind === "base-translation" ? { kind: "base-translation", direction: { x: 0, y: 0, z: 1 }, scale: 1 } : { kind: "node", nodeId: project.nodes[0]?.id ?? "", direction: { x: 0, y: 0, z: 1 }, scale: 1 }] })}>添加同源作用 {index + 1}</button>
      <button type="button" className="button ghost" disabled={s.sources.length === 1} onClick={() => onChange({ ...s, sources: s.sources.filter((_, i) => i !== index) })}>移除随机源 {index + 1}</button>
    </fieldset>)}
    <button type="button" className="button ghost" disabled={s.sources.length >= 16 || total >= 128} onClick={() => { let i = 1; while (s.sources.some((source) => source.sourceId === 'RS' + i)) i++; onChange({ ...s, sources: [...s.sources, { sourceId: 'RS' + i, psdSpectrumId: s.sources[0].psdSpectrumId, actions: [{ kind: "node", nodeId: project.nodes[0]?.id ?? "", direction: { x: 0, y: 0, z: 1 }, scale: 1 }] }] }); }}>添加独立随机源</button>
  </div>;
}
