import { useMemo, useState } from "react";
import type { CadParseResult } from "../../electron/contracts";
import { buildCadTopologyPreview, type CadPoint } from "../workspace/cad-topology";
import { cadBounds, cadBoundsCorners, transformCadPoint, type CadPose, type CadPoseDecision } from "../workspace/cad-geometry";
import { PagedItems } from "./ProcessDisclosure";
const vector = (p: CadPoint) => [p.x, p.y, p.z];
const text = (p: number[]) => p.map((v) => v.toPrecision(6)).join(", ");
const boxEdges = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];
function projectView(points: number[][]) {
  const projected = points.map(([x, y, z]) => [x - .55 * y, z - .3 * y]);
  const lo = [0, 1].map((i) => projected.length ? Math.min(...projected.map((p) => p[i])) : 0), hi = [0, 1].map((i) => projected.length ? Math.max(...projected.map((p) => p[i])) : 0);
  const scale = Math.min(620 / Math.max(hi[0] - lo[0], .1), 280 / Math.max(hi[1] - lo[1], .1));
  return (p: number[]) => [40 + (p[0] - .55 * p[1] - lo[0]) * scale, 320 - (p[2] - .3 * p[1] - lo[1]) * scale];
}
export function CadTopologyPreview({ result, pose, decisions, approvedContactIds, onPoseChange, onContactsChange, onClose }: {
  result: CadParseResult; pose: CadPose; decisions: CadPoseDecision[]; approvedContactIds: string[];
  onPoseChange(pose: CadPose): void; onContactsChange(ids: string[]): void; onClose(): void;
}) {
  const topology = useMemo(() => buildCadTopologyPreview(result.intermediateState, approvedContactIds), [result, approvedContactIds]);
  const [fields, setFields] = useState(() => [...pose.translationM, ...pose.rotationDegrees].map(String));
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [located, setLocated] = useState<number[]>([]);
  const transform = (p: number[]) => transformCadPoint(p, pose);
  const solids = (result.intermediateState.engineeringGeometry?.solidInstances ?? []).map((solid) => ({ ...solid, corners: cadBoundsCorners(solid.bounds).map(transform) }));
  const nodes = topology.nodes.map((node) => ({ ...node, position: transform(vector(node.position)) }));
  const positions = new Map(nodes.map((node) => [node.id, node.position]));
  const bounds = cadBounds([...nodes.map((node) => node.position), ...solids.flatMap((solid) => solid.corners)]);
  const boundsCorners = bounds ? cadBoundsCorners(bounds) : [];
  const projection = projectView(boundsCorners);
  const line = (a: number[], b: number[], key: string, className: string) => {
    const [x1, y1] = projection(a), [x2, y2] = projection(b);
    return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} className={className} />;
  };
  const exportPreview = async () => {
    try {
      const payload = { schemaVersion: 1, task: "P25-04", previewOnly: true, recordedAt: new Date().toISOString(), requestId: result.requestId,
        inputSha256: result.input.sha256, geometryHash: result.intermediateState.geometryHash, intermediateState: result.intermediateState,
        pose, poseDecisions: decisions, contactDecisions: { geometryHash: result.intermediateState.geometryHash, approvedContactIds },
        topology, posedNodes: nodes, posedBoundingBox: bounds };
      const saved = await window.frameMind.exportCadPreview({ suggestedName: `framemind-p25-04-${result.input.sha256.slice(0, 12)}`, content: JSON.stringify(payload, null, 2) });
      setNotice(saved.status === "saved" ? "预览 JSON 已导出" : "导出已取消");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导出失败"); }
  };
  return <div className="dialog-backdrop" onMouseDown={onClose}>
    <section className="node-dialog wide-dialog cad-topology-dialog" role="dialog" aria-modal="true" aria-label="STEP 工程拓扑预览" onMouseDown={(event) => event.stopPropagation()}>
      <header><h2>STEP 工程拓扑预览</h2><button className="icon-button" onClick={onClose} aria-label="关闭">×</button></header>
      <div className="cad-preview-body">
        <p className="dialog-copy">导入草稿 · 只展示有实体依据的中心线。接触候选需要人工核对，几何接触不代表连接刚度。</p>
        <div className="cad-topology-summary">
          <span>{topology.instanceCount} 个装配实例</span><span>{topology.sourceMemberCount} 条实体中心线</span><span>{topology.nodes.length} 个草稿节点</span><span>{topology.members.length} 个工程分段</span><span>连接候选容差 0.5 mm</span>
        </div>
        <form onSubmit={(event) => {
          event.preventDefault(); const values = fields.map(Number);
          if (fields.some((field) => !field.trim()) || !values.every(Number.isFinite)) { setError("位姿必须是完整的有限数值"); return; }
          onPoseChange({ translationM: [values[0], values[1], values[2]], rotationDegrees: [values[3], values[4], values[5]] }); setError(""); setNotice("草稿位姿已记录");
        }}><fieldset className="cad-pose-controls"><legend>整体位姿</legend>
          {["平移 X（m）", "平移 Y（m）", "平移 Z（m）", "旋转 X（°）", "旋转 Y（°）", "旋转 Z（°）"].map((label, index) => <label key={label}>{label}<input aria-label={label} type="number" step="any" value={fields[index]} onChange={(event) => setFields((current) => current.map((v, i) => i === index ? event.target.value : v))} /></label>)}
          <button type="submit" className="button primary">记录草稿位姿</button>
          <span className="cad-pose-record">全局原点处依次绕 X、Y、Z 旋转，再平移；已记录 {decisions.length} 次决定。</span>
        </fieldset></form>
        <div className="cad-topology-layout">
          <div className="cad-topology-viewport" aria-label="中心线与节点预览">
            <svg viewBox="0 0 700 360" role="img" aria-label="STEP 中心线、节点和包围盒">
              {bounds && boxEdges.map(([a, b], i) => line(boundsCorners[a], boundsCorners[b], `bounds-${i}`, "cad-preview-frame"))}
              {solids.flatMap((solid) => boxEdges.map(([a, b], i) => line(solid.corners[a], solid.corners[b], `${solid.instanceId}-${solid.solidId}-${i}`, located.some((id) => solid.sourceEntityIds.includes(id)) ? "cad-solid-box located" : "cad-solid-box")))}
              {topology.members.map((member) => {
                const start = positions.get(member.startNodeId), end = positions.get(member.endNodeId);
                return start && end ? line(start, end, member.id, member.classification === "split-segment" ? "cad-member cad-member-split" : "cad-member") : null;
              })}
              {nodes.map((node) => { const [x, y] = projection(node.position); return <circle key={node.id} cx={x} cy={y} r={node.mergedFrom.length > 1 ? 5 : 3} className="cad-node"><title>{node.id} · {text(node.position)} m</title></circle>; })}
              <g transform="translate(40 310)">
                <line x2="48" className="cad-axis-x" /><text x="52" y="4">X</text>
                <line x2="-25" y2="15" className="cad-axis-y" /><text x="-32" y="23">Y</text>
                <line y2="-48" className="cad-axis-z" /><text x="-4" y="-54">Z</text>
              </g>
            </svg>
            {bounds && <p className="cad-topology-note">预览范围（m） · 最小 {text(bounds.min)} · 最大 {text(bounds.max)}。阻塞实体以变换后的顶点范围框定位；曲面完整外包络尚未核验。</p>}
          </div>
          <div className="cad-topology-issues"><h3>拓扑诊断 · {topology.issues.length} 项</h3>
            <PagedItems items={topology.issues} label="CAD 拓扑诊断" pageSize={20}>{(items) => <>{items.map((issue, i) => <div className={`cad-topology-issue ${issue.severity}`} key={`${issue.code}-${i}`}>
              <strong>{issue.severity === "blocking" ? "阻塞" : "警告"} · {issue.code}</strong><span>{issue.message}</span>
              {issue.sourceEntityIds?.length ? <button className="button ghost" type="button" title={`来源 #${issue.sourceEntityIds.join(", #")}`} onClick={() => setLocated(issue.sourceEntityIds!)}>定位来源 #{issue.sourceEntityIds[0]}</button> : null}
              {issue.memberIds?.length ? <small>杆件 {issue.memberIds.join("、")}</small> : null}
              {issue.nodeIds?.length ? <small>节点 {issue.nodeIds.join("、")}</small> : null}
            </div>)}</>}</PagedItems>
          </div>
        </div>
        {topology.contacts.length > 0 && <section aria-label="接触候选"><h3>接触候选 · 明确确认后才合并草稿节点</h3>
          <PagedItems items={topology.contacts} label="接触候选">{(items) => <>{items.map((contact) => <label className="cad-contact" key={contact.id}><input type="checkbox" checked={approvedContactIds.includes(contact.id)} onChange={(event) => onContactsChange(event.target.checked ? [...approvedContactIds, contact.id] : approvedContactIds.filter((id) => id !== contact.id))} />{contact.memberIds.join(" / ")} · 距离 {(contact.distanceM * 1000).toPrecision(4)} mm · {contact.basis}</label>)}</>}</PagedItems>
        </section>}
        <details className="cad-topology-details"><summary>实例位置与主轴依据</summary>
          {solids.map((solid) => <p key={`${solid.instanceId}:${solid.solidId}`}>实例 #{solid.instanceId ?? "定义"} · 实体 #{solid.solidId} · {solid.status} · 原位移 {text(solid.transform.slice(0, 3).map((r) => r[3]))} m · 当前范围 {text(cadBounds(solid.corners)!.min)} → {text(cadBounds(solid.corners)!.max)}</p>)}
          <PagedItems items={result.intermediateState.engineeringGeometry?.centerlines ?? []} label="主轴来源">{(items) => <>{items.map((axis) => <p key={axis.id}>{axis.id} · L {axis.lengthM.toPrecision(8)} m · 两端截面顶点 {axis.endSections[0].length} / {axis.endSections[1].length} · {axis.method}</p>)}</>}</PagedItems>
        </details>
        <details className="cad-topology-details"><summary>忽略实体与不支持实体</summary>
          {(result.intermediateState.engineeringGeometry?.definitions ?? []).filter((d) => d.status !== "supported").map((d) => <p key={d.solidId}>实体 #{d.solidId} · {d.reason} · {d.rejections?.join("、")}</p>)}
          {result.intermediateState.ignoredEntities.map((e) => <p key={e.id}>#{e.id} · {e.type} · {e.reason}</p>)}
        </details>
        <details className="cad-topology-details"><summary>导入来源与坐标</summary><dl>
          <div><dt>输入哈希</dt><dd>{result.input.sha256}</dd></div><div><dt>坐标系</dt><dd>{result.intermediateState.normalization.coordinateSystem}</dd></div>
          <div><dt>长度单位</dt><dd>{result.intermediateState.units.sourceLength} → m × {result.intermediateState.units.lengthToM}</dd></div>
          <div><dt>几何哈希</dt><dd>{result.intermediateState.geometryHash ?? "未登记"}</dd></div>
        </dl></details>
        {error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status">{notice}</p>}
      </div>
      <div className="dialog-actions"><button type="button" className="button ghost" onClick={() => void exportPreview()}>导出预览 JSON</button><button type="button" className="button primary" onClick={onClose}>关闭预览</button></div>
    </section>
  </div>;
}
