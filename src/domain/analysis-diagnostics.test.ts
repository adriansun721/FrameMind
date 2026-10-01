import { expect, it } from "vitest";
import { solveFrame } from "./analysis";
import { addMaterial, addMember, addNode, addNodalLoad, addSection, addSupport, attachAnalysisResult, createProject, type FrameProject } from "./project";

function cantilever() {
  let project = createProject();
  project = addNode(project, { x: 0, y: 0, z: 0 });
  project = addNode(project, { x: 4, y: 0, z: 0 });
  project = addMaterial(project, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  project = addSection(project, { name: "Box", areaM2: 0.01, secondMomentYM4: 0.0002, secondMomentZM4: 0.0001, torsionalConstantM4: 0.00015 });
  project = addMember(project, { startNodeId: project.nodes[0].id, endNodeId: project.nodes[1].id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
  return addSupport(project, project.nodes[0].id, [true, true, true, true, true, true]);
}

it("rejects missing section parameters with the owning object and field", () => {
  const project = cantilever();
  project.sections[0].areaM2 = Number.NaN;
  expect(() => solveFrame(project)).toThrowError(expect.objectContaining({
    stage: "model-check",
    diagnostics: expect.arrayContaining([expect.objectContaining({
      code: "invalid-parameter", field: "areaM2", target: { kind: "section", id: project.sections[0].id },
    })]),
  }));
});

it.each([
  ["zero-length member", (project: FrameProject) => { project.nodes[1].position = { ...project.nodes[0].position }; }, "invalid-geometry", "endNodeId"],
  ["invalid reference", (project: FrameProject) => { project.materials = []; }, "invalid-reference", "materialId"],
  ["missing stiffness parameter", (project: FrameProject) => { Reflect.deleteProperty(project.materials[0], "elasticModulusGPa"); }, "invalid-parameter", "elasticModulusGPa"],
  ["invalid Poisson ratio", (project: FrameProject) => { project.materials[0].poissonRatio = 0.5; }, "invalid-parameter", "poissonRatio"],
  ["negative section parameter", (project: FrameProject) => { project.sections[0].secondMomentYM4 = -1; }, "invalid-parameter", "secondMomentYM4"],
  ["non-finite coordinate", (project: FrameProject) => { project.nodes[1].position.z = Infinity; }, "invalid-coordinate", "position.z"],
  ["invalid support", (project: FrameProject) => { project.supports[0].restraints.pop(); }, "invalid-restraints", "restraints"],
  ["repeated identity", (project: FrameProject) => { project.nodes[1].id = project.nodes[0].id; }, "invalid-identity", "id"],
] as const)("locates %s during model checking", (_, change, code, field) => {
  const project = cantilever(); change(project);
  expect(() => solveFrame(project)).toThrowError(expect.objectContaining({ stage: "model-check", diagnostics: expect.arrayContaining([expect.objectContaining({ code, field })]) }));
});

it("locates invalid load values and node references on their owning load", () => {
  let project = cantilever();
  project = addNodalLoad(project, project.nodes[1].id, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  project.nodalLoads[0].force.x = Infinity;
  expect(() => solveFrame(project)).toThrowError(expect.objectContaining({ stage: "model-check", diagnostics: expect.arrayContaining([expect.objectContaining({ code: "invalid-load", field: "force.x", target: { kind: "load", id: project.nodalLoads[0].id } })]) }));
  project.nodalLoads[0].force.x = 1;
  project.nodalLoads[0].nodeId = "missing-node" as typeof project.nodes[number]["id"];
  expect(() => solveFrame(project)).toThrowError(expect.objectContaining({ stage: "model-check", diagnostics: expect.arrayContaining([expect.objectContaining({ code: "invalid-reference", field: "nodeId", target: { kind: "load", id: project.nodalLoads[0].id } })]) }));
});

it("rejects overflow while adding finite nodal loads", () => {
  let project = cantilever();
  for (let index = 0; index < 2; index += 1) project = addNodalLoad(project, project.nodes[1].id, { x: 1e308, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  expect(() => solveFrame(project)).toThrowError(expect.objectContaining({ stage: "assembly", diagnostics: [expect.objectContaining({ code: "non-finite-load", target: { kind: "load", id: project.nodalLoads[1].id } })] }));
});

it("rejects non-finite back-substitution without creating a success result", () => {
  let project = cantilever();
  project = addNodalLoad(project, project.nodes[1].id, { x: 0, y: 1e308, z: 0 }, { x: 0, y: 0, z: 0 });
  expect(() => solveFrame(project)).toThrowError(expect.objectContaining({ stage: "solve", diagnostics: [expect.objectContaining({ code: "non-finite-displacement" })] }));
});

it("locates an isolated node and can solve after it is connected", () => {
  let project = addNode(cantilever(), { x: 8, y: 0, z: 0 });
  expect(() => solveFrame(project)).toThrowError(expect.objectContaining({ stage: "model-check", diagnostics: expect.arrayContaining([expect.objectContaining({ code: "isolated-node", target: { kind: "node", id: project.nodes[2].id } })]) }));
  const { materialId, sectionId, rotationDegrees } = project.members[0];
  project = addMember(project, { materialId, sectionId, rotationDegrees, startNodeId: project.nodes[1].id, endNodeId: project.nodes[2].id });
  expect(solveFrame(project).status).toBe("complete");
});

it("identifies an unsupported disconnected frame without rejecting independent supported frames", () => {
  let project = cantilever();
  project = addNode(project, { x: 0, y: 4, z: 0 }); project = addNode(project, { x: 4, y: 4, z: 0 });
  const { materialId, sectionId, rotationDegrees } = project.members[0];
  project = addMember(project, { materialId, sectionId, rotationDegrees, startNodeId: project.nodes[2].id, endNodeId: project.nodes[3].id });
  expect(() => solveFrame(project)).toThrowError(expect.objectContaining({ stage: "model-check", diagnostics: expect.arrayContaining([expect.objectContaining({ code: "unrestrained-component", target: { kind: "node", id: project.nodes[2].id } })]) }));
  project = addSupport(project, project.nodes[2].id, [true, true, true, true, true, true]);
  expect(solveFrame(project).status).toBe("complete");
});

it("reports a singular pivot with a checkable DOF and numerical evidence, without asserting a unique cause", () => {
  const project = cantilever(); project.supports[0].restraints = [true, true, true, false, false, false];
  expect(() => solveFrame(project)).toThrowError(expect.objectContaining({
    stage: "solve", diagnostics: [expect.objectContaining({ code: "singular-system", target: expect.objectContaining({ kind: "node" }), dof: expect.any(String),
      evidence: expect.objectContaining({ pivotMagnitude: expect.any(Number), threshold: expect.any(Number), globalDofIndex: expect.any(Number) }),
    })],
  }));
});

it("rejects finite inputs that overflow element stiffness during assembly", () => {
  const project = cantilever(); project.materials[0].elasticModulusGPa = 1e308;
  expect(() => solveFrame(project)).toThrowError(expect.objectContaining({ stage: "assembly", diagnostics: [expect.objectContaining({ code: "non-finite-stiffness", target: { kind: "member", id: project.members[0].id } })] }));
});

it("does not publish non-finite reactions as successful results", () => {
  let project = cantilever();
  project = addNodalLoad(project, project.nodes[1].id, { x: 0, y: 1e307, z: 0 }, { x: 0, y: 0, z: 0 });
  project = addNodalLoad(project, project.nodes[0].id, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1.6e308 });
  expect(() => solveFrame(project)).toThrowError(expect.objectContaining({ stage: "recovery", diagnostics: [expect.objectContaining({ code: "non-finite-reaction" })] }));
});

it("keeps the applied model and historical success intact when the next solve fails", () => {
  let project = cantilever(); project = attachAnalysisResult(project, solveFrame(project));
  project = addNode(project, { x: 8, y: 0, z: 0 });
  const before = structuredClone(project);
  expect(() => solveFrame(project)).toThrow();
  expect(project).toEqual(before);
  expect(project.latestAnalysis?.status).toBe("complete");
  expect(project.latestAnalysis?.input.nodes).toHaveLength(2);
});
