import { describe, expect, it } from "vitest";
import { buildCadResourceReview, calculateCadSectionResource, applyCadAiVerification, makeRigidJointAssumption, validateCadMaterial } from "./cad-resources";
import type { CadCenterline } from "./cad-geometry";
import type { CadTopologyPreview } from "./cad-topology";

const line = (id = "axis-1-1"): CadCenterline => ({
  id, instanceId: 1, solidId: 1, sourceEntityIds: [1, 10, 11, 12, 13],
  start: [0, 0, 0], end: [2, 0, 0], direction: [1, 0, 0], lengthM: 2,
  endSections: [
    [[0, -0.1, -0.05], [0, 0.1, -0.05], [0, 0.1, 0.05], [0, -0.1, 0.05]],
    [[2, -0.1, -0.05], [2, 0.1, -0.05], [2, 0.1, 0.05], [2, -0.1, 0.05]],
  ], boundingBox: { min: [0, -0.1, -0.05], max: [2, 0.1, 0.05] }, method: "test",
});
const topology = (issues: CadTopologyPreview["issues"] = []): CadTopologyPreview => ({
  toleranceM: 0.0005, nodes: [], members: [{ id: "axis-1-1:segment-1", parentId: "axis-1-1", sourceEntityIds: [1], instanceId: 1, startNodeId: "a", endNodeId: "b", range: [0, 1], classification: "candidate" }], contacts: [], issues, boundingBox: null, instanceCount: 1, ignoredCount: 0, sourceMemberCount: 1,
});

describe("CAD resources", () => {
  it("computes rectangle A/I and a Saint-Venant J without using Iy + Iz", () => {
    const resource = calculateCadSectionResource(line(), ["m1"]);
    expect(resource.status).toBe("verified");
    expect(resource.properties?.areaM2).toBeCloseTo(0.02);
    expect(resource.properties?.secondMomentYM4).toBeCloseTo(0.1 * 0.05 ** 3 / 12);
    expect(resource.properties?.secondMomentZM4).toBeCloseTo(0.05 * 0.1 ** 3 / 12);
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
  });

  it("shares equal verified section mechanics while retaining all source entities", () => {
    const second = { ...line("axis-2-1"), solidId: 2, sourceEntityIds: [2, 20, 21, 22, 23], start: [0, 1, 0], end: [2, 1, 0] };
    const review = buildCadResourceReview({ topology: { ...topology(), members: [topology().members[0], { ...topology().members[0], id: "axis-2-1:segment-1", parentId: "axis-2-1", sourceEntityIds: [2] }] }, centerlines: [line(), second], material: { name: "S355JR", elasticModulusGPa: 210, poissonRatio: .3, densityKgM3: 7850, source: "catalog", confirmed: true }, rigidJointsConfirmed: true });
    expect(review.sections).toHaveLength(1);
    expect(review.sections[0].memberIds).toEqual(expect.arrayContaining(["axis-1-1:segment-1", "axis-2-1:segment-1"]));
    expect(review.sections[0].sourceEntityIds).toEqual(expect.arrayContaining([1, 2, 20]));
  });
});
