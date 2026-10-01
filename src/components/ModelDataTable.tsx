import { useEffect, useState } from "react";
import { Crosshair, RotateCcw, Save, X } from "lucide-react";
import type { FrameProject } from "../domain/project";
import type { AnalysisTarget } from "../domain/analysis-diagnostics";

export interface NodeDraft { x: string; y: string; z: string; }
export interface MemberDraft { startNodeId: string; endNodeId: string; materialId: string; sectionId: string; rotationDegrees: string; }

interface ModelDataTableProps {
  project: FrameProject;
  selection: AnalysisTarget | null;
  nodeDraft: NodeDraft;
  memberDraft: MemberDraft;
  error: string | null;
  selectedNodeIds: Set<string>;
  selectedMemberIds: Set<string>;
  onNodeDraft(draft: NodeDraft): void;
  onMemberDraft(draft: MemberDraft): void;
  onSelect(selection: AnalysisTarget): void;
  onToggleSelection(kind: "node" | "member", id: string): void;
  onDuplicate(kind: "node" | "member"): void;
  onDelete(kind: "node" | "member"): void;
  onBatchEdit(kind: "node" | "member"): void;
  onSaveNode(event: React.FormEvent): void;
  onSaveMember(event: React.FormEvent): void;
  onClose(): void;
}

export function ModelDataTable({ project, selection, nodeDraft, memberDraft, error, selectedNodeIds, selectedMemberIds, onNodeDraft, onMemberDraft, onSelect, onToggleSelection, onDuplicate, onDelete, onBatchEdit, onSaveNode, onSaveMember, onClose }: ModelDataTableProps) {
  const [tab, setTab] = useState<"node" | "member">(selection?.kind === "member" ? "member" : "node");
  useEffect(() => {
    if (selection?.kind === "node" || selection?.kind === "member") setTab(selection.kind);
  }, [selection]);
  const editable = selection?.kind === tab;

  return <section className="model-data-table" aria-label="模型数据表">
    <header className="data-table-heading">
      <div role="tablist" aria-label="模型数据类型">
        <button role="tab" aria-selected={tab === "node"} onClick={() => setTab("node")}>节点 ({project.nodes.length})</button>
        <button role="tab" aria-selected={tab === "member"} onClick={() => setTab("member")}>杆件 ({project.members.length})</button>
      </div>
      <span>R{project.revision}</span>
      <div className="data-table-actions">{(tab === "node" ? selectedNodeIds.size : selectedMemberIds.size) > 0 && <><button type="button" className="table-action" onClick={() => onBatchEdit(tab)}>批量修改</button><button type="button" className="table-action" onClick={() => onDuplicate(tab)}>复制选中</button><button type="button" className="table-action danger" onClick={() => onDelete(tab)}>删除选中</button></>}</div>
      <button className="icon-button" aria-label="关闭数据表" title="关闭数据表" onClick={onClose}><X size={15} /></button>
    </header>
    {editable && error && <p className="data-table-error" id="table-edit-error" role="alert">{error}</p>}
    <form className="data-table-scroll" noValidate onSubmit={tab === "node" ? onSaveNode : onSaveMember}>
      {tab === "node" ? <table aria-label="节点数据"><thead><tr><th aria-label="选择" /><th>节点</th><th>X (m)</th><th>Y (m)</th><th>Z (m)</th><th>已应用坐标 (m)</th><th>操作</th></tr></thead>
        <tbody>{project.nodes.map((node) => {
          const selected = selection?.kind === "node" && selection.id === node.id;
          const checked = selectedNodeIds.has(node.id);
          return <tr key={node.id} aria-selected={selected}>
            <td><input type="checkbox" aria-label={`选择节点 ${node.label}`} checked={checked} onChange={() => onToggleSelection("node", node.id)} /></td>
            <th scope="row"><button type="button" className="data-object-location" aria-label={`定位节点 ${node.label}`} title={`${node.label} · ${node.id}`} onClick={() => onSelect({ kind: "node", id: node.id })}><Crosshair size={13} />{node.label}</button></th>
            {(["x", "y", "z"] as const).map((axis) => <td key={axis}>{selected ? <input type="number" step="any" aria-label={`${node.label} ${axis.toUpperCase()} 坐标`} aria-invalid={!!error?.includes(`${axis.toUpperCase()} 坐标`)} aria-describedby={error ? "table-edit-error" : undefined} value={nodeDraft[axis]} onChange={(event) => onNodeDraft({ ...nodeDraft, [axis]: event.target.value })} /> : node.position[axis]}</td>)}
            <td className="committed-value">{node.position.x}, {node.position.y}, {node.position.z}</td>
            <td>{selected && <RowActions label={node.label} reset={() => onSelect({ kind: "node", id: node.id })} />}</td>
          </tr>;
        })}</tbody></table> : <table aria-label="杆件数据"><thead><tr><th aria-label="选择" /><th>杆件</th><th>起点</th><th>终点</th><th>材料</th><th>截面</th><th>转角 (°)</th><th>操作</th></tr></thead>
        <tbody>{project.members.map((member) => {
          const selected = selection?.kind === "member" && selection.id === member.id;
          const checked = selectedMemberIds.has(member.id);
          const references = [
            { field: "startNodeId", label: "起点节点", options: project.nodes.map((item) => ({ id: item.id, label: item.label })) },
            { field: "endNodeId", label: "终点节点", options: project.nodes.map((item) => ({ id: item.id, label: item.label })) },
            { field: "materialId", label: "材料", options: project.materials.map((item) => ({ id: item.id, label: `${item.label} · ${item.name}` })) },
            { field: "sectionId", label: "截面", options: project.sections.map((item) => ({ id: item.id, label: `${item.label} · ${item.name}` })) },
          ] as const;
          return <tr key={member.id} aria-selected={selected}>
            <td><input type="checkbox" aria-label={`选择杆件 ${member.label}`} checked={checked} onChange={() => onToggleSelection("member", member.id)} /></td>
            <th scope="row"><button type="button" className="data-object-location" aria-label={`定位杆件 ${member.label}`} title={`${member.label} · ${member.id}`} onClick={() => onSelect({ kind: "member", id: member.id })}><Crosshair size={13} />{member.label}</button></th>
            {references.map(({ field, label, options }) => <td key={field}>{selected ? <select aria-label={`${member.label} ${label}`} value={memberDraft[field]} aria-invalid={!!error?.includes(label)} aria-describedby={error ? "table-edit-error" : undefined} onChange={(event) => onMemberDraft({ ...memberDraft, [field]: event.target.value })}>{options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : options.find((item) => item.id === member[field])?.label}</td>)}
            <td>{selected ? <input type="number" step="any" aria-label={`${member.label} 截面转角`} aria-invalid={!!error?.includes("截面转角")} aria-describedby={error ? "table-edit-error" : undefined} value={memberDraft.rotationDegrees} onChange={(event) => onMemberDraft({ ...memberDraft, rotationDegrees: event.target.value })} /> : member.rotationDegrees}</td>
            <td>{selected && <RowActions label={member.label} reset={() => onSelect({ kind: "member", id: member.id })} />}</td>
          </tr>;
        })}</tbody></table>}
      {(tab === "node" ? project.nodes : project.members).length === 0 && <p className="data-table-empty">{tab === "node" ? "暂无节点" : "暂无杆件"}</p>}
    </form>
  </section>;
}

function RowActions({ label, reset }: { label: string; reset(): void }) {
  return <div className="data-row-actions"><button type="submit" className="icon-button" aria-label={`保存 ${label}`} title={`保存 ${label}`}><Save size={14} /></button><button type="button" className="icon-button" aria-label={`还原 ${label} 草稿`} title="还原为已应用值" onClick={reset}><RotateCcw size={14} /></button></div>;
}
