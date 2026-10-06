import * as THREE from "three";

/** Label-only culling. Structure, conditions and hit targets are never hidden here. */
export function layoutSceneLabels(scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number): number {
  camera.updateMatrixWorld(); scene.updateMatrixWorld();
  const labels: THREE.Sprite[] = [];
  scene.traverse((object) => { if (object instanceof THREE.Sprite && object.userData.sceneLabel) labels.push(object); });
  labels.sort((a, b) => (b.userData.labelPriority ?? 0) - (a.userData.labelPriority ?? 0));
  const occupied: { x: number; y: number; width: number }[] = [];
  const position = new THREE.Vector3();
  // Screen area sets the budget; zoom changes projected spacing and therefore density.
  const budget = Math.max(3, Math.min(32, Math.floor(width * height / 18000)));
  for (const label of labels) {
    label.getWorldPosition(position).project(camera);
    const x = (position.x + 1) * width / 2, y = (1 - position.y) * height / 2;
    const labelWidth = label.userData.labelWidth ?? 68;
    const onScreen = position.z >= -1 && position.z <= 1 && x >= 8 && x + labelWidth <= width - 8 && y >= 48 && y <= height - 36;
    const collides = occupied.some((box) => x < box.x + box.width + 6 && x + labelWidth + 6 > box.x && Math.abs(y - box.y) < 32);
    label.visible = onScreen && occupied.length < budget && !collides;
    if (label.visible) occupied.push({ x, y, width: labelWidth });
  }
  return occupied.length;
}
