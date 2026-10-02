import { expect, it } from "vitest";
import { getMemberResponseSamples, getMemberSectionForces, solveFrame } from "./analysis";
import { createProject, addMaterial, addMember, addNode, addSection, addSupport, addNodalLoad, addUniformLoad } from "./project";

function cantilever() {
  let project = createProject();
  project = addNode(project, { x: 0, y: 0, z: 0 });
  project = addNode(project, { x: 4, y: 0, z: 0 });
  project = addMaterial(project, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  project = addSection(project, { name: "Section", areaM2: 0.01, secondMomentYM4: 0.0002, secondMomentZM4: 0.0001, torsionalConstantM4: 0.0001 });
  project = addMember(project, { startNodeId: project.nodes[0].id, endNodeId: project.nodes[1].id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
  project = addSupport(project, project.nodes[0].id, [true, true, true, true, true, true]);
  project = addNodalLoad(project, project.nodes[1].id, { x: 0, y: -5, z: 0 }, { x: 0, y: 0, z: 0 });
  return project;
}

it("samples verified cubic deformation and section force recovery along a member", () => {
  const project = cantilever();
  const result = solveFrame(project);
  const memberId = project.members[0].id;
  const samples = getMemberResponseSamples(result, memberId, 9);
  expect(samples).toHaveLength(9);
  expect(samples[0].position).toBe(0);
  expect(samples.at(-1)?.position).toBeCloseTo(4);
  expect(samples[0].globalDisplacement).toEqual({ x: 0, y: 0, z: 0 });
  expect(samples.at(-1)?.globalDisplacement.y).toBeCloseTo(result.nodes[1].displacement.y);
  expect(samples[4].forces).toEqual(getMemberSectionForces(result, memberId, 2).forces);
  expect(samples[0].forces[1]).toBeCloseTo(-5);
});

it("rejects invalid result sampling requests", () => {
  const result = solveFrame(cantilever());
  expect(() => getMemberResponseSamples(result, result.members[0].memberId, 1)).toThrow(/采样数量/);
});

it("recovers each distributed-load station against the cantilever equilibrium reference", () => {
  const unloaded = { ...cantilever(), nodalLoads: [] };
  const project = addUniformLoad(unloaded, { kind: "uniform", memberId: unloaded.members[0].id, loadCaseId: "LC1", coordinateSystem: "global", intensity: { x: 0, y: -2, z: 0 } });
  const result = solveFrame(project);
  // Independent equilibrium: Vy=-2(4-x); Mz=-(4-x)^2 on the positive-x face.
  const samples = getMemberResponseSamples(result, project.members[0].id, 5);
  for (const [index, expected] of [[0, [-8, -16]], [1, [-6, -9]], [2, [-4, -4]], [3, [-2, -1]], [4, [0, 0]]] as const) {
    expect(samples[index].forces[1]).toBeCloseTo(expected[0], 10);
    expect(samples[index].forces[5]).toBeCloseTo(expected[1], 10);
    expect(samples[index].forces).toEqual(getMemberSectionForces(result, project.members[0].id, index).forces);
  }
});
