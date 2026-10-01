import * as THREE from "three";

export function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    }
    if (object instanceof THREE.Sprite) {
      object.material.map?.dispose();
      object.material.dispose();
    }
  });
  root.removeFromParent();
}
