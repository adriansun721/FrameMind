import { UnitInput, useUnits } from "./UnitPresentation";
import { useState } from "react";
import type { FrameProject, NodeId } from "../domain/project";
import { conditionsIssues, proposeConditions, type ConditionsProposal } from "../workspace/analysis-conditions";
import { LoadStageFields, loadStageDraft, loadStageOptions, readLoadStageDraft } from "./LoadStageFields";
import { ProposalCard } from "./ProposalCard";
import { conditionSummaries } from "./condition-summary";

interface Props {
  project: FrameProject; proposal: ConditionsProposal; busy: boolean; current: boolean; baseRevision: number;
  visible?: boolean; calculate?: boolean;
  previous?: ConditionsProposal;
  onDirty(dirty: boolean): void; onChange(proposal: ConditionsProposal): void; onConfirm(): void; onReject(): void;
}
const DOFS = ["UX", "UY", "UZ", "RX", "RY", "RZ"];
const AXES = ["x", "y", "z"] as const;
const zero = () => ({ x: "0", y: "0", z: "0" });
const sourceLabel: Record<string, string> = { existing: "已有", user: "用户提供", catalog: "目录", suggestion: "建议 · 待确认", assumption: "假设 · 待确认", unknown: "未知 · 待补齐" };

export function AnalysisConditionsCard({ project, proposal, busy, current, baseRevision, visible, calculate, previous, onDirty, onChange, onConfirm, onReject }: Props) {
  const u = useUnits();
  const existingLoad = (value: FrameProject["nodalLoads"][number] | FrameProject["uniformLoads"][number] | undefined) => !value ? "未找到原荷载"
    : "force" in value ? `${value.label} · ${value.loadCaseId} · F=${u.vector(value.force, "kN")} · M=${u.vector(value.moment, "kN·m")}`
      : `${value.label} · ${value.loadCaseId} · ${value.coordinateSystem === "global" ? "全局" : "局部"} q=${u.vector(value.intensity, "kN/m")}`;
  const [supports, setSupports] = useState(proposal.supports);
  const [loads, setLoads] = useState(() => proposal.nodalLoads?.map((load) => ({ ...load,
    force: { x: String(load.force.x), y: String(load.force.y), z: String(load.force.z) },
    moment: { x: String(load.moment.x), y: String(load.moment.y), z: String(load.moment.z) } })));
  const [dirty, setDirty] = useState(false);
  const [loadStage, setLoadStage] = useState(() => loadStageDraft(proposal));
  const [analysisSourceId, setAnalysisSourceId] = useState(proposal.analysisSourceId ?? project.activeAnalysisCaseId ?? project.activeLoadCombinationId ?? project.activeLoadCaseId);
  const [error, setError] = useState("");
  const edit = () => { setDirty(true); onDirty(true); setError(""); };
  const nodeOptions = project.nodes.map((node) => <option key={node.id} value={node.id}>{node.label} · {node.id} · {u.vector(node.position, "m")}</option>);
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
  const summaries = conditionSummaries(project, proposal, u.preset);
  const summaryFields = { 支座: "supports", 节点荷载: "nodalLoads", 均布荷载: "uniformLoads", 工况: "loadCases", 组合: "loadCombinations", 自重: "selfWeight" } as const;
  const changed = (key: keyof ConditionsProposal) => previous?.id === proposal.id && JSON.stringify(previous[key]) !== JSON.stringify(proposal[key]);
  const sourceName = loadStageOptions(project, loadStageDraft(proposal)).sources.find((source) => source.value === (proposal.analysisSourceId ?? project.activeAnalysisCaseId ?? project.activeLoadCombinationId ?? project.activeLoadCaseId))?.label;
  const details = <>
    <p>V{proposal.version} · 基础 R{baseRevision} · 未应用</p>
    {summaries.map((summary) => <section key={summary.label}><h4>{summary.label}</h4>{summary.groups.map((group, i) => <p key={i}>{group.objects.join("、")}：{group.setting}{group.suggested && <small className="proposal-suggestion">建议</small>}</p>)}</section>)}
    <h4>涉及对象身份与原值</h4>
    {proposal.supports?.map((s, i) => <p key={`support:${i}`}>{project.nodes.find((n) => n.id === s.nodeId)?.label} · {s.nodeId} · {s.id ?? "新增"}{s.id && ` · 原约束：${project.supports.find((v) => v.id === s.id)?.restraints.map((v, a) => `${DOFS[a]} ${v ? "约束" : "自由"}`).join(" / ")}`}</p>)}
    {proposal.nodalLoads?.map((l, i) => <p key={`load:${i}`}>{l.nodeId} · {l.id ?? "新增"}{l.id && ` · 原荷载：${existingLoad(project.nodalLoads.find((v) => v.id === l.id))}`}</p>)}
    {proposal.uniformLoads?.map((l, i) => <p key={`uniform:${i}`}>{l.memberId} · {l.id ?? "新增"}{l.id && ` · 原荷载：${existingLoad(project.uniformLoads.find((v) => v.id === l.id))}`}</p>)}
    {proposal.loadCases?.map((c, i) => <p key={`case:${i}`}>{c.id ?? c.ref} · {c.name} · {sourceLabel[c.source]}{c.id && ` · 原工况：${project.loadCases.find((v) => v.id === c.id)?.name}`}</p>)}
    {proposal.loadCombinations?.map((c, i) => <p key={`combination:${i}`}>{c.id ?? c.ref} · {c.name}{c.id && ` · 原组合：${JSON.stringify(project.loadCombinations.find((v) => v.id === c.id))}`}</p>)}
    {proposal.selfWeight && <details><summary>材料密度与截面面积</summary><ul>{project.members.map((m) => <li key={m.id}>{m.label} · ρ={u.quantity(project.materials.find((v) => v.id === m.materialId)!.densityKgM3, "kg/m³")} · A={u.quantity(project.sections.find((v) => v.id === m.sectionId)!.areaM2, "m²")}</li>)}</ul></details>}
    <p>确认后计算来源：{sourceName}</p>
  </>;
  return <ProposalCard title="分析条件与荷载组合" label="分析条件卡片" visible={visible} current={current} busy={busy} dirty={dirty} issues={issues}
    updateDisabled={busy || project.nodes.length === 0}
    confirmLabel={calculate ? "确认并计算" : "确认条件"} onConfirm={onConfirm} details={details} onCancelEdit={() => {
      setSupports(proposal.supports);
      setLoads(proposal.nodalLoads?.map((l) => ({ ...l, force: { x: String(l.force.x), y: String(l.force.y), z: String(l.force.z) }, moment: { x: String(l.moment.x), y: String(l.moment.y), z: String(l.moment.z) } })));
      setLoadStage(loadStageDraft(proposal)); setAnalysisSourceId(proposal.analysisSourceId ?? project.activeAnalysisCaseId ?? project.activeLoadCombinationId ?? project.activeLoadCaseId);
      setDirty(false); setError(""); onDirty(false);
    }} rows={[
      ...summaries.map((summary) => ({ label: summary.label, changed: changed(summaryFields[summary.label as keyof typeof summaryFields]), value: <>{summary.groups.map((group, i) => <div className="proposal-condition-group" key={i}>
        {group.objects.length} 项 · {group.objects.slice(0, 3).join("、")}{group.objects.length > 3 && "等"}<br />{group.setting}
        {group.suggested && <small className="proposal-suggestion">建议</small>}</div>)}</> })),
      ...(!summaries.length ? [{ label: "变更", value: "本阶段无新增或修改条件" }] : []),
      { label: "计算来源", changed: changed("analysisSourceId"), value: sourceName ?? proposal.analysisSourceId ?? project.activeAnalysisCaseId ?? project.activeLoadCombinationId ?? project.activeLoadCaseId },
    ]}>
    <p>全局 XYZ · 平移 UX/UY/UZ、转动 RX/RY/RZ · 勾选表示约束。力 {u.unit("kN")}，力矩 {u.unit("kN·m")}（右手规则）。</p>
    <form onSubmit={(event) => { event.preventDefault(); update(); }}>
      <div className="frame-parameter"><label>确认后计算来源<select aria-label="确认后计算来源" value={analysisSourceId} disabled={busy} onChange={(event) => { edit(); setAnalysisSourceId(event.target.value); }}>
        {options.sources.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}
      </select></label><p>当前：{project.activeAnalysisCaseId ?? project.activeLoadCombinationId ?? project.activeLoadCaseId} → 确认后：{options.sources.find((source) => source.value === analysisSourceId)?.label ?? analysisSourceId}。计算使用该来源的正式荷载。</p></div>
      <details className="proposal-editor-group" open={supports === undefined || supports.length > 0}><summary>支座约束</summary><fieldset disabled={busy}><legend>支座约束</legend>
        {supports === undefined && <p className="frame-draft-notice">尚缺支座条件</p>}
        {supports?.length === 0 && <p>本阶段无新增或修改支座</p>}
        {supports?.map((s, index) => <div className="condition-entry" key={index}>
          <strong>{s.id ? `修改 ${s.id}` : `新增支座 ${index + 1}`} · {sourceLabel[s.source]}</strong>
          <label>支座节点<select aria-label={`支座 ${index + 1} 节点`} value={s.nodeId} onChange={(e) => { edit(); setSupports(supports.map((item, i) => i === index ? { ...item, nodeId: e.target.value as NodeId, source: "user" } : item)); }}><option value="">请选择节点</option>{nodeOptions}</select></label>
          <div className="condition-dofs">{DOFS.map((dof, axis) => <label key={dof}><input type="checkbox" aria-label={`支座 ${index + 1} ${dof}`} checked={s.restraints[axis]} onChange={(e) => { edit(); setSupports(supports.map((item, i) => i === index ? { ...item, source: "user", restraints: item.restraints.map((value, a) => a === axis ? e.target.checked : value) as typeof s.restraints } : item)); }} />{dof}</label>)}</div>
          {s.id && <p>原约束：{project.supports.find((item) => item.id === s.id)?.restraints.map((value, i) => `${DOFS[i]} ${value ? "约束" : "自由"}`).join(" · ") ?? "对象已不存在"}</p>}
          <button type="button" onClick={() => { edit(); setSupports(supports.filter((_, i) => i !== index)); }}>移除支座条目 {index + 1}</button>
        </div>)}
        <div className="frame-proposal-actions"><button type="button" onClick={() => { edit(); setSupports([...(supports ?? []), { nodeId: "" as NodeId, restraints: [true, true, true, true, true, true], source: "user" }]); }}>添加支座条目</button>
          <button type="button" onClick={() => { edit(); setSupports([]); }}>本阶段无支座变更</button></div>
      </fieldset></details>
      <details className="proposal-editor-group" open={loads === undefined || loads.length > 0}><summary>节点集中力与力矩</summary><fieldset disabled={busy}><legend>节点集中力与力矩</legend>
        {loads === undefined && <p className="frame-draft-notice">尚缺节点荷载条件</p>}
        {loads?.length === 0 && <p>本阶段无新增或修改节点荷载</p>}
        {loads?.map((load, index) => <div className="condition-entry" key={index}>
          <strong>{load.id ? `修改 ${load.id}` : `新增节点荷载 ${index + 1}`} · {sourceLabel[load.source]}</strong>
          <label>荷载节点<select aria-label={`荷载 ${index + 1} 节点`} value={load.nodeId} onChange={(e) => { edit(); setLoads(loads.map((item, i) => i === index ? { ...item, nodeId: e.target.value as NodeId, source: "user" } : item)); }}><option value="">请选择节点</option>{nodeOptions}</select></label>
          <label>工况<select aria-label={`荷载 ${index + 1} 工况`} value={load.loadCaseId} onChange={(e) => { edit(); setLoads(loads.map((item, i) => i === index ? { ...item, loadCaseId: e.target.value, source: "user" } : item)); }}>{options.cases.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
          <div className="condition-vectors">{(["force", "moment"] as const).flatMap((kind) => AXES.map((axis) => {
            const label = `${kind === "force" ? "F" : "M"}${axis.toUpperCase()} (${u.unit(kind === "force" ? "kN" : "kN·m")})`;
            return <label key={`${kind}:${axis}`}>{label}<UnitInput unit={kind === "force" ? "kN" : "kN·m"} aria-label={`荷载 ${index + 1} ${label}`} value={load[kind][axis]} onValueChange={(value) => { edit(); setLoads(loads.map((item, i) => i === index ? { ...item, source: "user", [kind]: { ...item[kind], [axis]: value } } : item)); }} /></label>;
          }))}</div>
          {load.id && <p>原荷载：{existingLoad(project.nodalLoads.find((item) => item.id === load.id))}</p>}
          <button type="button" onClick={() => { edit(); setLoads(loads.filter((_, i) => i !== index)); }}>移除荷载条目 {index + 1}</button>
        </div>)}
        <div className="frame-proposal-actions"><button type="button" onClick={() => { edit(); setLoads([...(loads ?? []), { nodeId: "" as NodeId, loadCaseId: project.activeLoadCaseId, force: zero(), moment: zero(), source: "user" }]); }}>添加荷载条目</button>
          <button type="button" onClick={() => { edit(); setLoads([]); }}>本阶段无节点荷载变更</button></div>
      </fieldset></details>
      <LoadStageFields project={project} draft={loadStage} busy={busy} onChange={(next) => { edit(); setLoadStage(next); }} />
      {error && <p role="alert" className="frame-conflict">{error}</p>}
      {dirty && <p className="frame-draft-notice">编辑尚未保存，当前三维预览保持原方案。</p>}
    </form>
    <details className="proposal-more-actions"><summary>更多操作</summary><div className="frame-proposal-actions"><button disabled={busy || dirty} onClick={() => onChange({ ...proposal, version: proposal.version + 1 })}>重新生成条件预览</button><button disabled={busy || dirty} onClick={onReject}>拒绝条件方案</button></div></details>
  </ProposalCard>;
}
