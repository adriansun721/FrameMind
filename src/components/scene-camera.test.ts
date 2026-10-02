import { describe, expect, it } from "vitest";
import type { FrameNode } from "../domain/project";
import { calculateSceneFrame } from "./scene-camera";
import * as THREE from "three";

describe("3D scene framing", () => {
  it("fits all model corners with annotation room in a narrow workbench", () => {
    const nodes = [
      { id: "node_0001", label: "N1", position: { x: 0, y: 0, z: 0 } },
      { id: "node_0002", label: "N2", position: { x: 4, y: 2, z: 4 } },
    ] as FrameNode[];
    const frame = calculateSceneFrame(nodes, 0.5);
    const camera = new THREE.PerspectiveCamera(42, 0.5, 0.1, frame.far);
    camera.up.set(0, 0, 1); camera.position.set(frame.camera.x, frame.camera.y, frame.camera.z);
    camera.lookAt(frame.target.x, frame.target.y, frame.target.z); camera.updateMatrixWorld();
    for (const x of [-0.9, 4.9]) for (const y of [-0.9, 2.9]) for (const z of [-0.9, 4.9]) {
      const projected = new THREE.Vector3(x, y, z).project(camera);
      expect(Math.abs(projected.x)).toBeLessThan(0.9);
      expect(Math.abs(projected.y)).toBeLessThan(0.9);
    }
  });
  it("keeps a node with large finite coordinates inside the camera range", () => {
    const node: FrameNode = {
      id: "node_0001" as FrameNode["id"],
      label: "N1",
      position: { x: 10_000, y: -20_000, z: 30_000 },
    };

    const frame = calculateSceneFrame([node]);
    const cameraDistance = Math.hypot(
      frame.camera.x - node.position.x,
      frame.camera.y - node.position.y,
      frame.camera.z - node.position.z,
    );

    expect(frame.target).toEqual(node.position);
    expect(frame.far).toBeGreaterThan(cameraDistance);
    expect(cameraDistance).toBeGreaterThan(1);
  });
});
