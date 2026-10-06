import type { BucklingSettings } from "../domain/buckling";
import type { FrameProject } from "../domain/project";

export function BucklingSettingsEditor({ project, value, onChange }: { project: FrameProject; value: BucklingSettings; onChange(value: BucklingSettings): void }) {
  return <>
    <p>固定预荷载 + λ × 参考荷载。λ 只放大参考部分，固定部分可为零。荷载方向在荷载定义中编辑；此处指定来源和系数。</p>
    {(["fixed", "reference"] as const).map((role) => <fieldset key={role}><legend>{role === "fixed" ? "固定预荷载" : "参考荷载"}</legend>
      {value[role].length === 0 && <p>固定预荷载为零</p>}
      {value[role].map((term, index) => <div className="load-case-actions" key={index}>
        <label className="field"><span>荷载来源</span><select aria-label={`${role === "fixed" ? "固定" : "参考"}荷载来源 ${index + 1}`} value={term.loadCaseId} onChange={(e) => onChange({ ...value, [role]: value[role].map((t, i) => i === index ? { ...t, loadCaseId: e.target.value } : t) })}>{project.loadCases.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.name}</option>)}</select></label>
        <label className="field"><span>系数</span><input type="number" step="any" aria-label={`${role === "fixed" ? "固定" : "参考"}荷载系数 ${index + 1}`} value={term.factor} onChange={(e) => onChange({ ...value, [role]: value[role].map((t, i) => i === index ? { ...t, factor: Number(e.target.value) } : t) })} /></label>
        <button type="button" className="button ghost" onClick={() => onChange({ ...value, [role]: value[role].filter((_, i) => i !== index) })}>移除{role === "fixed" ? "固定" : "参考"}项 {index + 1}</button>
      </div>)}
      <button type="button" className="button ghost" onClick={() => onChange({ ...value, [role]: [...value[role], { loadCaseId: project.loadCases.find((c) => !value[role].some((t) => t.loadCaseId === c.id))?.id ?? project.activeLoadCaseId, factor: 1 }] })}>添加{role === "fixed" ? "固定预荷载" : "参考荷载"}</button>
    </fieldset>)}
    {([['modeCount', '提取屈曲阶数'], ['maxEquations', '屈曲最大方程数'], ['factorTolerance', '因子细分相对误差']] as const).map(([key, label]) => <label className="field" key={key}><span>{label}</span><input aria-label={label} type="number" step="any" value={value[key]} onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })} /></label>)}
    <label className="field"><span>屈曲每杆最大单元</span><select aria-label="屈曲每杆最大单元" value={value.maxDivisions} onChange={(e) => onChange({ ...value, maxDivisions: Number(e.target.value) })}>{[1, 2, 4, 8, 16].map((n) => <option key={n}>{n}</option>)}</select></label>
    <p>稳定线弹性基态 · 轴力几何刚度 · 倒数对称特征值法。不包括随动力、扭转预应力、塑性或后屈曲。</p>
  </>;
}
