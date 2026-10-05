import { useState } from "react";
import type { FrameProject, NodeId } from "../domain/project";
import { GEOMETRY_CONTRACT } from "../domain/geometry-policy";
import { inspectNearNodes, inspectNodeMerge, type NodeMergeImpact as Impact } from "../domain/node-merge";
import { ModelEditConfirmation, prepareModelEditConfirmation, proposeModelEdits } from "../workspace/model-edits";
import { NodeMergeImpact } from "./NodeMergeImpact";
import { UnitInput, useUnits } from "./UnitPresentation";

export function NodeMergeEditor({ project, onCommit, onClose }: { project: FrameProject; onCommit(project: FrameProject): void; onClose(): void }) {
  const u = useUnits();
  const [tolerance, setTolerance] = useState(String(GEOMETRY_CONTRACT.nodeMerge.defaultToleranceM));
  const [scan, setScan] = useState<ReturnType<typeof inspectNearNodes> | null>(null);
  const [ids, setIds] = useState<NodeId[]>([]); const [target, setTarget] = useState<NodeId | "">("");
  const [impact, setImpact] = useState<Impact | null>(null);
  const [support, setSupport] = useState("");
  const [choices, setChoices] = useState<Record<string, string>>({}); const [accept, setAccept] = useState(false);
  const [preview, setPreview] = useState<ReturnType<typeof prepareModelEditConfirmation> | null>(null); const [error, setError] = useState<string | null>(null);
  const reset = () => { setImpact(null); setPreview(null); setChoices({}); setSupport(""); setAccept(false); setError(null); };
  const run = (action: () => void) => { try { action(); setError(null); } catch (cause) { setPreview(null); setError(cause instanceof Error ? cause.message : "无法核对合并影响"); } };
  const input = () => { if (!tolerance.trim()) throw new Error("请输入明确长度容差"); return { nodeIds: ids, targetNodeId: target as NodeId, tolerance: Number(tolerance) }; };
  const choice = (id: string) => <select aria-label={`处理 ${id}`} value={choices[id] ?? ""} onChange={(event) => { setChoices({ ...choices, [id]: event.target.value }); setPreview(null); }}><option value="">请选择</option><option value="keep">保留</option><option value="remove">移除</option></select>;
  const review = () => run(() => {
    if (!impact || impact.baseRevision !== project.revision) throw new Error("请重新检查合并影响");
    if (impact.supports.length && !support) throw new Error("请选择保留的支座或明确全部移除");
    const conflicting = new Set([...impact.zeroLengthMemberIds, ...impact.duplicateMemberGroups.flat()]);
    const decisions = [...impact.nodalLoads.map((l) => l.id), ...conflicting];
    if (decisions.some((id) => !choices[id])) throw new Error("请逐项解决节点荷载、零长和重复杆件的保留／移除");
    const keepMemberIds = impact.members.filter((m) => !conflicting.has(m.before.id) || choices[m.before.id] === "keep").map((m) => m.before.id);
    const removedLoads = impact.uniformLoads.filter((l) => !keepMemberIds.includes(l.memberId));
    if (removedLoads.some((l) => choices[l.id] !== "remove")) throw new Error("请逐项确认随杆移除的均布荷载");
    const proposal = proposeModelEdits(project, { operations: [{ type: "merge_nodes", ...input(), resolution: {
      keepSupportIds: support === "none" || !impact.supports.length ? [] : [support],
      keepNodalLoadIds: impact.nodalLoads.filter((l) => choices[l.id] === "keep").map((l) => l.id), keepMemberIds,
      removeUniformLoadIds: removedLoads.map((l) => l.id), acceptGeometryChange: accept,
    } }] });
    setPreview(prepareModelEditConfirmation(project, proposal));
  });
  return <div className="dialog-backdrop" onMouseDown={onClose}><section className="node-dialog wide-dialog node-merge-dialog" role="dialog" aria-modal="true" aria-label="近重合检查与节点合并" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
    <header><h2>近重合检查与节点合并</h2><button className="button ghost" onClick={onClose}>关闭</button></header>
    <form className="dialog-form topology-form" onSubmit={(e) => { e.preventDefault(); review(); }}>
      <p>检查不会自动连接。容差为固定工程长度，不随缩放或坐标尺度改变；每个节点须在指定目标的容差内。</p>
      <label className="field"><span>近重合容差 ({u.unit("m")})</span><UnitInput aria-label="近重合容差" unit="m" value={tolerance} onValueChange={(v) => { setTolerance(v); setScan(null); reset(); }} /></label>
      <button type="button" className="button ghost" onClick={() => run(() => { if (!tolerance.trim()) throw new Error("请输入明确长度容差"); setScan(inspectNearNodes(project, Number(tolerance))); })}>检查近重合</button>
      {scan && <section aria-label="近重合检查结果"><p>修订 {scan.revision} · {scan.pairs.length} 对节点；距离单位 {u.unit("m")}</p><ul>{scan.pairs.map((pair) => <li key={pair.nodeIds.join(":")}><button type="button" className="button ghost" onClick={() => { setIds(pair.nodeIds); setTarget(pair.nodeIds[0]); reset(); }}>{pair.nodeIds.join(" / ")} · {u.number(pair.distance, "m")} {u.unit("m")} · {pair.kind === "duplicate" ? "重复" : "近重合"}</button></li>)}</ul>{scan.revision !== project.revision && <p role="alert">模型已变化，请重新检查。</p>}</section>}
      <label className="field"><span>合并节点（Ctrl 多选）</span><select className="topology-member-select" multiple aria-label="合并节点" value={ids} onChange={(e) => { setIds(Array.from(e.target.selectedOptions, (o) => o.value as NodeId)); setTarget(""); reset(); }}>{project.nodes.map((n) => <option key={n.id} value={n.id}>{n.label} · {n.id}</option>)}</select></label>
      <label className="field"><span>保留目标节点身份与坐标</span><select aria-label="合并目标节点" value={target} onChange={(e) => { setTarget(e.target.value as NodeId); reset(); }}><option value="">请选择目标</option>{ids.map((id) => <option key={id} value={id}>{id}</option>)}</select></label>
      <button type="button" className="button ghost" onClick={() => { reset(); run(() => setImpact(inspectNodeMerge(project, input()))); }}>检查合并影响</button>
      {impact && <><NodeMergeImpact impact={impact} />
        {!!impact.supports.length && <label className="field"><span>支座冲突处理</span><select aria-label="保留支座" value={support} onChange={(e) => { setSupport(e.target.value); setPreview(null); }}><option value="">请选择</option><option value="none">明确全部移除</option>{impact.supports.map((s) => <option key={s.id} value={s.id}>仅保留 {s.id}</option>)}</select></label>}
        {impact.nodalLoads.map((l) => <label className="field" key={l.id}><span>节点荷载 {l.id} · {l.loadCaseId}</span>{choice(l.id)}</label>)}
        {[...new Set([...impact.zeroLengthMemberIds, ...impact.duplicateMemberGroups.flat()])].map((id) => <label className="field" key={id}><span>冲突杆件 {id}{impact.zeroLengthMemberIds.includes(id) ? "（零长须移除）" : "（重复可明确保留为并联）"}</span>{choice(id)}</label>)}
        {impact.uniformLoads.filter((l) => choices[l.memberId] === "remove").map((l) => <label className="field" key={l.id}><span>随杆移除均布荷载 {l.id}</span><input type="checkbox" aria-label={`移除 ${l.id}`} checked={choices[l.id] === "remove"} onChange={(e) => { setChoices({ ...choices, [l.id]: e.target.checked ? "remove" : "" }); setPreview(null); }} /></label>)}
        <label><input type="checkbox" aria-label="接受合并几何变化" checked={accept} onChange={(e) => { setAccept(e.target.checked); setPreview(null); }} /> 接受目标坐标、杆长、局部朝向及局部荷载方向变化</label>
      </>}
      {preview && <section className="topology-preview" aria-label="成组合并预览"><strong>修订 {preview.proposal.baseRevision} · 成组提案</strong><NodeMergeImpact impact={preview.proposal.preview.nodeMerges![0]} /></section>}
      {impact && impact.baseRevision !== project.revision && <p role="alert">正式模型已变化，请重新检查合并影响。</p>}
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button ghost" onClick={onClose}>取消</button><button type="submit" className="button ghost" disabled={!impact}>预览成组合并</button><button type="button" className="button primary" disabled={!preview || project.revision !== preview.proposal.baseRevision} onClick={() => {
        if (!preview) return;
        const outcome = new ModelEditConfirmation().confirm(project, preview);
        if (outcome.result.status !== "applied") { setError(outcome.result.message); return; }
        onCommit(outcome.project); onClose();
      }}>确认节点合并</button></div>
    </form>
  </section></div>;
}
