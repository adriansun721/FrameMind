import * as THREE from "three";
import { calculateMemberGeometry } from "../domain/member-geometry";
import type { Vector3 } from "../domain/project";
import type { SectionGeometry } from "../domain/section-geometry";

/** Cross-section x/y are engineering local y/z; extrusion z is local x. */
export function createSectionExtrusion(g: SectionGeometry): THREE.ExtrudeGeometry {
  const rectangle = (b: number, h: number) => [
    new THREE.Vector2(-b / 2, -h / 2), new THREE.Vector2(b / 2, -h / 2),
    new THREE.Vector2(b / 2, h / 2), new THREE.Vector2(-b / 2, h / 2),
  ];
  let shape: THREE.Shape;
  if (g.shape === "circle" || g.shape === "circular-tube") {
    shape = new THREE.Shape(); shape.absarc(0, 0, g.diameter / 2, 0, Math.PI * 2, false);
    if (g.shape === "circular-tube") {
      const hole = new THREE.Path(); hole.absarc(0, 0, g.diameter / 2 - g.thickness, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
  } else if (g.shape === "i-section") {
    const b = g.width / 2, h = g.height / 2, w = g.webThickness / 2, z = h - g.flangeThickness;
    shape = new THREE.Shape([
      [-b, -h], [b, -h], [b, -z], [w, -z], [w, z], [b, z],
      [b, h], [-b, h], [-b, z], [-w, z], [-w, -z], [-b, -z],
    ].map(([y, z]) => new THREE.Vector2(y, z)));
  } else {
    shape = new THREE.Shape(rectangle(g.width, g.height));
    if (g.shape === "rectangular-tube") shape.holes.push(new THREE.Path(rectangle(g.width - 2 * g.thickness, g.height - 2 * g.thickness).reverse()));
  }
  // Unit extrusion permits instancing by member length, without scaling the section.
  return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1, curveSegments: 32 });
}

export function memberSolidTransform(start: Vector3, end: Vector3, rotationDegrees: number): THREE.Matrix4 {
  const g = calculateMemberGeometry(start, end, rotationDegrees);
  const vector = (v: Vector3) => new THREE.Vector3(v.x, v.y, v.z);
  return new THREE.Matrix4().makeBasis(vector(g.localY), vector(g.localZ), vector(g.localX).multiplyScalar(g.length))
    .setPosition(start.x, start.y, start.z);
}

export function sectionOuterRadius(g?: SectionGeometry): number {
  if (!g) return 0;
  return "diameter" in g ? g.diameter / 2 : Math.hypot(g.width, g.height) / 2;
}
