import { describe, expect, it } from "vitest";
import { addAnalysisCase, addLoadCase, addLoadCombination, addMaterial, addMember, addNodalLoad, addNode, addSection, addSupport, attachAnalysisResult, createProject, deleteAnalysisCase, deleteLoadCase, deleteLoadCombination, selectAnalysisCase, selectLoadCombination, updateAnalysisCase, updateMaterial, updateNodalLoad, updateNode, updateSelfWeight, type FrameProject } from "./project";
import { captureAnalysisInput, getActiveAnalysisResult, isAnalysisResultCurrent, solveFrame } from "./analysis";
import { decodeProject, encodeProject } from "./project-file";
import { createAnalysisRequest, executeAnalysisRequest } from "./analysis-service";
import { compareAnalysisResults } from "./analysis-comparison";
import { captureAiSnapshot, executeAiTool } from "../workspace/ai-tools";
import { ModelEditConfirmation, prepareModelEditConfirmation } from "../workspace/model-edits";
import { reportSourceLabel } from "./engineering-report";
import { proposeTask } from "../workspace/task-draft";
import { prepareTaskDraftConfirmation, TaskDraftStageConfirmation } from "../workspace/task-confirmation";

const properties = (name: string, loadSourceId = "LC1") => ({ name, loadSourceId, method: "static" as const, settings: { solver: "native-static" as const } });
function cantilever(): FrameProject {
  let p = addNode(addNode(createProject("T2-16"), { x: 0, y: 0, z: 0 }), { x: 4, y: 0, z: 0 });
  p = addMaterial(p, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  p = addSection(p, { name: "Reference", areaM2: 0.01, secondMomentYM4: 0.0002, secondMomentZM4: 0.0001, torsionalConstantM4: 0.00015 });
  p = addMember(p, { startNodeId: p.nodes[0].id, endNodeId: p.nodes[1].id, materialId: p.materials[0].id, sectionId: p.sections[0].id, rotationDegrees: 0 });
  p = addSupport(p, p.nodes[0].id, [true, true, true, true, true, true]);
  return addNodalLoad(p, p.nodes[1].id, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
}
function run(p: FrameProject, id: string): FrameProject {
  p = selectAnalysisCase(p, id);
  return attachAnalysisResult(p, executeAnalysisRequest(createAnalysisRequest(captureAnalysisInput(p))));
}

describe("T2-16 reusable definitions and analysis cases", () => {
  it("runs two independently identified analyses using the same load and freezes their sources through reopening", () => {
    let p = addAnalysisCase(addAnalysisCase(cantilever(), properties("A")), properties("B"));
    p = run(run(p, "AC1"), "AC2");
    const reopened = decodeProject(encodeProject(p));
    expect(reopened.nodalLoads).toHaveLength(1);
    expect(reopened.analysisResults.map((r) => r.service?.sourceId)).toEqual(["AC1", "AC2"]);
    expect(getActiveAnalysisResult(reopened)?.input.analysisCase?.name).toBe("B");
    for (const r of reopened.analysisResults) {
      // Independent axial solution: FL/EA = 10*4/(200e6*0.01) m.
      expect(r.nodes[1].displacement.x).toBeCloseTo(0.00002, 12);
      expect(r.nodes[0].reaction.x).toBeCloseTo(-10, 10);
      expect(isAnalysisResultCurrent(reopened, r)).toBe(true);
      expect(Object.isFrozen(r.input.analysisCase)).toBe(true);
      expect(reportSourceLabel(r)).toContain(r.input.analysisCase!.id);
    }
    const renamed = updateAnalysisCase(reopened, "AC1", properties("Renamed"));
    expect(renamed.analysisResults.every((r) => isAnalysisResultCurrent(renamed, r))).toBe(true);
    expect(reopened.analysisResults[0].input.analysisCase?.name).toBe("A");
  });

  it("invalidates every dependent case and combination, but ignores unrelated definitions and unused resources", () => {
    let p = addLoadCase(cantilever(), "Unused");
    p = addLoadCombination(p, "Shared", [{ loadCaseId: "LC1", factor: 2 }, { loadCaseId: "LC2", factor: 0 }]);
    p = addAnalysisCase(addAnalysisCase(addAnalysisCase(p, properties("A")), properties("B")), properties("Combination", "CB1"));
    p = run(run(run(p, "AC1"), "AC2"), "AC3");
    const history = p.analysisResults;
    let unrelated = addMaterial(p, { ...p.materials[0], name: "Not assigned" });
    unrelated = addSection(unrelated, { ...p.sections[0], name: "Not assigned" });
    unrelated = addNodalLoad(unrelated, p.nodes[1].id, { x: 50, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, "LC2");
    unrelated = updateMaterial(unrelated, unrelated.materials[0].id, { ...unrelated.materials[0], densityKgM3: 8000 });
    expect(history.every((r) => isAnalysisResultCurrent(unrelated, r))).toBe(true);
    const changed = updateNodalLoad(unrelated, p.nodalLoads[0].id, p.nodes[1].id, { x: 20, y: 0, z: 0 }, p.nodalLoads[0].moment);
    expect(history.every((r) => !isAnalysisResultCurrent(changed, r))).toBe(true);
    expect(history[0].input.nodalLoads[0].force.x).toBe(10);
    expect(history.every((r) => !isAnalysisResultCurrent(updateNode(p, p.nodes[1].id, { x: 5, y: 0, z: 0 }), r))).toBe(true);
    expect(history.every((r) => !isAnalysisResultCurrent(updateMaterial(p, p.materials[0].id, { ...p.materials[0], elasticModulusGPa: 210 }), r))).toBe(true);
    const changedSource = updateAnalysisCase(p, "AC1", properties("A", "LC2"));
    expect(isAnalysisResultCurrent(changedSource, history[0])).toBe(false);
    expect(isAnalysisResultCurrent(changedSource, history[1])).toBe(true);
    const wrongSettings = { ...history[0], input: { ...history[0].input, solver: { ...history[0].input.solver!, relativePivotTolerance: 1e-8 } } };
    expect(isAnalysisResultCurrent(p, wrongSettings)).toBe(false);
  });

  it("tracks density only for analyses using self-weight", () => {
    let p = addLoadCase(cantilever(), "Gravity");
    p = updateSelfWeight(p, { enabled: true, loadCaseId: "LC2", gravity: { x: 0, y: 0, z: -9.81 } });
    p = addAnalysisCase(addAnalysisCase(p, properties("Force")), properties("Gravity", "LC2"));
    p = run(run(p, "AC1"), "AC2");
    const changed = updateMaterial(p, p.materials[0].id, { ...p.materials[0], densityKgM3: 8000 });
    expect(isAnalysisResultCurrent(changed, p.analysisResults[0])).toBe(true);
    expect(isAnalysisResultCurrent(changed, p.analysisResults[1])).toBe(false);
  });

  it("migrates old cases and combinations without rewriting historic inputs or reusing identities", () => {
    let p = addLoadCombination(addLoadCase(cantilever(), "Wind"), "User", [{ loadCaseId: "LC1", factor: 1 }]);
    p = attachAnalysisResult(p, solveFrame(selectLoadCombination(p, "CB1")));
    const legacy = JSON.parse(encodeProject(p));
    delete legacy.analysisCases; delete legacy.nextAnalysisCaseNumber;
    const reopened = decodeProject(JSON.stringify(legacy));
    expect(reopened.analysisCases.map((c) => [c.id, c.loadSourceId])).toEqual([["AC1", "LC1"], ["AC2", "LC2"], ["AC3", "CB1"]]);
    expect(getActiveAnalysisResult(selectAnalysisCase(reopened, "AC3"))?.id).toBe(p.latestAnalysis!.id);
    expect(encodeProject(decodeProject(encodeProject(reopened)))).toBe(encodeProject(reopened));
    expect(reopened.analysisResults[0].input).toEqual(p.analysisResults[0].input);
    const renamed = updateAnalysisCase(reopened, "AC3", properties("Renamed", "CB1"));
    expect(getActiveAnalysisResult(selectAnalysisCase(renamed, "AC3"))?.id).toBe(p.latestAnalysis!.id);
    const next = run(renamed, "AC3");
    expect(compareAnalysisResults(p.analysisResults[0], next.analysisResults[1]).compatible).toBe(true);
    const laterLegacy = attachAnalysisResult(next, solveFrame(selectLoadCombination(next, "CB1")));
    expect(getActiveAnalysisResult(selectAnalysisCase(laterLegacy, "AC3"))?.id).toBe(next.analysisResults[1].id);
    expect(addAnalysisCase(deleteAnalysisCase(reopened, "AC2"), properties("Next")).analysisCases.at(-1)?.id).toBe("AC4");
  });

  it("retains frozen history after deleting analysis cases, load definitions and combinations", () => {
    let p = addLoadCase(cantilever(), "Keep");
    p = addLoadCombination(p, "User", [{ loadCaseId: "LC1", factor: 1 }]);
    p = addAnalysisCase(addAnalysisCase(p, properties("A")), properties("Combo", "CB1"));
    p = run(run(p, "AC1"), "AC2");
    const removed = deleteLoadCase(p, "LC1", true);
    expect(removed.analysisResults.map((r) => r.id)).toEqual(p.analysisResults.map((r) => r.id));
    const reopened = decodeProject(encodeProject(removed));
    expect(reopened.analysisResults.every((r) => !isAnalysisResultCurrent(reopened, r))).toBe(true);
    expect(reopened.analysisResults[0].input.nodalLoads[0].force.x).toBe(10);
    expect(deleteLoadCombination(p, "CB1").analysisResults).toHaveLength(2);
    expect(deleteAnalysisCase(p, "AC1").analysisResults).toHaveLength(2);
    expect(compareAnalysisResults(p.analysisResults[0], p.analysisResults[0]).compatible).toBe(true);
  });

  it("exposes analysis definitions to tools and applies reviewed edits once using the manual validation", () => {
    const p = cantilever();
    const snapshot = captureAiSnapshot(p, []);
    const call = { id: "case", type: "function", function: { name: "propose_model_edits", arguments: JSON.stringify({ operations: [{ type: "create_analysis_case", properties: properties("AI case") }] }) } };
    const draft = executeAiTool(snapshot, call).modelEdits!;
    expect(draft).toBeDefined(); expect(p.analysisCases).toHaveLength(0);
    const confirmation = prepareModelEditConfirmation(p, draft), stage = new ModelEditConfirmation();
    const applied = stage.confirm(p, confirmation);
    expect(applied.result.status).toBe("applied");
    expect(applied.project.analysisCases).toEqual(addAnalysisCase(p, properties("AI case")).analysisCases);
    expect(stage.confirm(applied.project, confirmation).project.analysisCases).toHaveLength(1);
    const read = executeAiTool(captureAiSnapshot(applied.project, []), { id: "read", type: "function", function: { name: "read_model", arguments: '{"collection":"analysis-cases"}' } });
    expect(read.status).toBe("completed");
    expect((read.data as { items: unknown[] }).items).toHaveLength(1);
    const expanded = captureAiSnapshot(addAnalysisCase(applied.project, properties("Second")), []);
    const summary = executeAiTool(expanded, { id: "summary", type: "function", function: { name: "read_model", arguments: '{"collection":"summary"}' } });
    expect(summary.data).toMatchObject({ counts: { analysisCases: 2 } });
    expect(summary.data).not.toHaveProperty("analysisCases");
    const page = executeAiTool(expanded, { id: "page", type: "function", function: { name: "read_model", arguments: '{"collection":"analysis-cases","limit":1,"fields":["id"]}' } });
    expect(page.data).toMatchObject({ total: 2, items: [{ id: "AC1" }], page: { hasMore: true, nextOffset: 1 } });
  });

  it.each(["LC2", "CB1"])("synchronizes an active analysis source after an agent update to %s and reopens it", (loadSourceId) => {
    let p = addLoadCombination(addLoadCase(cantilever(), "Alternate"), "Combined", [{ loadCaseId: "LC1", factor: 2 }]);
    p = selectAnalysisCase(addAnalysisCase(p, properties("Active")), "AC1");
    const call = { id: "update-case", type: "function", function: { name: "propose_model_edits", arguments: JSON.stringify({ operations: [{ type: "update_analysis_case", id: "AC1", properties: properties("Updated", loadSourceId) }] }) } };
    const draft = executeAiTool(captureAiSnapshot(p, []), call).modelEdits!;
    const applied = new ModelEditConfirmation().confirm(p, prepareModelEditConfirmation(p, draft));
    expect(applied.result.status).toBe("applied");
    expect(applied.project.activeAnalysisCaseId).toBe("AC1");
    expect(applied.project.activeLoadCaseId).toBe(loadSourceId === "LC2" ? "LC2" : "LC1");
    expect(applied.project.activeLoadCombinationId).toBe(loadSourceId === "CB1" ? "CB1" : undefined);
    const reopened = decodeProject(encodeProject(applied.project));
    const input = captureAnalysisInput(reopened);
    expect(input.analysisCase?.loadSourceId).toBe(loadSourceId);
    expect(input.combination?.definition.id ?? input.loadCase?.id).toBe(loadSourceId);
  });

  it("confirms a complete agent task bound to an analysis case and keeps that source after reopening", () => {
    const p = addAnalysisCase(cantilever(), properties("Bound source"));
    const draft = proposeTask(captureAiSnapshot(p, []), { conditions: { supports: [], nodalLoads: [], analysisSourceId: "AC1" }, analysis: { requested: true, sourceId: "AC1", source: "user" } });
    const applied = new TaskDraftStageConfirmation().confirm(p, prepareTaskDraftConfirmation(p, draft));
    expect(applied.result.status).toBe("applied");
    expect(applied.project.activeAnalysisCaseId).toBe("AC1");
    const reopened = decodeProject(encodeProject(applied.project));
    expect(captureAnalysisInput(reopened).analysisCase?.id).toBe("AC1");
    expect((applied.result.data as { analysis: { sourceId: string } }).analysis.sourceId).toBe("AC1");
  });

  it("rejects unsupported methods, settings, source mismatches and numeric comparisons at public boundaries", () => {
    const p = addAnalysisCase(cantilever(), properties("A"));
    for (const method of ["modal", "second-order", "buckling", "random"] as const) {
      expect(() => addAnalysisCase(p, { ...properties("Unsupported"), method })).toThrow(method === "modal" ? /结构质量/ : method === "buckling" ? /固定／参考/ : method === "second-order" ? /二阶/ : /尚未接入/);
      const result = solveFrame(selectAnalysisCase(p, "AC1"));
      const unsupported = { ...result, input: { ...result.input, analysisCase: { ...result.input.analysisCase!, method } } };
      expect(compareAnalysisResults(result, unsupported).compatible).toBe(false);
      expect(() => decodeProject(encodeProject(attachAnalysisResult(p, unsupported)))).toThrow();
    }
    const saved = JSON.parse(encodeProject(run(p, "AC1")));
    saved.analysisCases[0].settings.tolerance = 1e-6;
    expect(() => decodeProject(JSON.stringify(saved))).toThrow(/设置/);
    const orphan = JSON.parse(encodeProject(p)); orphan.analysisCases[0].loadSourceId = "LC99";
    expect(() => decodeProject(JSON.stringify(orphan))).toThrow(/工况/);
  });
});
