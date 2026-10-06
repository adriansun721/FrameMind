import { expect, it } from "vitest";
import * as THREE from "three";
import { layoutSceneLabels } from "./scene-labels";

it("prioritizes selected labels, changes density with zoom and never hides structure", () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, 1, .1, 200);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const background = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()); scene.add(background);
  const label = (x: number, priority: number) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial()); sprite.position.x = x;
    sprite.userData = { sceneLabel: true, labelPriority: priority, labelWidth: 68 }; scene.add(sprite); return sprite;
  };
  const ordinary = label(.2, 10), selected = label(0, 100), nearby = label(.8, 20);
  expect(layoutSceneLabels(scene, camera, 600, 600)).toBe(1);
  expect(selected.visible).toBe(true); expect(ordinary.visible).toBe(false); expect(nearby.visible).toBe(false);
  camera.position.z = 3;
  expect(layoutSceneLabels(scene, camera, 600, 600)).toBe(2);
  expect(selected.visible).toBe(true); expect(nearby.visible).toBe(true); expect(background.visible).toBe(true);
});
