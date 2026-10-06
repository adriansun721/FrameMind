// @vitest-environment node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { releasedBeam } from "../validation/member-release-fixtures";
import { updateMember, updateNode, updateSection, addNodalLoad, attachAnalysisResult, addLoadCase, addLoadCombination, selectAnalysisSource, updateSelfWeight } from "./project";
import { captureAnalysisInput, NATIVE_STATIC_SOLVER, getMemberAnalysisRecord, isAnalysisResultCurrent, getMemberSectionForces, getMemberResponseSamples, solveFrame } from "./analysis";
import { createAnalysisRequest } from "./analysis-service";
import { decodeAnalysisResult, decodeProject, encodeProject } from "./project-file";
import { applyProjectEdits } from "./project-operations";
import { captureEngineeringReport } from "./engineering-report";
import { buildReportPdfHtml } from "../workspace/report-pdf";
import { readResult, readResults } from "../workspace/ai-results";

function nativePacket(p: ReturnType<typeof releasedBeam>) {
  const input = captureAnalysisInput(p);
  // T2-25 is a distinct numerical implementation; rigid legacy requests retain /2.
  const solver = { ...NATIVE_STATIC_SOLVER, implementation: "framemind-native/3" };
  const request = createAnalysisRequest({ ...input, solver });
  const child = spawnSync(resolve("native/bin/framemind-core.exe"), [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, timeout: 30000 });
  if (child.error) throw child.error;
  return JSON.parse(child.stdout.trim().split("\n").at(-1)!);
}

it("solves a uniformly loaded fixed-hinged beam from independent equilibrium and compatibility", () => {
  const packet = nativePacket(releasedBeam());
  expect(packet.kind, JSON.stringify(packet)).toBe("result");
  const r = decodeAnalysisResult(packet.result);
  // qL: 8 kN. Propped cantilever: 5qL/8, 3qL/8 and qL²/8.
  expect(r.nodes[0].reaction.z).toBeCloseTo(5, 9);
  expect(r.nodes[1].reaction.z).toBeCloseTo(3, 9);
  expect(r.members[0].localEndForces.start[4]).toBeCloseTo(-4, 9);
  expect(r.members[0].localEndForces.end[4]).toBeCloseTo(0, 9);
  expect(getMemberAnalysisRecord(r, r.members[0].memberId).origin).toBe("captured-from-run");
  for (const field of ["globalStiffness", "recoveryTransformation", "transformation", "originalLocalStiffness", "localStiffness"] as const) {
    const modified = structuredClone(r);
    modified.members[0].nativeReleaseRecovery![field][0][0] += 123456;
    expect(() => decodeAnalysisResult(modified), field).toThrow();
  }
});

it("recovers the actual released beam-end slopes and exact simply-supported UDL deflection", () => {
  let p = releasedBeam();
  p = updateMember(p, p.members[0].id, { endReleases: { start: { my: true, mz: true }, end: { my: true, mz: true } } });
  p = { ...p, supports: p.supports.map((s) => ({ ...s, restraints: [true, true, true, true, false, false] })) };
  const packet = nativePacket(p);
  expect(packet.kind, JSON.stringify(packet)).toBe("result");
  const r = decodeAnalysisResult(packet.result);
  expect(r.nodes[0].reaction.z).toBeCloseTo(4, 9);
  expect(r.nodes[1].reaction.z).toBeCloseTo(4, 9);
  expect(r.process!.releaseGaugeDofs).toEqual([4, 5, 10, 11]);
  const record = getMemberAnalysisRecord(r, r.members[0].memberId);
  const ei = 200e6 * .0010666666666666667;
  expect(record.localDisplacement[4]).toBeCloseTo(2 * 4 ** 3 / (24 * ei), 12);
  expect(record.localDisplacement[10]).toBeCloseTo(-2 * 4 ** 3 / (24 * ei), 12);
  // Exact EB beam solution, not cubic interpolation of endpoint displacements.
  expect(r.members[0].nativeResponses![8].localDisplacement.z).toBeCloseTo(-5 * 2 * 4 ** 4 / (384 * ei), 12);
  expect(getMemberResponseSamples(r, r.members[0].memberId, 33)[16].localDisplacement.z).toBeCloseTo(-5 * 2 * 4 ** 4 / (384 * ei), 12);
  const malformed = structuredClone(r); malformed.process!.releaseNullRotations![0].direction = { x: 1, y: 0, z: 0 };
  expect(() => decodeAnalysisResult(malformed)).toThrow();
  expect(() => readResult(r, true, { kind: "node", id: p.nodes[0].id, quantity: "rotation", component: "y" }, "undefined-rotation")).toThrow();
  expect(JSON.stringify(readResults(r, true, { collection: "nodes", fields: ["rotation.y"] }))).toContain("undetermined");
});

it("accepts cancellation roundoff for large-section double hinges while rejecting corrupted coefficients", () => {
  for (const width of [2, 4]) for (const length of [3.1, 4]) for (const rotationDegrees of [0, 37]) {
    let p = releasedBeam();
    p = updateSection(p, p.sections[0].id, { name: "large rectangle", geometry: { shape: "rectangle", width, height: .4 } });
    p = updateNode(p, p.nodes[1].id, { x: length, y: 0, z: 0 });
    p = updateMember(p, p.members[0].id, { rotationDegrees, endReleases: { start: { my: true, mz: true }, end: { my: true, mz: true } } });
    const packet = nativePacket(p); expect(packet.kind, JSON.stringify(packet)).toBe("result");
    const r = decodeAnalysisResult(packet.result);
    const ei = 200e6 * width * .4 ** 3 / 12;
    expect(r.members[0].nativeResponses![8].localDisplacement.z).toBeCloseTo(-5 * 2 * length ** 4 / (384 * ei), 12);
    expect(r.members[0].localEndForces.start[4]).toBe(0);
    expect(r.members[0].localEndForces.end[4]).toBe(0);
    for (const field of ["localStiffness", "globalStiffness"] as const) {
      const modified = structuredClone(r);
      modified.members[0].nativeReleaseRecovery![field][1][1] += .01;
      expect(() => decodeAnalysisResult(modified), field).toThrow();
    }
  }
});

it("keeps rotated local release directions independent of global support rotations", () => {
  let p = releasedBeam();
  p = updateMember(p, p.members[0].id, { rotationDegrees: 37 });
  p = { ...p, supports: p.supports.map((s, i) => ({ ...s, restraints: [true, true, true, true, i === 0, i === 0] })) };
  const packet = nativePacket(p); expect(packet.kind, JSON.stringify(packet)).toBe("result");
  const r = decodeAnalysisResult(packet.result), angle = 37 * Math.PI / 180;
  expect(r.nodes[0].reaction.z).toBeCloseTo(5 * Math.cos(angle), 9);
  expect(r.nodes[0].reaction.y).toBeCloseTo(-5 * Math.sin(angle), 9);
  expect(r.nodes[1].reaction.z).toBeCloseTo(3 * Math.cos(angle), 9);
  expect(r.members[0].localEndForces.end[4]).toBeCloseTo(0, 9);
  expect(r.process!.releaseNullRotations).toHaveLength(1);
});

it("rejects a released cantilever mechanism and an unresisted nodal moment without stiffness repair", () => {
  const beam = releasedBeam();
  const mechanism = updateMember({ ...beam, supports: beam.supports.slice(0, 1) }, beam.members[0].id, { endReleases: { start: { my: true, mz: false }, end: { my: true, mz: false } } });
  const packet = nativePacket(mechanism);
  expect(packet.kind).toBe("error");
  expect(packet.error.diagnostics[0]).toMatchObject({ code: "singular-system", target: { kind: "node", id: beam.nodes[1].id } });
  let freeEnd = { ...beam, supports: beam.supports.map((s) => ({ ...s, restraints: [true, true, true, true, false, false] as [boolean, boolean, boolean, boolean, boolean, boolean] })) };
  freeEnd = addNodalLoad(freeEnd, beam.nodes[1].id, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  expect(nativePacket(freeEnd).error.diagnostics[0]).toMatchObject({ code: "unresisted-release-moment", target: { id: beam.nodes[1].id }, field: "endReleases" });
  expect(() => solveFrame(beam)).toThrow();
});

it("preserves release dependencies, actual process records and engineering endpoint placement after split", () => {
  const p = releasedBeam(), packet = nativePacket(p); expect(packet.kind).toBe("result");
  const r = decodeAnalysisResult(packet.result), saved = decodeProject(encodeProject(attachAnalysisResult(p, r)));
  expect(isAnalysisResultCurrent(saved, saved.latestAnalysis!)).toBe(true);
  const changed = updateMember(saved, p.members[0].id, { endReleases: { start: { my: false, mz: false }, end: { my: false, mz: false } } });
  expect(isAnalysisResultCurrent(changed, r)).toBe(false);
  const split = applyProjectEdits(p, [{ type: "split_member", memberIds: [p.members[0].id], position: { x: 2, y: 0, z: 0 } }]).project;
  expect(split.members.map((m) => m.endReleases)).toEqual([
    { start: { my: false, mz: false }, end: { my: false, mz: false } },
    { start: { my: false, mz: false }, end: { my: true, mz: false } },
  ]);
  const divided = decodeAnalysisResult(nativePacket(split).result);
  expect(divided.nodes[0].reaction.z).toBeCloseTo(5, 9);
  expect(divided.nodes[1].reaction.z).toBeCloseTo(3, 9);
  const html = buildReportPdfHtml(captureEngineeringReport(saved, r.id, { memberIds: [p.members[0].id], steps: ["member-process", "constraints", "assembled-stiffness"] }));
  expect(html).toContain("framemind-native/3");
  expect(html).toContain("释放 My");
  expect(getMemberSectionForces(r, p.members[0].id, 4).forces[4]).toBeCloseTo(0, 9);
});

it("condenses self-weight and positive/negative combinations once in the same local release system", () => {
  let p = releasedBeam();
  p = updateSelfWeight(p, { ...p.selfWeight, enabled: true });
  p = addLoadCase(p, "second");
  p = addNodalLoad(p, p.nodes[0].id, { x: 0, y: 0, z: -3 }, { x: 0, y: 0, z: 0 }, "LC2");
  p = addLoadCombination(p, "combined", [{ loadCaseId: "LC1", factor: 1.5 }, { loadCaseId: "LC2", factor: -.5 }]);
  const combined = selectAnalysisSource(p, p.loadCombinations[0].id);
  const packet = nativePacket(combined); expect(packet.kind, JSON.stringify(packet)).toBe("result");
  const r = decodeAnalysisResult(packet.result);
  const q = 2 + 7850 * .08 * 9.81 / 1000;
  expect(r.nodes[0].reaction.z).toBeCloseTo(1.5 * q * 4 * 5 / 8 - 1.5, 8);
  expect(r.nodes[1].reaction.z).toBeCloseTo(1.5 * q * 4 * 3 / 8, 8);
  expect(r.members[0].localEndForces.end[4]).toBeCloseTo(0, 9);
});
