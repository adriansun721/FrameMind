import { expect, it } from "vitest";
import * as THREE from "three";
import { localSceneNodes } from "./scene-coordinates";
import { freeGeometryFixtures } from "../validation/free-geometry-fixtures";
import { EngineeringSceneModel } from "./engineering-scene-model";
import { calculateSceneFrame } from "./scene-camera";

it("keeps a 0.122 mm member distinct in GPU buffers at billion-metre coordinates without changing input", () => {
  const project = freeGeometryFixtures()[1].project;
  const before = structuredClone(project.nodes);
  const nodes = localSceneNodes(project.nodes, project.nodes[0].position);
  const group = new THREE.Group();
  const palette = { member: "#888", node: "#999", hovered: "#bbb", selected: "#789", axisY: "#708", axisZ: "#788" };
  const model = new EngineeringSceneModel(group, palette, () => new THREE.Sprite());
  model.sync(nodes, project.members);
  const line = group.children.find((object): object is THREE.Line => object instanceof THREE.Line)!;
  expect(line.geometry.getAttribute("position").getX(0)).toBe(0);
  expect(line.geometry.getAttribute("position").getX(1)).toBe(.0001220703125);
  const frame = calculateSceneFrame(nodes);
  expect(Math.abs(frame.camera.x)).toBeLessThan(100); expect(frame.far).toBeGreaterThan(7);
  expect(model.getHitTargets().filter((target) => target.userData.kind === "node").map((target) => target.userData.id)).toEqual(project.nodes.map((node) => node.id));
  expect(project.nodes).toEqual(before);
  model.dispose();
});
