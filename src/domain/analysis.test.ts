import { describe, expect, it } from "vitest";
import { addMaterial, addMember, addNode, addNodalLoad, addSection, addSupport, createProject } from "./project";
import { solveFrame } from "./analysis";

function cantilever() {
  let project = createProject("T03 cantilever");
  project = addNode(project, { x: 0, y: 0, z: 0 });
  project = addNode(project, { x: 4, y: 0, z: 0 });
  project = addMaterial(project, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  project = addSection(project, { name: "Box", areaM2: 0.01, secondMomentYM4: 0.0002, secondMomentZM4: 0.0001, torsionalConstantM4: 0.00015 });
  project = addMember(project, { startNodeId: project.nodes[0].id, endNodeId: project.nodes[1].id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
  project = addSupport(project, project.nodes[0].id, [true, true, true, true, true, true]);
  return project;
}

// Independent closed-form reference for a prismatic Euler-Bernoulli cantilever.
function cantileverReference(length: number, material: { elasticModulusGPa: number; poissonRatio: number }, section: { areaM2: number; secondMomentYM4: number; secondMomentZM4: number; torsionalConstantM4: number }, force: { x: number; y: number; z: number }, moment: { x: number; y: number; z: number }) {
  const e = material.elasticModulusGPa * 1e6; const iy = e * section.secondMomentYM4; const iz = e * section.secondMomentZM4; const g = e / (2 * (1 + material.poissonRatio));
  return { displacement: { x: force.x * length / (e * section.areaM2), y: force.y * length ** 3 / (3 * iz) + moment.z * length ** 2 / (2 * iz), z: force.z * length ** 3 / (3 * iy) - moment.y * length ** 2 / (2 * iy) }, rotation: { x: moment.x * length / (g * section.torsionalConstantM4), y: -force.z * length ** 2 / (2 * iy) + moment.y * length / iy, z: force.y * length ** 2 / (2 * iz) + moment.z * length / iz } };
}

describe("3D frame analysis", () => {
  const expectReference = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.max(1e-9, 1e-8 * Math.abs(expected)));

  it("solves a spatial cantilever against independent bending, axial, and torsion references", () => {
    let project = cantilever();
    project = addNodalLoad(project, project.nodes[1].id, { x: 8, y: 5, z: -3 }, { x: 2, y: 1.5, z: -1.25 });
    const result = solveFrame(project);
    const tip = result.nodes.find((node) => node.nodeId === project.nodes[1].id)!;
    const expected = cantileverReference(4, project.materials[0], project.sections[0], { x: 8, y: 5, z: -3 }, { x: 2, y: 1.5, z: -1.25 });
    expectReference(tip.displacement.x, expected.displacement.x); expectReference(tip.displacement.y, expected.displacement.y); expectReference(tip.displacement.z, expected.displacement.z);
    expectReference(tip.rotation.x, expected.rotation.x); expectReference(tip.rotation.y, expected.rotation.y); expectReference(tip.rotation.z, expected.rotation.z);
    const fixed = result.nodes.find((node) => node.nodeId === project.nodes[0].id)!;
    expectReference(fixed.reaction.x, -8); expectReference(fixed.reaction.y, -5); expectReference(fixed.reaction.z, 3); expectReference(fixed.reactionMoment.x, -2); expectReference(fixed.reactionMoment.y, -1.5 + (-3 * 4)); expectReference(fixed.reactionMoment.z, 1.25 - 5 * 4);
    const endForces = result.members[0].localEndForces.end;
    expectReference(endForces[0], 8); expectReference(endForces[1], 5); expectReference(endForces[2], -3); expectReference(endForces[3], 2); expectReference(endForces[4], 1.5); expectReference(endForces[5], -1.25);
  });

  it("rejects a model with no effective restraint", () => {
    const project = cantilever();
    expect(() => solveFrame({ ...project, supports: [] })).toThrow(/约束/);
  });

  it("does not label an unverified multi-member model as a T03 result", () => {
    const project = cantilever();
    expect(() => solveFrame({ ...project, members: [...project.members, { ...project.members[0], id: "member_0002" as typeof project.members[number]["id"], label: "M2" }] })).toThrow(/T03.*单根/);
  });
});
