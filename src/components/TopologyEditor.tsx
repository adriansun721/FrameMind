import { useState } from "react";
import type { FrameProject } from "../domain/project";
import { ModelEditConfirmation, prepareModelEditConfirmation, proposeModelEdits } from "../workspace/model-edits";
import { UnitInput, useUnits } from "./UnitPresentation";
import { TopologyImpact } from "./TopologyImpact";

export function TopologyEditor({ project, selectedMemberIds, onCommit, onClose }: {
  project: FrameProject; selectedMemberIds: ReadonlySet<string>; onCommit(project: FrameProject): void; onClose(): void;
}) {
  const units = useUnits();
  const [mode, setMode] = useState<"split_member" | "connect_members">(selectedMemberIds.size > 1 ? "connect_members" : "split_member");
  const [ids, setIds] = useState<string[]>(selectedMemberIds.size ? [...selectedMemberIds] : project.members.slice(0, 1).map((item) => item.id));
  const [point, setPoint] = useState({ x: "0", y: "0", z: "0" });
  const [nodeId, setNodeId] = useState("");
  const [preview, setPreview] = useState<ReturnType<typeof prepareModelEditConfirmation> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reset = () => { setPreview(null); setError(null); };
  const prepare = () => {
    try {
      if (Object.values(point).some((value) => !value.trim() || !Number.isFinite(Number(value)))) throw new Error("请输入有限 XYZ 坐标");
      const proposal = proposeModelEdits(project, { operations: [{ type: mode, memberIds: ids,
        position: { x: Number(point.x), y: Number(point.y), z: Number(point.z) }, ...(nodeId ? { nodeId } : {}) }] });
      setPreview(prepareModelEditConfirmation(project, proposal)); setError(null);
    } catch (cause) { setPreview(null); setError(cause instanceof Error ? cause.message : "无法准备拓扑预览"); }
  };
  return <div className="dialog-backdrop" onMouseDown={onClose}><section className="node-dialog wide-dialog" role="dialog" aria-modal="true" aria-label="显式连接与工程分割" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }} onMouseDown={(event) => event.stopPropagation()}>
    <header><h2>显式连接与工程分割</h2><button className="button ghost" aria-label="关闭" onClick={onClose}>关闭</button></header>
    <p className="dialog-copy">改变正式工程节点和杆件，确认前原拓扑保持。几何交叉不会自动连接；内部计算细分不会创建工程对象。</p>
    <form className="dialog-form topology-form" onSubmit={(event) => { event.preventDefault(); prepare(); }}>
      <label className="field"><span>操作</span><select aria-label="拓扑操作" value={mode} onChange={(event) => { setMode(event.target.value as typeof mode); reset(); }}><option value="split_member">单杆工程分割</option><option value="connect_members">显式连接杆件</option></select></label>
      <label className="field"><span>正式杆件</span><select className="topology-member-select" multiple aria-label="拓扑杆件" value={ids} onChange={(event) => { setIds(Array.from(event.target.selectedOptions, (option) => option.value)); reset(); }}>{project.members.map((member) => <option key={member.id} value={member.id}>{member.label} · {member.id}</option>)}</select></label>
      <small>连接选择两根或更多杆件，按 Ctrl 多选。分割选择一根杆件。</small>
      <div className="coordinate-inputs">{(["x", "y", "z"] as const).map((axis) => <label className="field" key={axis}><span>{axis.toUpperCase()} ({units.unit("m")})</span><UnitInput aria-label={`拓扑 ${axis.toUpperCase()} 坐标`} unit="m" value={point[axis]} onValueChange={(value) => { setPoint({ ...point, [axis]: value }); reset(); }} /></label>)}</div>
      <label className="field"><span>共享节点</span><select aria-label="拓扑共享节点" value={nodeId} onChange={(event) => { const id = event.target.value; setNodeId(id); const node = project.nodes.find((item) => item.id === id); if (node) setPoint({ x: String(node.position.x), y: String(node.position.y), z: String(node.position.z) }); reset(); }}><option value="">创建新共享节点</option>{project.nodes.map((node) => <option key={node.id} value={node.id}>{node.label} · {node.id}</option>)}</select></label>
      <p>材料、截面、截面转角和局部朝向继承；子段均布荷载保持强度与工况，各自作用于原范围的一部分。外端刚接属性保留，新内端刚接；遇未登记端部属性阻止提交。</p>
      {preview && <section aria-label="拓扑影响预览" className="topology-preview">
        <strong>预览 · 修订 {preview.proposal.baseRevision}</strong>
        <TopologyImpact receipts={preview.proposal.preview.topology ?? []} />
        <p>原历史结果保留冻结输入和旧对象含义，当前结果将过期。相关任务需重读替换身份后继续；整组可撤销。</p>
        {project.revision !== preview.proposal.baseRevision && <p role="alert">正式模型已变化，请重新预览。</p>}
      </section>}
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button ghost" onClick={onClose}>取消</button><button type="submit" className="button ghost">预览影响</button><button type="button" className="button primary" disabled={!preview || project.revision !== preview.proposal.baseRevision} onClick={() => {
        if (!preview) return;
        const outcome = new ModelEditConfirmation().confirm(project, preview);
        if (outcome.result.status !== "applied") { setError(outcome.result.message); return; }
        onCommit(outcome.project); onClose();
      }}>确认拓扑变更</button></div>
    </form>
  </section></div>;
}
