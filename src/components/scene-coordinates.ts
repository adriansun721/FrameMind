import type { FrameNode, Vector3 } from "../domain/project";

/** Subtract in double precision before coordinates enter GPU float buffers. */
export function localSceneNodes(nodes: readonly FrameNode[], origin: Vector3): FrameNode[] {
  return nodes.map((node) => ({ ...node, position: {
    x: node.position.x - origin.x, y: node.position.y - origin.y, z: node.position.z - origin.z,
  } }));
}
