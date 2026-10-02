import { describe, expect, it } from "vitest";
import { captureEngineeringReport, withSupplementalReportProcess } from "./engineering-report";
import { createSupplementalAnalysisInput, solveFrame } from "./analysis";
import { reportFixture } from "./engineering-report.fixture";
import { addMember, addNodalLoad, addNode, addSupport, attachAnalysisResult, updateNode, updateSection } from "./project";
import { createReportFigures } from "../workspace/report-figures";

describe("engineering report source", () => {
  it("captures only selected member processes from the historical analysis", () => {
    const original = reportFixture(); const result = original.analysisResults[0];
    const changed = updateSection(original, original.sections[0].id, { ...original.sections[0], areaM2: 0.04 });
    const selection = { memberIds: [result.input.members[0].id], steps: ["member-process" as const] };
    const report = captureEngineeringReport(changed, result.id, selection);
    selection.memberIds.length = 0;
    expect(report.appendix?.members).toHaveLength(1);
    expect(report.appendix?.members[0].localStiffness[0][0]).toBeCloseTo(500000, 6);
    expect(report.appendix?.members[0].localDisplacement[6]).toBeCloseTo(0.00002, 12);
    expect(report.appendix?.members[0].origin).toBe("reconstructed-from-frozen-input");
    expect(report.appendix?.selection.memberIds).toEqual(["member_0001"]);
    expect(report.appendix?.overall).toBeNull();
    expect(Object.isFrozen(report.appendix?.members[0].localStiffness[0])).toBe(true);
  });
  it("exports a selected historical run using its original geometry and section", () => {
    const original = reportFixture(); const result = original.analysisResults[0];
    const changed = updateNode(updateSection(original, original.sections[0].id, { ...original.sections[0], areaM2: 0.02 }), original.nodes[1].id, { x: 8, y: 0, z: 0 });
    const report = captureEngineeringReport(changed, result.id);
    expect(report.result.input.nodes[1].position.x).toBe(4);
    expect(report.result.input.sections[0].areaM2).toBe(0.01);
    expect(report.result.nodes[1].displacement.x).toBeCloseTo(0.00002, 12);
    expect(report.result.members[0].localEndForces.start[0]).toBeCloseTo(-10, 9);
    expect(Object.isFrozen(report.result.input.nodes[1].position)).toBe(true);
    expect(Object.isFrozen(report.result.nodes[1].displacement)).toBe(true);
    const figures = createReportFigures(report);
    changed.name = "后续项目名称";
    expect(report.projectName).toBe("悬臂杆工程计算书基线");
    expect(createReportFigures(report)).toEqual(figures);
  });

  it("rejects missing, failed, cross-project and unmatched results", () => {
    const project = reportFixture(); const result = project.analysisResults[0];
    expect(() => captureEngineeringReport(project, "missing")).toThrow(/已完成/);
    const replace = (value: unknown) => ({ ...project, analysisResults: [value] }) as typeof project;
    expect(() => captureEngineeringReport(replace({ ...result, status: "failed" }), result.id)).toThrow(/无效分析/);
    expect(() => captureEngineeringReport(replace({ ...result, projectId: "other" }), result.id)).toThrow(/本项目/);
    expect(() => captureEngineeringReport(replace({ ...result, nodes: result.nodes.slice(1) }), result.id)).toThrow(/对象引用/);
    expect(() => captureEngineeringReport(replace({ ...result, members: [{ ...result.members[0], length: 8 }] }), result.id)).toThrow(/几何/);
    expect(() => captureEngineeringReport(replace({ ...result, nodes: [{ ...result.nodes[0], displacement: { x: NaN, y: 0, z: 0 } }, result.nodes[1]] }), result.id)).toThrow(/位移/);
  });

  it("preserves original combination cases and weighted self weight without recomputing", () => {
    const project = reportFixture(true); const report = captureEngineeringReport(project, project.analysisResults[0].id);
    expect(report.result.input.combination?.definition.terms).toEqual([{ loadCaseId: "LC1", factor: 1.5 }, { loadCaseId: "LC2", factor: -0.5 }]);
    expect(report.result.input.combination?.cases[1].uniformLoads[0].intensity.y).toBe(-3);
    expect(report.result.input.uniformLoads?.[0].intensity.y).toBe(1.5);
    expect(report.result.nodes[0].reaction.z).toBeCloseTo(4.62051, 9);
    const figures = createReportFigures(report);
    expect(figures.model).toContain("CB1 · 恒载与反向横载");
    expect(figures.displacement).toContain(report.result.id);
  });

  it("selects captured assembly and constraints without including full matrices by default", () => {
    const project = reportFixture(true); const result = project.analysisResults[0];
    const report = captureEngineeringReport(project, result.id, { memberIds: ["member_0001"], steps: ["assembly", "dof-mapping", "constraints"] });
    expect(report.appendix?.overall?.origin).toBe("captured-from-run");
    expect(report.appendix?.overall?.loadVector[6]).toBeCloseTo(15, 9);
    expect(report.appendix?.overall?.constrainedDofs).toEqual([0, 1, 2, 3, 4, 5]);
    expect(report.appendix?.selection.steps).not.toContain("assembled-stiffness");
    expect(report.appendix?.missing).toEqual([]);
    expect(Object.isFrozen(report.result.process?.loadVector)).toBe(true);
    expect(captureEngineeringReport(project, result.id).appendix).toBeUndefined();
    expect(() => captureEngineeringReport(project, result.id, { memberIds: ["other"], steps: ["member-process"] })).toThrow(/所选分析/);
  });

  it("labels uncollected process and oversized matrices as missing instead of fabricating them", () => {
    const project = reportFixture(); const result = project.analysisResults[0];
    const legacy = { ...project, analysisResults: [{ ...result, process: undefined, input: { ...result.input, solver: undefined } }] };
    const selection = { memberIds: ["member_0001"], steps: ["member-process", "constraints", "assembled-stiffness"] as const };
    const report = captureEngineeringReport(legacy, result.id, { ...selection, steps: [...selection.steps] });
    expect(report.appendix?.members).toEqual([]);
    expect(report.appendix?.overall).toBeNull();
    expect(report.appendix?.missing.join(" ")).toMatch(/未采集整体过程快照/);
    expect(report.appendix?.missing.join(" ")).toMatch(/杆件过程缺少记录/);
    const bounded = { ...project, analysisResults: [{ ...result, process: { ...result.process!, assembledStiffness: null, reducedStiffness: null } }] };
    expect(captureEngineeringReport(bounded, result.id, { memberIds: [], steps: ["assembled-stiffness", "reduced-stiffness"] }).appendix?.missing).toHaveLength(2);
  });

  it("does not export captured process entries that map to the wrong historical objects", () => {
    const project = reportFixture(); const result = project.analysisResults[0];
    const process = structuredClone(result.process!);
    process.dofs[0].nodeId = result.input.nodes[1].id;
    const corrupted = { ...project, analysisResults: [{ ...result, process }] };
    const report = captureEngineeringReport(corrupted, result.id, { memberIds: ["member_0001"], steps: ["dof-mapping", "assembly"] });
    expect(report.appendix?.overall).toBeNull();
    expect(report.appendix?.missing.join(" ")).toMatch(/冻结输入不可对应/);
  });

  it("marks numerically unrelated captured matrices and loads missing while preserving the original body", () => {
    const project = reportFixture(); const result = project.analysisResults[0];
    const changed = solveFrame(updateSection(project, project.sections[0].id, { ...project.sections[0], areaM2: 0.04 }));
    const mutations = [
      changed.process!,
      { ...structuredClone(result.process!), loadVector: result.process!.loadVector.map((value) => value + 1) },
      { ...structuredClone(result.process!), assembledStiffness: result.process!.assembledStiffness!.map((row) => row.map((value) => value + 1)) },
      { ...structuredClone(result.process!), reducedStiffness: result.process!.reducedStiffness!.map((row) => row.map((value) => value + 1)) },
    ];
    for (const process of mutations) {
      const corrupted = { ...project, analysisResults: [{ ...result, process }] };
      const report = captureEngineeringReport(corrupted, result.id, { memberIds: ["member_0001"], steps: ["member-process", "assembly", "constraints", "assembled-stiffness", "reduced-stiffness"] });
      expect(report.result.nodes[1].displacement.x).toBeCloseTo(0.00002, 12);
      expect(report.appendix?.members[0].globalStiffness[0][0]).toBeCloseTo(500000, 6);
      expect(report.appendix?.overall).toBeNull();
      expect(report.appendix?.missing.join(" ")).toMatch(/冻结输入不可对应/);
    }
  });

  it("retains captured member contributions when the real run exceeds both matrix collection limits", () => {
    let project = reportFixture();
    for (let index = 1; index <= 12; index += 1) {
      project = addNode(project, { x: 4, y: index, z: 0 });
      const end = project.nodes.at(-1)!;
      project = addMember(project, { startNodeId: project.nodes[0].id, endNodeId: end.id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
      project = addNodalLoad(project, end.id, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    }
    project = attachAnalysisResult(project, solveFrame(project));
    const result = project.analysisResults.at(-1)!;
    const report = captureEngineeringReport(project, result.id, { memberIds: ["member_0001"], steps: ["assembly", "assembled-stiffness", "reduced-stiffness"] });
    expect(report.appendix?.overall?.dofs).toHaveLength(84);
    expect(report.appendix?.overall?.assembledStiffness).toBeNull();
    expect(report.appendix?.overall?.reducedStiffness).toBeNull();
    expect(report.appendix?.overall?.members).toHaveLength(13);
    expect(report.appendix?.missing).toHaveLength(2);
    expect(report.appendix?.missing.join(" ")).toContain("采集上限 72 阶");
    const constrained = addSupport(project, project.nodes.at(-1)!.id, [true, true, true, true, true, true]);
    const smallerFreeSystem = attachAnalysisResult(constrained, solveFrame(constrained));
    const smallerResult = smallerFreeSystem.analysisResults.at(-1)!;
    const smallerReport = captureEngineeringReport(smallerFreeSystem, smallerResult.id, { memberIds: [], steps: ["reduced-stiffness"] });
    expect(smallerReport.appendix?.overall?.dofs).toHaveLength(84);
    expect(smallerReport.appendix?.overall?.reducedStiffness).toHaveLength(72);
    expect(smallerReport.appendix?.missing).toEqual([]);
  });

  it("keeps the original body and labels an explicit frozen-input supplemental process separately", () => {
    const project = reportFixture(); const original = project.analysisResults[0];
    const legacy = { ...project, analysisResults: [{ ...original, process: undefined, input: { ...original.input, solver: undefined } }] };
    const report = captureEngineeringReport(legacy, original.id, { memberIds: ["member_0001"], steps: ["member-process", "constraints"] });
    const supplemental = solveFrame(createSupplementalAnalysisInput(report.result));
    const supplemented = withSupplementalReportProcess(report, supplemental);
    expect(supplemented.result.id).toBe(original.id);
    expect(supplemented.result.input.solver).toBeUndefined();
    expect(supplemented.appendix?.overall).toMatchObject({ analysisId: supplemental.id, sourceAnalysisId: original.id, origin: "supplemental-reconstruction" });
    expect(supplemented.appendix?.members[0]).toMatchObject({ analysisId: supplemental.id, sourceAnalysisId: original.id, origin: "supplemental-reconstruction" });
    expect(supplemented.appendix?.missing).toEqual([]);
    expect(supplemented.appendix?.members[0].localStiffness[0][0]).toBeCloseTo(500000, 6);
    const other = solveFrame(updateSection(project, project.sections[0].id, { ...project.sections[0], areaM2: 0.04 }));
    expect(() => withSupplementalReportProcess(report, other)).toThrow(/冻结输入/);
    expect(project.analysisResults).toHaveLength(1);
    expect(report.appendix?.missing).not.toHaveLength(0);
  });
});
