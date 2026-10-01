import { useState, type FormEvent } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";
import { addLoadCombination, deleteLoadCombination, selectLoadCombination, updateLoadCombination, type FrameProject } from "../domain/project";
import { getLoadCaseResult, isAnalysisResultCurrent } from "../domain/analysis";

export function LoadCombinationManager({ project, onChange, onClose }: { project: FrameProject; onChange(project: FrameProject): void; onClose(): void }) {
  const initial = project.loadCombinations.find((item) => item.id === project.activeLoadCombinationId);
  const [editingId, setEditingId] = useState(initial?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [factors, setFactors] = useState<Record<string, string>>(() => Object.fromEntries(initial?.terms.map((term) => [term.loadCaseId, String(term.factor)]) ?? []));
  const [error, setError] = useState<string | null>(null);
  const edit = (id: string) => {
    const item = project.loadCombinations.find((item) => item.id === id);
    setEditingId(id); setName(item?.name ?? ""); setFactors(Object.fromEntries(item?.terms.map((term) => [term.loadCaseId, String(term.factor)]) ?? [])); setError(null);
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    try {
      const terms = project.loadCases.filter((item) => Object.hasOwn(factors, item.id)).map((item) => {
        const text = factors[item.id];
        if (!text.trim() || !Number.isFinite(Number(text))) throw new Error(`${item.id} 的系数必须为有限数值`);
        return { loadCaseId: item.id, factor: Number(text) };
      });
      const next = editingId ? updateLoadCombination(project, editingId, name, terms) : addLoadCombination(project, name, terms);
      const id = editingId || next.loadCombinations.at(-1)!.id;
      onChange(selectLoadCombination(next, id)); setEditingId(id); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "组合保存失败"); }
  };
  const remove = () => {
    try {
      const result = getLoadCaseResult(project, editingId);
      if (result && !window.confirm(`删除 ${editingId} 及其组合结果？此变更可撤销。`)) return;
      onChange(deleteLoadCombination(project, editingId)); edit("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "组合删除失败"); }
  };
  return <div className="dialog-backdrop"><section className="node-dialog wide-dialog" role="dialog" aria-modal="true" aria-labelledby="combination-title">
    <header><h2 id="combination-title">自定义荷载组合</h2><button className="icon-button" aria-label="关闭组合管理" title="关闭" onClick={onClose}><X size={17} /></button></header>
    <div className="dialog-form">
      <div className="load-case-list" role="list" aria-label="组合列表">{project.loadCombinations.map((item) => {
        const result = getLoadCaseResult(project, item.id);
        return <button role="listitem" className={`load-case-row ${editingId === item.id ? "active" : ""}`} key={item.id} onClick={() => edit(item.id)}><span>{item.id} · {item.name}</span><small>{result ? isAnalysisResultCurrent(project, result) ? "结果当前" : "结果已过期" : "未计算"}</small></button>;
      })}</div>
      <button className="button ghost" onClick={() => edit("")}><Plus size={14} />新建组合</button>
      <form onSubmit={save}>
        <label className="field"><span>组合名称</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <div className="combination-terms" aria-label="组合工况与系数">{project.loadCases.map((item) => {
          const checked = Object.hasOwn(factors, item.id);
          return <div className="combination-term" key={item.id}>
            <label className="check-field"><input type="checkbox" aria-label={`包含 ${item.id}`} checked={checked} onChange={(event) => setFactors((current) => { const next = { ...current }; if (event.target.checked) next[item.id] = "1"; else delete next[item.id]; return next; })} /><span>{item.id} · {item.name}</span></label>
            <label className="field"><span>系数 · 无量纲</span><input type="number" step="any" aria-label={`${item.id} 系数`} disabled={!checked} value={factors[item.id] ?? ""} onChange={(event) => setFactors({ ...factors, [item.id]: event.target.value })} /></label>
          </div>;
        })}</div>
        <p className="combination-basis">用户定义 · 线弹性 · m / kN / kN·m</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="load-case-actions"><button className="button primary" type="submit"><Save size={14} />{editingId ? "保存组合" : "创建组合"}</button><button className="button ghost" type="button" disabled={!editingId} onClick={remove}><Trash2 size={14} />删除组合</button></div>
      </form>
    </div>
  </section></div>;
}
