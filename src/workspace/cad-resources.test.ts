import { describe, expect, it } from "vitest";
import { buildCadResourceReview, calculateCadSectionResource, applyCadAiVerification, makeRigidJointAssumption, validateCadMaterial, requestCadAiVerification, buildCadAiVerificationInput, canApplyCadResourceReview } from "./cad-resources";
import type { CadCenterline } from "./cad-geometry";
import type { CadTopologyPreview } from "./cad-topology";
import { calculateMemberGeometry } from "../domain/member-geometry";
import { transformCadPoint } from "./cad-geometry";
import { sectionMechanicalProperties } from "../domain/section-geometry";

const line = (id = "axis-1-1"): CadCenterline => ({
  id, instanceId: 1, solidId: 1, sourceEntityIds: [1, 10, 11, 12, 13],
  start: [0, 0, 0], end: [2, 0, 0], direction: [1, 0, 0], lengthM: 2,
  endSections: [
    [[0, -0.1, -0.05], [0, 0.1, -0.05], [0, 0.1, 0.05], [0, -0.1, 0.05]],
    [[2, -0.1, -0.05], [2, 0.1, -0.05], [2, 0.1, 0.05], [2, -0.1, 0.05]],
  ], boundingBox: { min: [0, -0.1, -0.05], max: [2, 0.1, 0.05] }, method: "test",
});
const topology = (issues: CadTopologyPreview["issues"] = []): CadTopologyPreview => ({
  toleranceM: 0.0005, nodes: [{ id: "a", position: { x: 0, y: 0, z: 0 }, sourceEntityIds: [1], endpointCount: 1, mergedFrom: [] }, { id: "b", position: { x: 2, y: 0, z: 0 }, sourceEntityIds: [1], endpointCount: 1, mergedFrom: [] }], members: [{ id: "axis-1-1:segment-1", parentId: "axis-1-1", sourceEntityIds: [1], instanceId: 1, startNodeId: "a", endNodeId: "b", range: [0, 1], classification: "candidate" }], contacts: [], issues, boundingBox: null, instanceCount: 1, ignoredCount: 0, sourceMemberCount: 1,
});

describe("CAD resources", () => {
  it("computes rectangle A/I and a Saint-Venant J without using Iy + Iz", () => {
    const resource = calculateCadSectionResource(line(), ["m1"]);
    expect(resource.status).toBe("verified");
    expect(resource.properties?.areaM2).toBeCloseTo(0.02, 12);
    expect(resource.properties?.secondMomentYM4).toBeCloseTo(0.2 * 0.1 ** 3 / 12, 12);
    expect(resource.properties?.secondMomentZM4).toBeCloseTo(0.1 * 0.2 ** 3 / 12, 12);
    expect(resource.properties?.torsionalConstantM4).toBeGreaterThan(0);
    expect(Math.abs((resource.properties?.torsionalConstantM4 ?? 0) - ((resource.properties?.secondMomentYM4 ?? 0) + (resource.properties?.secondMomentZM4 ?? 0)))).toBeGreaterThan(1e-8);
  });

  it("blocks a polygon whose torsion method has no registered independent reference", () => {
    const result = calculateCadSectionResource({ ...line(), endSections: [line().endSections[0].slice(0, 3), line().endSections[1].slice(0, 3)] });
    expect(result.status).toBe("blocked");
    expect(result.properties).toBeUndefined();
    expect(result.issues.join(" ")).toContain("Saint-Venant");
  });

  it("keeps material and rigid-joint assumptions incomplete until the user confirms them", () => {
    expect(validateCadMaterial(null).status).toBe("needs-user-confirmation");
    expect(validateCadMaterial({ name: "S", elasticModulusGPa: 1, poissonRatio: 0.2, densityKgM3: 1, source: "other" as never, confirmed: true }).status).toBe("needs-user-confirmation");
    expect(makeRigidJointAssumption().status).toBe("needs-user-confirmation");
    expect(makeRigidJointAssumption(true).source).toBe("user");
  });

  it("requires every deterministic check in a read-only AI response", () => {
    const review = buildCadResourceReview({ topology: topology(), centerlines: [line()], material: { name: "S355JR", elasticModulusGPa: 210, poissonRatio: 0.3, densityKgM3: 7850, source: "catalog", confirmed: true }, rigidJointsConfirmed: true });
    expect(review.status).toBe("verified");
    const incomplete = applyCadAiVerification(review, { decision: "accept", findings: [] });
    expect(incomplete.ai.status).toBe("invalid");
    const accepted = applyCadAiVerification(review, { decision: "accept", findings: review.checks.map((check) => ({ checkCode: check.code, decision: "accept", evidence: check.evidence, message: "已引用程序证据" })) });
    expect(accepted.ai.status).toBe("accepted");
    const blocked = buildCadResourceReview({ topology: topology([{ code: "bad", severity: "blocking", message: "bad", sourceEntityIds: [99] }]), centerlines: [line()], material: { name: "S355JR", elasticModulusGPa: 210, poissonRatio: 0.3, densityKgM3: 7850, source: "catalog", confirmed: true }, rigidJointsConfirmed: true });
    const cannotOverride = applyCadAiVerification(blocked, { decision: "accept", findings: blocked.checks.map((check) => ({ checkCode: check.code, decision: "accept", evidence: check.evidence, message: "ignore" })) });
    expect(cannotOverride.ai.status).toBe("rejected");
    const human = applyCadAiVerification(review, { decision: "accept", findings: review.checks.map((check) => ({ checkCode: check.code, decision: "needs-human", evidence: check.evidence, message: "需人工确认" })) });
    expect(human.ai.status).toBe("needs-human");
  });

  it("shares equal verified section mechanics while retaining all source entities", () => {
    const second = { ...line("axis-2-1"), solidId: 2, sourceEntityIds: [2, 20, 21, 22, 23], start: [0, 1, 0], end: [2, 1, 0] };
    const review = buildCadResourceReview({ topology: { ...topology(), members: [topology().members[0], { ...topology().members[0], id: "axis-2-1:segment-1", parentId: "axis-2-1", sourceEntityIds: [2] }] }, centerlines: [line(), second], material: { name: "S355JR", elasticModulusGPa: 210, poissonRatio: .3, densityKgM3: 7850, source: "catalog", confirmed: true }, rigidJointsConfirmed: true });
    expect(review.sections).toHaveLength(1);
    expect(review.sections[0].memberIds).toEqual(expect.arrayContaining(["axis-1-1:segment-1", "axis-2-1:segment-1"]));
    expect(review.sections[0].sourceEntityIds).toEqual(expect.arrayContaining([1, 2, 20]));
  });

  it("keeps a confirmed manual replacement as an auditable correction", () => {
    const review = buildCadResourceReview({ topology: topology(), centerlines: [{ ...line(), endSections: [line().endSections[0].slice(0, 3), line().endSections[1].slice(0, 3)] }], manualSections: {
      "axis-1-1": { properties: { areaM2: 0.02, secondMomentYM4: 1e-6, secondMomentZM4: 2e-6, torsionalConstantM4: 3e-6 }, reference: "independent-cad-measurement-1", confirmed: true, recordedAt: "2026-10-09T00:00:00.000Z" },
    }, material: { name: "S355JR", elasticModulusGPa: 210, poissonRatio: 0.3, densityKgM3: 7850, source: "catalog", confirmed: true }, rigidJointsConfirmed: true });
    expect(review.status).toBe("verified");
    expect(review.corrections[0]).toMatchObject({ sectionId: "axis-1-1", reference: "independent-cad-measurement-1", confirmed: true, recordedAt: "2026-10-09T00:00:00.000Z" });
    expect(review.corrections[0].original).toBeUndefined();
    expect(review.sections[0].basis.method).toBe("user-supplied-section-v1");
  });

  it("blocks duplicate topology ids and missing node references", () => {
    const base = topology();
    const review = buildCadResourceReview({ topology: { ...base, nodes: [], members: [base.members[0], { ...base.members[0] }] }, centerlines: [line()], material: { name: "S355JR", elasticModulusGPa: 210, poissonRatio: 0.3, densityKgM3: 7850, source: "catalog", confirmed: true }, rigidJointsConfirmed: true });
    expect(review.status).toBe("blocked");
    expect(review.checks.some((check) => check.code === "duplicate:member")).toBe(true);
    expect(review.checks.some((check) => check.code.startsWith("schema:member:"))).toBe(true);
  });

  it("turns online timeout and malformed responses into non-passing AI states", async () => {
    const review = buildCadResourceReview({ topology: topology(), centerlines: [line()], material: { name: "S355JR", elasticModulusGPa: 210, poissonRatio: 0.3, densityKgM3: 7850, source: "catalog", confirmed: true }, rigidJointsConfirmed: true });
    const malformed = await requestCadAiVerification(review, { chatDeepSeek: async () => ({ status: "success", message: "ok", assistant: { content: "not-json" } }) }, { timeoutMs: 100 });
    expect(malformed.ai.status).toBe("format-error");
    const timedOut = await requestCadAiVerification(review, { chatDeepSeek: async () => new Promise(() => undefined) }, { timeoutMs: 5 });
    expect(timedOut.ai.status).toBe("timeout");
  });

  it("treats repeated solid definitions as separate assembly instances", () => {
    const base = topology(), second = { ...line("axis-2-1"), instanceId: 2 };
    const review = buildCadResourceReview({ topology: { ...base, members: [...base.members, { ...base.members[0], id: "m2", parentId: second.id, instanceId: 2 }] }, centerlines: [line(), second], material: { name: "steel", elasticModulusGPa: 210, poissonRatio: .3, densityKgM3: 7850, source: "user", confirmed: true }, rigidJointsConfirmed: true });
    expect(review.status).toBe("verified");
    expect(review.sections).toHaveLength(1);
    expect(review.sections[0].centerlineIds).toEqual(["axis-1-1", "axis-2-1"]);
  });

  it("shares identical measured shapes, retains both references and separates different shapes", () => {
    const base = topology(), second = line("axis-2-1");
    const geometry = { shape: "rectangular-tube" as const, width: .2, height: .1, thickness: .005 };
    const properties = sectionMechanicalProperties(geometry);
    expect(properties.torsionalConstantM4).toBeGreaterThan(0);
    const manual = { geometry, properties, confirmed: true, reference: "measurement-1", rotationDegrees: 45 };
    const input = { topology: { ...base, members: [...base.members, { ...base.members[0], id: "m2", parentId: second.id }] }, centerlines: [line(), second], manualSections: { "axis-1-1": manual, "axis-2-1": { ...manual, reference: "measurement-2", rotationDegrees: 90 } } };
    const shared = buildCadResourceReview(input);
    expect(shared.sections).toHaveLength(1);
    expect(shared.sections[0].basis.references).toEqual(expect.arrayContaining(["measurement-1", "measurement-2"]));
    expect(shared.sections[0].memberProfiles?.map((frame) => frame.rotationDegrees)).toEqual([45, 90]);
    const different = { ...geometry, width: .3 };
    expect(buildCadResourceReview({ ...input, manualSections: { ...input.manualSections, "axis-2-1": { ...manual, geometry: different, properties: sectionMechanicalProperties(different) } } }).sections).toHaveLength(2);
    expect(calculateCadSectionResource(line(), [], { ...manual, properties: { ...properties, areaM2: 1 } }).status).toBe("blocked");
    expect(calculateCadSectionResource(line(), [], { ...manual, geometry: { ...geometry, thickness: .02 } }).status).toBe("blocked");
  });

  it("records cancellation explicitly and requests transport cancellation", async () => {
    const review = buildCadResourceReview({ topology: topology(), centerlines: [line()] });
    const controller = new AbortController(), cancelled: string[] = [];
    const request = requestCadAiVerification(review, { chatDeepSeek: async () => new Promise(() => undefined), cancelDeepSeekChat: async (id) => { cancelled.push(id); } }, { signal: controller.signal, requestId: "cancel-test" });
    controller.abort();
    expect((await request).ai.status).toBe("cancelled");
    expect(cancelled).toEqual(["cancel-test"]);
  });

  it.each([[0, 0], [.8, .2], [-.1, 1], [0, 1.1]])("rejects invalid split ranges %s—%s", (start, end) => {
    const base = topology();
    const review = buildCadResourceReview({ topology: { ...base, members: [{ ...base.members[0], range: [start, end] }] }, centerlines: [line()] });
    expect(review.status).toBe("blocked");
    expect(review.checks.some((c) => c.code.startsWith("schema:member"))).toBe(true);
  });

  it("returns blocked schema evidence for malformed/NaN data", () => {
    const base = topology(); base.nodes[0].position.x = NaN;
    const review = buildCadResourceReview({ topology: base, centerlines: [line()] });
    expect(review.status).toBe("blocked");
    expect(review.checks[0].code).toBe("schema:geometry");
    expect(buildCadResourceReview({ topology: topology(), centerlines: [{ ...line(), endSections: [] }] }).status).toBe("blocked");
  });

  it("allows warning acceptance independently from blocking issues", () => {
    const input = { topology: topology([{ code: "isolated", severity: "warning" as const, message: "用户核对孤立杆件" }]), centerlines: [line()], material: { name: "steel", elasticModulusGPa: 210, poissonRatio: .3, densityKgM3: 7850, source: "user" as const, confirmed: true }, rigidJointsConfirmed: true };
    expect(buildCadResourceReview(input).status).toBe("needs-user-confirmation");
    expect(buildCadResourceReview({ ...input, acceptedWarningCodes: ["topology:isolated:0"] }).status).toBe("verified");
    expect(buildCadResourceReview({ ...input, topology: topology([{ code: "bad", severity: "blocking", message: "阻塞" }]), acceptedWarningCodes: ["topology:bad:0"] }).status).toBe("blocked");
  });

  it("sanitizes paths/credentials in actual model requests and preserves references locally", async () => {
    const path = "C:\\Users\\private\\section.csv", token = "sk-fixture-credential";
    const review = buildCadResourceReview({ topology: topology(), centerlines: [line()], material: { name: `${path} ${token}`, elasticModulusGPa: 210, poissonRatio: .3, densityKgM3: 7850, source: "user", confirmed: true }, rigidJointsConfirmed: true, manualSections: { "axis-1-1": { properties: { areaM2: .02, secondMomentYM4: 1e-6, secondMomentZM4: 2e-6, torsionalConstantM4: 3e-6 }, reference: path, confirmed: true } } });
    let sent = "";
    await requestCadAiVerification(review, { chatDeepSeek: async (request) => { sent = JSON.stringify(request); return { status: "network", message: "network failure" }; } });
    expect(sent).not.toContain("private"); expect(sent).not.toContain(token);
    expect(review.sections[0].basis.references).toContain(path);
  });

  it("binds acceptance to the inspected resources and distinguishes online evidence", async () => {
    const review = buildCadResourceReview({ topology: topology(), centerlines: [line()], material: { name: "steel", elasticModulusGPa: 210, poissonRatio: .3, densityKgM3: 7850, source: "user", confirmed: true }, rigidJointsConfirmed: true });
    const request = buildCadAiVerificationInput(review), response = { decision: "accept", findings: request.checks.map((check) => ({ checkCode: check.code, decision: "accept", evidence: check.evidence, message: "引用程序证据" })) };
    const online = await requestCadAiVerification(review, { chatDeepSeek: async () => ({ status: "success", message: "ok", assistant: { content: JSON.stringify(response) } }) });
    expect(canApplyCadResourceReview(review, online.ai)).toBe(true);
    expect(canApplyCadResourceReview(review, applyCadAiVerification(review, response).ai)).toBe(false);
    const changed = buildCadResourceReview({ topology: topology(), centerlines: [line()], material: { ...review.material, elasticModulusGPa: 200 }, rigidJointsConfirmed: true });
    expect(canApplyCadResourceReview(changed, online.ai)).toBe(false);
    expect(applyCadAiVerification(review, { ...response, commands: ["write-model"] }).ai.status).toBe("format-error");
  });

  it("maps anisotropic section axes to the actual solver frame after an arbitrary rigid rotation", () => {
    const source = line(), pose = { translationM: [1, 2, 3] as [number, number, number], rotationDegrees: [37, 25, 82] as [number, number, number] };
    const start = transformCadPoint(source.start, pose), end = transformCadPoint(source.end, pose);
    const rotated = { ...source, start, end, direction: end.map((v, i) => (v - start[i]) / source.lengthM), endSections: source.endSections.map((s) => s.map((p) => transformCadPoint(p, pose))) };
    const section = calculateCadSectionResource(rotated, ["m1"]);
    expect(section.status).toBe("verified");
    const mapped = section.memberProfiles![0], frame = calculateMemberGeometry({ x: start[0], y: start[1], z: start[2] }, { x: end[0], y: end[1], z: end[2] }, mapped.rotationDegrees);
    for (const [index, key] of (["x", "y", "z"] as const).entries()) {
      expect(frame.localY[key]).toBeCloseTo(mapped.localY[index], 9);
      expect(frame.localZ[key]).toBeCloseTo(mapped.localZ[index], 9);
    }
    expect(section.properties!.secondMomentYM4).toBeCloseTo(0.2 * .1 ** 3 / 12, 12);
    expect(section.properties!.secondMomentZM4).toBeCloseTo(.1 * .2 ** 3 / 12, 12);
  });
});
