import { useState } from "react";
import type { FrameProject, NodeId } from "../domain/project";
import { conditionsIssues, proposeConditions, type ConditionsProposal } from "../workspace/analysis-conditions";
import { LoadStageFields, loadStageDraft, loadStageOptions, readLoadStageDraft } from "./LoadStageFields";

interface Props {
  project: FrameProject; proposal: ConditionsProposal; busy: boolean; current: boolean; baseRevision: number;
  onDirty(dirty: boolean): void; onChange(proposal: ConditionsProposal): void; onConfirm(): void; onReject(): void;
}
const DOFS = ["UX", "UY", "UZ", "RX", "RY", "RZ"];
const AXES = ["x", "y", "z"] as const;
const zero = () => ({ x: "0", y: "0", z: "0" });

export function AnalysisConditionsCard({ project, proposal, busy, current, baseRevision, onDirty, onChange, onConfirm, onReject }: Props) {
  const [supports, setSupports] = useState(proposal.supports);
  const [loads, setLoads] = useState(() => proposal.nodalLoads?.map((load) => ({ ...load,
    force: { x: String(load.force.x), y: String(load.force.y), z: String(load.force.z) },
    moment: { x: String(load.moment.x), y: String(load.moment.y), z: String(load.moment.z) } })));
  const [dirty, setDirty] = useState(false);
  const [loadStage, setLoadStage] = useState(() => loadStageDraft(proposal));
  const [analysisSourceId, setAnalysisSourceId] = useState(proposal.analysisSourceId ?? project.activeLoadCombinationId ?? project.activeLoadCaseId);
  const [error, setError] = useState("");
  const edit = () => { setDirty(true); onDirty(true); setError(""); };
  const nodeOptions = project.nodes.map((node) => <option key={node.id} value={node.id}>{node.label} · {node.id} · ({node.position.x}, {node.position.y}, {node.position.z}) m</option>);
  const issues = conditionsIssues(project, proposal);
  const options = loadStageOptions(project, loadStage);
  const update = () => {
    try {
      const parse = (values: { x: string; y: string; z: string }) => Object.fromEntries(AXES.map((axis) => {
        if (!values[axis].trim() || !Number.isFinite(Number(values[axis]))) throw new Error("六个力/力矩分量必须填写有限数值");
        return [axis, Number(values[axis])];
      }));
      // Missing selfWeight must remove a pending change, while leaving confirmed settings intact.
      const base = { ...proposal }; delete base.selfWeight;
      onChange(proposeConditions({ analysisSourceId, ...readLoadStageDraft(loadStage), ...(supports === undefined ? {} : { supports }), ...(loads === undefined ? {} : { nodalLoads: loads.map((load) => ({ ...load, force: parse(load.force), moment: parse(load.moment) })) }) }, base));
      setDirty(false); onDirty(false); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "条件无效"); }
  };
  return <section className="frame-proposal-card" aria-label="分析条件卡片">
    <div className="frame-proposal-heading"><strong>分析条件与荷载组合</strong><span>V{proposal.version} · 基础 R{baseRevision} · 未应用</span></div>
    <p>全局 XYZ · 平移 UX/UY/UZ、转动 RX/RY/RZ · 勾选表示约束。力 kN，力矩 kN·m（右手规则）。</p>
    <form onSubmit={(event) => { event.preventDefault(); update(); }}>
      <div className="frame-parameter"><label>确认后计算来源<select aria-label="确认后计算来源" value={analysisSourceId} disabled={busy} onChange={(event) => { edit(); setAnalysisSourceId(event.target.value); }}>
        {options.sources.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}
      </select></label><p>当前：{project.activeLoadCombinationId ?? project.activeLoadCaseId} → 确认后：{options.sources.find((source) => source.value === analysisSourceId)?.label ?? analysisSourceId}。计算使用该来源的正式荷载。</p></div>
      <fieldset disabled={busy}><legend>支座约束</legend>
        {supports === undefined && <p className="frame-draft-notice">尚缺支座条件</p>}
        {supports?.length === 0 && <p>本阶段无新增或修改支座</p>}
        {supports?.map((s, index) => <div className="condition-entry" key={index}>
          <strong>{s.id ? `修改 ${s.id}` : `新增支座 ${index + 1}`} · {s.source === "user" ? "用户提供" : "建议 · 待确认"}</strong>
          <label>支座节点<select aria-label={`支座 ${index + 1} 节点`} value={s.nodeId} onChange={(e) => { edit(); setSupports(supports.map((item, i) => i === index ? { ...item, nodeId: e.target.value as NodeId, source: "user" } : item)); }}><option value="">请选择节点</option>{nodeOptions}</select></label>
          <div className="condition-dofs">{DOFS.map((dof, axis) => <label key={dof}><input type="checkbox" aria-label={`支座 ${index + 1} ${dof}`} checked={s.restraints[axis]} onChange={(e) => { edit(); setSupports(supports.map((item, i) => i === index ? { ...item, source: "user", restraints: item.restraints.map((value, a) => a === axis ? e.target.checked : value) as typeof s.restraints } : item)); }} />{dof}</label>)}</div>
          {s.id && <p>原约束：{project.supports.find((item) => item.id === s.id)?.restraints.map((value, i) => `${DOFS[i]} ${value ? "约束" : "自由"}`).join(" · ") ?? "对象已不存在"}</p>}
          <button type="button" onClick={() => { edit(); setSupports(supports.filter((_, i) => i !== index)); }}>移除支座条目 {index + 1}</button>
        </div>)}
        <div className="frame-proposal-actions"><button type="button" onClick={() => { edit(); setSupports([...(supports ?? []), { nodeId: "" as NodeId, restraints: [true, true, true, true, true, true], source: "user" }]); }}>添加支座条目</button>
          <button type="button" onClick={() => { edit(); setSupports([]); }}>本阶段无支座变更</button></div>
      </fieldset>
      <fieldset disabled={busy}><legend>节点集中力与力矩</legend>
        {loads === undefined && <p className="frame-draft-notice">尚缺节点荷载条件</p>}
        {loads?.length === 0 && <p>本阶段无新增或修改节点荷载</p>}
        {loads?.map((load, index) => <div className="condition-entry" key={index}>
          <strong>{load.id ? `修改 ${load.id}` : `新增节点荷载 ${index + 1}`} · {load.source === "user" ? "用户提供" : "建议 · 待确认"}</strong>
          <label>荷载节点<select aria-label={`荷载 ${index + 1} 节点`} value={load.nodeId} onChange={(e) => { edit(); setLoads(loads.map((item, i) => i === index ? { ...item, nodeId: e.target.value as NodeId, source: "user" } : item)); }}><option value="">请选择节点</option>{nodeOptions}</select></label>
          <label>工况<select aria-label={`荷载 ${index + 1} 工况`} value={load.loadCaseId} onChange={(e) => { edit(); setLoads(loads.map((item, i) => i === index ? { ...item, loadCaseId: e.target.value, source: "user" } : item)); }}>{options.cases.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
          <div className="condition-vectors">{(["force", "moment"] as const).flatMap((kind) => AXES.map((axis) => {
            const label = `${kind === "force" ? "F" : "M"}${axis.toUpperCase()} (${kind === "force" ? "kN" : "kN·m"})`;
            return <label key={`${kind}:${axis}`}>{label}<input aria-label={`荷载 ${index + 1} ${label}`} value={load[kind][axis]} onChange={(e) => { edit(); setLoads(loads.map((item, i) => i === index ? { ...item, source: "user", [kind]: { ...item[kind], [axis]: e.target.value } } : item)); }} /></label>;
          }))}</div>
          {load.id && <p>原荷载：{JSON.stringify(project.nodalLoads.find((item) => item.id === load.id))}</p>}
          <button type="button" onClick={() => { edit(); setLoads(loads.filter((_, i) => i !== index)); }}>移除荷载条目 {index + 1}</button>
        </div>)}
        <div className="frame-proposal-actions"><button type="button" onClick={() => { edit(); setLoads([...(loads ?? []), { nodeId: "" as NodeId, loadCaseId: project.activeLoadCaseId, force: zero(), moment: zero(), source: "user" }]); }}>添加荷载条目</button>
          <button type="button" onClick={() => { edit(); setLoads([]); }}>本阶段无节点荷载变更</button></div>
      </fieldset>
      <LoadStageFields project={project} draft={loadStage} busy={busy} onChange={(next) => { edit(); setLoadStage(next); }} />
      {error && <p role="alert" className="frame-conflict">{error}</p>}
      {dirty && <p className="frame-draft-notice">条件编辑尚未更新，三维预览已暂停。</p>}
      <div className="frame-proposal-actions"><button type="submit" disabled={busy || project.nodes.length === 0}>更新条件预览</button>
        <button type="button" disabled={busy || dirty} onClick={() => onChange({ ...proposal, version: proposal.version + 1 })}>重新生成条件预览</button>
        <button type="button" onClick={onReject}>拒绝条件方案</button></div>
    </form>
    {issues.length > 0 && <ul className="frame-issues">{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
    <p>已确认：{project.supports.length} 个支座、{project.nodalLoads.length} 项节点荷载、{project.uniformLoads.length} 项均布荷载、{project.loadCases.length} 个工况、{project.loadCombinations.length} 个用户组合。卡片修改仅在确认后进入正式模型。</p>
    <div className="frame-proposal-actions"><button disabled={busy || dirty || !current || issues.length > 0} onClick={onConfirm}>确认应用分析条件阶段</button></div>
  </section>;
}
