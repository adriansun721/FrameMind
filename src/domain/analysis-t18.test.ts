import { describe, expect, it } from "vitest";
import { addMaterial, addMember, addNode, addNodalLoad, addSection, addSupport, createProject } from "./project";
import { getOverallAnalysisProcessRecord, solveFrame, supplementOverallAnalysisProcessRecord } from "./analysis";

function cantilever() {
  let project = createProject("T18 overall process");
  project = addNode(project, { x: 0, y: 0, z: 0 });
  project = addNode(project, { x: 4, y: 0, z: 0 });
  project = addMaterial(project, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  project = addSection(project, { name: "Box", areaM2: 0.01, secondMomentYM4: 0.0002, secondMomentZM4: 0.0001, torsionalConstantM4: 0.00015 });
  project = addMember(project, { startNodeId: project.nodes[0].id, endNodeId: project.nodes[1].id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
  project = addSupport(project, project.nodes[0].id, [true, true, true, true, true, true]);
  return addNodalLoad(project, project.nodes[1].id, { x: 8, y: 5, z: -3 }, { x: 2, y: 1.5, z: -1.25 });
}

describe("T18 overall analysis process", () => {
  it("exposes frozen DOF mapping, assembly contributions and constrained system", () => {
    const result = solveFrame(cantilever());
    const record = getOverallAnalysisProcessRecord(result);

    expect(record.analysisId).toBe(result.id);
    expect(record.sourceAnalysisId).toBe(result.id);
    expect(record.origin).toBe("captured-from-run");
    expect(result.process?.members[0].globalDofIndices).toEqual(record.members[0].globalDofIndices);
    expect(record.dofs).toHaveLength(12);
    expect(record.dofs.slice(0, 6).map(({ nodeId, dof, globalIndex, restrained }) => `${nodeId}:${dof}:${globalIndex}:${restrained}`)).toEqual([
      "node_0001:ux:0:true", "node_0001:uy:1:true", "node_0001:uz:2:true", "node_0001:rx:3:true", "node_0001:ry:4:true", "node_0001:rz:5:true",
    ]);
    expect(record.members[0].globalDofIndices).toEqual([...Array(12).keys()]);
    expect(record.assembledStiffness).toHaveLength(12);
    expect(record.reducedStiffness).toHaveLength(6);
    expect(record.assembledStiffness![0][0]).toBeCloseTo(record.members[0].globalStiffness[0][0], 9);
    expect(record.loadVector.slice(6, 12)).toEqual([8, 5, -3, 2, 1.5, -1.25]);
    expect(record.constrainedDofs).toEqual([0, 1, 2, 3, 4, 5]);
    expect(record.freeDofs).toEqual([6, 7, 8, 9, 10, 11]);
  });

  it("keeps printed and PDF page references distinct and records implementation differences", () => {
    const record = getOverallAnalysisProcessRecord(solveFrame(cantilever()));
    expect(record.basis.references.find((reference) => reference.section === "5.2")).toMatchObject({ printedPage: 118, pdfPage: 127 });
    expect(record.basis.differences).toEqual(expect.arrayContaining([expect.objectContaining({ topic: "坐标转换矩阵方向" }), expect.objectContaining({ topic: "约束处理" })]));
  });

  it("labels supplemental reconstruction separately for legacy results", () => {
    const result = solveFrame(cantilever());
    const legacy = { ...result, input: { ...result.input, solver: undefined } };
    expect(() => getOverallAnalysisProcessRecord(legacy)).toThrow(/版本/);
    const record = supplementOverallAnalysisProcessRecord(legacy);
    expect(record.origin).toBe("supplemental-reconstruction");
    expect(record.sourceAnalysisId).toBe(result.id);
    expect(record.analysisId).not.toBe(result.id);
  });
});
