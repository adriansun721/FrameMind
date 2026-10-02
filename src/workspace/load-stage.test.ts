import { describe, expect, it } from "vitest";
import { addLoadCase, addMaterial, addMember, addNode, addSection, createProject, selectLoadCase } from "../domain/project";
import { solveFrame } from "../domain/analysis";
import { decodeProject, encodeProject } from "../domain/project-file";
import { ProjectHistory } from "../domain/project-history";
import { captureAiSnapshot, executeAiTool } from "./ai-tools";
import { buildConditionsPreview, ConditionsStageConfirmation, prepareConditionsConfirmation } from "./analysis-conditions";

function model() {
  let p = addNode(createProject(), { x: 0, y: 0, z: 0 });
  p = addNode(p, { x: 4, y: 0, z: 0 });
  p = addMaterial(p, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  p = addSection(p, { name: "Box", areaM2: 0.01, secondMomentYM4: 0.0002, secondMomentZM4: 0.0001, torsionalConstantM4: 0.00015 });
  return addMember(p, { startNodeId: p.nodes[0].id, endNodeId: p.nodes[1].id, materialId: p.materials[0].id, sectionId: p.sections[0].id, rotationDegrees: 0 });
}
const call = (args: unknown) => ({ id: "loads", type: "function", function: { name: "propose_analysis_conditions", arguments: JSON.stringify(args) } });
const p = model();
const input = {
  supports: [{ nodeId: p.nodes[0].id, restraints: [true, true, true, true, true, true], source: "user" }], nodalLoads: [],
  loadCases: [{ ref: "dead", id: "LC1", name: "Dead", description: "Self weight", source: "user" }, { ref: "live", name: "Live", description: "Uniform force", source: "user" }],
  uniformLoads: [{ memberId: p.members[0].id, coordinateSystem: "local", loadCaseId: "live", intensity: { x: 0, y: -2, z: 0 }, source: "user" }],
  selfWeight: { enabled: true, loadCaseId: "dead", gravity: { x: 0, y: 0, z: -10 }, source: "suggestion" },
  loadCombinations: [{ ref: "service", name: "User service", terms: [{ loadCaseId: "dead", factor: 1 }, { loadCaseId: "live", factor: -0.5 }], source: "user" }],
  analysisSourceId: "service",
};

describe("T24 confirmed load stages via public tools and solver", () => {
  it("previews two cases, local uniform force, self weight and a user combination, then solves only confirmed inputs", () => {
    const before = encodeProject(p);
    const preview = executeAiTool(captureAiSnapshot(p, []), call(input));
    expect(preview.status).toBe("awaiting-confirmation");
    expect(encodeProject(p)).toBe(before);
    const stage = new ConditionsStageConfirmation();
    const confirmation = prepareConditionsConfirmation(p, preview.conditions!);
    const applied = stage.confirm(p, confirmation);
    expect(applied.result.status).toBe("applied");
    expect(applied.project.revision).toBe(p.revision + 1);
    expect(applied.project.activeLoadCombinationId).toBe("CB1");
    expect(applied.project.uniformLoads[0].loadCaseId).toBe("LC2");
    expect(applied.project.selfWeight.loadCaseId).toBe("LC1");
    expect(applied.result.data).toMatchObject({ references: { dead: "LC1", live: "LC2", service: "CB1" } });
    const solved = solveFrame(applied.project);
    // 4m cantilever: effective qy=+1 kN/m, qz=-0.785 kN/m; E=200 GPa.
    expect(solved.nodes[1].displacement.y).toBeCloseTo(0.0016, 10);
    expect(solved.nodes[1].displacement.z).toBeCloseTo(-0.000628, 10);
    expect(solved.nodes[0].reaction.y).toBeCloseTo(-4, 10);
    expect(solved.nodes[0].reaction.z).toBeCloseTo(3.14, 10);
    expect(solved.input.combination?.cases).toHaveLength(2);
    expect(solved.input.combination?.definition.terms).toEqual([{ loadCaseId: "LC1", factor: 1 }, { loadCaseId: "LC2", factor: -0.5 }]);
    expect(decodeProject(encodeProject(applied.project))).toEqual(applied.project);
    const history = new ProjectHistory(); history.record(p, applied.project);
    expect(history.undo(applied.project)).toBe(p);
    expect(history.redo(p)).toBe(applied.project);
    expect(stage.confirm(applied.project, confirmation).project).toBe(applied.project);
    expect(stage.confirm(p, confirmation).project).toBe(p);
  });

  it("retains partial updates, rejects malformed and dangling inputs, and rolls back a late combination failure", () => {
    const snapshot = captureAiSnapshot(p, []);
    const proposal = executeAiTool(snapshot, call(input)).conditions!;
    const update = executeAiTool(snapshot, call({ selfWeight: { ...input.selfWeight, gravity: { x: 0, y: 0, z: -9.81 }, source: "user" } }), undefined, proposal);
    expect(update.conditions?.uniformLoads).toEqual(proposal.uniformLoads);
    expect(update.conditions?.loadCombinations).toEqual(proposal.loadCombinations);
    expect(update.conditions?.selfWeight?.source).toBe("user");
    for (const bad of [
      { ...input, code: "arbitrary" }, { ...input, uniformLoads: [{ ...input.uniformLoads[0], intensity: { x: "1", y: 0, z: 0 } }] },
      { ...input, selfWeight: { ...input.selfWeight, gravity: { x: 0, y: 0, z: 0 } } },
      { ...input, loadCases: [...input.loadCases, input.loadCases[1]] },
      { ...input, loadCases: [{ ...input.loadCases[0], ref: "LC2" }, input.loadCases[1]] },
      { ...input, loadCombinations: [{ ...input.loadCombinations[0], terms: [{ loadCaseId: "live", factor: 1 }, { loadCaseId: "live", factor: 0 }] }] },
      { ...input, uniformLoads: [{ ...input.uniformLoads[0], memberId: "M1" }] },
      { ...input, uniformLoads: [{ ...input.uniformLoads[0], loadCaseId: "unknown" }] },
      { ...input, loadCombinations: [{ ...input.loadCombinations[0], terms: [] }] },
      { ...input, loadCombinations: [{ ...input.loadCombinations[0], terms: [{ loadCaseId: "dead", factor: null }] }] },
    ]) {
      const result = executeAiTool(snapshot, call(bad));
      expect(["failed", "missing-input"]).toContain(result.status);
    }
    const base = { ...p, nextLoadCombinationNumber: Number.MAX_SAFE_INTEGER };
    const stage = new ConditionsStageConfirmation();
    const confirmation = prepareConditionsConfirmation(base, proposal);
    expect(stage.confirm(base, confirmation)).toMatchObject({ project: base, result: { status: "failed" } });
    expect(base.uniformLoads).toHaveLength(0);
    expect(base.loadCases).toHaveLength(1);
    expect(base.selfWeight.enabled).toBe(false);
    expect(stage.confirm(base, confirmation).result.status).toBe("failed");
  });

  it("previews user uniform arrows and one self-weight marker without adding weight arrows to every member", () => {
    const proposal = executeAiTool(captureAiSnapshot(p, []), call(input)).conditions!;
    const preview = buildConditionsPreview(p, proposal);
    expect(preview.uniformLoads).toHaveLength(1);
    expect(preview.uniformLoads![0]).toMatchObject({ coordinateSystem: "local", intensity: { x: 0, y: -2, z: 0 } });
    expect(preview.selfWeight).toMatchObject({ enabled: true, caseLabel: "Dead", gravity: { x: 0, y: 0, z: -10 } });
    expect(p.uniformLoads).toHaveLength(0);
    expect(p.selfWeight.enabled).toBe(false);
  });

  it("updates stable load, case and combination identities, supports zero coefficients, and rejects a stale frozen stage", () => {
    const stage = new ConditionsStageConfirmation();
    const applied = stage.confirm(p, prepareConditionsConfirmation(p, executeAiTool(captureAiSnapshot(p, []), call(input)).conditions!)).project;
    const request = { supports: [], nodalLoads: [],
      loadCases: [{ ref: "live", id: "LC2", name: "Revised live", description: "", source: "user" }],
      uniformLoads: [{ ...input.uniformLoads[0], id: applied.uniformLoads[0].id, coordinateSystem: "global", intensity: { x: 0, y: 0, z: -6 } }],
      selfWeight: { ...input.selfWeight, enabled: false, loadCaseId: "LC2" },
      loadCombinations: [{ ref: "zero", id: "CB1", name: "Zero response", terms: [{ loadCaseId: "LC1", factor: 0 }, { loadCaseId: "live", factor: 0 }], source: "user" }], analysisSourceId: "zero" };
    const preview = executeAiTool(captureAiSnapshot(applied, []), call(request));
    expect(preview.status).toBe("awaiting-confirmation");
    const confirmation = prepareConditionsConfirmation(applied, preview.conditions!);
    preview.conditions!.loadCombinations![0].terms[0].factor = 99;
    const edited = addNode(applied, { x: 10, y: 0, z: 0 });
    expect(stage.confirm(edited, confirmation)).toMatchObject({ project: edited, result: { status: "failed" } });
    const updated = stage.confirm(applied, confirmation).project;
    expect(updated.loadCases).toHaveLength(2); expect(updated.loadCombinations).toHaveLength(1); expect(updated.uniformLoads).toHaveLength(1);
    expect(updated.loadCases[1].name).toBe("Revised live");
    expect(updated.uniformLoads[0].id).toBe(applied.uniformLoads[0].id);
    expect(updated.uniformLoads[0].intensity.z).toBe(-6);
    expect(updated.selfWeight.enabled).toBe(false);
    expect(updated.loadCombinations[0].terms.every((t) => t.factor === 0)).toBe(true);
    const solved = solveFrame(updated);
    for (const value of Object.values(solved.nodes[1].displacement)) expect(value).toBeCloseTo(0, 12);
    for (const value of Object.values(solved.nodes[0].reaction)) expect(value).toBeCloseTo(0, 12);
    expect(solved.input.combination?.cases[1].uniformLoads[0].intensity.z).toBe(-6);
    expect(decodeProject(encodeProject(updated))).toEqual(updated);
  });

  it("infers one calculation case when its stable ID and draft alias are used together", () => {
    const base = selectLoadCase(addLoadCase(p, "Other case"), "LC2");
    const preview = executeAiTool(captureAiSnapshot(base, []), call({ supports: input.supports, nodalLoads: [],
      loadCases: [input.loadCases[0]], uniformLoads: [{ ...input.uniformLoads[0], loadCaseId: "LC1" }], selfWeight: input.selfWeight }));
    expect(preview.status).toBe("awaiting-confirmation");
    expect(preview.conditions!.analysisSourceId).toBe("LC1");
    const applied = new ConditionsStageConfirmation().confirm(base, prepareConditionsConfirmation(base, preview.conditions!)).project;
    expect(applied.activeLoadCaseId).toBe("LC1");
    expect(solveFrame(applied).input.loadCase!.id).toBe("LC1");
  });

  it("rejects draft case references that reuse an unrelated formal object identity", () => {
    const applied = new ConditionsStageConfirmation().confirm(p, prepareConditionsConfirmation(p, executeAiTool(captureAiSnapshot(p, []), call(input)).conditions!)).project;
    const refs = [applied.nodes[0].id, applied.members[0].id, applied.materials[0].id, applied.sections[0].id, applied.supports[0].id, applied.uniformLoads[0].id];
    for (const ref of refs) {
      const preview = executeAiTool(captureAiSnapshot(applied, []), call({ supports: [], nodalLoads: [],
        loadCases: [{ ref, name: "Conflicting alias", description: "", source: "user" }] }));
      expect(preview.status).toBe("missing-input");
      expect(new ConditionsStageConfirmation().confirm(applied, prepareConditionsConfirmation(applied, preview.conditions!)).result.status).toBe("failed");
    }
  });
});
