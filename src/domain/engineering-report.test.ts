import { describe, expect, it } from "vitest";
import { captureEngineeringReport } from "./engineering-report";
import { reportFixture } from "./engineering-report.fixture";
import { updateNode, updateSection } from "./project";
import { createReportFigures } from "../workspace/report-figures";

describe("engineering report source", () => {
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
});
