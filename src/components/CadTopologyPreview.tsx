import { useMemo, useState } from "react";
import type { CadParseResult } from "../../electron/contracts";
import { buildCadTopologyPreview, type CadPoint } from "../workspace/cad-topology";
import { cadBounds, cadBoundsCorners, transformCadPoint, type CadPose, type CadPoseDecision } from "../workspace/cad-geometry";
import { PagedItems } from "./ProcessDisclosure";
import { applyCadAiVerification, buildCadResourceReview, buildCadAiVerificationInput, type CadMaterialResource, type CadAiVerification } from "../workspace/cad-resources";
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
  const [material, setMaterial] = useState<Partial<CadMaterialResource>>({ source: "user" });
  const [rigidJointsConfirmed, setRigidJointsConfirmed] = useState(false);
  const [aiRequestVisible, setAiRequestVisible] = useState(false);
  const [aiResponse, setAiResponse] = useState("");
  const [aiVerification, setAiVerification] = useState<CadAiVerification | null>(null);
  const transform = (p: number[]) => transformCadPoint(p, pose);
  const solids = (result.intermediateState.engineeringGeometry?.solidInstances ?? []).map((solid) => ({ ...solid, corners: cadBoundsCorners(solid.bounds).map(transform) }));
  const nodes = topology.nodes.map((node) => ({ ...node, position: transform(vector(node.position)) }));
  const positions = new Map(nodes.map((node) => [node.id, node.position]));
  const bounds = cadBounds([...nodes.map((node) => node.position), ...solids.flatMap((solid) => solid.corners)]);
  const boundsCorners = bounds ? cadBoundsCorners(bounds) : [];
  const projection = projectView(boundsCorners);
  const resourceReview = useMemo(() => buildCadResourceReview({
    topology,
    centerlines: result.intermediateState.engineeringGeometry?.centerlines ?? [],
    geometryHash: result.intermediateState.geometryHash,
    material,
    rigidJointsConfirmed,
  }), [topology, result, material, rigidJointsConfirmed]);
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
        <section className="cad-resource-review" aria-label="截面材料与刚接核验">
          <h3>截面、材料与刚接假设 · {resourceReview.status === "verified" ? "资源已核验" : resourceReview.status === "blocked" ? "存在阻塞" : "待用户补齐"}</h3>
          <p className="dialog-copy">程序只从端截面证据计算 A、Iy、Iz 和 Saint-Venant J。材料与刚接是独立用户决定；AI 只能读取下方脱敏证据并逐项返回建议。</p>
          <div className="cad-resource-grid">
            {resourceReview.sections.map((section) => <article className={`cad-resource-card ${section.status}`} key={section.id}>
              <strong>{section.id}</strong><span>{section.memberIds.length ? `工程杆件：${section.memberIds.join("、")}` : "未关联工程杆件"}</span>
              {section.properties ? <dl><div><dt>A</dt><dd>{section.properties.areaM2.toPrecision(8)} m²</dd></div><div><dt>Iy</dt><dd>{section.properties.secondMomentYM4.toPrecision(8)} m⁴</dd></div><div><dt>Iz</dt><dd>{section.properties.secondMomentZM4.toPrecision(8)} m⁴</dd></div><div><dt>J</dt><dd>{section.properties.torsionalConstantM4?.toPrecision(8) ?? "未计算"} m⁴</dd></div></dl> : null}
              <small>{section.basis.method} · {section.basis.applicability} · 不确定性：{section.basis.uncertainty}</small>
              <small>参考：{section.basis.references.join("；") || "未登记独立参考"}</small>
              {section.issues.map((issue) => <span className="cad-resource-issue" key={issue}>{issue}</span>)}
              <small>来源实体：{section.sourceEntityIds.map((id) => `#${id}`).join(", ") || "无"}</small>
            </article>)}
          </div>
          <fieldset className="cad-resource-controls"><legend>材料（缺失时必须由用户确认）</legend>
            <label>名称<input aria-label="导入材料名称" value={material.name ?? ""} onChange={(event) => setMaterial((current) => ({ ...current, name: event.target.value }))} /></label>
            <label>E（GPa）<input aria-label="导入材料弹性模量" type="number" step="any" value={material.elasticModulusGPa ?? ""} onChange={(event) => setMaterial((current) => ({ ...current, elasticModulusGPa: event.target.value === "" ? undefined : Number(event.target.value) }))} /></label>
            <label>ν<input aria-label="导入材料泊松比" type="number" step="any" value={material.poissonRatio ?? ""} onChange={(event) => setMaterial((current) => ({ ...current, poissonRatio: event.target.value === "" ? undefined : Number(event.target.value) }))} /></label>
            <label>ρ（kg/m³）<input aria-label="导入材料密度" type="number" step="any" value={material.densityKgM3 ?? ""} onChange={(event) => setMaterial((current) => ({ ...current, densityKgM3: event.target.value === "" ? undefined : Number(event.target.value) }))} /></label>
            <label className="cad-joint-confirm"><input type="checkbox" checked={Boolean(material.confirmed)} onChange={(event) => setMaterial((current) => ({ ...current, confirmed: event.target.checked }))} />确认材料来源与参数</label>
          </fieldset>
          <label className="cad-joint-confirm"><input type="checkbox" checked={rigidJointsConfirmed} onChange={(event) => setRigidJointsConfirmed(event.target.checked)} />我明确确认已审查的工程连接按刚接建模（几何接触不自动代表刚接）</label>
          <div className="cad-resource-checks"><strong>确定性检查</strong>{resourceReview.checks.map((check) => <div key={check.code} className={`cad-resource-check ${check.status}`}><span>{check.status === "passed" ? "通过" : check.status === "failed" ? "阻塞" : "待确认"} · {check.code}</span><small>{check.message}</small></div>)}</div>
          <button className="button ghost" type="button" onClick={() => setAiRequestVisible((visible) => !visible)}>{aiRequestVisible ? "隐藏" : "生成"} AI 只读核验摘要</button>
          {aiRequestVisible && <><pre className="cad-ai-evidence">{JSON.stringify(buildCadAiVerificationInput(resourceReview), null, 2)}</pre><label className="cad-ai-response">粘贴 AI 结构化核验响应（只接受引用上述 evidence 的条目）<textarea value={aiResponse} onChange={(event) => setAiResponse(event.target.value)} rows={4} /></label><button className="button ghost" type="button" onClick={() => { try { setAiVerification(applyCadAiVerification(resourceReview, JSON.parse(aiResponse)).ai); setNotice("AI 核验响应已按只读规则记录"); } catch { setAiVerification({ status: "invalid", request: buildCadAiVerificationInput(resourceReview) }); setNotice("AI 核验响应不是有效 JSON；不能生成通过回执"); } }}>校验 AI 响应</button>{aiVerification && <p role="status">AI 状态：{aiVerification.status}（程序阻塞项不会被 AI 覆盖）</p>}</>}
        </section>
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
