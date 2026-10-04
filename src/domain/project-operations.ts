import {
  addMember,
  addNode,
  deleteMember,
  updateMember,
  updateNode,
  type FrameProject,
  type MemberId,
  type MemberProperties,
  type FrameNode,
  type FrameMember,
  type FrameSupport,
  type FrameNodalLoad,
  type FrameUniformLoad,
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

export type ProjectEditOperation =
  | { type: "create_node"; position: Vector3 }
  | { type: "update_node"; id: NodeId; position: Partial<Vector3> }
  | { type: "duplicate_node" | "delete_node"; id: NodeId }
  | { type: "create_member"; properties: MemberProperties }
  | { type: "update_member"; id: MemberId; changes: Partial<MemberProperties> }
  | { type: "duplicate_member" | "delete_member"; id: MemberId };

export interface ProjectEditChange {
  kind: "node" | "member" | "support" | "nodal-load" | "uniform-load";
  id: string;
  before?: FrameNode | FrameMember | FrameSupport | FrameNodalLoad | FrameUniformLoad;
  after?: FrameNode | FrameMember | FrameSupport | FrameNodalLoad | FrameUniformLoad;
}
export interface ProjectEditReceipt {
  projectId: string;
  baseRevision: number;
  appliedRevision: number;
  changes: ProjectEditChange[];
  created: { operationIndex: number; kind: "node" | "member"; id: string; sourceId?: string }[];
  affectedMemberIds: MemberId[];
}

/** Manual edits and reviewed tool drafts execute the same commands and return the same object diff. */
export function applyProjectEdits(project: FrameProject, operations: readonly ProjectEditOperation[]): { project: FrameProject; receipt: ProjectEditReceipt } {
  const created: ProjectEditReceipt["created"] = [];
  const next = applyProjectTransaction(project, operations.map((operation, operationIndex) => (current) => {
    let changed: FrameProject;
    switch (operation.type) {
      case "create_node": changed = addNode(current, operation.position); break;
      case "update_node": {
        const node = current.nodes.find((item) => item.id === operation.id);
        if (!node) throw new Error(`节点 ${operation.id} 不存在`);
        changed = updateNode(current, operation.id, { ...node.position, ...operation.position }); break;
      }
      case "duplicate_node": changed = duplicateNode(current, operation.id); break;
      case "delete_node": changed = deleteNode(current, operation.id); break;
      case "create_member": changed = addMember(current, operation.properties); break;
      case "update_member": changed = updateMember(current, operation.id, operation.changes); break;
      case "duplicate_member": changed = duplicateMember(current, operation.id); break;
      case "delete_member": changed = deleteMember(current, operation.id); break;
    }
    if (operation.type === "create_node" || operation.type === "duplicate_node" || operation.type === "create_member" || operation.type === "duplicate_member") {
      const kind = operation.type.endsWith("node") ? "node" as const : "member" as const;
      const object = (kind === "node" ? changed.nodes : changed.members).at(-1)!;
      created.push({ operationIndex, kind, id: object.id, ...("id" in operation ? { sourceId: operation.id } : {}) });
    }
    return changed;
  }));
  const changes: ProjectEditChange[] = [];
  const collections = [["node", "nodes"], ["member", "members"], ["support", "supports"], ["nodal-load", "nodalLoads"], ["uniform-load", "uniformLoads"]] as const;
  for (const [kind, collection] of collections) {
    const before = new Map(project[collection].map((object) => [object.id as string, object]));
    const after = new Map(next[collection].map((object) => [object.id as string, object]));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      if (JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id))) changes.push({ kind, id, before: before.get(id), after: after.get(id) });
    }
  }
  const nodeIds = new Set(changes.filter((change) => change.kind === "node").map((change) => change.id));
  const affectedMemberIds = [...new Set([...project.members, ...next.members].filter((member) => nodeIds.has(member.startNodeId) || nodeIds.has(member.endNodeId)
    || changes.some((change) => change.kind === "member" && change.id === member.id)).map((member) => member.id))];
  return { project: next, receipt: { projectId: project.id, baseRevision: project.revision, appliedRevision: next.revision, changes, created, affectedMemberIds } };
}
