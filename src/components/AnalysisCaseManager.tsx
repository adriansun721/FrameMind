import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { ANALYSIS_CAPABILITIES, type AnalysisMethod } from "../domain/analysis-capabilities";
import { addAnalysisCase, updateAnalysisCase, deleteAnalysisCase, selectAnalysisCase, type FrameProject } from "../domain/project";
import { getAnalysisResultForSource, isAnalysisResultCurrent } from "../domain/analysis";

export function AnalysisCaseManager({ project, onChange, onAnalyze, onViewHistory, onLoads, onCombinations, onClose }: {
  project: FrameProject; onChange(project: FrameProject): void; onAnalyze(id: string): void;
  onViewHistory(id: string): void; onLoads(): void; onCombinations(): void; onClose(): void;
}) {
  const initial = project.analysisCases.find((c) => c.id === project.activeAnalysisCaseId);
  const [editingId, setEditingId] = useState(initial?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [sourceId, setSourceId] = useState(initial?.loadSourceId ?? project.activeLoadCombinationId ?? project.activeLoadCaseId);
  const [error, setError] = useState<string>();
  const edit = (id: string) => {
    const item = project.analysisCases.find((c) => c.id === id);
    setEditingId(id); setName(item?.name ?? ""); setSourceId(item?.loadSourceId ?? project.activeLoadCaseId); setError(undefined);
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    try {
      const properties = { name, method: "static" as const, loadSourceId: sourceId, settings: { solver: "native-static" as const } };
      const next = editingId ? updateAnalysisCase(project, editingId, properties) : addAnalysisCase(project, properties);
      const id = editingId || next.analysisCases.at(-1)!.id;
      onChange(selectAnalysisCase(next, id)); setEditingId(id); setError(undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "分析工况保存失败"); }
  };
  const remove = () => {
    try { onChange(deleteAnalysisCase(project, editingId)); edit(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "分析工况删除失败"); }
  };
  return <div className="dialog-backdrop"><section className="node-dialog wide-dialog" role="dialog" aria-modal="true" aria-labelledby="analysis-case-title">
    <header><h2 id="analysis-case-title">分析工况管理</h2><button className="icon-button" aria-label="关闭分析工况管理" onClick={onClose}><X size={17} /></button></header>
    <div className="dialog-form">
      <p>荷载定义可供多个分析工况复用。计算结果保留各自的冻结输入。</p>
      <div className="load-case-actions"><button className="button ghost" onClick={onLoads}>编辑荷载定义</button><button className="button ghost" onClick={onCombinations}>编辑荷载组合</button></div>
      <div className="load-case-list" role="list" aria-label="分析工况列表">{project.analysisCases.map((item) => {
        const result = getAnalysisResultForSource(project, item.id);
        return <button role="listitem" key={item.id} className={`load-case-row ${item.id === editingId ? "active" : ""}`} onClick={() => edit(item.id)}><span>{item.id} · {item.name}</span><small>线性静力 · {item.loadSourceId} · {result ? isAnalysisResultCurrent(project, result) ? "结果当前" : "结果已过期" : "未计算"}</small></button>;
      })}</div>
      <button className="button ghost" onClick={() => edit("")}>新建分析工况</button>
      <form onSubmit={save}>
        <label className="field"><span>分析工况名称</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>分析方法</span><select value="static" onChange={() => {}}>{Object.entries(ANALYSIS_CAPABILITIES).map(([method, capability]) => <option key={method} value={method} disabled={!capability.available}>{capability.name}{capability.available ? "" : "（尚未开放）"}</option>)}</select></label>
        <label className="field"><span>复用荷载定义</span><select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>{[...project.loadCases, ...project.loadCombinations].map((c) => <option key={c.id} value={c.id}>{c.id} · {c.name}</option>)}</select></label>
        <p>数值设置：原生静力求解器 · 稀疏 LDLT · 自由度消元 · 相对主元阈值 1e-12。单位 m / kN / kN·m。</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="load-case-actions"><button className="button primary" type="submit">{editingId ? "保存分析工况" : "创建分析工况"}</button><button className="button ghost" type="button" disabled={!editingId} onClick={remove}>删除分析工况</button><button className="button ghost" type="button" disabled={!editingId} onClick={() => onAnalyze(editingId)}>计算此分析工况</button></div>
      </form>
      <details className="load-case-comparison"><summary>分析支持矩阵</summary><div className="load-case-table-scroll"><table><thead><tr><th>方法</th><th>荷载输入组合</th><th>响应叠加</th><th>结果比较</th></tr></thead><tbody>{Object.keys(ANALYSIS_CAPABILITIES).map((method) => {
        const c = ANALYSIS_CAPABILITIES[method as AnalysisMethod];
        const supported = (allowed: boolean) => c.available ? allowed ? "支持" : "不支持" : "尚未开放";
        return <tr key={method}><th>{c.name}</th><td>{supported(c.loadCombination)}</td><td>{supported(c.responseSuperposition)}</td><td>{supported(c.resultComparison)}</td></tr>;
      })}</tbody></table></div><p>静力组合使用同一结构与用户系数加权荷载，不将不同冻结输入的历史结果相加。</p></details>
      <section className="property-section" aria-label="历史分析来源"><h3>历史分析来源</h3>{[...project.analysisResults].reverse().map((r) => <button key={r.id} className="load-case-row" onClick={() => onViewHistory(r.id)}><span>{r.input.analysisCase ? `${r.input.analysisCase.id} · ${r.input.analysisCase.name}` : r.input.combination ? `${r.input.combination.definition.id} · ${r.input.combination.definition.name}` : `${r.input.loadCase?.id ?? "LC1"} · ${r.input.loadCase?.name ?? "旧版输入"}`}</span><small>R{r.projectRevision} · {isAnalysisResultCurrent(project, r) ? "当前" : "已过期"} · {r.id}</small></button>)}</section>
    </div>
  </section></div>;
}
