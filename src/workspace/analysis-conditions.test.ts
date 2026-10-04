import { describe, expect, it } from "vitest";
import { addLoadCase, addMaterial, addMember, addNode, addSection, createProject, type FrameProject } from "../domain/project";
import { decodeProject, encodeProject } from "../domain/project-file";
import { ProjectHistory } from "../domain/project-history";
import { solveFrame } from "../domain/analysis";
import { captureAiSnapshot, executeAiTool } from "./ai-tools";
import { ConditionsStageConfirmation, conditionsIssues, prepareConditionsConfirmation, proposeConditions } from "./analysis-conditions";

function cantilever(): FrameProject {
  let p = addNode(createProject(), { x: 0, y: 0, z: 0 });
  p = addNode(p, { x: 4, y: 0, z: 0 });
  p = addMaterial(p, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  p = addSection(p, { name: "Box", areaM2: 0.01, secondMomentYM4: 0.0002, secondMomentZM4: 0.0001, torsionalConstantM4: 0.00015 });
  return addMember(p, { startNodeId: p.nodes[0].id, endNodeId: p.nodes[1].id, materialId: p.materials[0].id, sectionId: p.sections[0].id, rotationDegrees: 0 });
}
const p = cantilever();
const inputs = {
  supports: [{ nodeId: p.nodes[0].id, restraints: [true, true, true, true, true, true], source: "suggestion" }],
  nodalLoads: [{ nodeId: p.nodes[1].id, loadCaseId: "LC1", force: { x: 8, y: 5, z: -3 }, moment: { x: 2, y: 1.5, z: -1.25 }, source: "user" }],
};
const call = (args: unknown) => ({ id: "conditions", type: "function", function: { name: "propose_analysis_conditions", arguments: JSON.stringify(args) } });

describe("AI conditions through public tools, confirmation, history and local solver", () => {
  it("previews stable identities and units without admitting unconfirmed data to analysis, then solves confirmed forces and moments", () => {
    const before = encodeProject(p);
    const result = executeAiTool(captureAiSnapshot(p, []), call(inputs));
    expect(result).toMatchObject({ status: "awaiting-confirmation", data: { units: { length: "m", force: "kN", moment: "kN·m" } } });
    expect(encodeProject(p)).toBe(before);
    expect(() => solveFrame(p)).toThrow(/约束/);
    const applied = new ConditionsStageConfirmation().confirm(p, prepareConditionsConfirmation(p, result.conditions!));
    expect(applied.result.status).toBe("applied");
    expect(applied.project.revision).toBe(p.revision + 1);
    expect(decodeProject(encodeProject(applied.project))).toEqual(applied.project);
    const solved = solveFrame(applied.project);
    // Independent closed-form 4m Euler-Bernoulli cantilever, E=200 GPa, Iy=0.0002, Iz=0.0001.
    expect(solved.nodes[1].displacement.x).toBeCloseTo(0.000016, 10);
    expect(solved.nodes[1].displacement.y).toBeCloseTo(0.004833333333333333, 10);
    expect(solved.nodes[1].displacement.z).toBeCloseTo(-0.0019, 10);
    expect(solved.nodes[0].reaction).toEqual({ x: -8, y: -5, z: 3 });
    expect(solved.nodes[0].reactionMoment.y).toBeCloseTo(-13.5, 10);
    expect(solved.nodes[0].reactionMoment.z).toBeCloseTo(-18.75, 10);
    const history = new ProjectHistory(); history.record(p, applied.project);
    const restored = history.undo(applied.project)!;
    expect(restored).toMatchObject(p);
    expect(history.redo(restored)).toEqual(applied.project);
  });

  it("preserves missing fields separately from explicitly empty conditions and rejects stale references and malformed requests", () => {
    const draft = executeAiTool(captureAiSnapshot(p, []), call({ supports: inputs.supports }));
    expect(draft.status).toBe("missing-input");
    expect(conditionsIssues(p, draft.conditions!)).toEqual([expect.stringContaining("尚缺节点力/力矩")]);
    expect(new ConditionsStageConfirmation().confirm(p, prepareConditionsConfirmation(p, draft.conditions!)).result.status).toBe("failed");
    const complete = proposeConditions({ nodalLoads: [] }, draft.conditions!);
    expect(conditionsIssues(p, complete)).toEqual([]);
    for (const args of [
      { ...inputs, script: "anything" }, { supports: [{ ...inputs.supports[0], restraints: [true] }] },
      { nodalLoads: [{ ...inputs.nodalLoads[0], force: { x: "8", y: 0, z: 0 } }] },
      { supports: [{ ...inputs.supports[0], source: "assumed" }] },
    ]) expect(executeAiTool(captureAiSnapshot(p, []), call(args)).status).toBe("failed");
    expect(executeAiTool(captureAiSnapshot(p, []), call({ ...inputs, supports: [{ ...inputs.supports[0], nodeId: "N1" }] })).status).toBe("missing-input");
    expect(executeAiTool(captureAiSnapshot(p, []), call({ ...inputs, nodalLoads: [{ ...inputs.nodalLoads[0], loadCaseId: "LC999" }] })).status).toBe("missing-input");
  });

  it("binds frozen content to the exact project and applies the entire stage once even after undo", () => {
    const proposal = proposeConditions(inputs);
    const confirmation = prepareConditionsConfirmation(p, proposal);
    proposal.supports![0].restraints[0] = false;
    proposal.nodalLoads![0].force.x = 999;
    const stage = new ConditionsStageConfirmation();
    const edited = addNode(p, { x: 7, y: 0, z: 0 });
    expect(stage.confirm(edited, confirmation)).toMatchObject({ project: edited, result: { status: "failed" } });
    expect(stage.confirm(createProject(), confirmation).result.status).toBe("failed");
    const applied = stage.confirm(p, confirmation).project;
    expect(applied.supports[0].restraints[0]).toBe(true);
    expect(applied.nodalLoads[0].force.x).toBe(8);
    expect(stage.confirm(applied, confirmation).project).toBe(applied);
    expect(stage.confirm(p, confirmation).project).toBe(p);
  });

  it("rolls back all support and load commands on late failure without consuming identities", () => {
    const base = { ...p, nextLoadNumber: Number.MAX_SAFE_INTEGER };
    const before = encodeProject(base);
    const confirmation = prepareConditionsConfirmation(base, proposeConditions(inputs));
    const stage = new ConditionsStageConfirmation();
    expect(stage.confirm(base, confirmation)).toMatchObject({ project: base, result: { status: "failed" } });
    expect(stage.confirm(base, confirmation).result.status).toBe("failed");
    expect(encodeProject(base)).toBe(before);
    expect(base.supports).toHaveLength(0);
  });

  it("previews a subsequent update and retains the confirmed inputs until that stage is confirmed", () => {
    const stage = new ConditionsStageConfirmation();
    const applied = stage.confirm(p, prepareConditionsConfirmation(p, proposeConditions(inputs))).project;
    const proposal = proposeConditions({ supports: [{ ...inputs.supports[0], id: applied.supports[0].id }],
      nodalLoads: [{ ...inputs.nodalLoads[0], id: applied.nodalLoads[0].id, force: { x: 16, y: 0, z: 0 } }] });
    expect(applied.nodalLoads[0].force.x).toBe(8);
    expect(conditionsIssues(applied, proposeConditions(inputs))).toContainEqual(expect.stringContaining("节点已有"));
    const updated = stage.confirm(applied, prepareConditionsConfirmation(applied, proposal)).project;
    expect(updated.supports).toHaveLength(1); expect(updated.nodalLoads).toHaveLength(1);
    expect(updated.nodalLoads[0].force.x).toBe(16);
    expect(updated.nodalLoads[0].id).toBe(applied.nodalLoads[0].id);
  });

  it("binds continuation to the reviewed nonactive load case and restores that source with the whole stage", () => {
    const base = addLoadCase(p, "Other case", "");
    expect(base.activeLoadCaseId).toBe("LC1");
    const result = executeAiTool(captureAiSnapshot(base, []), call({ ...inputs, nodalLoads: [{ ...inputs.nodalLoads[0], loadCaseId: "LC2" }] }));
    expect(result.conditions?.analysisSourceId).toBe("LC2");
    expect(base.activeLoadCaseId).toBe("LC1");
    const applied = new ConditionsStageConfirmation().confirm(base, prepareConditionsConfirmation(base, result.conditions!)).project;
    expect(applied.activeLoadCaseId).toBe("LC2");
    expect(applied.revision).toBe(base.revision + 1);
    const solved = solveFrame(applied);
    expect(solved.input.loadCase?.id).toBe("LC2");
    expect(solved.nodes[1].displacement.x).toBeCloseTo(0.000016, 10);
    const history = new ProjectHistory(); history.record(base, applied);
    const restored = history.undo(applied)!;
    expect(restored).toMatchObject(base); expect(history.redo(restored)).toEqual(applied);
  });
});
