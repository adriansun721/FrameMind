import type { FrameProject, MemberId, Vector3 } from "../domain/project";
import type { LoadStage } from "../workspace/load-stage";

const AXES = ["x", "y", "z"] as const;
type VectorDraft = Record<typeof AXES[number], string>;
const vectorDraft = (v: Vector3): VectorDraft => ({ x: String(v.x), y: String(v.y), z: String(v.z) });
type UniformDraft = Omit<NonNullable<LoadStage["uniformLoads"]>[number], "intensity"> & { intensity: VectorDraft };
type WeightDraft = Omit<NonNullable<LoadStage["selfWeight"]>, "gravity"> & { gravity: VectorDraft };
type CombinationDraft = Omit<NonNullable<LoadStage["loadCombinations"]>[number], "terms"> & { terms: { loadCaseId: string; factor: string }[] };
export interface LoadStageDraft extends Omit<LoadStage, "uniformLoads" | "selfWeight" | "loadCombinations"> {
  uniformLoads?: UniformDraft[]; selfWeight?: WeightDraft; loadCombinations?: CombinationDraft[];
}
export function loadStageDraft(stage: LoadStage): LoadStageDraft {
  return { loadCases: stage.loadCases,
    uniformLoads: stage.uniformLoads?.map((l) => ({ ...l, intensity: vectorDraft(l.intensity) })),
    selfWeight: stage.selfWeight && { ...stage.selfWeight, gravity: vectorDraft(stage.selfWeight.gravity) },
    loadCombinations: stage.loadCombinations?.map((c) => ({ ...c, terms: c.terms.map((t) => ({ ...t, factor: String(t.factor) })) })),
  };
}
function number(value: string): number {
  if (!value.trim() || !Number.isFinite(Number(value))) throw new Error("荷载、重力与组合系数必须填写有限数值");
  return Number(value);
}
function vector(v: VectorDraft): Vector3 { return { x: number(v.x), y: number(v.y), z: number(v.z) }; }
export function readLoadStageDraft(draft: LoadStageDraft): LoadStage {
  return { loadCases: draft.loadCases,
    uniformLoads: draft.uniformLoads?.map((l) => ({ ...l, intensity: vector(l.intensity) })),
    selfWeight: draft.selfWeight && { ...draft.selfWeight, gravity: vector(draft.selfWeight.gravity) },
    loadCombinations: draft.loadCombinations?.map((c) => ({ ...c, terms: c.terms.map((t) => ({ ...t, factor: number(t.factor) })) })),
  };
}
export function loadStageOptions(project: FrameProject, draft: LoadStageDraft) {
  const cases = project.loadCases.map((c) => ({ value: c.id, label: `${c.id} · ${draft.loadCases?.find((d) => d.id === c.id)?.name ?? c.name}` }));
  for (const c of draft.loadCases ?? []) if (!c.id) cases.push({ value: c.ref, label: `${c.name || "未命名工况"} · 待创建` });
  const combos = project.loadCombinations.map((c) => ({ value: c.id, label: `${c.id} · ${draft.loadCombinations?.find((d) => d.id === c.id)?.name ?? c.name}（用户自定义组合）` }));
  for (const c of draft.loadCombinations ?? []) if (!c.id) combos.push({ value: c.ref, label: `${c.name || "未命名组合"} · 待创建（用户自定义）` });
  // Updated objects may be referenced by their draft alias as well as their stable identity.
  for (const c of draft.loadCases ?? []) if (c.id && c.ref !== c.id) cases.push({ value: c.ref, label: `${c.id} · ${c.name}` });
  for (const c of draft.loadCombinations ?? []) if (c.id && c.ref !== c.id) combos.push({ value: c.ref, label: `${c.id} · ${c.name}（用户自定义组合）` });
  return { cases, sources: [...cases, ...combos] };
}
const provenance = (source: "user" | "suggestion") => source === "user" ? "用户提供" : "建议 · 待确认";

export function LoadStageFields({ project, draft, busy, onChange }: { project: FrameProject; draft: LoadStageDraft; busy: boolean; onChange(draft: LoadStageDraft): void }) {
  const { cases } = loadStageOptions(project, draft);
  const options = cases.map((c) => <option key={c.value} value={c.value}>{c.label}</option>);
  const caseSelect = (label: string, value: string, change: (value: string) => void) => <label>工况<select aria-label={label} value={value} onChange={(e) => change(e.target.value)}><option value="">请选择工况</option>{options}</select></label>;
  const vectors = (label: string, v: VectorDraft, unit: string, change: (v: VectorDraft) => void) => <div className="condition-vectors">{AXES.map((axis) => <label key={axis}>{axis.toUpperCase()} ({unit})<input aria-label={`${label} ${axis.toUpperCase()} (${unit})`} value={v[axis]} onChange={(e) => change({ ...v, [axis]: e.target.value })} /></label>)}</div>;
  const updateUniform = (index: number, patch: Partial<UniformDraft>) => onChange({ ...draft, uniformLoads: draft.uniformLoads!.map((l, i) => i === index ? { ...l, ...patch, source: "user" } : l) });
  const updateCase = (index: number, patch: Partial<NonNullable<LoadStageDraft["loadCases"]>[number]>) => onChange({ ...draft, loadCases: draft.loadCases!.map((c, i) => i === index ? { ...c, ...patch, source: "user" } : c) });
  const updateCombo = (index: number, patch: Partial<CombinationDraft>) => onChange({ ...draft, loadCombinations: draft.loadCombinations!.map((c, i) => i === index ? { ...c, ...patch, source: "user" } : c) });
  const updateWeight = (patch: Partial<WeightDraft>) => onChange({ ...draft, selfWeight: { ...draft.selfWeight!, ...patch, source: "user" } });
  const firstCase = cases[0]?.value ?? "";
  return <>
    <fieldset disabled={busy}><legend>荷载工况</legend>
      <p>已有工况：{project.loadCases.map((c) => `${c.id} · ${c.name}`).join("；")}。省略本组保留已有工况。</p>
      {draft.loadCases?.map((c, index) => <div className="condition-entry" key={index}>
        <strong>{c.id ? `修改 ${c.id}` : `新增工况 ${index + 1}`} · {provenance(c.source)}</strong>
        <label>名称<input aria-label={`工况 ${index + 1} 名称`} value={c.name} onChange={(e) => updateCase(index, { name: e.target.value })} /></label>
        <label>说明<input aria-label={`工况 ${index + 1} 说明`} value={c.description} onChange={(e) => updateCase(index, { description: e.target.value })} /></label>
        {c.id && <p>原工况：{project.loadCases.find((item) => item.id === c.id)?.name} · {project.loadCases.find((item) => item.id === c.id)?.description}</p>}
        <button type="button" onClick={() => onChange({ ...draft, loadCases: draft.loadCases!.filter((_, i) => i !== index) })}>移除工况条目 {index + 1}</button>
      </div>)}
      <button type="button" onClick={() => onChange({ ...draft, loadCases: [...(draft.loadCases ?? []), { ref: `case_${crypto.randomUUID()}`, name: "", description: "", source: "user" }] })}>添加工况条目</button>
    </fieldset>
    <fieldset disabled={busy}><legend>杆件均布荷载</legend><p>整根杆件 · 全局 XYZ 或杆件局部 xyz · kN/m。省略本组保留已有荷载。</p>
      {draft.uniformLoads?.map((l, index) => <div className="condition-entry" key={index}>
        <strong>{l.id ? `修改 ${l.id}` : `新增均布荷载 ${index + 1}`} · {provenance(l.source)}</strong>
        <label>杆件<select aria-label={`均布荷载 ${index + 1} 杆件`} value={l.memberId} onChange={(e) => updateUniform(index, { memberId: e.target.value as MemberId })}><option value="">请选择杆件</option>{project.members.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.id}</option>)}</select></label>
        <label>方向坐标系<select aria-label={`均布荷载 ${index + 1} 坐标系`} value={l.coordinateSystem} onChange={(e) => updateUniform(index, { coordinateSystem: e.target.value as UniformDraft["coordinateSystem"] })}><option value="global">全局 XYZ</option><option value="local">杆件局部 xyz</option></select></label>
        {caseSelect(`均布荷载 ${index + 1} 工况`, l.loadCaseId, (loadCaseId) => updateUniform(index, { loadCaseId }))}
        {vectors(`均布荷载 ${index + 1}`, l.intensity, "kN/m", (intensity) => updateUniform(index, { intensity }))}
        {l.id && <p>原均布荷载：{JSON.stringify(project.uniformLoads.find((item) => item.id === l.id))}</p>}
        <button type="button" onClick={() => onChange({ ...draft, uniformLoads: draft.uniformLoads!.filter((_, i) => i !== index) })}>移除均布荷载条目 {index + 1}</button>
      </div>)}
      <button type="button" onClick={() => onChange({ ...draft, uniformLoads: [...(draft.uniformLoads ?? []), { memberId: (project.members[0]?.id ?? "") as MemberId, loadCaseId: firstCase, coordinateSystem: "global", intensity: { x: "0", y: "0", z: "0" }, source: "user" }] })}>添加均布荷载条目</button>
    </fieldset>
    <fieldset disabled={busy}><legend>结构自重</legend>
      <p>已确认：{project.selfWeight.enabled ? "启用" : "关闭"} · {project.selfWeight.loadCaseId} · g=({project.selfWeight.gravity.x}, {project.selfWeight.gravity.y}, {project.selfWeight.gravity.z}) m/s²。全结构只计入指定的一个工况。</p>
      {draft.selfWeight ? <div className="condition-entry"><strong>{provenance(draft.selfWeight.source)}</strong>
        <label><input type="checkbox" aria-label="卡片启用结构自重" checked={draft.selfWeight.enabled} onChange={(e) => updateWeight({ enabled: e.target.checked })} />启用结构自重</label>
        {caseSelect("自重工况", draft.selfWeight.loadCaseId, (loadCaseId) => updateWeight({ loadCaseId }))}
        {vectors("重力", draft.selfWeight.gravity, "m/s²", (gravity) => updateWeight({ gravity }))}
        <details className="self-weight-references"><summary>材料密度与截面面积</summary><ul>{project.members.map((m) => <li key={m.id}>{m.label} · ρ={project.materials.find((v) => v.id === m.materialId)?.densityKgM3 ?? "缺失"} kg/m³ · A={project.sections.find((v) => v.id === m.sectionId)?.areaM2 ?? "缺失"} m²</li>)}</ul></details>
        <button type="button" onClick={() => onChange({ ...draft, selfWeight: undefined })}>本阶段不修改自重</button>
      </div> : <button type="button" onClick={() => onChange({ ...draft, selfWeight: { ...project.selfWeight, gravity: vectorDraft(project.selfWeight.gravity), source: "user" } })}>编辑自重条目</button>}
    </fieldset>
    <fieldset disabled={busy}><legend>用户自定义组合</legend><p>线弹性 · 系数无量纲，允许零和负数。组合依据由用户指定。</p>
      {draft.loadCombinations?.map((c, index) => <div className="condition-entry" key={index}>
        <strong>{c.id ? `修改 ${c.id}` : `新增组合 ${index + 1}`} · {provenance(c.source)}</strong>
        <label>名称<input aria-label={`组合 ${index + 1} 名称`} value={c.name} onChange={(e) => updateCombo(index, { name: e.target.value })} /></label>
        {c.terms.map((t, termIndex) => <div className="condition-term" key={termIndex}>
          {caseSelect(`组合 ${index + 1} 项 ${termIndex + 1} 工况`, t.loadCaseId, (loadCaseId) => updateCombo(index, { terms: c.terms.map((v, i) => i === termIndex ? { ...v, loadCaseId } : v) }))}
          <label>系数<input aria-label={`组合 ${index + 1} 项 ${termIndex + 1} 系数`} value={t.factor} onChange={(e) => updateCombo(index, { terms: c.terms.map((v, i) => i === termIndex ? { ...v, factor: e.target.value } : v) })} /></label>
          <button type="button" onClick={() => updateCombo(index, { terms: c.terms.filter((_, i) => i !== termIndex) })}>移除组合 {index + 1} 项 {termIndex + 1}</button>
        </div>)}
        {c.id && <p>原组合：{JSON.stringify(project.loadCombinations.find((item) => item.id === c.id))}</p>}
        <button type="button" onClick={() => updateCombo(index, { terms: [...c.terms, { loadCaseId: firstCase, factor: "1" }] })}>添加组合 {index + 1} 项</button>
        <button type="button" onClick={() => onChange({ ...draft, loadCombinations: draft.loadCombinations!.filter((_, i) => i !== index) })}>移除组合条目 {index + 1}</button>
      </div>)}
      <button type="button" onClick={() => onChange({ ...draft, loadCombinations: [...(draft.loadCombinations ?? []), { ref: `combination_${crypto.randomUUID()}`, name: "", terms: [{ loadCaseId: firstCase, factor: "1" }], source: "user" }] })}>添加自定义组合条目</button>
    </fieldset>
  </>;
}
