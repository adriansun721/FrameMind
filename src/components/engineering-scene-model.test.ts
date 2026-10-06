import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { FrameMember, FrameNode } from "../domain/project";
import { EngineeringSceneModel } from "./engineering-scene-model";
import { sectionCantilever, SECTION_REFERENCES } from "../validation/section-fixtures";
import { updateMember, updateSection } from "../domain/project";

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
  it("renders true rectangle dimensions and the right-hand 90 degree section rotation", () => {
    const parent = new THREE.Group();
    const model = new EngineeringSceneModel(parent, palette, () => new THREE.Sprite(new THREE.SpriteMaterial()));
    const p = sectionCantilever();
    model.sync(p.nodes, p.members, p.sections);
    const size = model.getBounds().getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(3, 6); expect(size.y).toBeCloseTo(.2, 6); expect(size.z).toBeCloseTo(.4, 6);
    model.setSelection({ kind: "member", id: p.members[0].id });
    const rotated = updateMember(p, p.members[0].id, { rotationDegrees: 90 });
    model.sync(rotated.nodes, rotated.members, rotated.sections);
    const turned = model.getBounds().getSize(new THREE.Vector3());
    expect(turned.x).toBeCloseTo(3, 6); expect(turned.y).toBeCloseTo(.4, 6); expect(turned.z).toBeCloseTo(.2, 6);
    const display = parent.getObjectByName(`member-display:${p.members[0].id}`) as THREE.Mesh;
    expect((display.material as THREE.MeshLambertMaterial).color.getHexString()).toBe("7891ad");
    model.dispose();
  });

  it.each(SECTION_REFERENCES)("keeps $geometry.shape openings in rendered geometry", ({ geometry }) => {
    const p = sectionCantilever(geometry), parent = new THREE.Group();
    const model = new EngineeringSceneModel(parent, palette, () => new THREE.Sprite(new THREE.SpriteMaterial()));
    model.sync(p.nodes, p.members, p.sections); parent.updateMatrixWorld(true);
    const mesh = parent.getObjectByName(`member-display:${p.members[0].id}`)!;
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    const ray = (y: number, z: number) => new THREE.Raycaster(new THREE.Vector3(-1, y, z), new THREE.Vector3(1, 0, 0)).intersectObject(mesh);
    const hollow = geometry.shape === "rectangular-tube" || geometry.shape === "circular-tube";
    expect(ray(0, 0).length > 0).toBe(!hollow);
    if (geometry.shape === "rectangular-tube") expect(ray(.095, 0).length).toBeGreaterThan(0);
    if (geometry.shape === "circular-tube") expect(ray(.095, 0).length).toBeGreaterThan(0);
    if (geometry.shape === "i-section") { expect(ray(.09, 0)).toHaveLength(0); expect(ray(.09, .19).length).toBeGreaterThan(0); }
    model.dispose();
  });

  it.each([
    { end: { x: 0, y: 0, z: 3 }, rotation: 0, size: [.2, .4, 3] },
    { end: { x: 3, y: 4, z: 0 }, rotation: 0, size: [3.16, 4.12, .4] },
    { end: { x: 3, y: 0, z: 0 }, rotation: 30, size: [3, .3732050807568877, .4464101615137755] },
  ])("aligns vertical, inclined and rotated sections with engineering axes ($rotation degrees)", ({ end, rotation, size }) => {
    const p = sectionCantilever(undefined, rotation), parent = new THREE.Group();
    const model = new EngineeringSceneModel(parent, palette, () => new THREE.Sprite(new THREE.SpriteMaterial()));
    model.sync([p.nodes[0], { ...p.nodes[1], position: end }], p.members, p.sections);
    const bounds = model.getBounds().getSize(new THREE.Vector3()).toArray();
    bounds.forEach((actual, i) => expect(actual).toBeCloseTo(size[i], 6));
    model.dispose();
  });

  it("switches only presentation and keeps old property sections as selectable lines", () => {
    const p = sectionCantilever(), snapshot = JSON.stringify(p), parent = new THREE.Group();
    const model = new EngineeringSceneModel(parent, palette, () => new THREE.Sprite(new THREE.SpriteMaterial()));
    model.sync(p.nodes, p.members, p.sections);
    model.setSelection({ kind: "member", id: p.members[0].id });
    const targets = model.getHitTargets().map((target) => target.userData);
    model.sync(p.nodes, p.members, p.sections, "line");
    expect(parent.getObjectByName(`member-display:${p.members[0].id}`)).toBeInstanceOf(THREE.Line);
    expect(model.getHitTargets().map((target) => target.userData)).toEqual(targets);
    expect(JSON.stringify(p)).toBe(snapshot);
    const legacy = updateSection(p, p.sections[0].id, { name: "old properties", areaM2: .02, secondMomentYM4: .0001, secondMomentZM4: .0002, torsionalConstantM4: .0003 });
    model.sync(legacy.nodes, legacy.members, legacy.sections);
    expect(parent.getObjectByName(`member-display:${p.members[0].id}`)).toBeInstanceOf(THREE.Line);
    model.dispose();
  });

  it("shows every solid in dense models with true dimensions and stable instance highlights", () => {
    const p = sectionCantilever(), parent = new THREE.Group();
    const model = new EngineeringSceneModel(parent, palette, () => new THREE.Sprite(new THREE.SpriteMaterial()));
    const members = Array.from({ length: 120 }, (_, i) => ({ ...p.members[0], id: `member_${i}` as FrameMember["id"], label: `M${i}`, rotationDegrees: i % 2 * 90 }));
    model.sync(p.nodes, members, p.sections);
    const meshes: THREE.InstancedMesh[] = [];
    parent.traverse((object) => { if (object instanceof THREE.InstancedMesh) meshes.push(object); });
    expect(meshes).toHaveLength(1); expect(meshes[0].count).toBe(120);
    const matrix = new THREE.Matrix4(); meshes[0].getMatrixAt(1, matrix);
    const bounds = new THREE.Box3().setFromBufferAttribute(meshes[0].geometry.getAttribute("position") as THREE.BufferAttribute).applyMatrix4(matrix).getSize(new THREE.Vector3());
    expect(bounds.toArray()).toEqual(expect.arrayContaining([expect.closeTo(3, 6), expect.closeTo(.4, 6), expect.closeTo(.2, 6)]));
    model.setSelection({ kind: "member", id: members[37].id });
    const color = new THREE.Color(); meshes[0].getColorAt(37, color); expect(color.getHexString()).toBe("7891ad");
    expect(model.getHitTargets().filter((target) => target.userData.kind === "member")).toHaveLength(120);
    const dispose = vi.spyOn(meshes[0], "dispose"); model.dispose(); expect(dispose).toHaveBeenCalledOnce();
  });

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
