import { useState } from "react";
import type { AiSnapshot } from "../workspace/ai-tools";
import { frameResourceOptions } from "../workspace/frame-proposal";
import { proposeSectionChange, SECTION_PARAMETERS, type SectionChangeProposal } from "../workspace/section-stage";

export function SectionChangeCard({ snapshot, proposal, current, busy, onChange, onDirty, onConfirm, onReject, onRegenerate }: {
  snapshot: AiSnapshot; proposal: SectionChangeProposal; current: boolean; busy: boolean;
  onChange(proposal: SectionChangeProposal): void; onDirty(dirty: boolean): void; onConfirm(): void; onReject(): void; onRegenerate(): void;
}) {
  const resources = frameResourceOptions(snapshot, "columnSection");
  const initialRef = snapshot.model.sections.some((section) => section.id === proposal.section.id) ? proposal.section.id
    : proposal.section.provenance.catalogId ?? "custom";
  const [resource, setResource] = useState<string>(initialRef);
  const [name, setName] = useState(proposal.section.name);
  const [parameters, setParameters] = useState(Object.fromEntries(Object.keys(SECTION_PARAMETERS).map((key) => [key, String(proposal.section[key as keyof typeof SECTION_PARAMETERS])])));
  const [dirty, setDirty] = useState(false); const [error, setError] = useState("");
  const edit = () => { setDirty(true); onDirty(true); };
  return <section className="frame-proposal-card section-change-card" aria-label="选柱截面修改方案">
    <h3>选柱截面修改 · 待确认</h3>
    <p>{proposal.source === "user" ? "用户提供" : "建议 · 待确认"} · {proposal.memberIds.length} 根柱 · 输入 R{snapshot.context.modelRevision}</p>
    <p>仅重新指定下列柱的截面，共享截面保持原参数。全部 {snapshot.model.members.length} 根杆件的响应将在重算后更新。</p>
    {proposal.memberIds.map((id) => {
      const member = snapshot.model.members.find((item) => item.id === id)!;
      const before = snapshot.model.sections.find((item) => item.id === member.sectionId)!;
      return <div className="section-change-object" key={id}><strong>{member.label} · {id}</strong><p>{before.name} → {proposal.section.name}</p>
        <dl>{Object.entries(SECTION_PARAMETERS).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{before[key as keyof typeof SECTION_PARAMETERS]} → {proposal.section[key as keyof typeof SECTION_PARAMETERS]}</dd></div>)}</dl>
      </div>;
    })}
    {snapshot.model.selfWeight.enabled && <p>自重已启用 · {snapshot.model.selfWeight.loadCaseId}。新面积同时改变质量和重算荷载，前后差异包含自重影响。</p>}
    {!snapshot.analysisCurrent && <p className="frame-draft-notice">当前输入没有成功分析基线，确认重算后需另行选择历史分析进行对比。</p>}
    {!current && <p className="frame-draft-notice">模型或选中对象已变化，预览已失效。重新生成后核对新的对象范围。</p>}
    <form onSubmit={(event) => {
      event.preventDefault();
      try {
        const section = { name, ...Object.fromEntries(Object.keys(SECTION_PARAMETERS).map((key) => {
          if (!parameters[key].trim()) throw new Error(`${SECTION_PARAMETERS[key as keyof typeof SECTION_PARAMETERS]}不能为空`);
          return [key, Number(parameters[key])];
        })) };
        onChange(proposeSectionChange(snapshot, { ...(resource === "custom" ? { section } : { sectionId: resource }), source: "user" }, proposal));
        setDirty(false); onDirty(false); setError("");
      } catch (problem) { setError(problem instanceof Error ? problem.message : "截面参数无效"); }
    }}>
      <label>目标截面<select aria-label="目标柱截面" value={resource} disabled={busy || !current} onChange={(event) => { edit(); setResource(event.target.value); }}>
        {resources.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}<option value="custom">自定义新截面</option>
      </select></label>
      {resource === "custom" && <fieldset disabled={busy || !current}><legend>自定义参数</legend>
        <label>名称<input aria-label="新柱截面名称" value={name} onChange={(event) => { edit(); setName(event.target.value); }} /></label>
        {Object.entries(SECTION_PARAMETERS).map(([key, label]) => <label key={key}>{label}<input aria-label={`新柱截面 ${label}`} value={parameters[key]} onChange={(event) => { edit(); setParameters({ ...parameters, [key]: event.target.value }); }} /></label>)}
      </fieldset>}
      {dirty && <p className="frame-draft-notice">参数编辑尚未更新，三维预览已暂停。</p>}{error && <p role="alert">{error}</p>}
      <div className="frame-proposal-actions"><button type="submit" disabled={busy || !current}>更新截面预览</button><button type="button" disabled={busy} onClick={onRegenerate}>重新生成截面预览</button><button type="button" disabled={busy} onClick={onReject}>拒绝截面方案</button></div>
    </form>
    <div className="frame-proposal-actions"><button disabled={busy || dirty || !current} onClick={onConfirm}>确认应用截面修改阶段</button></div>
  </section>;
}
