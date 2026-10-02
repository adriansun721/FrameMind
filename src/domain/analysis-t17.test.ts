import { describe, expect, it } from "vitest";
import { addMaterial, addMember, addNode, addNodalLoad, addSection, addSupport, createProject } from "./project";
import { getMemberAnalysisRecord, solveFrame, supplementMemberAnalysisRecord } from "./analysis";

function cantilever() {
  let project = createProject("T17 member process");
  project = addNode(project, { x: 0, y: 0, z: 0 });
  project = addNode(project, { x: 4, y: 0, z: 0 });
  project = addMaterial(project, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  project = addSection(project, { name: "Box", areaM2: 0.01, secondMomentYM4: 0.0002, secondMomentZM4: 0.0001, torsionalConstantM4: 0.00015 });
  project = addMember(project, { startNodeId: project.nodes[0].id, endNodeId: project.nodes[1].id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
  project = addSupport(project, project.nodes[0].id, [true, true, true, true, true, true]);
  return addNodalLoad(project, project.nodes[1].id, { x: 8, y: 5, z: -3 }, { x: 2, y: 1.5, z: -1.25 });
}

describe("T17 member analysis process", () => {
  it("exposes the selected member's frozen-input matrices, axes, mapping and displacements", () => {
    const project = cantilever();
    const result = solveFrame(project);
    const record = getMemberAnalysisRecord(result, result.members[0].memberId);

    expect(record.analysisId).toBe(result.id);
    expect(record.sourceAnalysisId).toBe(result.id);
    expect(record.origin).toBe("reconstructed-from-frozen-input");
    expect(record.dofs).toHaveLength(12);
    expect(record.dofs.slice(0, 6).map(({ nodeId, dof, globalIndex }) => `${nodeId}:${dof}:${globalIndex}`)).toEqual([
      "node_0001:ux:0", "node_0001:uy:1", "node_0001:uz:2", "node_0001:rx:3", "node_0001:ry:4", "node_0001:rz:5",
    ]);
    expect(record.localStiffness).toHaveLength(12);
    expect(record.localStiffness[0][0]).toBeCloseTo(500_000, 6);
    expect(record.localStiffness[0][6]).toBeCloseTo(-500_000, 6);
    expect(record.transformation[0][0]).toBe(1);
    expect(record.transformation[1][1]).toBe(1);
    expect(record.transformation[2][2]).toBe(1);
    expect(record.globalStiffness[0][0]).toBeCloseTo(record.localStiffness[0][0], 6);
    expect(record.globalDisplacement).toHaveLength(12);
    expect(record.localDisplacement).toHaveLength(12);
    expect(record.localEndForces.end[0]).toBeCloseTo(8, 9);
  });

  it("labels a supplemental reconstruction with a new analysis id for legacy results", () => {
    const result = solveFrame(cantilever());
    const legacy = { ...result, input: { ...result.input, solver: undefined } };

    expect(() => getMemberAnalysisRecord(legacy, result.members[0].memberId)).toThrow(/版本/);
    const record = supplementMemberAnalysisRecord(legacy, result.members[0].memberId);

    expect(record.origin).toBe("supplemental-reconstruction");
    expect(record.sourceAnalysisId).toBe(result.id);
    expect(record.analysisId).not.toBe(result.id);
    expect(record.localStiffness.flat().every(Number.isFinite)).toBe(true);
  });
});
