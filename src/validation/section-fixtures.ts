import { addMaterial, addMember, addNode, addNodalLoad, addSection, addSupport, createProject } from "../domain/project";
import type { SectionGeometry } from "../domain/section-geometry";

// Independently worked idealized-section values: exterior-minus-interior rectangles,
// disjoint I/H plates and circle integrals. SCI P385 B.2 supplies the J approximations.
export const SECTION_REFERENCES: { geometry: SectionGeometry; expected: [number, number, number, number] }[] = [
  { geometry: { shape: "rectangle", width: .2, height: .4 }, expected: [.08, .0010666666666666667, .0002666666666666667, .0007324166666666668] },
  { geometry: { shape: "circle", diameter: .2 }, expected: [.031415926535897934, .00007853981633974484, .00007853981633974484, .00015707963267948968] },
  { geometry: { shape: "rectangular-tube", width: .2, height: .4, thickness: .01 }, expected: [.0116, .00024358666666666667, .00008198666666666667, .00018933827586206897] },
  { geometry: { shape: "circular-tube", diameter: .2, thickness: .01 }, expected: [.005969026041820614, .000027009842839238267, .000027009842839238267, .000054019685678476534] },
  { geometry: { shape: "i-section", width: .2, height: .4, webThickness: .01, flangeThickness: .02 }, expected: [.0116, .00032794666666666667, .000026696666666666667, .0000011866666666666667] },
];

export function sectionCantilever(geometry: SectionGeometry = SECTION_REFERENCES[0].geometry, rotationDegrees = 0) {
  let p = createProject("T2-22 parameter section");
  p = addNode(p, { x: 0, y: 0, z: 0 }); p = addNode(p, { x: 3, y: 0, z: 0 });
  p = addMaterial(p, { name: "E200", elasticModulusGPa: 200, poissonRatio: .3, densityKgM3: 7850 });
  p = addSection(p, { name: geometry.shape, geometry });
  p = addMember(p, { startNodeId: p.nodes[0].id, endNodeId: p.nodes[1].id, materialId: p.materials[0].id, sectionId: p.sections[0].id, rotationDegrees });
  p = addSupport(p, p.nodes[0].id, [true, true, true, true, true, true]);
  return addNodalLoad(p, p.nodes[1].id, { x: 4, y: 5, z: -10 }, { x: 2, y: 0, z: 0 });
}
