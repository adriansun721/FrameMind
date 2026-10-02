import { useMemo, useState } from "react";
import type { AiSnapshot } from "../workspace/ai-tools";
import { buildFramePreview, editFrameParameter, FRAME_FIELDS, frameResourceOptions, type FrameField, type FrameProposal, type ParameterValue } from "../workspace/frame-proposal";

interface Props {
  snapshot: AiSnapshot; proposal: FrameProposal; busy: boolean;
  onChange(proposal: FrameProposal): void; onDirty(dirty: boolean): void; onReject(): void;
}
const valueText = (value: ParameterValue | undefined) => Array.isArray(value) ? value.join(", ") : value === undefined ? "" : String(value);

export function FrameProposalCard({ snapshot, proposal, busy, onChange, onDirty, onReject }: Props) {
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
      onChange({ ...next, changes }); setDirty(false); setError(""); onDirty(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "参数无效"); }
  };
  return <section className="frame-proposal-card" aria-label="建模参数卡片">
    <div className="frame-proposal-heading"><strong>空间刚架 · 建模方案</strong><span>V{proposal.version} · 未应用</span></div>
    <p>正交网格 · Z 向分层 · 各层双向梁、连续柱 · 所有杆端刚接</p>
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
      {dirty && <p className="frame-draft-notice">参数编辑尚未更新，三维预览已暂停。</p>}
      <div className="frame-proposal-actions"><button type="submit" disabled={busy}>更新参数预览</button>
        <button type="button" disabled={busy || dirty} onClick={() => onChange({ ...proposal, version: proposal.version + 1, changes: [] })}>重新生成预览</button>
        <button type="button" onClick={onReject}>拒绝方案</button></div>
    </form>
    {preview.issues.length ? <ul className="frame-issues">{preview.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <>
      <p data-testid="frame-proposal-counts">将创建 {preview.nodes.length} 个节点、{preview.members.filter((member) => member.role === "column").length} 根柱、{preview.members.filter((member) => member.role === "beam").length} 根梁。</p>
      <p>支座与荷载尚未设置。此方案未进入正式模型或分析输入。</p>
      <details><summary>涉及对象与创建内容</summary><div className="frame-object-list">
        {[...preview.nodes, ...preview.members].slice(objectPage * 100, (objectPage + 1) * 100).map((object) => <div key={object.id}>{object.label} · {"position" in object
          ? `(${object.position.x}, ${object.position.y}, ${object.position.z}) m`
          : `${object.role === "column" ? "柱" : "梁"} · ${nodeLabels.get(object.startNodeId)} → ${nodeLabels.get(object.endNodeId)} · ${preview.sections.find((section) => section.id === object.sectionId)?.name}`}</div>)}
      </div><div className="frame-proposal-actions"><button disabled={objectPage === 0} onClick={() => setObjectPage((page) => page - 1)}>上一页对象</button><span>第 {objectPage + 1} 页 · 共 {preview.nodes.length + preview.members.length} 对象</span><button disabled={(objectPage + 1) * 100 >= preview.nodes.length + preview.members.length} onClick={() => setObjectPage((page) => page + 1)}>下一页对象</button></div></details>
    </>}
    {proposal.changes.length > 0 && <details><summary>本次参数变化</summary>{proposal.changes.map((change) => <p key={change.field}>{FRAME_FIELDS[change.field]}：{valueText(change.before) || "缺失"} → {valueText(change.after)}</p>)}</details>}
  </section>;
}
