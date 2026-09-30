import { describe, expect, it } from "vitest";
import type { FrameNode } from "../domain/project";
import { calculateSceneFrame } from "./scene-camera";

describe("3D scene framing", () => {
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
