import { addNode, addMember, addUniformLoad, deleteMember, validateUniformLoad, type FrameProject, type MemberId, type NodeId, type Vector3 } from "./project";
import { GEOMETRY_CONTRACT } from "./geometry-policy";
import { calculateMemberGeometry } from "./member-geometry";

export interface TopologyInput { memberIds: MemberId[]; position: Vector3; nodeId?: NodeId; }
export interface TopologyMapping {
  sourceMemberId: MemberId;
  segments: { memberId: MemberId; range: [number, number] }[];
  uniformLoads: { sourceLoadId: string; replacementLoadIds: string[] }[];
}
export interface TopologyReceipt {
  sharedNodeId: NodeId;
  mappings: TopologyMapping[];
  boundaryNodeIds: NodeId[];
  supportIds: string[];
  nodalLoadIds: string[];
  history: "retained-with-frozen-input";
  taskTargets: "reread-replacement-identities";
}
const axes = ["x", "y", "z"] as const;
const samePoint = (a: Vector3, b: Vector3) => axes.every((axis) => a[axis] === b[axis]);

/** Explicit engineering topology; picking and solver subdivision never call this. */
export function changeTopology(project: FrameProject, input: TopologyInput, mode: "split" | "connect"): { project: FrameProject; receipt: TopologyReceipt } {
  if (!input.position || !axes.every((axis) => Number.isFinite(input.position[axis]))) throw new Error("连接／分割位置必须是有限 XYZ 坐标");
  if (!Array.isArray(input.memberIds) || input.memberIds.length < (mode === "connect" ? 2 : 1) || input.memberIds.length > 100
    || (mode === "split" && input.memberIds.length !== 1) || new Set(input.memberIds).size !== input.memberIds.length) throw new Error("请选择不同的正式杆件；单杆分割仅允许一根杆件");
  const members = input.memberIds.map((id) => {
    const member = project.members.find((item) => item.id === id);
    if (!member) throw new Error(`杆件 ${id} 已不存在，请重读目标映射`);
    const start = project.nodes.find((node) => node.id === member.startNodeId);
    const end = project.nodes.find((node) => node.id === member.endNodeId);
    if (!start || !end) throw new Error(`杆件 ${member.label} 端点不存在，请重读工程`);
    const delta = axes.map((axis) => end.position[axis] - start.position[axis]);
    const length = Math.hypot(...delta);
    if (!Number.isFinite(length) || length <= GEOMETRY_CONTRACT.memberLength.minimumExclusive) throw new Error(`杆件 ${member.label} 长度无效，不能分割`);
    const direction = delta.map((value) => value / length);
    const distance = axes.reduce((sum, axis, index) => sum + (input.position[axis] - start.position[axis]) * direction[index], 0);
    const error = Math.hypot(...axes.map((axis, index) => input.position[axis] - start.position[axis] - distance * direction[index]));
    if (!Number.isFinite(distance) || !Number.isFinite(error)) throw new Error(`杆件 ${member.label} 的分割位置超出有限数值范围`);
    const endpoint = samePoint(start.position, input.position) ? start.id : samePoint(end.position, input.position) ? end.id : undefined;
    if (!endpoint && (distance <= GEOMETRY_CONTRACT.memberLength.minimumExclusive || length - distance <= GEOMETRY_CONTRACT.memberLength.minimumExclusive
      || error > GEOMETRY_CONTRACT.topology.pointOnMemberToleranceM)) throw new Error(`位置不在杆件 ${member.label} 内部，或产生端点重合／零长杆`);
    if (endpoint && mode === "split") throw new Error("单杆分割不能使用端点，不能产生零长杆");
    if (!endpoint) {
      const original = calculateMemberGeometry(start.position, end.position, member.rotationDegrees);
      for (const [a, b] of [[start.position, input.position], [input.position, end.position]]) {
        const child = calculateMemberGeometry(a, b, member.rotationDegrees);
        if ((["localX", "localY", "localZ"] as const).some((key) => axes.some((axis) => Math.abs(child[key][axis] - original[key][axis]) > GEOMETRY_CONTRACT.topology.localAxisTolerance))) {
          throw new Error(`杆件 ${member.label} 分割点不能保持局部朝向，请提供精确直线位置`);
        }
      }
    }
    return { member, fraction: distance / length, endpoint };
  });
  const coincident = project.nodes.filter((node) => samePoint(node.position, input.position));
  const existing = input.nodeId ? project.nodes.find((node) => node.id === input.nodeId) : undefined;
  if (input.nodeId && (!existing || !samePoint(existing.position, input.position))) throw new Error("指定共享节点不存在或位置不匹配");
  if (!input.nodeId && coincident.length) throw new Error("该位置已有节点，请明确共享节点身份；不会自动合并支座或荷载");
  if (members.some(({ endpoint }) => endpoint && endpoint !== input.nodeId)) throw new Error("端点身份冲突，请先核对并合并节点；不能静默转移支座或荷载");
  if (members.every(({ endpoint }) => endpoint)) throw new Error("所选杆件已共享该端点，无需改变拓扑");
  let next = existing ? project : addNode(project, input.position);
  const sharedNodeId = existing?.id ?? next.nodes.at(-1)!.id;
  const mappings: TopologyMapping[] = [];
  for (const { member, fraction, endpoint } of members) {
    if (endpoint) continue;
    if (Object.keys(member).some((key) => !["id", "label", "startNodeId", "endNodeId", "materialId", "sectionId", "rotationDegrees", "endReleases"].includes(key))) throw new Error(`杆件 ${member.label} 含未登记端部属性，不能安全分割`);
    const loads = project.uniformLoads.filter((load) => load.memberId === member.id);
    loads.forEach(validateUniformLoad);
    next = deleteMember(next, member.id);
    const segments: TopologyMapping["segments"] = [];
    for (const [startNodeId, endNodeId, range] of [
      [member.startNodeId, sharedNodeId, [0, fraction]], [sharedNodeId, member.endNodeId, [fraction, 1]],
    ] as const) {
      next = addMember(next, { startNodeId, endNodeId, materialId: member.materialId, sectionId: member.sectionId, rotationDegrees: member.rotationDegrees,
        ...(member.endReleases ? { endReleases: {
          start: range[0] === 0 ? member.endReleases.start : { my: false, mz: false },
          end: range[1] === 1 ? member.endReleases.end : { my: false, mz: false },
        } } : {}) });
      segments.push({ memberId: next.members.at(-1)!.id, range: [...range] });
    }
    const uniformLoads = loads.map((load) => {
      const replacementLoadIds = segments.map(({ memberId }) => {
        next = addUniformLoad(next, { kind: "uniform", memberId, coordinateSystem: load.coordinateSystem, loadCaseId: load.loadCaseId, intensity: load.intensity });
        return next.uniformLoads.at(-1)!.id;
      });
      return { sourceLoadId: load.id, replacementLoadIds };
    });
    mappings.push({ sourceMemberId: member.id, segments, uniformLoads });
  }
  const boundaryNodeIds = [...new Set([sharedNodeId, ...members.flatMap(({ member }) => [member.startNodeId, member.endNodeId])])];
  return { project: next, receipt: { sharedNodeId, mappings, boundaryNodeIds,
    supportIds: project.supports.filter((item) => boundaryNodeIds.includes(item.nodeId)).map((item) => item.id),
    nodalLoadIds: project.nodalLoads.filter((item) => boundaryNodeIds.includes(item.nodeId)).map((item) => item.id),
    history: "retained-with-frozen-input", taskTargets: "reread-replacement-identities" } };
}
