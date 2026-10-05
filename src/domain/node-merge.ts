import { validateMember, validateUniformLoad, type FrameProject, type NodeId, type MemberId } from "./project";
import { GEOMETRY_CONTRACT } from "./geometry-policy";
import { calculateMemberGeometry } from "./member-geometry";

export interface NodeMergeSelection { nodeIds: NodeId[]; targetNodeId: NodeId; tolerance: number; }
export interface NodeMergeResolution {
  keepSupportIds: string[];
  keepNodalLoadIds: string[];
  keepMemberIds: MemberId[];
  removeUniformLoadIds: string[];
  acceptGeometryChange: boolean;
}
export type NodeMergeInput = NodeMergeSelection & { resolution: NodeMergeResolution };
const distance = (a: { x: number; y: number; z: number }, b: typeof a) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function requireTolerance(tolerance: number) {
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error("近重合容差必须是非负有限长度（m），0 仅检查精确重复");
}

/** Pairwise distances in canonical metres; a chain is never an implicit merge group. */
export function inspectNearNodes(project: FrameProject, tolerance: number = GEOMETRY_CONTRACT.nodeMerge.defaultToleranceM) {
  requireTolerance(tolerance);
  const pairs: { nodeIds: [NodeId, NodeId]; distance: number; kind: "duplicate" | "near" }[] = [];
  for (let i = 0; i < project.nodes.length; i++) for (let j = i + 1; j < project.nodes.length; j++) {
    const d = distance(project.nodes[i].position, project.nodes[j].position);
    if (d <= tolerance) pairs.push({ nodeIds: [project.nodes[i].id, project.nodes[j].id], distance: d, kind: d === 0 ? "duplicate" : "near" });
  }
  return { projectId: project.id, revision: project.revision, tolerance, unit: "m", pairs, automaticMerge: false };
}

export function inspectNodeMerge(project: FrameProject, input: NodeMergeSelection) {
  requireTolerance(input.tolerance);
  if (!Array.isArray(input.nodeIds) || input.nodeIds.length < 2 || input.nodeIds.length > 100 || new Set(input.nodeIds).size !== input.nodeIds.length) throw new Error("合并需选择 2 至 100 个不同节点");
  if (!input.nodeIds.includes(input.targetNodeId)) throw new Error("目标节点必须是所选节点中的明确身份");
  const nodes = input.nodeIds.map((id) => {
    const node = project.nodes.find((item) => item.id === id);
    if (!node) throw new Error(`合并节点 ${id} 不存在`);
    return node;
  });
  const target = nodes.find((node) => node.id === input.targetNodeId)!;
  const distances = nodes.map((node) => ({ nodeId: node.id, distance: distance(node.position, target.position) }));
  if (distances.some((item) => !Number.isFinite(item.distance) || item.distance > input.tolerance)) throw new Error("所有节点到目标的距离必须在已登记容差内；近重合链不能自动成组");
  const selected = new Set(input.nodeIds);
  const affected = project.members.filter((member) => selected.has(member.startNodeId) || selected.has(member.endNodeId));
  const affectedIds = new Set(affected.map((member) => member.id));
  const mapped = project.members.map((member) => ({ ...member,
    startNodeId: selected.has(member.startNodeId) ? target.id : member.startNodeId,
    endNodeId: selected.has(member.endNodeId) ? target.id : member.endNodeId,
  }));
  const position = (id: NodeId) => project.nodes.find((node) => node.id === id)!.position;
  const zeroLengthMemberIds = mapped.filter((member) => affectedIds.has(member.id) && distance(position(member.startNodeId), position(member.endNodeId)) <= GEOMETRY_CONTRACT.memberLength.minimumExclusive).map((member) => member.id);
  const groups = new Map<string, MemberId[]>();
  for (const member of mapped.filter((item) => !zeroLengthMemberIds.includes(item.id))) {
    const key = [member.startNodeId, member.endNodeId].sort().join(":");
    groups.set(key, [...(groups.get(key) ?? []), member.id]);
  }
  const duplicateMemberGroups = [...groups.values()].filter((ids) => ids.length > 1 && ids.some((id) => affectedIds.has(id)));
  const reviewIds = new Set([...affectedIds, ...duplicateMemberGroups.flat()]);
  const members = mapped.filter((member) => reviewIds.has(member.id)).map((after) => {
    const before = project.members.find((member) => member.id === after.id)!;
    return { before, after, zeroLength: zeroLengthMemberIds.includes(after.id),
      geometryBefore: calculateMemberGeometry(position(before.startNodeId), position(before.endNodeId), before.rotationDegrees),
      geometryAfter: zeroLengthMemberIds.includes(after.id) ? null : calculateMemberGeometry(position(after.startNodeId), position(after.endNodeId), after.rotationDegrees) };
  });
  const taskReferences = (project.taskState?.conversations ?? []).flatMap((conversation) => {
    const references = [...(conversation.targets ?? []), ...(conversation.turns.at(-1)?.context.selection ?? [])]
      .filter((ref) => ref.kind === "node" ? selected.has(ref.id as NodeId) : reviewIds.has(ref.id as MemberId));
    return references.map((ref) => ({ taskId: conversation.id, ...ref }));
  });
  for (const task of project.taskState?.analyses ?? []) {
    for (const node of task.input.nodes.filter((node) => selected.has(node.id))) taskReferences.push({ taskId: task.taskId, kind: "node", id: node.id });
    for (const member of task.input.members.filter((member) => reviewIds.has(member.id))) taskReferences.push({ taskId: task.taskId, kind: "member", id: member.id });
  }
  return { projectId: project.id, baseRevision: project.revision, targetNodeId: target.id, targetPosition: target.position,
    nodeIds: input.nodeIds, tolerance: input.tolerance, unit: "m", distances, members, zeroLengthMemberIds, duplicateMemberGroups,
    supports: project.supports.filter((support) => selected.has(support.nodeId)),
    nodalLoads: project.nodalLoads.filter((load) => selected.has(load.nodeId)),
    uniformLoads: project.uniformLoads.filter((load) => reviewIds.has(load.memberId)), taskReferences,
    history: "retained-with-frozen-input" as const, taskTargets: "reread-replacement-identities" as const };
}
export type NodeMergeImpact = ReturnType<typeof inspectNodeMerge>;
export type NodeMergeReceipt = NodeMergeImpact & { resolution: NodeMergeResolution; removedNodeIds: NodeId[] };

/** No conflict policy defaults. Every retained/deleted condition is part of the reviewed input. */
export function mergeNodes(project: FrameProject, input: NodeMergeInput): { project: FrameProject; receipt: NodeMergeReceipt } {
  const impact = inspectNodeMerge(project, input);
  const resolution = input.resolution;
  if (!resolution || resolution.acceptGeometryChange !== true) throw new Error("请明确接受坐标、杆长、局部朝向及局部荷载方向随目标节点变化");
  const checkIds = (ids: readonly string[], allowed: readonly string[], label: string) => {
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some((id) => !allowed.includes(id))) throw new Error(`${label}选择不完整或含失效身份`);
  };
  checkIds(resolution.keepSupportIds, impact.supports.map((s) => s.id), "保留支座");
  if (resolution.keepSupportIds.length > 1) throw new Error("多个支座须明确选一个保留或全部移除；不能默认叠加约束");
  checkIds(resolution.keepNodalLoadIds, impact.nodalLoads.map((l) => l.id), "保留节点荷载");
  checkIds(resolution.keepMemberIds, impact.members.map((m) => m.before.id), "保留杆件");
  if (resolution.keepMemberIds.some((id) => impact.zeroLengthMemberIds.includes(id))) throw new Error("零长杆必须明确移除");
  // Ordinary non-conflicting members cannot be silently discarded by this operation.
  const conflicts = new Set([...impact.zeroLengthMemberIds, ...impact.duplicateMemberGroups.flat()]);
  if (impact.members.some((m) => !conflicts.has(m.before.id) && !resolution.keepMemberIds.includes(m.before.id))) throw new Error("非冲突杆件必须保留");
  const removedMembers = new Set(impact.members.filter((m) => !resolution.keepMemberIds.includes(m.before.id)).map((m) => m.before.id));
  const removedLoads = impact.uniformLoads.filter((load) => removedMembers.has(load.memberId)).map((load) => load.id);
  checkIds(resolution.removeUniformLoadIds, removedLoads, "随杆移除均布荷载");
  if (removedLoads.length !== resolution.removeUniformLoadIds.length) throw new Error("必须明确确认每个随杆移除的均布荷载，不能转移或静默丢弃");
  const knownFields = (value: object, fields: string[], label: string) => { if (Object.keys(value).some((key) => !fields.includes(key))) throw new Error(`${label}含未登记工程字段，不能安全合并`); };
  for (const node of project.nodes.filter((node) => input.nodeIds.includes(node.id))) knownFields(node, ["id", "label", "position"], "节点");
  for (const m of impact.members) knownFields(m.before, ["id", "label", "startNodeId", "endNodeId", "materialId", "sectionId", "rotationDegrees"], "杆件");
  for (const s of impact.supports) knownFields(s, ["id", "label", "nodeId", "restraints"], "支座");
  for (const l of impact.nodalLoads) knownFields(l, ["id", "label", "nodeId", "loadCaseId", "force", "moment"], "节点荷载");
  impact.uniformLoads.forEach(validateUniformLoad);
  const selected = new Set(input.nodeIds);
  const reviewedMembers = new Map(impact.members.map((m) => [m.before.id, m.after]));
  const next: FrameProject = { ...project,
    nodes: project.nodes.filter((node) => !selected.has(node.id) || node.id === input.targetNodeId),
    members: project.members.filter((member) => !removedMembers.has(member.id)).map((member) => reviewedMembers.get(member.id) ?? member),
    supports: project.supports.filter((support) => !selected.has(support.nodeId) || resolution.keepSupportIds.includes(support.id)).map((support) => selected.has(support.nodeId) ? { ...support, nodeId: input.targetNodeId } : support),
    nodalLoads: project.nodalLoads.filter((load) => !selected.has(load.nodeId) || resolution.keepNodalLoadIds.includes(load.id)).map((load) => selected.has(load.nodeId) ? { ...load, nodeId: input.targetNodeId } : load),
    uniformLoads: project.uniformLoads.filter((load) => !removedMembers.has(load.memberId)),
  };
  next.members.forEach((member) => validateMember(next, member.label, member));
  return { project: next, receipt: { ...impact, resolution: structuredClone(resolution), removedNodeIds: input.nodeIds.filter((id) => id !== input.targetNodeId) } };
}
