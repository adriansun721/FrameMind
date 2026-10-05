import { describe, expect, it } from "vitest";
import samples from "../../docs/evidence/plan2/T2-14/wire-samples.json";
import { decodeAnalysisResult, decodeProject, encodeProject } from "./project-file";
import { attachAnalysisResult, updateNode } from "./project";
import { getMemberAnalysisRecord, getMemberResponseSamples, getMemberSectionForces, getOverallAnalysisProcessRecord, isAnalysisResultCurrent, solveFrame } from "./analysis";
import { compareAnalysisResults } from "./analysis-comparison";
import { captureEngineeringReport } from "./engineering-report";
import { buildReportPdfHtml } from "../workspace/report-pdf";
import { captureAiSnapshot, executeAiTool } from "../workspace/ai-tools";

const sample = (id: string) => {
  const wire = samples.find((item) => item.id === id)!;
  return { project: decodeProject(JSON.stringify(wire.project)), result: decodeAnalysisResult(wire.result) };
};

describe("native full static results through existing engineering interfaces", () => {
  it("recovers quadratic bending at a location between captured stations", () => {
    const { result } = sample("uniform-local");
    // qz=4 on a 4 m cantilever: My at x=0.3 is -4*(4-0.3)^2/2.
    const actions = getMemberSectionForces(result, result.members[0].memberId, 0.3).forces;
    expect(actions[4]).toBeCloseTo(-27.38, 9);
    expect(actions[5]).toBeCloseTo(-20.535, 9);
    expect(getMemberResponseSamples(result, result.members[0].memberId)).toEqual(
      result.members[0].nativeResponses!.map((s) => ({ ...s, analysisId: result.id, memberId: result.members[0].memberId })),
    );
    expect(getMemberAnalysisRecord(result, result.members[0].memberId).origin).toBe("reconstructed-from-frozen-input");
  });

  it("keeps spatial history, comparison and report tied to the same native input", () => {
    const { project, result } = sample("spatial-chain");
    const saved = decodeProject(encodeProject(attachAnalysisResult(project, result)));
    expect(isAnalysisResultCurrent(saved, saved.latestAnalysis!)).toBe(true);
    const before = solveFrame(project);
    const comparison = compareAnalysisResults(before, result);
    expect(comparison.compatible).toBe(true);
    expect(comparison.members).toHaveLength(3);
    for (const row of comparison.members) for (const value of [...row.startDelta, ...row.endDelta]) expect(Math.abs(value)).toBeLessThan(1e-9);
    const changed = updateNode(saved, saved.nodes[1].id, { x: 5, y: 0, z: 0 });
    expect(isAnalysisResultCurrent(changed, result)).toBe(false);
    const report = captureEngineeringReport(changed, result.id, { memberIds: result.members.map((m) => m.memberId), steps: ["member-process", "assembly", "assembled-stiffness", "reduced-stiffness"] });
    expect(report.result.input).toEqual(result.input);
    expect(report.appendix!.missing).toEqual([]);
    expect(report.appendix!.overall!.origin).toBe("captured-from-run");
    expect(report.appendix!.overall!.solver.algorithm).toBe("sparse-ldlt");
    expect(buildReportPdfHtml(report)).toContain("framemind-native/2");
    expect(getOverallAnalysisProcessRecord(result).loadVector).toEqual(result.process!.loadVector);
  });

  it("rejects incomplete or incorrectly mapped multi-member native records", () => {
    const { result } = sample("spatial-chain");
    for (const edit of [
      (r: typeof result) => { r.process!.members.pop(); },
      (r: typeof result) => { r.process!.members[1] = r.process!.members[0]; },
      (r: typeof result) => { r.process!.members[1].globalDofIndices.reverse(); },
      (r: typeof result) => { r.members[1].nativeResponses = undefined; },
      (r: typeof result) => { r.process!.assembledStiffness = null; },
      (r: typeof result) => { r.process!.solver.algorithm = "partial-pivot-gaussian"; },
    ]) {
      const modified = structuredClone(result); edit(modified);
      expect(() => decodeAnalysisResult(modified)).toThrow();
    }
  });

  it("quotes the native combination result with its identity, units and current state", () => {
    const { project, result } = sample("combination-negative");
    const saved = attachAnalysisResult(project, result);
    const read = (p: typeof saved) => executeAiTool(captureAiSnapshot(p, []), { id: "native_quote", type: "function", function: {
      name: "read_result", arguments: JSON.stringify({ kind: "member", id: result.members[0].memberId, quantity: "sectionForces", component: "My", position: 2 }),
    } });
    const output = read(saved);
    expect(output.status).toBe("completed");
    expect(output.reference).toMatchObject({ analysisId: result.id, inputRevision: result.projectRevision, current: true, unit: "kN·m", source: { kind: "combination" } });
    expect(output.reference!.value).toBeCloseTo(-45.270085, 9);
    const changed = updateNode(saved, saved.nodes[1].id, { x: 5, y: 0, z: 0 });
    expect(read(changed).reference!.current).toBe(false);
  });
});
