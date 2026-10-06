import { useState } from "react";
import { SECTION_DIMENSIONS, SECTION_SHAPES, SECTION_SHAPE_FIELDS, sectionMechanicalProperties, type SectionGeometry } from "../domain/section-geometry";
import { validateSection, type FrameProject, type SectionInput, type SectionId, type MemberId } from "../domain/project";
import { applyProjectEdits, type ProjectEditOperation } from "../domain/project-operations";
import { ModelEditConfirmation, prepareModelEditConfirmation, proposeModelEdits } from "../workspace/model-edits";
import { UnitInput, useUnits } from "./UnitPresentation";
import { SectionEditImpact } from "./SectionEditImpact";
import { SECTION_CATALOG, getSectionCatalogEntry } from "../domain/resource-library";
import { SectionBasisView } from "./SectionBasisView";

const propertyFields = { areaM2: "面积 A", secondMomentYM4: "惯性矩 Iy", secondMomentZM4: "惯性矩 Iz", torsionalConstantM4: "扭转常数 J" };
const defaults = { width: ".2", height: ".4", diameter: ".2", thickness: ".01", webThickness: ".01", flangeThickness: ".02",
  areaM2: ".01", secondMomentYM4: ".0001", secondMomentZM4: ".0001", torsionalConstantM4: ".0001" };
const numericDraft = (value: object) => Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === "number").map(([k, v]) => [k, String(v)]));
const sectionDraft = (input?: SectionInput) => ({ ...defaults, ...numericDraft(input ?? {}), ...numericDraft(input?.geometry ?? {}) });
export function ParametricSectionEditor({ project, initialSectionId, initialInput, onCommit, onClose }: {
  project: FrameProject; initialSectionId?: string; initialInput?: SectionInput; onCommit(project: FrameProject): void; onClose(): void;
}) {
  const u = useUnits();
  const initial = initialInput ?? project.sections.find((s) => s.id === initialSectionId);
  const initialCatalogBasis = initial && "catalogBasis" in initial ? initial.catalogBasis : undefined;
  const [mode, setMode] = useState<"create" | "update" | "duplicate" | "assign">(initialSectionId ? "update" : "create");
  const [id, setId] = useState(initialSectionId ?? project.sections[0]?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "新参数截面");
  const [shape, setShape] = useState<SectionGeometry["shape"] | "properties" | "catalog">(initial ? initialCatalogBasis ? "catalog" : initial.geometry?.shape ?? "properties" : "rectangle");
  const [catalogId, setCatalogId] = useState(initialCatalogBasis?.catalogId ?? SECTION_CATALOG[0].catalogId);
  const [values, setValues] = useState<Record<string, string>>(sectionDraft(initial));
  const [targets, setTargets] = useState<string[]>([]); const [angle, setAngle] = useState("0"); const [angleEnabled, enableAngle] = useState(false);
  const [preview, setPreview] = useState<ReturnType<typeof prepareModelEditConfirmation> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const edit = () => { setPreview(null); setError(null); };
  const load = (sectionId: string) => {
    setId(sectionId); const s = project.sections.find((s) => s.id === sectionId); if (!s) return;
    setName(s.name); setShape(s.catalogBasis ? "catalog" : s.geometry?.shape ?? "properties"); setCatalogId(s.catalogBasis?.catalogId ?? SECTION_CATALOG[0].catalogId);
    setValues(sectionDraft(s));
  };
  const numeric = (key: string) => { if (!values[key]?.trim() || !Number.isFinite(Number(values[key]))) throw new Error("尺寸及参数必须为有限数值"); return Number(values[key]); };
  const changeShape = (next: typeof shape) => {
    edit();
    try {
      if (next === "catalog") {
        const saved = project.sections.find((s) => s.id === id);
        setValues(sectionDraft(saved?.catalogBasis?.catalogId === catalogId ? saved : getSectionCatalogEntry(catalogId)));
      }
      if (next === "properties" && shape === "catalog") {
        const s = project.sections.find((s) => s.id === id);
        setValues(sectionDraft(s?.catalogBasis?.catalogId === catalogId ? s : getSectionCatalogEntry(catalogId)));
      } else if (next === "properties" && shape !== "properties" && shape !== "catalog") {
        const geometry = { shape, ...Object.fromEntries(SECTION_SHAPE_FIELDS[shape].map((key) => [key, numeric(key)])) };
        setValues({ ...values, ...numericDraft(sectionMechanicalProperties(geometry)) });
      }
      setShape(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "截面尺寸无效"); }
  };
  const review = () => {
    try {
      const operations: ProjectEditOperation[] = [];
      if (mode === "create" || mode === "update") {
        const saved = project.sections.find((s) => s.id === id);
        const properties = shape === "catalog" ? validateSection("草案", { ...(saved?.catalogBasis?.catalogId === catalogId ? saved : getSectionCatalogEntry(catalogId)!), name })
          : shape === "properties" ? { name, ...Object.fromEntries(Object.keys(propertyFields).map((k) => [k, numeric(k)])) } as SectionInput
          : { name, geometry: { shape, ...Object.fromEntries(SECTION_SHAPE_FIELDS[shape].map((k) => [k, numeric(k)])) } as SectionGeometry };
        operations.push(mode === "create" ? { type: "create_section", properties } : { type: "update_section", id: id as SectionId, properties });
      } else if (mode === "duplicate") operations.push({ type: "duplicate_section", id: id as SectionId });
      if (targets.length || mode === "assign") {
        const sectionId = mode === "create" || mode === "duplicate" ? applyProjectEdits(project, operations).project.sections.at(-1)!.id : id as SectionId;
        if (angleEnabled && (!angle.trim() || !Number.isFinite(Number(angle)))) throw new Error("截面转角必须为有限数值");
        operations.push({ type: "assign_section", id: sectionId, memberIds: targets as MemberId[], ...(angleEnabled ? { rotationDegrees: Number(angle) } : {}) });
      }
      setPreview(prepareModelEditConfirmation(project, proposeModelEdits(project, { operations }))); setError(null);
    } catch (e) { setPreview(null); setError(e instanceof Error ? e.message : "截面草案无效"); }
  };
  return <div className="dialog-backdrop"><section className="node-dialog wide-dialog section-editor" role="dialog" aria-modal="true" aria-label="参数化截面管理">
    <header><h2>参数化截面管理</h2><button className="icon-button" aria-label="关闭截面管理" onClick={onClose}>×</button></header>
    <p className="dialog-copy">按几何尺寸计算 A / Iy / Iz / J，或保留标准目录参数。先核对共享影响与朝向，再成组确认。</p>
    <div className="dialog-form">
      <label className="field"><span>操作</span><select aria-label="截面操作" value={mode} onChange={(e) => { edit(); setMode(e.target.value as typeof mode); if (e.target.value !== "create") load(id); }}>
        <option value="create">创建截面</option><option value="update" disabled={!project.sections.length}>编辑共享截面</option><option value="duplicate" disabled={!project.sections.length}>复制截面</option><option value="assign" disabled={!project.sections.length}>批量指派</option>
      </select></label>
      {mode !== "create" && <label className="field"><span>项目截面</span><select aria-label="项目截面" value={id} onChange={(e) => { edit(); load(e.target.value); }}>{project.sections.map((s) => <option key={s.id} value={s.id}>{s.label} · {s.name}</option>)}</select></label>}
      {(mode === "create" || mode === "update") && <>
        <label className="field"><span>截面名称</span><input aria-label="截面名称" value={name} onChange={(e) => { edit(); setName(e.target.value); }} /></label>
        <label className="field"><span>截面形状</span><select aria-label="截面形状" value={shape} onChange={(e) => changeShape(e.target.value as typeof shape)}><option value="properties">仅力学属性（几何未定义）</option><option value="catalog">标准目录（保留目录参数）</option>{Object.entries(SECTION_SHAPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {shape === "catalog" && <><label className="field"><span>标准截面</span><select aria-label="标准截面" value={catalogId} onChange={(e) => { edit(); setCatalogId(e.target.value); const s = getSectionCatalogEntry(e.target.value)!; setValues(sectionDraft(s)); setName(s.name); }}>{SECTION_CATALOG.map((s) => <option key={s.catalogId} value={s.catalogId}>{s.name}</option>)}</select></label><SectionBasisView section={project.sections.find((s) => s.id === id && s.catalogBasis?.catalogId === catalogId) ?? getSectionCatalogEntry(catalogId)!} /><p>选择尺寸形状会改用理想化公式；选择仅力学属性可修改参数并移除几何。均需重新预览确认。</p></>}
        {(shape === "catalog" ? [] : shape === "properties" ? Object.entries(propertyFields) : SECTION_SHAPE_FIELDS[shape].map((k) => [k, SECTION_DIMENSIONS[k]])).map(([key, label]) => {
          const unit = shape === "properties" ? key === "areaM2" ? "m²" : "m⁴" : "m";
          return <label className="field" key={key}><span>{label}</span><div><UnitInput aria-label={label} value={values[key]} unit={unit} onValueChange={(v) => { edit(); setValues({ ...values, [key]: v }); }} /><em>{u.unit(unit)}</em></div></label>;
        })}
      </>}
      <details><summary>指派范围与转角 · {targets.length} 根杆件</summary>
        {project.members.map((m) => <label className="check-field" key={m.id}><input type="checkbox" aria-label={`指派 ${m.id}`} checked={targets.includes(m.id)} onChange={(e) => { edit(); setTargets(e.target.checked ? [...targets, m.id] : targets.filter((id) => id !== m.id)); }} />{m.label} · {m.id}</label>)}
        <label className="check-field"><input type="checkbox" aria-label="设置指派转角" checked={angleEnabled} onChange={(e) => { edit(); enableAngle(e.target.checked); }} />同时设置转角（否则保留原朝向）</label>
        {angleEnabled && <label className="field"><span>截面转角</span><UnitInput unit="°" aria-label="指派截面转角" value={angle} onValueChange={(v) => { edit(); setAngle(v); }} /></label>}
      </details>
      <button className="button" onClick={review}>预览截面影响</button>
      {preview && <SectionEditImpact project={preview.baseProject} receipt={preview.proposal.preview} />}
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="dialog-actions"><button className="button" onClick={onClose}>取消</button><button className="button primary" disabled={!preview || preview.baseProject !== project} onClick={() => {
        if (!preview) return; const outcome = new ModelEditConfirmation().confirm(project, preview);
        if (outcome.result.status === "applied") { onCommit(outcome.project); onClose(); } else setError(outcome.result.message);
      }}>确认截面变更</button></div>
    </div>
  </section></div>;
}
