import type { NodeMergeImpact as Impact, NodeMergeReceipt } from "../domain/node-merge";
import { useUnits } from "./UnitPresentation";

export function NodeMergeImpact({ impact }: { impact: Impact | NodeMergeReceipt }) {
  const u = useUnits();
  const vector = (v: { x: number; y: number; z: number }, unit: string) => `${[v.x, v.y, v.z].map((n) => u.number(n, unit)).join(", ")} ${u.unit(unit)}`;
  const direction = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z].map((n) => Number(n.toPrecision(8))).join(", ");
  return <section className="topology-impact" aria-label="节点合并影响">
    <p>目标 {impact.targetNodeId} · 坐标 ({vector(impact.targetPosition, "m")})；容差 {u.number(impact.tolerance, "m")} {u.unit("m")}</p>
    <p>到目标距离：{impact.distances.map((d) => `${d.nodeId}: ${u.number(d.distance, "m")} ${u.unit("m")}`).join("；")}</p>
    {!!impact.pointMasses?.length && <p>附加点质量明确相加至目标节点：{impact.pointMasses.map((p) => `${p.nodeId}: ${u.quantity(p.massKg, "kg")}`).join("；")}。线质量随保留杆件，移除杆件时一同移除，杆长变化时总量随长度变化。</p>}
    <ul>{impact.members.map((m) => <li key={m.before.id}>{m.before.id}: {m.before.startNodeId} → {m.before.endNodeId} ⇒ {m.after.startNodeId} → {m.after.endNodeId} · 材料 {m.before.materialId} · 截面 {m.before.sectionId} · 转角 {m.before.rotationDegrees}° · 杆长 {u.number(m.geometryBefore.length, "m")} → {m.geometryAfter ? u.number(m.geometryAfter.length, "m") : "0（须移除）"} {u.unit("m")}</li>)}</ul>
    <p>零长杆：{impact.zeroLengthMemberIds.join("、") || "无"}；重复杆件：{impact.duplicateMemberGroups.map((ids) => ids.join(" / ")).join("；") || "无"}。重复杆保留多个表示并联构件，荷载随各自杆件保留。</p>
    <details><summary>局部朝向核对（方向余弦，无量纲）</summary>{impact.members.map((m) => <p key={m.before.id}>{m.before.id}: {(["localX", "localY", "localZ"] as const).map((axis) => `${axis}: (${direction(m.geometryBefore[axis])}) → ${m.geometryAfter ? `(${direction(m.geometryAfter[axis])})` : "零长"}`).join("；")}</p>)}</details>
    <ul>{impact.supports.map((s) => <li key={s.id}>支座 {s.id} @ {s.nodeId} · [UX UY UZ RX RY RZ] = {s.restraints.map((v) => v ? "约束" : "自由").join(" / ")}</li>)}</ul>
    <ul>{impact.nodalLoads.map((l) => <li key={l.id}>节点荷载 {l.id} @ {l.nodeId} · {l.loadCaseId} · 力 ({vector(l.force, "kN")}) · 力矩 ({vector(l.moment, "kN·m")})</li>)}</ul>
    <ul>{impact.uniformLoads.map((l) => <li key={l.id}>均布荷载 {l.id} @ {l.memberId} · {l.loadCaseId} · {l.coordinateSystem} · ({vector(l.intensity, "kN/m")})</li>)}</ul>
    {"resolution" in impact && <p>明确保留：支座 {impact.resolution.keepSupportIds.join("、") || "无"}；节点荷载 {impact.resolution.keepNodalLoadIds.join("、") || "无"}；杆件 {impact.resolution.keepMemberIds.join("、") || "无"}。移除均布荷载：{impact.resolution.removeUniformLoadIds.join("、") || "无"}。移除节点 {impact.removedNodeIds.join("、")} → {impact.targetNodeId}。</p>}
    <p>任务引用：{impact.taskReferences.map((ref) => `${ref.taskId}: ${ref.kind} ${ref.id}`).join("；") || "无已保存引用"}。相关任务需重读目标身份；计算中的冻结输入保留原含义。</p>
    <p>目标坐标保持；杆长、局部朝向和局部荷载方向按新端点重新计算，全局荷载分量保持。保留多个节点荷载表示明确叠加，不合并记录或跨工况累加。历史结果保留冻结输入，当前结果按依赖过期；整组可撤销。</p>
  </section>;
}
