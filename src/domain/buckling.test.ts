import { describe, expect, it } from "vitest";
import { bucklingColumn } from "../validation/buckling-fixtures";
import { captureAnalysisInput } from "./analysis";
import { deleteLoadCase, updateAnalysisCase, getLoadCaseReferences } from "./project";
import { decodeProject, encodeProject } from "./project-file";
import { createAnalysisRequest } from "./analysis-service";
import { ModelEditConfirmation, prepareModelEditConfirmation, proposeModelEdits } from "../workspace/model-edits";

describe("T2-30 buckling engineering cases", () => {
  it("removes a case dependent on a deleted fixed source and reopens without a dangling active identity", () => {
    const project = deleteLoadCase(bucklingColumn(30), "LC2", true);
    expect(project.analysisCases).toEqual([]);
    expect(project.activeAnalysisCaseId).toBeUndefined();
    expect(decodeProject(encodeProject(project)).analysisCases).toEqual([]);
  });
  it("freezes independent fixed/reference inputs, coefficients and native dependency roles", () => {
    const project = bucklingColumn(30), input = captureAnalysisInput(project), request = createAnalysisRequest(input);
    expect(input.bucklingLoads!.fixed!.nodalLoads[0].force.x).toBe(-30);
    expect(input.bucklingLoads!.reference.nodalLoads[0].force.x).toBe(-10);
    expect(input.nodalLoads).toEqual([]);
    expect(Object.isFrozen(input.bucklingLoads!.reference.nodalLoads[0].force)).toBe(true);
    expect(request.dependencies).toEqual([{ loadCaseId: "LC2", factor: 1, role: "fixed" }, { loadCaseId: "LC1", factor: 1, role: "reference" }]);
    expect(getLoadCaseReferences(project, "LC2").analyses).toBe(1);
    expect(decodeProject(encodeProject(project)).analysisCases).toEqual(project.analysisCases);
  });
  it("keeps settings isolated until an atomic tool draft is confirmed", () => {
    const project = bucklingColumn(30), { id, ...properties } = project.analysisCases[0];
    const changed = { ...properties, settings: { ...properties.settings, buckling: { ...properties.settings.buckling!, reference: [{ loadCaseId: "LC1", factor: 2 }] } } };
    const proposal = proposeModelEdits(project, { operations: [{ type: "update_analysis_case", id, properties: changed }] });
    expect(project.analysisCases[0].settings.buckling!.reference[0].factor).toBe(1);
    const applied = new ModelEditConfirmation().confirm(project, prepareModelEditConfirmation(project, proposal));
    expect(applied.result.status).toBe("applied");
    expect(captureAnalysisInput(applied.project).bucklingLoads!.reference.nodalLoads[0].force.x).toBe(-20);
    const after = decodeProject(encodeProject(applied.project));
    expect(after.analysisCases[0].settings.buckling!.reference[0].factor).toBe(2);
  });
  it("rejects missing reference, duplicate sources, invalid settings and static-style inputs", () => {
    const project = bucklingColumn(), { id, ...properties } = project.analysisCases[0];
    for (const changes of [{ reference: [] }, { reference: [{ loadCaseId: "LC1", factor: 0 }] }, { reference: [{ loadCaseId: "LC1", factor: 1 }, { loadCaseId: "LC1", factor: 2 }] }, { maxEquations: 2147483648 }, { modeCount: 0 }, { fixed: [{ loadCaseId: "LC99", factor: 1 }] }]) {
      expect(() => updateAnalysisCase(project, id, { ...properties, settings: { ...properties.settings, buckling: { ...properties.settings.buckling!, ...changes } } })).toThrow();
    }
    expect(() => updateAnalysisCase(project, id, { ...properties, loadSourceId: "LC1" })).toThrow(/固定／参考/);
  });
});
