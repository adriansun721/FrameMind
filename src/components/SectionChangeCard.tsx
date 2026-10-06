import { UnitInput, useUnits } from "./UnitPresentation";
import { useState } from "react";
import type { AiSnapshot } from "../workspace/ai-tools";
import { frameResourceOptions } from "../workspace/frame-proposal";
import { proposeSectionChange, SECTION_PARAMETERS, type SectionChangeProposal } from "../workspace/section-stage";
import { ProposalCard } from "./ProposalCard";
import { SectionGeometryPreview } from "./SectionGeometryPreview";
import { SectionBasisView } from "./SectionBasisView";
import { SECTION_DIMENSIONS, SECTION_SHAPE_FIELDS, type SectionGeometry } from "../domain/section-geometry";

export function SectionChangeCard({ snapshot, proposal, current, busy, visible, calculate, previous, onChange, onDirty, onConfirm, onReject, onRegenerate }: {
  snapshot: AiSnapshot; proposal: SectionChangeProposal; current: boolean; busy: boolean;
  visible?: boolean; calculate?: boolean;
  previous?: SectionChangeProposal;
  onChange(proposal: SectionChangeProposal): void; onDirty(dirty: boolean): void; onConfirm(): void; onReject(): void; onRegenerate(): void;
}) {
  const u = useUnits();
  const fieldUnit = (key: string) => key === "areaM2" ? "m²" : "m⁴";
  const resources = frameResourceOptions(snapshot, "columnSection");
  const initialRef = snapshot.model.sections.some((section) => section.id === proposal.section.id) ? proposal.section.id
    : proposal.section.provenance.catalogId ?? "custom";
  const [resource, setResource] = useState<string>(initialRef);
  const [name, setName] = useState(proposal.section.name);
  const [geometry, setGeometry] = useState(proposal.section.geometry);
  const [parameters, setParameters] = useState(Object.fromEntries(Object.keys(SECTION_PARAMETERS).map((key) => [key, String(proposal.section[key as keyof typeof SECTION_PARAMETERS])])));
  const [dirty, setDirty] = useState(false); const [error, setError] = useState("");
  const edit = () => { setDirty(true); onDirty(true); };
  const beforeSections = [...new Set(proposal.memberIds.map((id) => {
    const member = snapshot.model.members.find((item) => item.id === id);
    return snapshot.model.sections.find((item) => item.id === member?.sectionId)?.name ?? "对象已不存在";
  }))];
  const details = <>
    <SectionGeometryPreview geometry={proposal.section.geometry} />
    <SectionBasisView section={proposal.section} />
    <p>{proposal.source === "user" ? "用户提供" : "建议 · 待确认"} · {proposal.memberIds.length} 根柱 · 输入 R{snapshot.context.modelRevision}</p>
    <p>仅重新指定下列柱的截面，共享截面保持原参数。全部 {snapshot.model.members.length} 根杆件的响应将在重算后更新。</p>
    {proposal.memberIds.map((id) => {
      const member = snapshot.model.members.find((item) => item.id === id);
      const before = snapshot.model.sections.find((item) => item.id === member?.sectionId);
      if (!member || !before) return <p key={id}>{id} · 目标或原截面已删除</p>;
      return <div className="section-change-object" key={id}><strong>{member.label} · {id}</strong><p>{before.name} → {proposal.section.name}</p>
        <SectionGeometryPreview geometry={proposal.section.geometry} rotationDegrees={member.rotationDegrees} />
        <dl>{Object.entries(SECTION_PARAMETERS).map(([key, label]) => <div key={key}><dt>{label.replace(/m[²⁴]/g, u.unit(fieldUnit(key)))}</dt><dd>{u.quantity(before[key as keyof typeof SECTION_PARAMETERS], fieldUnit(key))} → {u.quantity(proposal.section[key as keyof typeof SECTION_PARAMETERS], fieldUnit(key))}</dd></div>)}</dl>
      </div>;
    })}
    {snapshot.model.selfWeight.enabled && <p>自重已启用 · {snapshot.model.selfWeight.loadCaseId}。新面积同时改变质量和重算荷载，前后差异包含自重影响。</p>}
    {!snapshot.analysisCurrent && <p className="frame-draft-notice">当前输入没有成功分析基线，确认重算后需另行选择历史分析进行对比。</p>}
    {!current && <p className="frame-draft-notice">目标存在冲突，相关修改已暂停。</p>}
  </>;
  return <ProposalCard title="修改柱截面" label="选柱截面修改方案" visible={visible} current={current} busy={busy} dirty={dirty} details={details}
    updateDisabled={busy || !current}
    confirmLabel={calculate ? "确认并重算" : "确认修改"} onConfirm={onConfirm} onCancelEdit={() => {
      setResource(initialRef); setName(proposal.section.name);
      setGeometry(proposal.section.geometry);
      setParameters(Object.fromEntries(Object.keys(SECTION_PARAMETERS).map((key) => [key, String(proposal.section[key as keyof typeof SECTION_PARAMETERS])])));
      setDirty(false); setError(""); onDirty(false);
    }} rows={[
      { label: "对象", value: `${proposal.memberIds.length} 根选中柱 · ${proposal.memberIds.slice(0, 3).map((id) => snapshot.model.members.find((m) => m.id === id)?.label ?? id).join("、")}${proposal.memberIds.length > 3 ? "等（详情查看范围）" : ""}` },
      { label: "原截面", value: beforeSections.join(" / ") },
      { label: "新截面", changed: previous?.id === proposal.id && JSON.stringify(previous.section) !== JSON.stringify(proposal.section), value: <>{proposal.section.name}{proposal.source === "suggestion" && <small className="proposal-suggestion">建议</small>}</> },
      { label: "自重", value: snapshot.model.selfWeight.enabled ? `已启用 · ${snapshot.model.selfWeight.loadCaseId} · 新面积会影响自重荷载` : "未启用" },
      { label: "后续", value: calculate ? "确认后重算全部杆件响应" : "确认后应用截面，响应需重算" },
    ]}>
    {!current && <p className="frame-draft-notice">目标存在冲突，相关修改已暂停。</p>}
    <form onSubmit={(event) => {
      event.preventDefault();
      try {
        const section = geometry ? { name, geometry } : { name, ...Object.fromEntries(Object.keys(SECTION_PARAMETERS).map((key) => {
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
        {geometry ? SECTION_SHAPE_FIELDS[geometry.shape].map((key) => <label key={key}>{SECTION_DIMENSIONS[key]} ({u.unit("m")})<UnitInput unit="m" aria-label={`新柱截面 ${SECTION_DIMENSIONS[key]}`} value={String((geometry as unknown as Record<string, number>)[key])} onValueChange={(value) => { edit(); setGeometry({ ...geometry, [key]: value.trim() ? Number(value) : NaN } as SectionGeometry); }} /></label>)
          : Object.entries(SECTION_PARAMETERS).map(([key, label]) => <label key={key}>{label.replace(/m[²⁴]/g, u.unit(fieldUnit(key)))}<UnitInput unit={fieldUnit(key)} aria-label={`新柱截面 ${label.replace(/m[²⁴]/g, u.unit(fieldUnit(key)))}`} value={parameters[key]} onValueChange={(value) => { edit(); setParameters({ ...parameters, [key]: value }); }} /></label>)}
      </fieldset>}
      {dirty && <p className="frame-draft-notice">编辑尚未保存，当前三维预览保持原方案。</p>}{error && <p role="alert">{error}</p>}
    </form>
    <details className="proposal-more-actions"><summary>更多操作</summary><div className="frame-proposal-actions"><button disabled={busy || dirty} onClick={onRegenerate}>重新生成截面预览</button><button disabled={busy || dirty} onClick={onReject}>拒绝截面方案</button></div></details>
  </ProposalCard>;
}
