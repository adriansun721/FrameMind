import type { FrameNode, Vector3 } from "../domain/project";
import * as THREE from "three";

export interface SceneFrame {
  target: Vector3;
  camera: Vector3;
  far: number;
}

export function calculateSceneFrame(nodes: FrameNode[], aspect = 1): SceneFrame {
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
  const viewDirection = new THREE.Vector3(0.72, -1, 0.76).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), viewDirection).normalize();
  const up = new THREE.Vector3().crossVectors(viewDirection, right).normalize();
  const tangentY = Math.tan(21 * Math.PI / 180);
  const tangentX = tangentY * Math.max(0.01, aspect);
  let distance = 7;
  // Fit the padded corners against both frustum axes, including their depth.
  for (const x of [bounds.minX - 0.9, bounds.maxX + 0.9])
    for (const y of [bounds.minY - 0.9, bounds.maxY + 0.9])
      for (const z of [bounds.minZ - 0.9, bounds.maxZ + 0.9]) {
        const corner = new THREE.Vector3(x - target.x, y - target.y, z - target.z);
        distance = Math.max(distance, corner.dot(viewDirection) + Math.max(Math.abs(corner.dot(right)) / tangentX, Math.abs(corner.dot(up)) / tangentY) * 1.15);
      }
  const directionLength = Math.hypot(0.72, -1, 0.76);
  const scale = distance / directionLength;
  const camera = {
    x: target.x + 0.72 * scale,
    y: target.y - scale,
    z: target.z + 0.76 * scale,
  };

  return { target, camera, far: Math.max(200, distance * 12) };
}
