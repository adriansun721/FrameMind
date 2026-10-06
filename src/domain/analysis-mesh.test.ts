// @vitest-environment node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { releasedBeam, releasedPortal } from "../validation/member-release-fixtures";
import { DEFAULT_MESH_POLICY, createMeshPlan } from "./analysis-mesh";
import { NATIVE_MESH_STATIC_SOLVER, captureAnalysisInput, getMemberResponseSamples, getMemberSectionForces, getOverallAnalysisProcessRecord, isAnalysisResultCurrent } from "./analysis";
import { createAnalysisRequest } from "./analysis-service";
import { decodeAnalysisResult, decodeProject, encodeProject } from "./project-file";
import { attachAnalysisResult, updateMember, addAnalysisCase, selectAnalysisCase, updateAnalysisCase } from "./project";
import { applyProjectEdits } from "./project-operations";
import { captureReportAppendix } from "./report-appendix";
import { captureEngineeringReport } from "./engineering-report";
import { buildReportPdfHtml } from "../workspace/report-pdf";
import { readResults, readResult } from "../workspace/ai-results";

it.each([1, 10, 100, 1000])("inherits frozen anisotropic local axes at the reference boundary, origin %s", (origin) => {
  const base = releasedBeam();
  const project = { ...base, nodes: base.nodes.map((n, i) => ({ ...n, position: i ? { x: origin + Math.sqrt(.19) * 4, y: origin, z: origin + 3.6 } : { x: origin, y: origin, z: origin } })), members: base.members.map((m) => ({ ...m, endReleases: { start: { my: false, mz: false }, end: { my: false, mz: false } } })), uniformLoads: base.uniformLoads.map((q) => ({ ...q, intensity: { x: 0, y: -2, z: 0 } })) };
  const { result } = run(project, { ...DEFAULT_MESH_POLICY, relativeTolerance: 1e-24, forceTolerance: 1e-24, displacementTolerance: 1e-24 });
  const frame = result.input.meshPlan!.frames[project.members[0].id];
  expect(frame.referenceAxis).toBe("global-y");
  expect(result.discretization!.runs).toHaveLength(4);
  for (const { result: inner } of result.discretization!.runs) {
    for (const m of inner.members) expect(m.localAxes).toEqual({ x: frame.localX, y: frame.localY, z: frame.localZ });
    for (const axis of ["x", "y", "z"] as const) expect(inner.nodes.reduce((sum, n) => sum + n.reaction[axis], 0)).toBeCloseTo(2 * frame.length * frame.localY[axis], 8);
  }
  const deflection = getMemberResponseSamples(result, project.members[0].id, 33)[16].localDisplacement.y;
  expect(deflection).toBeCloseTo(-2 * frame.length ** 4 / (384 * 200e6 * project.sections[0].secondMomentZM4), 12);
  const altered = structuredClone(result); altered.discretization!.runs[1].result.input.calculationFrames![altered.discretization!.runs[1].result.members[0].memberId].localY.x += .1;
  expect(() => decodeAnalysisResult(altered)).toThrow();
  const publicInput = structuredClone(result); publicInput.input.calculationFrames = structuredClone(result.discretization!.runs[0].result.input.calculationFrames);
  expect(() => decodeAnalysisResult(publicInput)).toThrow("内部继承局部轴");
});

function run(project = releasedBeam(), policy = { ...DEFAULT_MESH_POLICY }) {
  const input = { ...captureAnalysisInput(project), solver: NATIVE_MESH_STATIC_SOLVER };
  const request = createAnalysisRequest({ ...input, meshPlan: createMeshPlan(input, policy) });
  const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  if (child.error) throw child.error;
  const packet = JSON.parse(child.stdout.trim().split("\n").at(-1)!);
  expect(packet.kind, JSON.stringify(packet)).toBe("result");
  return { request, result: decodeAnalysisResult(packet.result) };
}

it("freezes internal mappings while keeping engineering topology, selection identities and saved results intact", () => {
  const project = releasedBeam(), { request, result } = run(project);
  expect(Object.isFrozen(request.input.meshPlan!.levels[1].elements[0])).toBe(true);
  expect(result.discretization!.counts).toEqual({ engineeringNodes: 2, engineeringMembers: 1, calculationNodes: 3, calculationElements: 2, totalDofs: 18, constrainedDofs: 12, releaseGaugeDofs: 0, equations: 6 });
  const reopened = decodeProject(encodeProject(attachAnalysisResult(project, result)));
  expect(reopened.nodes).toEqual(project.nodes); expect(reopened.members).toEqual(project.members);
  expect(JSON.stringify(reopened.latestAnalysis!.discretization)).toBe(JSON.stringify(result.discretization));
  const process = getOverallAnalysisProcessRecord(result);
  expect(process.origin).toBe("captured-from-run"); expect(process.members).toHaveLength(2);
  expect(process.freeDofs).toHaveLength(6);
  const mesh = readResults(result, true, { collection: "mesh", offset: 0, limit: 1 });
  if (!("items" in mesh) || !("page" in mesh)) throw new Error("内部映射缺少分页结果");
  expect(mesh.items).toHaveLength(1); expect(mesh.page.hasMore).toBe(true);
  expect(mesh.items[0]).toMatchObject({ memberId: project.members[0].id, start: 0, end: 2 });
  const changed = updateMember(reopened, project.members[0].id, { endReleases: { start: { my: false, mz: false }, end: { my: false, mz: false } } });
  expect(isAnalysisResultCurrent(changed, result)).toBe(false);
});

it("maps arbitrary station forces and exact simply-supported deflection from actual internal elements", () => {
  let project = releasedBeam();
  project = updateMember(project, project.members[0].id, { endReleases: { start: { my: true, mz: true }, end: { my: true, mz: true } } });
  project = { ...project, supports: project.supports.map((s) => ({ ...s, restraints: [true, true, true, true, false, false] })) };
  const { result } = run(project), id = project.members[0].id;
  expect(result.discretization!.counts.releaseGaugeDofs).toBe(4);
  const ei = 200e6 * .0010666666666666667;
  expect(getMemberResponseSamples(result, id, 33)[16].localDisplacement.z).toBeCloseTo(-5 * 2 * 4 ** 4 / (384 * ei), 12);
  expect(getMemberSectionForces(result, id, .3).forces[4]).toBeCloseTo(-4 * .3 + .3 ** 2, 9);
  expect(() => readResult(result, true, { kind: "node", id: project.nodes[0].id, quantity: "rotation", component: "y" }, "undefined")).toThrow();
  expect(JSON.stringify(readResults(result, true, { collection: "nodes", fields: ["rotation.y"] }))).toContain("null");
  const interior = result.discretization!.runs.at(-1)!.result.input.members;
  expect(interior[0].endReleases!.end).toEqual({ my: false, mz: false });
  expect(interior[1].endReleases!.start).toEqual({ my: false, mz: false });
});

it.each(["mapping", "inherited-release", "inherited-load", "station", "end-force", "counts", "error", "false-convergence", "missing-run"])("rejects corrupted frozen or captured mesh data: %s", (fault) => {
  const { result } = run(), modified = structuredClone(result), record = modified.discretization!;
  if (fault === "mapping") modified.input.meshPlan!.levels[1].elements[0].end += .1;
  if (fault === "inherited-release") record.runs[1].result.input.members[0].endReleases!.end.my = true;
  if (fault === "inherited-load") record.runs[1].result.input.uniformLoads![0].intensity.z = -3;
  if (fault === "station") record.runs[1].result.members[0].nativeResponses![5].forces[4] += 1;
  if (fault === "end-force") modified.members[0].localEndForces.end[2] += 1;
  if (fault === "counts") record.counts.equations++;
  if (fault === "error") record.runs[1].error!.reaction = .5;
  if (fault === "false-convergence") record.reason = "equation-budget";
  if (fault === "missing-run") record.runs.pop();
  expect(() => decodeAnalysisResult(modified)).toThrow();
});

it("reports a single grid and an equation-limited grid as unchecked, and rejects invented convergence", () => {
  for (const policy of [{ ...DEFAULT_MESH_POLICY, maxDivisions: 1 }, { ...DEFAULT_MESH_POLICY, maxEquations: 1 }]) {
    const project = releasedBeam(), { result } = run(project, policy);
    expect(result.discretization!.status).toBe("budget-exhausted");
    expect(result.discretization!.runs).toHaveLength(1);
    const fake = structuredClone(result); fake.discretization!.status = "converged"; fake.discretization!.reason = "tolerance";
    expect(() => decodeAnalysisResult(fake)).toThrow();
    expect(readResults(result, true, { collection: "summary" }).discretization!.status).toBe("budget-exhausted");
    const saved = attachAnalysisResult(project, result);
    expect(buildReportPdfHtml(captureEngineeringReport(saved, result.id))).toContain("未收敛");
  }
});

it("exports selected engineering members with the actual internal assembly and shared scale record", () => {
  const project = releasedPortal(), { result } = run(project), memberId = project.members[0].id;
  const appendix = captureReportAppendix(result, { memberIds: [memberId], steps: ["member-process", "assembly", "dof-mapping", "constraints"] })!;
  expect(appendix.missing).toEqual([]); expect(appendix.overall!.members).toHaveLength(6);
  const report = captureEngineeringReport(attachAnalysisResult(project, result), result.id, appendix.selection);
  const html = buildReportPdfHtml(report);
  expect(html).toContain("内部细分"); expect(html).toContain("__mesh_2_e_0_0");
  expect(html).not.toContain("__mesh_2_e_1_0 对号");
});

it("persists validated precision settings and invalidates only the affected analysis case", () => {
  let project = addAnalysisCase(releasedBeam(), { name: "mesh", method: "static", loadSourceId: "LC1", settings: { solver: "native-static", mesh: { ...DEFAULT_MESH_POLICY } } });
  project = selectAnalysisCase(project, project.analysisCases.at(-1)!.id);
  const { result } = run(project);
  const saved = decodeProject(encodeProject(attachAnalysisResult(project, result))), item = saved.analysisCases.at(-1)!;
  expect(item.settings.mesh).toEqual(DEFAULT_MESH_POLICY);
  const changed = updateAnalysisCase(saved, item.id, { ...item, settings: { solver: "native-static", mesh: { ...DEFAULT_MESH_POLICY, maxDivisions: 4 } } });
  expect(isAnalysisResultCurrent(changed, result)).toBe(false);
  expect(() => applyProjectEdits(saved, [{ type: "update_analysis_case", id: item.id, properties: { ...item, settings: { solver: "native-static", mesh: { ...DEFAULT_MESH_POLICY, maxEquations: 0 } } } }])).toThrow();
});

it.each(["members", "uniformLoads"])("refuses internal calculation identities in every engineering %s row", (collection) => {
  const raw = JSON.parse(encodeProject(releasedPortal()));
  if (collection === "uniformLoads") { raw.uniformLoads.push({ ...raw.uniformLoads[0] }); raw.nextUniformLoadNumber = 3; }
  raw[collection][1].id = "__mesh_2_e_0_1"; raw[collection][1].label = "__mesh_2_e_0_1";
  expect(() => decodeProject(JSON.stringify(raw))).toThrow("稳定标识格式无效");
});
