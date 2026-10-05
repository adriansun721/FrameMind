import type { TopologyReceipt } from "../domain/topology";

export function TopologyImpact({ receipts }: { receipts: readonly TopologyReceipt[] }) {
  return <section className="topology-impact" aria-label="拓扑身份映射">{receipts.map((receipt, index) => <div key={index}>
    <p>工程拓扑变更 · 共享节点 {receipt.sharedNodeId}；内部计算细分不会创建工程对象。</p>
    <ul>{receipt.mappings.map((mapping) => <li key={mapping.sourceMemberId}>{mapping.sourceMemberId} → {mapping.segments.map((segment) => `${segment.memberId} [${segment.range.map((n) => Number(n.toPrecision(6))).join("–")}]`).join("、")}<br />原杆归一化范围 0—1；均布荷载：{mapping.uniformLoads.map((load) => `${load.sourceLoadId} → ${load.replacementLoadIds.join("、")}`).join("；") || "无"}</li>)}</ul>
    <p>保留支座：{receipt.supportIds.join("、") || "无"}；保留节点荷载：{receipt.nodalLoadIds.join("、") || "无"}</p>
    <p>材料、截面、局部朝向继承；均布荷载强度不变，按子段范围继承。当前端部为刚接，遇未登记端部属性阻止提交。原历史结果保留冻结输入，当前结果过期；相关任务需重读替换身份。</p>
  </div>)}</section>;
}
