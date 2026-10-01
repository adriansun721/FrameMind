import { describe, expect, it } from "vitest";
import { captureAnalysisInput, getSelfWeightSummary, solveFrame } from "./analysis";
import { addMaterial, addMember, addNode, addSection, addSupport, attachAnalysisResult, createProject, updateSection, updateSelfWeight } from "./project";
import { decodeProject, encodeProject } from "./project-file";

function cantilever() {
  let project = createProject("T10 self weight");
  project = addNode(project, { x: 0, y: 0, z: 0 });
  project = addNode(project, { x: 4, y: 0, z: 0 });
  project = addMaterial(project, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  project = addSection(project, { name: "Reference", areaM2: 0.01, secondMomentYM4: 0.0002, secondMomentZM4: 0.0001, torsionalConstantM4: 0.00015 });
  project = addMember(project, { startNodeId: project.nodes[0].id, endNodeId: project.nodes[1].id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
  return addSupport(project, project.nodes[0].id, [true, true, true, true, true, true]);
}

const close = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.max(1e-10, Math.abs(expected) * 1e-9));

describe("T10 self weight", () => {
  it("assembles material density and area into one LC1 gravity load and balances reactions", () => {
    const project = updateSelfWeight(cantilever(), { enabled: true, loadCaseId: "LC1", gravity: { x: 0, y: 0, z: -9.81 } });
    const result = solveFrame(project);
    const summary = getSelfWeightSummary(result.input);
    expect(summary.loadCaseId).toBe("LC1");
    close(summary.totalMassKg, 7850 * 0.01 * 4);
    close(summary.totalWeightKN, 7850 * 0.01 * 4 * 9.81 / 1000);
    close(summary.totalForce.z, -summary.totalWeightKN);
    close(result.nodes[0].reaction.z, summary.totalWeightKN);
    const e = 200e6; const iY = 0.0002; const q = -summary.totalWeightKN / 4;
    close(result.nodes[1].displacement.z, q * 4 ** 4 / (8 * e * iY));
    expect(result.input.selfWeight?.enabled).toBe(true);
    expect(result.input.uniformLoads).toHaveLength(0);
  });

  it("freezes self weight in old results and does not accumulate on repeated solves", () => {
    const project = updateSelfWeight(cantilever(), { enabled: true, loadCaseId: "LC1", gravity: { x: 0, y: 0, z: -9.81 } });
    const first = solveFrame(project);
    const attached = attachAnalysisResult(project, first);
    const changed = updateSection(attached, attached.sections[0].id, { ...attached.sections[0], areaM2: 0.02 });
    const second = solveFrame(changed);
    expect(getSelfWeightSummary(first.input).totalWeightKN).toBeCloseTo(3.08034, 10);
    expect(getSelfWeightSummary(first.input).totalWeightKN).not.toBe(getSelfWeightSummary(second.input).totalWeightKN);
    expect(attached.latestAnalysis?.input.selfWeight?.gravity.z).toBe(-9.81);
    expect(second.nodes[0].reaction.z).toBeCloseTo(2 * first.nodes[0].reaction.z, 10);
    const reopened = decodeProject(encodeProject(attached));
    expect(reopened.selfWeight.enabled).toBe(true);
    expect(reopened.latestAnalysis?.input.selfWeight?.enabled).toBe(true);
    expect(getSelfWeightSummary(reopened.latestAnalysis!.input).totalWeightKN).toBeCloseTo(getSelfWeightSummary(first.input).totalWeightKN, 10);
    expect(captureAnalysisInput(reopened).selfWeight?.gravity.z).toBe(-9.81);
  });
});
