import { useMemo, useState } from "react";
import type { AiSnapshot } from "../workspace/ai-tools";
import { buildFramePreview, editFrameParameter, FRAME_FIELDS, frameResourceOptions, type FrameField, type FrameProposal, type ParameterValue } from "../workspace/frame-proposal";
import { ProposalCard } from "./ProposalCard";

interface Props {
  snapshot: AiSnapshot; proposal: FrameProposal; busy: boolean;
  current: boolean; baseRevision: number; visible?: boolean; onConfirm(): void;
  onChange(proposal: FrameProposal): void; onDirty(dirty: boolean): void; onReject(): void;
}
const valueText = (value: ParameterValue | undefined) => Array.isArray(value) ? value.join(", ") : value === undefined ? "" : String(value);

export function FrameProposalCard({ snapshot, proposal, busy, current, baseRevision, visible, onConfirm, onChange, onDirty, onReject }: Props) {
  const fields = Object.keys(FRAME_FIELDS) as FrameField[];
  const [texts, setTexts] = useState(() => Object.fromEntries(fields.map((field) => [field, valueText(proposal.parameters[field]?.value)])) as Record<FrameField, string>);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const preview = useMemo(() => buildFramePreview(snapshot, proposal), [snapshot, proposal]);
  const [objectPage, setObjectPage] = useState(0);
  const nodeLabels = new Map(preview.nodes.map((node) => [node.id, node.label]));
  const update = () => {
    try {
      let next = proposal;
      const changes: FrameProposal["changes"] = [];
      for (const field of fields) {
        if (texts[field] !== valueText(proposal.parameters[field]?.value) || proposal.parameters[field]?.conflict !== undefined) {
          next = editFrameParameter(next, field, texts[field]); changes.push(...next.changes);
        }
      }
      onChange({ ...next, version: Math.max(next.version, proposal.version + 1), changes }); setDirty(false); setError(""); onDirty(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "参数无效"); }
  };
  const parameter = (field: FrameField, unit = "", compact = true) => {
    const p = proposal.parameters[field];
    const text = ["material", "columnSection", "beamSection"].includes(field)
      ? compact ? snapshot.model.materials.find((item) => item.id === p?.value)?.name ?? snapshot.model.sections.find((item) => item.id === p?.value)?.name
        ?? frameResourceOptions(snapshot, field).find((option) => option.value === p?.value)?.label.split(" · ")[0] ?? valueText(p?.value)
        : frameResourceOptions(snapshot, field).find((option) => option.value === p?.value)?.label ?? valueText(p?.value)
      : valueText(p?.value);
    return <span className={proposal.changes.some((change) => change.field === field) ? "proposal-row-changed" : undefined}>{p ? `${text}${unit}` : "缺失"}{p?.source === "suggestion" && <small className="proposal-suggestion">建议</small>}</span>;
  };
  const details = <>
    <p>V{proposal.version} · 基础 R{baseRevision} · 未应用</p>
    <p>正交网格 · Z 向分层 · 各层双向梁、连续柱 · 所有杆端刚接</p>
    <dl className="proposal-summary">{fields.map((field) => <div key={field}><dt>{FRAME_FIELDS[field]}</dt><dd>{parameter(field, "", false)}{proposal.parameters[field]?.source === "user" && <small className="proposal-source">用户提供</small>}</dd></div>)}</dl>
    <p>支座与荷载尚未设置。此方案未进入正式模型或分析输入。</p>
    <h4>涉及对象与创建内容</h4><div className="frame-object-list">
      {[...preview.nodes, ...preview.members].slice(objectPage * 100, (objectPage + 1) * 100).map((object) => <div key={object.id}>{object.label} · {"position" in object
        ? `(${object.position.x}, ${object.position.y}, ${object.position.z}) m`
        : `${object.role === "column" ? "柱" : "梁"} · ${nodeLabels.get(object.startNodeId)} → ${nodeLabels.get(object.endNodeId)} · ${preview.sections.find((section) => section.id === object.sectionId)?.name}`}</div>)}
    </div><div className="frame-proposal-actions"><button disabled={objectPage === 0} onClick={() => setObjectPage((page) => page - 1)}>上一页对象</button><span>第 {objectPage + 1} 页 · 共 {preview.nodes.length + preview.members.length} 对象</span><button disabled={(objectPage + 1) * 100 >= preview.nodes.length + preview.members.length} onClick={() => setObjectPage((page) => page + 1)}>下一页对象</button></div>
    {proposal.changes.length > 0 && <><h4>本次参数变化</h4>{proposal.changes.map((change) => <p key={change.field}>{FRAME_FIELDS[change.field]}：{valueText(change.before) || "缺失"} → {valueText(change.after)}</p>)}</>}
  </>;
  return <ProposalCard title="空间刚架建模方案" label="建模参数卡片" visible={visible} current={current} busy={busy} dirty={dirty} issues={preview.issues}
    confirmLabel="确认建模" onConfirm={onConfirm} details={details} onCancelEdit={() => {
      setTexts(Object.fromEntries(fields.map((field) => [field, valueText(proposal.parameters[field]?.value)])) as Record<FrameField, string>);
      setDirty(false); setError(""); onDirty(false);
    }} rows={[
      { label: "布置", value: <>{parameter("storeys", " 层")} · X：{parameter("xSpans", " m")} · Y：{parameter("ySpans", " m")}</> },
      { label: "层高", value: parameter("storeyHeights", " m") },
      { label: "材料", value: parameter("material") },
      { label: "截面", value: <>柱：{parameter("columnSection")}<br />梁：{parameter("beamSection")}</> },
      { label: "定位", value: <>原点 {parameter("origin", " m")} · 截面转角 {parameter("rotationDegrees", "°")}</> },
      { label: "规模", value: <span data-testid="frame-proposal-counts">{preview.issues.length ? "补齐参数后生成" : `${preview.nodes.length} 节点 · ${preview.members.filter((member) => member.role === "column").length} 柱 · ${preview.members.filter((member) => member.role === "beam").length} 梁`}</span> },
    ]}>
    <form onSubmit={(event) => { event.preventDefault(); update(); }}>
      {fields.map((field) => {
        const parameter = proposal.parameters[field];
        const isResource = ["material", "columnSection", "beamSection"].includes(field);
        const change = (value: string) => { setTexts((previous) => ({ ...previous, [field]: value })); setDirty(true); onDirty(true); setError(""); };
        return <div className="frame-parameter" key={field}>
          <label><span>{FRAME_FIELDS[field]}</span><small>{parameter ? parameter.source === "user" ? "用户提供" : "建议 · 待确认" : "尚缺失"}</small>
            {isResource ? <select aria-label={FRAME_FIELDS[field]} value={texts[field]} disabled={busy} onChange={(event) => change(event.target.value)}>
              <option value="">请选择</option>
              {parameter && !frameResourceOptions(snapshot, field).some((option) => option.value === texts[field]) && <option value={texts[field]}>{texts[field]}（资源不存在）</option>}
              {frameResourceOptions(snapshot, field).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select> : <input aria-label={FRAME_FIELDS[field]} value={texts[field]} placeholder={field === "storeyHeights" ? "如：3, 3（两层）" : field === "origin" ? "如：0, 0, 0" : "输入数值；多项用逗号分隔"} disabled={busy} onChange={(event) => change(event.target.value)} />}
          </label>
          {parameter?.conflict !== undefined && <div className="frame-conflict" role="alert">待澄清：当前 {valueText(parameter.value)} / 新值 {valueText(parameter.conflict)}。编辑选定值后更新。</div>}
        </div>;
      })}
      {error && <p role="alert" className="frame-conflict">{error}</p>}
      {dirty && <p className="frame-draft-notice">编辑尚未保存，当前三维预览保持原方案。</p>}
    </form>
    <details className="proposal-more-actions"><summary>更多操作</summary><div className="frame-proposal-actions"><button disabled={busy || dirty} onClick={() => onChange({ ...proposal, version: proposal.version + 1, changes: [] })}>重新生成预览</button><button disabled={dirty} onClick={onReject}>拒绝方案</button></div></details>
  </ProposalCard>;
}
