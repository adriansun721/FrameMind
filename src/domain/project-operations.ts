import {
  addMember,
  addNode,
  deleteMember,
  updateMember,
  updateNode,
  type FrameProject,
  type MemberId,
  type MemberProperties,
  type NodeId,
  type Vector3,
} from "./project";

export type ProjectMutation = (project: FrameProject) => FrameProject;

/** Applies several validated commands as one user-visible model change. */
export function applyProjectTransaction(project: FrameProject, mutations: readonly ProjectMutation[] | ProjectMutation): FrameProject {
  const steps = typeof mutations === "function" ? [mutations] : mutations;
  if (steps.length === 0) return project;
  const changed = steps.reduce((current, mutation) => mutation(current), project);
  if (changed === project) return project;
  if (!Number.isSafeInteger(project.revision) || project.revision >= Number.MAX_SAFE_INTEGER) throw new Error("项目编号状态无法安全递增");
  return {
    ...changed,
    revision: project.revision + 1,
    updatedAt: new Date().toISOString(),
  };
}

export interface NodeBatchUpdate { id: NodeId; position: Vector3; }

export function batchUpdateNodes(project: FrameProject, updates: readonly NodeBatchUpdate[]): FrameProject {
  return applyProjectTransaction(project, updates.map(({ id, position }) => (current) => updateNode(current, id, position)));
}

export interface MemberBatchUpdate { id: MemberId; changes: Partial<MemberProperties>; }

export function batchUpdateMembers(project: FrameProject, updates: readonly MemberBatchUpdate[]): FrameProject {
  return applyProjectTransaction(project, updates.map(({ id, changes }) => (current) => updateMember(current, id, changes)));
}

export function duplicateNode(project: FrameProject, id: NodeId): FrameProject {
  const source = project.nodes.find((node) => node.id === id);
  if (!source) throw new Error(`节点 ${id} 不存在`);
  return addNode(project, source.position);
}

export function duplicateMember(project: FrameProject, id: MemberId): FrameProject {
  const source = project.members.find((member) => member.id === id);
  if (!source) throw new Error(`杆件 ${id} 不存在`);
  return addMember(project, {
    startNodeId: source.startNodeId,
    endNodeId: source.endNodeId,
    materialId: source.materialId,
    sectionId: source.sectionId,
    rotationDegrees: source.rotationDegrees,
  });
}

export function duplicateNodes(project: FrameProject, ids: readonly NodeId[]): FrameProject {
  return applyProjectTransaction(project, ids.map((id) => (current) => duplicateNode(current, id)));
}

export function duplicateMembers(project: FrameProject, ids: readonly MemberId[]): FrameProject {
  return applyProjectTransaction(project, ids.map((id) => (current) => duplicateMember(current, id)));
}

/** Node deletion cascades members, supports and loads so no references dangle. */
export function deleteNode(project: FrameProject, id: NodeId): FrameProject {
  if (!project.nodes.some((node) => node.id === id)) throw new Error(`节点 ${id} 不存在`);
  return applyProjectTransaction(project, (current) => {
    const memberIds = new Set(current.members.filter((member) => member.startNodeId === id || member.endNodeId === id).map((member) => member.id));
    return {
      ...current,
      nodes: current.nodes.filter((node) => node.id !== id),
      members: current.members.filter((member) => !memberIds.has(member.id)),
      supports: current.supports.filter((support) => support.nodeId !== id),
      nodalLoads: current.nodalLoads.filter((load) => load.nodeId !== id),
      uniformLoads: current.uniformLoads.filter((load) => !memberIds.has(load.memberId)),
    };
  });
}

export function deleteNodes(project: FrameProject, ids: readonly NodeId[]): FrameProject {
  return applyProjectTransaction(project, ids.map((id) => (current) => deleteNode(current, id)));
}

export function deleteMembers(project: FrameProject, ids: readonly MemberId[]): FrameProject {
  return applyProjectTransaction(project, ids.map((id) => (current) => deleteMember(current, id)));
}
