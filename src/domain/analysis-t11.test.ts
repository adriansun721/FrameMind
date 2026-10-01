import { describe, expect, it } from "vitest";
import { captureAnalysisInput, getLoadCaseResult, isAnalysisResultCurrent, solveFrame } from "./analysis";
import { addLoadCase, addMaterial, addMember, addNodalLoad, addNode, addSection, addSupport, addUniformLoad, attachAnalysisResult, createProject, deleteLoadCase, selectLoadCase, updateLoadCase, updateNodalLoad, updateNode, updateSelfWeight } from "./project";
import { decodeProject, encodeProject } from "./project-file";

function cantilever() {
  let p = createProject("T11 independent cases");
  p = addNode(p, { x: 0, y: 0, z: 0 }); p = addNode(p, { x: 4, y: 0, z: 0 });
  p = addMaterial(p, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  p = addSection(p, { name: "Reference", areaM2: 0.01, secondMomentYM4: 0.0002, secondMomentZM4: 0.0001, torsionalConstantM4: 0.00015 });
  p = addMember(p, { startNodeId: p.nodes[0].id, endNodeId: p.nodes[1].id, materialId: p.materials[0].id, sectionId: p.sections[0].id, rotationDegrees: 0 });
  p = addSupport(p, p.nodes[0].id, [true, true, true, true, true, true]);
  p = addLoadCase(p, "横向与自重", "全局 Y 均布力与 Z 重力");
  p = addNodalLoad(p, p.nodes[1].id, { x: 10, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, "LC1");
  p = addUniformLoad(p, { kind: "uniform", memberId: p.members[0].id, coordinateSystem: "global", loadCaseId: "LC2", intensity: { x: 0, y: -3, z: 0 } });
  return updateSelfWeight(p, { enabled: true, loadCaseId: "LC2", gravity: { x: 0, y: 0, z: -9.81 } });
}

describe("T11 independent load cases", () => {
  it("separately solves nodal force/moment and uniform/self-weight inputs against cantilever formulas", () => {
    const p = cantilever();
    const axial = solveFrame(p); const transverse = solveFrame(captureAnalysisInput(p, "LC2"));
    expect(axial.input.loadCase?.id).toBe("LC1");
    expect(axial.input.nodalLoads).toHaveLength(1); expect(axial.input.uniformLoads).toHaveLength(0); expect(axial.input.selfWeight?.enabled).toBe(false);
    expect(axial.nodes[1].displacement.x).toBeCloseTo(0.00002, 12);
    expect(axial.nodes[1].rotation.x).toBeCloseTo(0.0006933333333333333, 12);
    expect(axial.nodes[0].reaction.x).toBeCloseTo(-10, 10); expect(axial.nodes[0].reactionMoment.x).toBeCloseTo(-2, 10);
    expect(axial.members[0].localEndForces.start).toEqual([-10, 0, 0, -2, 0, 0]);
    expect(transverse.input.loadCase?.id).toBe("LC2"); expect(transverse.input.nodalLoads).toHaveLength(0);
    expect(transverse.nodes[1].displacement.y).toBeCloseTo(-0.0048, 12);
    expect(transverse.nodes[1].displacement.z).toBeCloseTo(-0.000616068, 12);
    expect(transverse.nodes[0].reaction.y).toBeCloseTo(12, 10); expect(transverse.nodes[0].reaction.z).toBeCloseTo(3.08034, 10);
    expect(transverse.nodes[0].reactionMoment.y).toBeCloseTo(-6.16068, 10); expect(transverse.nodes[0].reactionMoment.z).toBeCloseTo(24, 10);
    expect(transverse.members[0].localEndForces.start[1]).toBeCloseTo(12, 10);
    expect(transverse.members[0].localEndForces.start[4]).toBeCloseTo(-6.16068, 10);
    expect(() => solveFrame(captureAnalysisInput(p, "LC9"))).toThrow(/工况/);
  });

  it("saves and reopens both results, keeping case-local edits independent and structural edits shared", () => {
    let p = cantilever(); p = attachAnalysisResult(p, solveFrame(p));
    p = selectLoadCase(p, "LC2"); p = attachAnalysisResult(p, solveFrame(p));
    p = decodeProject(encodeProject(p));
    const first = getLoadCaseResult(p, "LC1")!; const second = getLoadCaseResult(p, "LC2")!;
    expect(p.activeLoadCaseId).toBe("LC2"); expect(p.analysisResults).toHaveLength(2);
    expect(isAnalysisResultCurrent(p, first)).toBe(true); expect(isAnalysisResultCurrent(p, second)).toBe(true);
    p = updateLoadCase(p, "LC2", "风与重力", "编辑来源");
    expect(isAnalysisResultCurrent(p, first)).toBe(true); expect(isAnalysisResultCurrent(p, second)).toBe(false);
    expect(second.input.loadCase?.name).toBe("横向与自重");
    p = updateNodalLoad(p, p.nodalLoads[0].id, p.nodes[1].id, { x: 20, y: 0, z: 0 }, { x: 2, y: 0, z: 0 });
    expect(isAnalysisResultCurrent(p, first)).toBe(false); expect(first.input.nodalLoads[0].force.x).toBe(10);
    p = selectLoadCase(p, "LC1"); p = attachAnalysisResult(p, solveFrame(p));
    p = selectLoadCase(p, "LC2"); p = attachAnalysisResult(p, solveFrame(p));
    const moved = updateNode(p, p.nodes[1].id, { x: 5, y: 0, z: 0 });
    expect(moved.analysisResults.every((r) => !isAnalysisResultCurrent(moved, r))).toBe(true);
  });

  it("requires explicit reference cleanup, deletes atomically, and never reuses an old case ID", () => {
    let p = cantilever(); p = selectLoadCase(p, "LC2"); p = attachAnalysisResult(p, solveFrame(p));
    expect(() => deleteLoadCase(p, "LC2")).toThrow(/2 条荷载、1 份结果/);
    p = deleteLoadCase(p, "LC2", true);
    expect(p.activeLoadCaseId).toBe("LC1"); expect(p.uniformLoads).toEqual([]); expect(p.selfWeight.enabled).toBe(false); expect(p.analysisResults).toEqual([]); expect(p.latestAnalysis).toBeUndefined();
    expect(() => deleteLoadCase(p, "LC1", true)).toThrow(/至少/);
    p = addLoadCase(p, "后续工况"); expect(p.loadCases[1].id).toBe("LC3");
    expect(decodeProject(encodeProject(p)).loadCases[1].id).toBe("LC3");
  });

  it("rejects orphan or mixed-case file/solver inputs and migrates pre-T11 projects to LC1", () => {
    const p = cantilever(); const result = solveFrame(p);
    expect(() => decodeProject(encodeProject({ ...p, loadCases: [p.loadCases[0]] }))).toThrow(/工况/);
    expect(() => solveFrame({ ...p, nodalLoads: [{ ...p.nodalLoads[0], loadCaseId: "LC9" }] })).toThrow(/工况/);
    expect(() => solveFrame({ ...result.input, uniformLoads: p.uniformLoads })).toThrow(/工况/);
    expect(() => decodeProject(encodeProject({ ...p, latestAnalysis: { ...result, input: { ...result.input, uniformLoads: p.uniformLoads } }, revision: p.revision + 1 }))).toThrow(/工况/);
    const legacy = JSON.parse(encodeProject(attachAnalysisResult(createLegacy(), solveFrame(createLegacy()))));
    delete legacy.loadCases; delete legacy.activeLoadCaseId; delete legacy.nextLoadCaseNumber; delete legacy.analysisResults;
    delete legacy.nodalLoads[0].loadCaseId; delete legacy.latestAnalysis.input.loadCase; delete legacy.latestAnalysis.input.nodalLoads[0].loadCaseId;
    const reopened = decodeProject(JSON.stringify(legacy));
    expect(reopened.activeLoadCaseId).toBe("LC1"); expect(reopened.nodalLoads[0].loadCaseId).toBe("LC1"); expect(reopened.analysisResults).toHaveLength(1);
  });
});

function createLegacy() {
  const p = cantilever();
  return { ...p, id: "project_legacy" as typeof p.id, uniformLoads: [], selfWeight: { ...p.selfWeight, enabled: false, loadCaseId: "LC1" } };
}
