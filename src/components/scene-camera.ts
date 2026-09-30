import type { FrameNode, Vector3 } from "../domain/project";

export interface SceneFrame {
  target: Vector3;
  camera: Vector3;
  far: number;
}

export function calculateSceneFrame(nodes: FrameNode[]): SceneFrame {
  if (nodes.length === 0) {
    return {
      target: { x: 0, y: 0, z: 1.5 },
      camera: { x: 10, y: -12, z: 9 },
      far: 200,
    };
  }

  const bounds = nodes.reduce(
    (result, node) => ({
      minX: Math.min(result.minX, node.position.x),
      minY: Math.min(result.minY, node.position.y),
      minZ: Math.min(result.minZ, node.position.z),
      maxX: Math.max(result.maxX, node.position.x),
      maxY: Math.max(result.maxY, node.position.y),
      maxZ: Math.max(result.maxZ, node.position.z),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY,
    },
  );

  const target = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
  const diagonal = Math.hypot(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ,
  );
  const distance = Math.max(7, diagonal * 1.8);
  const directionLength = Math.hypot(0.72, -1, 0.76);
  const scale = distance / directionLength;
  const camera = {
    x: target.x + 0.72 * scale,
    y: target.y - scale,
    z: target.z + 0.76 * scale,
  };

  return { target, camera, far: Math.max(200, distance * 12) };
}
