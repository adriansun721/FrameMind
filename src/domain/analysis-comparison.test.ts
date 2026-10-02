import { describe, expect, it } from "vitest";
import { compareAnalysisResults } from "./analysis-comparison";
import { solveFrame } from "./analysis";
import { addMaterial, addMember, addNodalLoad, addNode, addSection, addSupport, attachAnalysisResult, createProject, updateSection } from "./project";
import { decodeProject, encodeProject } from "./project-file";

function frame() {
  let project = createProject("T15 comparison");
  project = addNode(project, { x: 0, y: 0, z: 0 }); project = addNode(project, { x: 4, y: 0, z: 0 });
  project = addMaterial(project, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  project = addSection(project, { name: "Box", areaM2: 0.01, secondMomentYM4: 0.0001, secondMomentZM4: 0.0001, torsionalConstantM4: 0.0001 });
  project = addMember(project, { startNodeId: project.nodes[0].id, endNodeId: project.nodes[1].id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
  project = addSupport(project, project.nodes[0].id, [true, true, true, true, true, true]);
  return addNodalLoad(project, project.nodes[1].id, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
}

describe("T15 analysis comparisons", () => {
  it("keeps same-source runs and reports changed parameters and response deltas", () => {
    let project = frame();
    const before = solveFrame(project);
    project = attachAnalysisResult(project, before);
    project = updateSection(project, project.sections[0].id, { ...project.sections[0], areaM2: 0.02 });
    const after = solveFrame(project);
    project = attachAnalysisResult(project, after);
    const reopened = decodeProject(encodeProject(project));
    expect(reopened.analysisResults).toHaveLength(2);
    expect(reopened.analysisResults[0].input.sections[0].areaM2).toBe(0.01);
    expect(reopened.analysisResults[1].input.sections[0].areaM2).toBe(0.02);
    const compared = compareAnalysisResults(before, after);
    expect(compared.compatible).toBe(true);
    expect(compared.changes.some((change) => change.kind === "section" && change.changes.includes("面积 A"))).toBe(true);
    expect(compared.nodes[1].displacementDelta.x).not.toBe(0);
    expect(compared.members[0].startDelta[0]).toBe(0);
  });

  it("explains incompatible sources instead of producing a misleading comparison", () => {
    const project = frame();
    const first = solveFrame(project);
    const second = { ...first, input: { ...first.input, loadCase: { ...first.input.loadCase!, id: "LC9" } } };
    const compared = compareAnalysisResults(first, second);
    expect(compared.compatible).toBe(false);
    expect(compared.issues.join(" ")).toContain("来源工况或组合不同");
  });
});
