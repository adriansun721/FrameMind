import type { CadCenterline, CadEngineeringGeometry } from "./cad-geometry";
export interface CadPoint { x: number; y: number; z: number }
export interface CadTopologyIssue { code: string; severity: "warning" | "blocking"; message: string; memberIds?: string[]; nodeIds?: string[]; sourceEntityIds?: number[] }
export interface CadTopologyNode { id: string; position: CadPoint; sourceEntityIds: number[]; endpointCount: number; mergedFrom: string[] }
export interface CadTopologyMember {
  id: string; parentId: string; sourceEntityIds: number[]; instanceId: number | null;
  startNodeId: string; endNodeId: string; range: [number, number];
  classification: "candidate" | "split-segment";
}
export interface CadContact {
  id: string; memberIds: [string, string]; position: CadPoint; distanceM: number; fractions: [number, number];
  basis: "axis-endpoint-and-overlapping-solid-bounds"; status: "needs-user-review" | "confirmed";
}
export interface CadTopologyPreview {
  toleranceM: number; nodes: CadTopologyNode[]; members: CadTopologyMember[]; contacts: CadContact[]; issues: CadTopologyIssue[];
  boundingBox: { min: CadPoint; max: CadPoint } | null; instanceCount: number; ignoredCount: number; sourceMemberCount: number;
}
export const CAD_TOPOLOGY_TOLERANCE_M = 0.0005;
const point = (v: number[]): CadPoint => ({ x: v[0], y: v[1], z: v[2] });
const array = (p: CadPoint) => [p.x, p.y, p.z];
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const distance = (a: number[], b: number[]) => Math.hypot(...sub(a, b));
const validPoint = (v: number[]) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
function project(p: number[], member: CadCenterline) {
  const axis = sub(member.end, member.start);
  const fraction = Math.max(0, Math.min(1, dot(sub(p, member.start), axis) / dot(axis, axis)));
  const position = member.start.map((v, i) => v + fraction * axis[i]);
  return { fraction, position, distanceM: distance(p, position) };
}
function boundsContact(a: CadCenterline, b: CadCenterline, tolerance: number) {
  return [0, 1, 2].every((i) => a.boundingBox.min[i] <= b.boundingBox.max[i] + tolerance && b.boundingBox.min[i] <= a.boundingBox.max[i] + tolerance);
}
/** Bounds identify coarse contact candidates, never joint rigidity. Only explicit
 * user review of a contact can merge or split the isolated import draft. */
export function buildCadTopologyPreview(input: {
  engineeringGeometry?: CadEngineeringGeometry; instances?: Array<unknown>;
  ignoredEntities?: Array<{ id?: number; reason?: string }>; diagnostics?: { blockingIssues?: string[] };
}, approvedContactIds: string[] = []): CadTopologyPreview {
  const toleranceM = CAD_TOPOLOGY_TOLERANCE_M;
  const issues: CadTopologyIssue[] = [], contacts: CadContact[] = [];
  const geometry = input.engineeringGeometry;
  if (!geometry) issues.push({ code: "centerline-evidence-missing", severity: "blocking", message: "缺少恒截面实体主轴依据；BREP 边界线不能作为工程中心线" });
  for (const issue of geometry?.issues ?? []) issues.push({ ...issue, severity: "blocking" });
  for (const code of input.diagnostics?.blockingIssues ?? []) issues.push({ code, severity: "blocking", message: `解析阻塞：${code}` });
  const members = (geometry?.centerlines ?? []).filter((m) => {
    const valid = validPoint(m.start) && validPoint(m.end) && Number.isFinite(m.lengthM) && m.lengthM > 1e-7
      && Math.abs(distance(m.start, m.end) - m.lengthM) < 1e-7
      && m.endSections?.length === 2 && m.endSections.every((s) => s.length >= 3 && s.every(validPoint));
    if (!valid) issues.push({ code: "invalid-centerline", severity: "blocking", message: `实体主轴 ${m.id} 坐标、长度或端截面无效`, memberIds: [m.id], sourceEntityIds: m.sourceEntityIds });
    return valid;
  });
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
    const a = members[i], b = members[j], axis = sub(a.end, a.start), squared = dot(axis, axis);
    const fractionOnA = (p: number[]) => dot(sub(p, a.start), axis) / squared;
    const axisDistance = (p: number[]) => distance(p, a.start.map((v, n) => v + fractionOnA(p) * axis[n]));
    const overlap = axisDistance(b.start) < 1e-7 && axisDistance(b.end) < 1e-7
      && (Math.min(1, Math.max(fractionOnA(b.start), fractionOnA(b.end))) - Math.max(0, Math.min(fractionOnA(b.start), fractionOnA(b.end)))) * a.lengthM > 1e-7;
    if (overlap) {
      issues.push({ code: "overlap", severity: "blocking", message: `${a.id} 与 ${b.id} 存在共线重叠范围`, memberIds: [a.id, b.id] });
      continue;
    }
    if (!boundsContact(a, b, toleranceM)) continue;
    const candidates = [0, 1].flatMap((end) => {
      const onB = project(end ? a.end : a.start, b), onA = project(end ? b.end : b.start, a);
      return [
        { fractions: [end, onB.fraction] as [number, number], position: end ? a.end : a.start, distanceM: onB.distanceM },
        { fractions: [onA.fraction, end] as [number, number], position: onA.position, distanceM: onA.distanceM },
      ];
    }).filter((c) => c.distanceM <= toleranceM).sort((x, y) => x.distanceM - y.distanceM);
    const unique = candidates.filter((c, index) => candidates.slice(0, index).every((p) => distance(p.position, c.position) > toleranceM));
    for (const c of unique) {
      const id = `contact:${a.id}:${b.id}:${c.fractions.map((f) => f.toFixed(8)).join(":")}`, confirmed = approvedContactIds.includes(id);
      contacts.push({ id, memberIds: [a.id, b.id], position: point(c.position), fractions: c.fractions, distanceM: c.distanceM, basis: "axis-endpoint-and-overlapping-solid-bounds", status: confirmed ? "confirmed" : "needs-user-review" });
      if (!confirmed) issues.push({ code: "unconfirmed-contact", severity: "blocking", message: `${a.id} / ${b.id} 接触候选尚未确认`, memberIds: [a.id, b.id] });
    }
    if (!unique.length) issues.push({ code: "eccentric-or-crossing-contact", severity: "warning", message: `${a.id} / ${b.id} 包围盒接近但无端点轴线连接依据；偏心或交叉需人工复核`, memberIds: [a.id, b.id] });
  }
  for (const id of approvedContactIds) if (!contacts.some((c) => c.id === id)) issues.push({ code: "stale-contact-decision", severity: "blocking", message: "接触决定不属于当前几何草稿" });
  // Build a boundary for each axis first; merge only contact-linked boundaries.
  const boundaries = members.map((m) => {
    const fractions = [...new Set([0, 1, ...contacts.filter((c) => c.status === "confirmed").flatMap((c) => c.memberIds.flatMap((id, i) => id === m.id ? [c.fractions[i]] : []))])].sort((a, b) => a - b);
    return { member: m, fractions, positions: fractions.map((f) => m.start.map((v, i) => v + f * (m.end[i] - v))) };
  });
  const endpoints = boundaries.flatMap((b) => b.fractions.map((fraction, i) => ({ member: b.member, fraction, position: b.positions[i] })));
  const parent = endpoints.map((_, i) => i);
  const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (const c of contacts.filter((c) => c.status === "confirmed")) {
    const indexes = c.memberIds.map((id, i) => endpoints.findIndex((e) => e.member.id === id && e.fraction === c.fractions[i]));
    if (indexes.every((i) => i >= 0)) {
      const left = find(indexes[0]), right = find(indexes[1]);
      const combined = endpoints.filter((_, i) => find(i) === left || find(i) === right);
      if (combined.some((e, i) => combined.slice(i + 1).some((q) => e.member.id === q.member.id && e.fraction !== q.fraction))) {
        issues.push({ code: "collapsed-member-contact", severity: "blocking", message: "接触合并会折叠同一原杆的不同分段位置，需调整连接判定", memberIds: c.memberIds });
      } else if (combined.some((e, i) => combined.slice(i + 1).some((q) => distance(e.position, q.position) > toleranceM))) {
        issues.push({ code: "ambiguous-contact-cluster", severity: "blocking", message: "接触链累计偏移超过固定连接容差", memberIds: c.memberIds });
      } else parent[right] = left;
    }
  }
  const nodes: CadTopologyNode[] = [], rootNodes = new Map<number, CadTopologyNode>();
  endpoints.forEach((e, index) => {
    const root = find(index);
    let node = rootNodes.get(root);
    if (!node) { node = { id: `topology-node-${nodes.length + 1}`, position: point(e.position), sourceEntityIds: [], endpointCount: 0, mergedFrom: [] }; rootNodes.set(root, node); nodes.push(node); }
    node.endpointCount++; node.sourceEntityIds = [...new Set([...node.sourceEntityIds, ...e.member.sourceEntityIds])].sort((a, b) => a - b);
    node.mergedFrom = [...new Set([...node.mergedFrom, e.member.id])];
  });
  const rows: CadTopologyMember[] = [];
  for (const b of boundaries) {
    const ids = b.fractions.map((f) => rootNodes.get(find(endpoints.findIndex((e) => e.member.id === b.member.id && e.fraction === f)))!.id);
    if (ids.length > 2) issues.push({ code: "split-required", severity: "warning", message: `${b.member.id} 按确认接触点切分为 ${ids.length - 1} 段`, memberIds: [b.member.id], nodeIds: ids.slice(1, -1) });
    for (let i = 0; i < ids.length - 1; i++) {
      const start = nodes.find((n) => n.id === ids[i])!, end = nodes.find((n) => n.id === ids[i + 1])!;
      if (ids[i] === ids[i + 1] || distance(array(start.position), array(end.position)) <= 1e-7) {
        issues.push({ code: "zero-length-segment", severity: "blocking", message: "确认接触生成了无有效长度的分段", memberIds: [b.member.id], nodeIds: [ids[i], ids[i + 1]] });
        continue;
      }
      rows.push({ id: `${b.member.id}:segment-${i + 1}`, parentId: b.member.id, sourceEntityIds: b.member.sourceEntityIds, instanceId: b.member.instanceId, startNodeId: ids[i], endNodeId: ids[i + 1], range: [b.fractions[i], b.fractions[i + 1]], classification: ids.length > 2 ? "split-segment" : "candidate" });
    }
  }
  const degree = new Map<string, number>(); rows.forEach((r) => [r.startNodeId, r.endNodeId].forEach((id) => degree.set(id, (degree.get(id) ?? 0) + 1)));
  nodes.filter((n) => degree.get(n.id) === 1).forEach((n) => issues.push({ code: "unconnected-endpoint", severity: "warning", message: `${n.id} 为未连接端点`, nodeIds: [n.id] }));
  rows.filter((r) => degree.get(r.startNodeId) === 1 && degree.get(r.endNodeId) === 1).forEach((r) => issues.push({ code: "isolated-member", severity: "warning", message: `${r.parentId} 两端均未连接`, memberIds: [r.parentId] }));
  for (const e of input.ignoredEntities ?? []) issues.push({ code: "unsupported-geometry", severity: "blocking", message: e.reason ?? "不支持几何", sourceEntityIds: e.id ? [e.id] : [] });
  const positions = nodes.map((n) => array(n.position));
  for (const solid of geometry?.solidInstances ?? []) positions.push(solid.bounds.min, solid.bounds.max);
  const boundingBox = positions.length ? { min: point([0, 1, 2].map((i) => Math.min(...positions.map((p) => p[i])))), max: point([0, 1, 2].map((i) => Math.max(...positions.map((p) => p[i])))) } : null;
  return { toleranceM, nodes, members: rows, contacts, issues, boundingBox, instanceCount: input.instances?.length ?? 0, ignoredCount: input.ignoredEntities?.length ?? 0, sourceMemberCount: geometry?.centerlines.length ?? 0 };
}
