import { useState } from "react";
import { CopyPlus, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { MATERIAL_CATALOG, SECTION_CATALOG } from "../domain/resource-library";
import { emptySharedResourceLibrary, loadSharedResourceLibrary, saveSharedResourceLibrary, type SharedResourceLibrary } from "../domain/shared-resource-library";
import { validateMaterial, validateSection, type CatalogSource, type MaterialProperties, type SectionProperties } from "../domain/project";

export type LibraryResource =
  | { kind: "material"; id: string; properties: MaterialProperties; catalogId?: string; source?: CatalogSource }
  | { kind: "section"; id: string; properties: SectionProperties; catalogId?: string; source?: CatalogSource };

type ResourceKind = LibraryResource["kind"];
type Draft = Record<string, string>;
interface ParameterField { key: string; label: string; unit: string; initial: string; }
const FIELDS: Record<ResourceKind, ParameterField[]> = {
  material: [
    { key: "elasticModulusGPa", label: "弹性模量 E", unit: "GPa", initial: "206" },
    { key: "poissonRatio", label: "泊松比 ν", unit: "无", initial: "0.3" },
    { key: "densityKgM3", label: "密度 ρ", unit: "kg/m³", initial: "7850" },
  ],
  section: [
    { key: "areaM2", label: "面积 A", unit: "m²", initial: "0.01" },
    { key: "secondMomentYM4", label: "惯性矩 Iy", unit: "m⁴", initial: "0.0001" },
    { key: "secondMomentZM4", label: "惯性矩 Iz", unit: "m⁴", initial: "0.0001" },
    { key: "torsionalConstantM4", label: "扭转常数 J", unit: "m⁴", initial: "0.00015" },
  ],
};

function readLibrary() {
  try { return { library: loadSharedResourceLibrary(window.localStorage), error: null }; }
  catch { return { library: emptySharedResourceLibrary(), error: "本地资源库读取失败，已有数据未被覆盖" }; }
}

function materialProperties(item: MaterialProperties): MaterialProperties {
  return { name: item.name, elasticModulusGPa: item.elasticModulusGPa, poissonRatio: item.poissonRatio, densityKgM3: item.densityKgM3 };
}

function sectionProperties(item: SectionProperties): SectionProperties {
  return { name: item.name, areaM2: item.areaM2, secondMomentYM4: item.secondMomentYM4, secondMomentZM4: item.secondMomentZM4, torsionalConstantM4: item.torsionalConstantM4 };
}

export function ResourceLibraryPanel({ onImport }: { onImport(resource: LibraryResource): void }) {
  const [initial] = useState(readLibrary);
  const [library, setLibrary] = useState<SharedResourceLibrary>(initial.library);
  const [kind, setKind] = useState<ResourceKind>("material");
  const [selectedId, setSelectedId] = useState<string>(MATERIAL_CATALOG[0].catalogId);
  const [editor, setEditor] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [error, setError] = useState<string | null>(initial.error);
  const label = kind === "material" ? "材料" : "截面";
  const entries: LibraryResource[] = kind === "material"
    ? [...MATERIAL_CATALOG.map((item): LibraryResource => ({ kind, id: item.catalogId, properties: materialProperties(item), catalogId: item.catalogId, source: item.source })),
      ...library.materials.map((item): LibraryResource => ({ kind, id: item.libraryId, properties: materialProperties(item) }))]
    : [...SECTION_CATALOG.map((item): LibraryResource => ({ kind, id: item.catalogId, properties: sectionProperties(item), catalogId: item.catalogId, source: item.source })),
      ...library.sections.map((item): LibraryResource => ({ kind, id: item.libraryId, properties: sectionProperties(item) }))];
  const selected = entries.find((item) => item.id === selectedId);

  const persist = (next: SharedResourceLibrary) => {
    saveSharedResourceLibrary(window.localStorage, next);
    setLibrary(next);
    setError(null);
  };
  const beginEdit = (resource?: LibraryResource) => {
    const values = resource ? Object.fromEntries(Object.entries(resource.properties).map(([key, value]) => [key, String(value)]))
      : { name: "", ...Object.fromEntries(FIELDS[kind].map((field) => [field.key, field.initial])) };
    setEditor({ id: resource?.id ?? null, draft: values });
    setError(initial.error);
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editor || initial.error) return;
    try {
      const numeric = (key: string) => {
        const value = editor.draft[key];
        if (!value?.trim() || !Number.isFinite(Number(value))) throw new Error("请输入有效的有限数值");
        return Number(value);
      };
      const libraryId = editor.id ?? `custom-${crypto.randomUUID()}`;
      if (kind === "material") {
        const item = { libraryId, ...validateMaterial("资源库", { name: editor.draft.name, elasticModulusGPa: numeric("elasticModulusGPa"), poissonRatio: numeric("poissonRatio"), densityKgM3: numeric("densityKgM3") }) };
        persist({ ...library, materials: [...library.materials.filter((entry) => entry.libraryId !== libraryId), item] });
      } else {
        const item = { libraryId, ...validateSection("资源库", { name: editor.draft.name, areaM2: numeric("areaM2"), secondMomentYM4: numeric("secondMomentYM4"), secondMomentZM4: numeric("secondMomentZM4"), torsionalConstantM4: numeric("torsionalConstantM4") }) };
        persist({ ...library, sections: [...library.sections.filter((entry) => entry.libraryId !== libraryId), item] });
      }
      setSelectedId(libraryId);
      setEditor(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "资源库保存失败"); }
  };
  const remove = () => {
    if (!selected || selected.catalogId || initial.error) return;
    if (!window.confirm(`确定从共用资源库删除“${selected.properties.name}”吗？`)) return;
    try {
      persist(kind === "material" ? { ...library, materials: library.materials.filter((item) => item.libraryId !== selected.id) }
        : { ...library, sections: library.sections.filter((item) => item.libraryId !== selected.id) });
      setSelectedId(entries[0].id);
      setEditor(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "资源库删除失败"); }
  };

  return <>
    <div className="panel-heading"><span>资源库</span><button className="icon-button" aria-label={`新增自定义${label}`} title={`新增自定义${label}`} disabled={!!initial.error} onClick={() => beginEdit()}><Plus size={16} /></button></div>
    <div className="library-tabs" role="tablist" aria-label="资源类型">
      {(["material", "section"] as const).map((value) => <button key={value} role="tab" aria-selected={kind === value} aria-controls="library-content" id={`library-tab-${value}`} onClick={() => {
        setKind(value); setSelectedId(value === "material" ? MATERIAL_CATALOG[0].catalogId : SECTION_CATALOG[0].catalogId); setEditor(null); setError(initial.error);
      }}>{value === "material" ? "材料" : "截面"}</button>)}
    </div>
    <div className="library-content" id="library-content" role="tabpanel" aria-labelledby={`library-tab-${kind}`}>
      <div className="library-list" aria-label={`${label}条目`}>
        <div className="library-group-label">常用{label}</div>
        {entries.filter((item) => item.catalogId).map((item) => <button key={item.id} className={`library-item ${selectedId === item.id && !editor ? "selected" : ""}`} aria-pressed={selectedId === item.id && !editor} onClick={() => { setSelectedId(item.id); setEditor(null); setError(initial.error); }}><span>{item.properties.name}</span></button>)}
        <div className="library-group-label">自定义{label}</div>
        {entries.filter((item) => !item.catalogId).map((item) => <button key={item.id} className={`library-item ${selectedId === item.id && !editor ? "selected" : ""}`} aria-pressed={selectedId === item.id && !editor} onClick={() => { setSelectedId(item.id); setEditor(null); setError(initial.error); }}><span>{item.properties.name}</span></button>)}
        {!entries.some((item) => !item.catalogId) && <div className="library-muted">暂无自定义{label}</div>}
      </div>
      {editor ? <form className="library-editor" aria-label={`自定义${label}`} onSubmit={submit}>
        <div className="library-detail-heading"><strong>{editor.id ? "编辑" : "新增"}自定义{label}</strong><button type="button" className="icon-button" title="取消编辑" aria-label="取消编辑" onClick={() => { setEditor(null); setError(initial.error); }}><X size={15} /></button></div>
        <label className="field"><span>{label}名称</span><input aria-label={`${label}名称`} value={editor.draft.name} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, name: event.target.value } })} required /></label>
        {FIELDS[kind].map((field) => <label className="field" key={field.key}><span>{field.label}</span><div><input type="number" step="any" aria-label={field.label} value={editor.draft[field.key]} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, [field.key]: event.target.value } })} required /><em>{field.unit}</em></div></label>)}
        <button type="submit" className="button primary"><Save size={14} />保存到资源库</button>
      </form> : selected && <section className="library-details" aria-label={`${label}详情`}>
        <div className="library-detail-heading"><strong>{selected.properties.name}</strong>{!selected.catalogId && <div className="library-actions"><button className="icon-button" title={`编辑自定义${label}`} aria-label={`编辑自定义${label}`} disabled={!!initial.error} onClick={() => beginEdit(selected)}><Pencil size={14} /></button><button className="icon-button" title={`删除自定义${label}`} aria-label={`删除自定义${label}`} disabled={!!initial.error} onClick={remove}><Trash2 size={14} /></button></div>}</div>
        <dl>{FIELDS[kind].map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{Object.entries(selected.properties).find(([key]) => key === field.key)?.[1]} <span>{field.unit}</span></dd></div>)}</dl>
        {selected.source && <div className="library-source"><span>{selected.source.publisher}</span><span>{selected.source.edition}</span><a href={selected.source.url} target="_blank" rel="noreferrer">来源文档</a></div>}
        <button className="button" onClick={() => onImport(selected)}><CopyPlus size={14} />加入当前项目</button>
      </section>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  </>;
}
