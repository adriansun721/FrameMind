import { describe, expect, it } from "vitest";
import { captureAnalysisInput, createSupplementalAnalysisInput, getOverallAnalysisProcessRecord, isAnalysisResultCurrent } from "./analysis";
import { createAnalysisRequest, executeAnalysisRequest } from "./analysis-service";
import { ANALYSIS_SERVICE_VERSION } from "./analysis-service-contract";
import { reportFixture } from "./engineering-report.fixture";
import { captureEngineeringReport } from "./engineering-report";
import { attachAnalysisResult, updateNode } from "./project";
import { decodeAnalysisResult, decodeProject, encodeProject } from "./project-file";
import { analysisProvenance } from "../workspace/ai-results";
import { createReportContent } from "../workspace/report-content";
import { runInvalidBenchmarks, runNumericalBenchmark } from "../validation/numerical-benchmarks";
import references from "../validation/t31-references.json";

describe("unified static analysis service", () => {
  it("keeps frozen input, result queries, project reload and report provenance on the same run", () => {
    const project = reportFixture();
    const mutable = structuredClone(captureAnalysisInput(project));
    const request = createAnalysisRequest(mutable);
    mutable.nodes[1].position.x = 99;
    expect(Object.isFrozen(request.input.nodes[1].position)).toBe(true);
    const result = executeAnalysisRequest(request);
    expect(result.nodes[1].displacement.x).toBeCloseTo(0.00002, 12);
    expect(result.service).toMatchObject({ version: ANALYSIS_SERVICE_VERSION, analysisId: result.id,
      projectId: project.id, projectRevision: project.revision, sourceId: "LC1", origin: { kind: "formal-model" },
      dependencies: [{ loadCaseId: "LC1", factor: 1 }], status: "complete" });
    expect(result.service!.stages.map((record) => record.stage)).toEqual(["model-check", "assembly", "solve", "recovery"]);
    const reopened = decodeProject(encodeProject(attachAnalysisResult(project, result)));
    expect(reopened.latestAnalysis!.service).toEqual(result.service);
    expect(analysisProvenance(reopened.latestAnalysis!, true).service).toEqual(result.service);
    const report = captureEngineeringReport(reopened, result.id);
    const blocks = JSON.stringify(createReportContent(report));
    expect(blocks).toContain(result.service!.requestId);
    expect(blocks).toContain("模型检查");
    expect(getOverallAnalysisProcessRecord(report.result).origin).toBe("captured-from-run");
    const edited = updateNode(reopened, reopened.nodes[1].id, { x: 5, y: 0, z: 0 });
    expect(isAnalysisResultCurrent(edited, result)).toBe(false);
    expect(edited.analysisResults.find((item) => item.id === result.id)!.input.nodes[1].position.x).toBe(4);
  });

  it("preserves signed combination dependencies and separates supplemental identity", () => {
    const project = reportFixture(true);
    const result = executeAnalysisRequest(createAnalysisRequest(captureAnalysisInput(project)));
    expect(result.service!.dependencies).toEqual([{ loadCaseId: "LC1", factor: 1.5 }, { loadCaseId: "LC2", factor: -0.5 }]);
    expect(result.service!.sourceId).toBe("CB1");
    expect(decodeAnalysisResult(structuredClone(result)).service).toEqual(result.service);
    const supplemental = executeAnalysisRequest(createAnalysisRequest(createSupplementalAnalysisInput(result), { kind: "supplemental", sourceAnalysisId: result.id }));
    expect(supplemental.id).not.toBe(result.id);
    expect(supplemental.service!.origin).toEqual({ kind: "supplemental", sourceAnalysisId: result.id });
  });

  it("rejects unsupported units, DOF order and numerical settings rather than relabeling a solve", () => {
    for (const change of [
      (input: ReturnType<typeof captureAnalysisInput>) => { input.solver!.relativePivotTolerance = 1e-6; },
      (input: ReturnType<typeof captureAnalysisInput>) => { input.dofOrder = ["uy", "ux", "uz", "rx", "ry", "rz"]; },
      (input: ReturnType<typeof captureAnalysisInput>) => { Reflect.set(input.assumptions, "units", "mm-N-N·mm"); },
    ]) {
      const input = structuredClone(captureAnalysisInput(reportFixture()));
      change(input);
      expect(() => executeAnalysisRequest(createAnalysisRequest(input))).toThrow(expect.objectContaining({
        stage: "model-check", diagnostics: [expect.objectContaining({ code: "unsupported-analysis-contract" })],
        run: expect.objectContaining({ status: "failed", stages: [] }),
      }));
    }
  });

  it("rejects corrupted saved service provenance while accepting legacy results without it", () => {
    const legacy = reportFixture().latestAnalysis!;
    expect(decodeAnalysisResult(legacy).service).toBeUndefined();
    const result = executeAnalysisRequest(createAnalysisRequest(legacy.input));
    for (const change of [
      (copy: typeof result) => { copy.service!.analysisId = "foreign"; },
      (copy: typeof result) => { copy.service!.dependencies[0].factor = 2; },
      (copy: typeof result) => { copy.service!.stages.pop(); },
    ]) {
      const copy = structuredClone(result); change(copy);
      expect(() => decodeAnalysisResult(copy)).toThrow("分析服务记录");
    }
  });

  it("returns a structured model-check rejection when a malformed request has no readable input", () => {
    const request = createAnalysisRequest(captureAnalysisInput(reportFixture()));
    for (const invalid of [null, { ...request, input: null }, { ...request, input: {} }]) {
      expect(() => executeAnalysisRequest(invalid as unknown as typeof request)).toThrow(expect.objectContaining({
        name: "AnalysisFailure", stage: "model-check", diagnostics: [expect.objectContaining({ code: "unsupported-analysis-contract", field: "input" })],
        run: undefined,
      }));
    }
  });

  it.each(references.cases)("matches the registered independent static sample through the service: $id", (benchmark) => {
    const report = runNumericalBenchmark(benchmark, (project) => executeAnalysisRequest(createAnalysisRequest(captureAnalysisInput(project))));
    expect(report.checks.filter((check) => !check.passed)).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("preserves all registered invalid-input and instability diagnostics through the service", () => {
    const reports = runInvalidBenchmarks((project) => executeAnalysisRequest(createAnalysisRequest(captureAnalysisInput(project))));
    expect(reports).toHaveLength(7);
    expect(reports.filter((report) => !report.passed)).toEqual([]);
  });
});
