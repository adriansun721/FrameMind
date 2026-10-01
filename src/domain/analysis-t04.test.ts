import { describe, expect, it } from "vitest";
import { addMaterial, addMember, addNode, addNodalLoad, addSection, addSupport, attachAnalysisResult, createProject, type FrameProject, type Vector3 } from "./project";
import { captureAnalysisInput, getMemberAnalysisRecord, solveFrame, type AnalysisResult } from "./analysis";
import { decodeProject, encodeProject } from "./project-file";

function spatialFrame(equalInertia = false): FrameProject {
  let project = createProject("T04 spatial frame");
  for (const position of [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 4, y: 3, z: 2 }]) project = addNode(project, position);
  project = addMaterial(project, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  project = addSection(project, { name: "Box", areaM2: 0.01, secondMomentYM4: equalInertia ? 0.0001 : 0.0002, secondMomentZM4: 0.0001, torsionalConstantM4: 0.00015 });
  for (let index = 0; index < 3; index += 1) project = addMember(project, { startNodeId: project.nodes[index].id, endNodeId: project.nodes[index + 1].id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
  project = addSupport(project, project.nodes[0].id, [true, true, true, true, true, true]);
  return addNodalLoad(project, project.nodes[3].id, { x: 8, y: 5, z: -3 }, { x: 2, y: 1.5, z: -1.25 });
}

function expectReference(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.max(1e-9, 1e-8 * Math.abs(expected)));
}

function components(vector: Vector3): number[] { return [vector.x, vector.y, vector.z]; }

function expectSameNodes(actual: AnalysisResult, expected: AnalysisResult) {
  for (const reference of expected.nodes) {
    const node = actual.nodes.find((item) => item.nodeId === reference.nodeId)!;
    for (const field of ["displacement", "rotation", "reaction", "reactionMoment"] as const) components(node[field]).forEach((value, index) => expectReference(value, components(reference[field])[index]));
  }
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

describe("T04 multi-member spatial analysis", () => {
  it("matches independently registered virtual-work responses and equilibrium end forces", () => {
    const project = spatialFrame();
    const result = solveFrame(project);
    const responses = [
      [0, 0, 0, 0, 0, 0],
      [0.000016, -0.004766666666666666, -0.0051, -0.005893333333333333, 0.00235, -0.00305],
      [0.01304725, -0.004759166666666667, -0.024355, -0.006830833333333333, 0.0069, -0.0050375],
      [0.02806391666666667, 0.009135833333333333, -0.024358, -0.006980833333333333, 0.00785, -0.005254166666666667],
    ];
    for (const [index, node] of result.nodes.entries()) {
      [...components(node.displacement), ...components(node.rotation)].forEach((value, dof) => expectReference(value, responses[index][dof]));
      components(node.reaction).forEach((value, dof) => expectReference(value, index === 0 ? [-8, -5, 3][dof] : 0));
      components(node.reactionMoment).forEach((value, dof) => expectReference(value, index === 0 ? [17, -29.5, 5.25][dof] : 0));
    }
    const forces = [
      [[-8, -5, 3, 17, -29.5, 5.25], [8, 5, -3, -17, 17.5, -25.25]],
      [[-5, 8, 3, -17.5, -17, 25.25], [5, -8, -3, 17.5, 8, -1.25]],
      [[3, -8, -5, 1.25, 8, -17.5], [-3, 8, 5, -1.25, 2, 1.5]],
    ];
    result.members.forEach((member, index) => {
      member.localEndForces.start.forEach((value, dof) => expectReference(value, forces[index][0][dof]));
      member.localEndForces.end.forEach((value, dof) => expectReference(value, forces[index][1][dof]));
    });
  });

  it("eliminates prescribed DOFs without introducing unit diagonal pivots into a stiff model", () => {
    const project = spatialFrame();
    const factor = 1e8;
    const result = solveFrame({ ...project, sections: project.sections.map((section) => ({ ...section, areaM2: section.areaM2 * factor, secondMomentYM4: section.secondMomentYM4 * factor, secondMomentZM4: section.secondMomentZM4 * factor, torsionalConstantM4: section.torsionalConstantM4 * factor })) });
    expectReference(result.nodes[3].displacement.x * factor, 0.02806391666666667);
    expectReference(result.nodes[0].reactionMoment.y, -29.5);
  });

  it("balances global forces and moments about the origin", () => {
    const result = solveFrame(spatialFrame());
    const forces = [0, 0, 0]; const moments = [0, 0, 0];
    const accumulate = (position: Vector3, force: Vector3, moment: Vector3) => {
      components(force).forEach((value, index) => { forces[index] += value; });
      const lever = cross(position, force);
      components(moment).forEach((value, index) => { moments[index] += value + components(lever)[index]; });
    };
    for (const node of result.nodes) accumulate(result.input.nodes.find((item) => item.id === node.nodeId)!.position, node.reaction, node.reactionMoment);
    for (const load of result.input.nodalLoads) accumulate(result.input.nodes.find((item) => item.id === load.nodeId)!.position, load.force, load.moment);
    [...forces, ...moments].forEach((value) => expect(Math.abs(value)).toBeLessThanOrEqual(1e-9));
  });

  it("enforces a shared node and both fixed supports against an indeterminate beam reference", () => {
    const base = spatialFrame();
    let project: FrameProject = { ...base, nodes: base.nodes.slice(0, 3).map((node, index) => ({ ...node, position: { x: 4 * index, y: 0, z: 0 } })), members: base.members.slice(0, 2), nodalLoads: [] };
    project = addSupport(project, project.nodes[2].id, [true, true, true, true, true, true]);
    project = addNodalLoad(project, project.nodes[1].id, { x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: 0 });
    const result = solveFrame(project);
    expectReference(result.nodes[1].displacement.y, 0.0006666666666666666);
    expectReference(result.nodes[1].rotation.z, 0);
    for (const index of [0, 2]) expectReference(result.nodes[index].reaction.y, -2.5);
    expectReference(result.nodes[0].reactionMoment.z, -5);
    expectReference(result.nodes[2].reactionMoment.z, 5);
  });

  it("preserves global physics under a non-axis-aligned spatial rotation", () => {
    const project = spatialFrame(true); const reference = solveFrame(project);
    const rotate = ({ x, y, z }: Vector3): Vector3 => ({ x: (x + 8 * y + 4 * z) / 9, y: (8 * x + y - 4 * z) / 9, z: (-4 * x + 4 * y - 7 * z) / 9 });
    const result = solveFrame({ ...project, nodes: project.nodes.map((node) => ({ ...node, position: rotate(node.position) })), nodalLoads: project.nodalLoads.map((load) => ({ ...load, force: rotate(load.force), moment: rotate(load.moment) })) });
    expectSameNodes(result, { ...reference, nodes: reference.nodes.map((node) => ({ ...node, displacement: rotate(node.displacement), rotation: rotate(node.rotation), reaction: rotate(node.reaction), reactionMoment: rotate(node.reactionMoment) })) });
  });

  it("preserves anisotropic section physics when principal axes and inertias are exchanged", () => {
    const project = spatialFrame();
    const result = solveFrame({ ...project, members: project.members.map((member) => ({ ...member, rotationDegrees: 90 })), sections: project.sections.map((section) => ({ ...section, secondMomentYM4: section.secondMomentZM4, secondMomentZM4: section.secondMomentYM4 })) });
    expectSameNodes(result, solveFrame(project));
  });

  it("maps DOFs by identity even after renumbering and reversing storage and member endpoints", () => {
    const project = spatialFrame(); const reference = solveFrame(project);
    const ids = new Map(project.nodes.map((node, index) => [node.id, `node_${String(index + 11).padStart(4, "0")}` as typeof node.id]));
    const result = solveFrame({ ...project,
      nodes: project.nodes.map((node, index) => ({ ...node, id: ids.get(node.id)!, label: `N${index + 11}` })).reverse(),
      members: project.members.map((member, index) => ({ ...member, id: `member_${String(index + 11).padStart(4, "0")}` as typeof member.id, label: `M${index + 11}`, startNodeId: ids.get(member.endNodeId)!, endNodeId: ids.get(member.startNodeId)! })).reverse(),
      supports: project.supports.map((support) => ({ ...support, nodeId: ids.get(support.nodeId)! })),
      nodalLoads: project.nodalLoads.map((load) => ({ ...load, nodeId: ids.get(load.nodeId)! })),
    });
    expectSameNodes(result, { ...reference, nodes: reference.nodes.map((node) => ({ ...node, nodeId: ids.get(node.nodeId as typeof project.nodes[number]["id"])! })) });
  });

  it("superposes multiple nodal forces and moments at a shared node", () => {
    const project = spatialFrame();
    const second = addNodalLoad({ ...project, nodalLoads: [] }, project.nodes[1].id, { x: -3, y: 2, z: 7 }, { x: 1, y: -2, z: 4 });
    const firstResult = solveFrame(project); const secondResult = solveFrame(second);
    const combined = solveFrame({ ...project, nodalLoads: [...project.nodalLoads, second.nodalLoads[0]] });
    expectSameNodes(combined, { ...firstResult, nodes: firstResult.nodes.map((node, index) => {
      const sum = (field: "displacement" | "rotation" | "reaction" | "reactionMoment"): Vector3 => ({ x: node[field].x + secondResult.nodes[index][field].x, y: node[field].y + secondResult.nodes[index][field].y, z: node[field].z + secondResult.nodes[index][field].z });
      return { nodeId: node.nodeId, displacement: sum("displacement"), rotation: sum("rotation"), reaction: sum("reaction"), reactionMoment: sum("reactionMoment") };
    }) });
  });

  it("captures input before a deferred task and retains its source and bounded member records after reopening", () => {
    const project = spatialFrame();
    const input = captureAnalysisInput(project);
    project.nodes[3].position.z = 20;
    project.sections[0].areaM2 = 0.2;
    project.nodalLoads[0].force.x = 999;
    project.supports[0].restraints[0] = false;
    const result = solveFrame(input);
    expectReference(result.nodes[3].displacement.x, 0.02806391666666667);
    expect(result.input.solver).toEqual({ implementation: "framemind-frame/3", algorithm: "partial-pivot-gaussian", constraints: "free-dof-elimination", relativePivotTolerance: 1e-12 });
    const reopened = decodeProject(encodeProject(attachAnalysisResult(project, result)));
    expect(JSON.stringify(reopened.latestAnalysis)).toBe(JSON.stringify(result));
    const record = getMemberAnalysisRecord(reopened.latestAnalysis!, result.members[2].memberId);
    expect(record.analysisId).toBe(result.id);
    expect(record.origin).toBe("reconstructed-from-frozen-input");
    expect(record.dofs).toHaveLength(12);
    expect(record.dofs[0]).toEqual({ nodeId: "node_0003", dof: "ux", globalIndex: 12 });
    expect(record.localStiffness).toHaveLength(12);
    expect(record.globalStiffness).toHaveLength(12);
    expect(record.localEndForces.end).toEqual(result.members[2].localEndForces.end);
    expectReference(record.localStiffness[0][0], 1e6);
    expect(() => { result.input.nodes[0].position.x = 100; }).toThrow();
    expect(() => { reopened.latestAnalysis!.input.nodes[0].position.x = 100; }).toThrow();
    expect(() => getMemberAnalysisRecord(result, "member_9999")).toThrow(/杆件/);
    expect(() => getMemberAnalysisRecord({ ...result, input: { ...result.input, solver: undefined } }, result.members[0].memberId)).toThrow(/版本/);
  });

  it("constrains only the requested support DOF and retains loads directly applied on it", () => {
    const base = spatialFrame();
    let project: FrameProject = { ...base, nodes: base.nodes.slice(0, 3).map((node, index) => ({ ...node, position: { x: 4 * index, y: 0, z: 0 } })), members: base.members.slice(0, 2), nodalLoads: [] };
    project = addSupport(project, project.nodes[2].id, [true, false, false, false, false, false]);
    project = addNodalLoad(project, project.nodes[2].id, { x: 8, y: 5, z: 0 }, { x: 2, y: 0, z: -1.25 });
    const result = solveFrame(project);
    expectReference(result.nodes[2].displacement.x, 0);
    expectReference(result.nodes[2].reaction.x, -8);
    expectReference(result.nodes[0].reaction.x, 0);
    expectReference(result.nodes[2].displacement.y, 0.04066666666666667);
    expectReference(result.nodes[2].rotation.x, 0.0013866666666666667);
    expectReference(result.nodes[0].reactionMoment.z, -38.75);
  });

  it("handles an empty free-DOF system when every node is restrained", () => {
    let project = spatialFrame();
    for (const node of project.nodes.slice(1)) project = addSupport(project, node.id, [true, true, true, true, true, true]);
    const result = solveFrame(project);
    result.nodes.forEach((node) => [...components(node.displacement), ...components(node.rotation)].forEach((value) => expectReference(value, 0)));
    components(result.nodes[3].reaction).forEach((value, index) => expectReference(value, [-8, -5, 3][index]));
    components(result.nodes[3].reactionMoment).forEach((value, index) => expectReference(value, [-2, -1.5, 1.25][index]));
  });

  it("reads legacy results without claiming their implementation and refuses corrupted solver metadata", () => {
    const project = spatialFrame(); const result = solveFrame(project);
    const legacy = { ...result, input: { ...result.input, solver: undefined } };
    const reopened = decodeProject(encodeProject(attachAnalysisResult(project, legacy)));
    expect(reopened.latestAnalysis!.input.solver).toBeUndefined();
    expect(() => getMemberAnalysisRecord(reopened.latestAnalysis!, result.members[0].memberId)).toThrow(/版本/);
    const incompatible = { ...result, input: { ...result.input, solver: { ...result.input.solver!, implementation: "future/3" } } };
    expect(() => getMemberAnalysisRecord(incompatible, result.members[0].memberId)).toThrow(/版本/);
    for (const tolerance of [0, -1, 1, Infinity]) {
      const corrupted = { ...result, input: { ...result.input, solver: { ...result.input.solver!, relativePivotTolerance: tolerance } } };
      expect(() => decodeProject(encodeProject(attachAnalysisResult(project, corrupted)))).toThrow(/求解器配置/);
    }
  });
});
