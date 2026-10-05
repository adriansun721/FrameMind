import { describe, expect, it } from "vitest";
import { addMaterial, addMember, addNodalLoad, addNode, addSection, addSupport, createProject } from "../domain/project";
import { applyDiagnosticOperations, compareDiagnosticTrials, createDiagnosticCopy, readDiagnosticCopy, runDiagnosticTrial } from "./diagnostic-trial";

function cantilever() {
  let project = createProject("诊断试算");
  project = addNode(project, { x: 0, y: 0, z: 0 });
  project = addNode(project, { x: 4, y: 0, z: 0 });
  project = addMaterial(project, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  project = addSection(project, { name: "Box", areaM2: 0.01, secondMomentYM4: 0.0002, secondMomentZM4: 0.0001, torsionalConstantM4: 0.00015 });
  project = addMember(project, { startNodeId: project.nodes[0].id, endNodeId: project.nodes[1].id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
  return project;
}

describe("diagnostic copy and trial seam", () => {
  it("keeps an independently identified copy and reports missing constraints without changing the formal model", () => {
    const project = cantilever();
    const copy = createDiagnosticCopy(project);
    const prepared = applyDiagnosticOperations(copy, [{ type: "set_support", nodeId: project.nodes[0].id, restraints: [true, true, true, true, true, true] }]);

    expect(prepared.id).not.toBe(project.id);
    expect(prepared.source).toMatchObject({ projectId: project.id, projectRevision: project.revision, kind: "formal-model" });
    expect(project.supports).toHaveLength(0);
    expect(prepared.model.supports).toHaveLength(1);
    expect(readDiagnosticCopy(prepared, { collection: "supports" }).items).toHaveLength(1);

    const failed = runDiagnosticTrial(copy, { label: "原始模型检查", operations: [] });
    expect(failed.trial.status).toBe("failed");
    expect(failed.trial.evidence.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "missing-restraints" })]));
    expect(failed.trial.summary.proven).toEqual(expect.arrayContaining([expect.stringContaining("受约束") ]));
    expect(failed.copy.model.supports).toHaveLength(0);
    expect(project.supports).toHaveLength(0);
    expect(failed.trial.evidence.stages).toContain("model-check");
    const malformed = runDiagnosticTrial(copy, { label: "无效候选", operations: [{ type: "set_support" } as never] });
    expect(malformed.trial.evidence.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid-diagnostic-operation" })]));
  });

  it("separates numerical success from engineering validity and compares isolated candidates", () => {
    let project = cantilever();
    project = addSupport(project, project.nodes[0].id, [true, true, true, true, true, true]);
    project = addNodalLoad(project, project.nodes[1].id, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    const copy = createDiagnosticCopy(project);
    const first = runDiagnosticTrial(copy, { label: "基准试算", operations: [] });
    const second = runDiagnosticTrial(first.copy, { label: "候选荷载试算", operations: [{ type: "set_nodal_load", id: project.nodalLoads[0].id, nodeId: project.nodes[1].id, loadCaseId: "LC1", force: { x: 20, y: 0, z: 0 }, moment: { x: 0, y: 0, z: 0 } }] });

    expect(first.trial.status).toBe("complete");
    expect(first.trial.engineeringValidity).toBe("numerically-solved-not-engineering-validated");
    expect(first.trial.evidence.stages).toEqual(["model-check", "assembly", "solve", "recovery"]);
    expect(first.trial.result?.projectId).toBe(first.copy.id);
    expect(first.trial.result?.service?.origin).toEqual({ kind: "diagnostic-copy", copyId: first.copy.id,
      sourceProjectId: project.id, sourceProjectRevision: project.revision, sourceAnalysisId: undefined });
    expect(first.copy.model.nodalLoads[0].force.x).toBe(10);
    expect(second.copy.model.nodalLoads[0].force.x).toBe(20);
    expect(project.nodalLoads[0].force.x).toBe(10);
    const comparison = compareDiagnosticTrials(first.copy, first.trial.id, second.copy, second.trial.id);
    expect(comparison.compatible).toBe(true);
    expect(comparison.analysis?.nodes[1].displacementDelta.x).not.toBe(0);
    expect(comparison.summary).toContain("候选");
  });
});
