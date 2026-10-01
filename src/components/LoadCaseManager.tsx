import { useState } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";
import { addLoadCase, deleteLoadCase, getLoadCaseReferences, selectLoadCase, updateLoadCase, type FrameProject } from "../domain/project";
import { getLoadCaseResult, isAnalysisResultCurrent } from "../domain/analysis";

export function LoadCaseManager({ project, onChange, onClose }: { project: FrameProject; onChange(project: FrameProject): void; onClose(): void }) {
  const [editingId, setEditingId] = useState(project.activeLoadCaseId);
  const initial = project.loadCases.find((item) => item.id === project.activeLoadCaseId)!;
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [error, setError] = useState<string | null>(null);
  const [nodeId, setNodeId] = useState<string>(project.nodes.at(-1)?.id ?? "");
  const edit = (id: string) => {
    const item = project.loadCases.find((item) => item.id === id);
    setEditingId(id); setName(item?.name ?? ""); setDescription(item?.description ?? ""); setError(null);
  };
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const next = editingId ? updateLoadCase(project, editingId, name, description) : addLoadCase(project, name, description);
      const id = editingId || next.loadCases.at(-1)!.id;
      onChange(selectLoadCase(next, id)); setEditingId(id); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "工况保存失败"); }
  };
  const remove = () => {
    try {
      const refs = getLoadCaseReferences(project, editingId);
      if (project.loadCases.length > 1 && (refs.loads || refs.results) && !window.confirm(`删除 ${editingId} 及其 ${refs.loads} 条荷载、${refs.results} 份结果？此变更可撤销。`)) return;
      const next = deleteLoadCase(project, editingId, true);
      onChange(next);
      const item = next.loadCases.find((item) => item.id === next.activeLoadCaseId)!;
      setEditingId(item.id); setName(item.name); setDescription(item.description); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "工况删除失败"); }
  };
  return <div className="dialog-backdrop"><section className="node-dialog wide-dialog" role="dialog" aria-modal="true" aria-labelledby="load-case-title">
    <header><h2 id="load-case-title">荷载工况管理</h2><button className="icon-button" aria-label="关闭工况管理" title="关闭" onClick={onClose}><X size={17} /></button></header>
    <div className="dialog-form">
      <div className="load-case-list" role="list" aria-label="工况列表">{project.loadCases.map((item) => {
        const refs = getLoadCaseReferences(project, item.id); const result = getLoadCaseResult(project, item.id);
        return <button role="listitem" className={`load-case-row ${editingId === item.id ? "active" : ""}`} key={item.id} onClick={() => edit(item.id)}><span>{item.id} · {item.name}</span><small>{refs.loads} 条荷载 · {result ? isAnalysisResultCurrent(project, result) ? "结果当前" : "结果已过期" : "未计算"}</small></button>;
      })}</div>
      <button className="button ghost" onClick={() => edit("")}><Plus size={14} />新建工况</button>
      <form onSubmit={save}>
        <label className="field"><span>工况名称</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="field"><span>工况说明</span><input value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="load-case-actions"><button className="button primary" type="submit"><Save size={14} />{editingId ? "保存工况" : "创建工况"}</button><button className="button ghost" type="button" disabled={!editingId} onClick={remove}><Trash2 size={14} />删除工况</button></div>
      </form>
      {project.analysisResults.length > 0 && <section className="load-case-comparison" aria-label="工况响应比较">
        <h3>工况响应比较</h3>
        <label className="field"><span>比较节点</span><select value={nodeId} onChange={(event) => setNodeId(event.target.value)}>{project.nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label>
        <div className="load-case-table-scroll"><table><thead><tr><th>工况 / 来源</th><th>位移 XYZ (m)</th><th>反力 XYZ (kN)</th></tr></thead><tbody>{project.loadCases.map((item) => {
          const result = getLoadCaseResult(project, item.id); const node = result?.nodes.find((node) => node.nodeId === nodeId);
          const vector = (value: { x: number; y: number; z: number }) => [value.x, value.y, value.z].map((n) => n.toPrecision(6)).join(", ");
          return <tr key={item.id}><th>{item.id} · {item.name}<small>{result ? `R${result.projectRevision} · ${isAnalysisResultCurrent(project, result) ? "当前" : "已过期"}` : "未计算"}</small></th><td>{node ? vector(node.displacement) : "—"}</td><td>{node ? vector(node.reaction) : "—"}</td></tr>;
        })}</tbody></table></div>
      </section>}
    </div>
  </section></div>;
}
