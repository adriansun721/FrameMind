import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { FrameMember, FrameNode } from "../domain/project";
import { EngineeringSceneModel } from "./engineering-scene-model";

const palette = {
  member: "#888888",
  node: "#999999",
  hovered: "#bbbbbb",
  selected: "#7891ad",
  axisY: "#708d79",
  axisZ: "#788da5",
};

const node = (number: number, x: number): FrameNode => ({
  id: `node_${String(number).padStart(4, "0")}` as FrameNode["id"],
  label: `N${number}`,
  position: { x, y: 0, z: 0 },
});

const member = (start: FrameNode, end: FrameNode): FrameMember => ({
  id: "member_0001" as FrameMember["id"],
  label: "M1",
  startNodeId: start.id,
  endNodeId: end.id,
  materialId: "material_0001" as FrameMember["materialId"],
  sectionId: "section_0001" as FrameMember["sectionId"],
  rotationDegrees: 0,
});

describe("engineering scene model", () => {
  it("keeps selected annotations when unrelated geometry is added", () => {
    const parent = new THREE.Group();
    const model = new EngineeringSceneModel(parent, palette, () => new THREE.Sprite(new THREE.SpriteMaterial()));
    const start = node(1, 0); const end = node(2, 4); const frameMember = member(start, end);
    model.sync([start, end], [frameMember]);
    model.setSelection({ kind: "member", id: frameMember.id });
    const annotations = parent.getObjectByName("selection-annotations")!;
    const selectedLabel = annotations.children[0];

    model.sync([start, end, node(3, 8)], [frameMember]);

    expect(annotations.children[0]).toBe(selectedLabel);
    model.dispose();
  });

  it("replaces only scene objects that depend on an edited node", () => {
    const parent = new THREE.Group();
    const model = new EngineeringSceneModel(parent, palette, () => new THREE.Sprite(new THREE.SpriteMaterial()));
    const start = node(1, 0); const end = node(2, 4); const frameMember = member(start, end);
    model.sync([start, end], [frameMember]);
    const hitTarget = (kind: string, id: string) => model.getHitTargets().find((object) => object.userData.kind === kind && object.userData.id === id)!;
    const originalStart = hitTarget("node", start.id);
    const originalEnd = hitTarget("node", end.id);
    const originalMember = hitTarget("member", frameMember.id);

    const movedEnd = { ...end, position: { ...end.position, x: 6 } };
    model.sync([start, movedEnd], [frameMember]);

    expect(hitTarget("node", start.id)).toBe(originalStart);
    expect(hitTarget("node", end.id)).not.toBe(originalEnd);
    expect(hitTarget("member", frameMember.id)).not.toBe(originalMember);
    model.dispose();
  });

  it("moves the steel-blue highlight between selected model objects", () => {
    const parent = new THREE.Group();
    const model = new EngineeringSceneModel(parent, palette, () => new THREE.Sprite(new THREE.SpriteMaterial()));
    const start = node(1, 0); const end = node(2, 4); const frameMember = member(start, end);
    model.sync([start, end], [frameMember]);
    const memberDisplay = parent.children.find((object) => object instanceof THREE.Line) as THREE.Line;
    const firstNodeDisplay = parent.children.find((object) => object instanceof THREE.Points) as THREE.Points;

    model.setSelection({ kind: "member", id: frameMember.id });
    expect((memberDisplay.material as THREE.LineBasicMaterial).color.getHexString()).toBe("7891ad");
    expect((firstNodeDisplay.material as THREE.PointsMaterial).color.getHexString()).toBe("999999");

    model.setSelection({ kind: "node", id: start.id });
    expect((memberDisplay.material as THREE.LineBasicMaterial).color.getHexString()).toBe("888888");
    expect((firstNodeDisplay.material as THREE.PointsMaterial).color.getHexString()).toBe("7891ad");
    model.dispose();
  });

  it("disposes removed geometry, materials, and selected label textures", () => {
    const parent = new THREE.Group();
    const model = new EngineeringSceneModel(parent, palette, () => {
      const texture = new THREE.Texture();
      return new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
    });
    const start = node(1, 0); const end = node(2, 4); const frameMember = member(start, end);
    model.sync([start, end], [frameMember]);
    model.setSelection({ kind: "member", id: frameMember.id });
    const memberDisplay = parent.children.find((object) => object instanceof THREE.Line) as THREE.Line;
    const geometryDispose = vi.spyOn(memberDisplay.geometry, "dispose");
    const materialDispose = vi.spyOn(memberDisplay.material as THREE.Material, "dispose");
    const annotations = parent.getObjectByName("selection-annotations")!;
    const label = annotations.children[0] as THREE.Sprite;
    const textureDispose = vi.spyOn(label.material.map!, "dispose");

    model.sync([start, end], []);

    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
    expect(memberDisplay.parent).toBeNull();
    model.dispose();
  });
});
