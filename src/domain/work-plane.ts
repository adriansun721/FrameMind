import type { FrameNode, FrameProject, MemberProperties, NodeId, Vector3 } from "./project";
import { applyProjectEdits, type ProjectEditOperation } from "./project-operations";
import { GEOMETRY_CONTRACT } from "./geometry-policy";

export type WorkPlane = "XY" | "XZ" | "YZ";
export const PLANE_NORMAL_AXIS = { XY: "z", XZ: "y", YZ: "x" } as const;
export interface DrawingPoint { position: Vector3; nodeId?: NodeId; }
export interface DrawnMemberInput {
  start: DrawingPoint;
  end: DrawingPoint;
  materialId: MemberProperties["materialId"];
  sectionId: MemberProperties["sectionId"];
  rotationDegrees: number;
}

/** A forward ray intersection, in local double precision before adding the world origin. */
export function intersectWorkPlane(rayOrigin: Vector3, direction: Vector3, plane: WorkPlane, offset: number, sceneOrigin: Vector3): Vector3 | null {
  const axis = PLANE_NORMAL_AXIS[plane];
  if (!Number.isFinite(offset) || Math.abs(direction[axis]) < GEOMETRY_CONTRACT.snapping.parallelRayTolerance) return null;
  const distance = (offset - sceneOrigin[axis] - rayOrigin[axis]) / direction[axis];
  if (!Number.isFinite(distance) || distance < 0) return null;
  const position = { x: rayOrigin.x + distance * direction.x + sceneOrigin.x,
    y: rayOrigin.y + distance * direction.y + sceneOrigin.y, z: rayOrigin.z + distance * direction.z + sceneOrigin.z };
  position[axis] = offset;
  return Object.values(position).every(Number.isFinite) ? position : null;
}

export function exactDrawingPoint(position: Vector3, nodes: readonly FrameNode[], snap: boolean): DrawingPoint {
  const node = snap ? nodes.find((node) => (["x", "y", "z"] as const).every((axis) => node.position[axis] === position[axis])) : undefined;
  return { position, ...(node ? { nodeId: node.id } : {}) };
}

/** Snapping is explicit and restricted to visible node centres on the selected plane. */
export function snapDrawingNode(nodes: readonly { node: FrameNode; x: number; y: number; depth: number }[], pointer: { x: number; y: number }, plane: WorkPlane, offset: number): FrameNode | undefined {
  const axis = PLANE_NORMAL_AXIS[plane];
  return nodes.filter(({ node, depth, x, y }) => node.position[axis] === offset && depth >= -1 && depth <= 1
    && Math.hypot(x - pointer.x, y - pointer.y) <= GEOMETRY_CONTRACT.snapping.nodeRadiusPixels)
    .sort((a, b) => Math.hypot(a.x - pointer.x, a.y - pointer.y) - Math.hypot(b.x - pointer.x, b.y - pointer.y)
      || a.depth - b.depth || a.node.id.localeCompare(b.node.id))[0]?.node;
}

/** Returns ordinary reviewed edits, including new endpoints, for one atomic segment. */
export function prepareDrawnMemberEdits(project: FrameProject, input: DrawnMemberInput): ProjectEditOperation[] {
  const operations: ProjectEditOperation[] = [];
  let preview = project;
  const endpoint = (point: DrawingPoint): NodeId => {
    if (point.nodeId) {
      const node = project.nodes.find((node) => node.id === point.nodeId);
      if (!node) throw new Error(`捕捉节点 ${point.nodeId} 已不存在，请重新选择端点`);
      if (!(["x", "y", "z"] as const).every((axis) => node.position[axis] === point.position[axis])) throw new Error(`捕捉节点 ${node.label} 已移动，请重新选择端点`);
      return node.id;
    }
    const operation: ProjectEditOperation = { type: "create_node", position: point.position };
    operations.push(operation); preview = applyProjectEdits(preview, [operation]).project;
    return preview.nodes.at(-1)!.id;
  };
  const startNodeId = endpoint(input.start); const endNodeId = endpoint(input.end);
  operations.push({ type: "create_member", properties: { startNodeId, endNodeId, materialId: input.materialId, sectionId: input.sectionId, rotationDegrees: input.rotationDegrees } });
  applyProjectEdits(project, operations);
  return operations;
}
