// @vitest-environment node
import { expect, it } from "vitest";
import { createProject } from "../src/domain/project";
import { decodeProject, encodeProject } from "../src/domain/project-file";
import { createReverseDesignBaseline, generateReverseDesignCandidate } from "./reverse-design-model";
import { ReverseDesignService } from "./reverse-design";
import { ProjectHistoryStore } from "./project-history-store";
import { ProjectCandidates } from "./project-candidates";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { candidateInput } from "./candidate-model";

it("creates the PRD fixed frame with archived resources and an independent mass baseline", () => {
  const original = encodeProject(createProject());
  const project = decodeProject(createReverseDesignBaseline(original));
  expect(project.nodes).toHaveLength(12);
  expect(project.members).toHaveLength(16);
  expect(project.supports).toHaveLength(4);
  expect(project.nodalLoads[0]).toMatchObject({ nodeId: "node_0010", force: { x: 5, y: 0, z: 0 } });
  expect(project.uniformLoads[0]).toMatchObject({ memberId: "member_0011", intensity: { x: 0, y: 0, z: -2 } });
  const candidate = generateReverseDesignCandidate(encodeProject(project), { beamCatalogId: "arcelor-ipe100", columnCatalogId: "arcelor-hea200" });
  // Independent decimal worksheet: columns 24 m, beams 40 m, density 7850 kg/m³.
  expect(candidate.report.beforeMassKg).toBeCloseTo(1908.492, 6);
  expect(candidate.report.afterMassKg).toBeCloseTo(1337.012, 6);
  expect(candidate.report.horizontalLimitMm).toBe(15);
  expect(candidate.report.status).toBe("blocked");
  const proposed = decodeProject(candidate.content);
  expect(proposed.nodes).toEqual(project.nodes);
  expect(proposed.selfWeight).toEqual(project.selfWeight);
  expect(candidate.report.selfWeight.find((m) => m.memberId === "member_0011")?.intensityKnM.z).toBeCloseTo(-0.079318755, 9);
});

it("binds confirmation to the parent and writes generated candidates only to isolated Git branches", async () => {
  const directory = await mkdtemp(join(tmpdir(), "framemind-p2509-test-"));
  try {
    const history = new ProjectHistoryStore(join(directory, "history")), candidates = new ProjectCandidates(history), service = new ReverseDesignService(history, candidates);
    const initial = decodeProject((await history.save(join(directory, "frame.framemind"), encodeProject(createProject()))).content);
    const sync = (content: string, reason?: "restore") => { const request = { content, sessionId: "test-session", reason }; candidates.sync(1, request); service.sync(1, request); };
    sync(encodeProject(initial));
    const draft = service.prepare(1);
    await expect(service.generate(1, { confirmationId: draft.confirmationId, beamCatalogId: "arcelor-ipe100", columnCatalogId: "arcelor-hea200" })).rejects.toThrow(/确认/);
    const confirmed = await service.confirm(1, draft.confirmationId);
    const generated = await service.generate(1, { confirmationId: draft.confirmationId, beamCatalogId: "arcelor-ipe100", columnCatalogId: "arcelor-hea200" });
    expect(generated.candidate.state).toBe("submitted");
    expect(await history.checkpoints.head(initial.id)).toBe(generated.candidate.parentCommit);
    expect(await history.read(initial.id, generated.candidate.parentCommit)).toBe(confirmed);
    const snapshot = await candidates.read(1, generated.candidate.taskId);
    expect(decodeProject(snapshot.candidateContent).sections[1].name).toBe("IPE 100");
    expect(decodeProject(snapshot.parentContent).sections[1].name).toBe("IPE 200");
    await expect(candidates.merge(1, generated.candidate.taskId, generated.candidate.commit)).rejects.toThrow(/inspect/);
    await candidates.cancel(1, generated.candidate.taskId);
    const retry = await candidates.tool(1, { tool: "fork", retryOf: generated.candidate.taskId });
    if (Array.isArray(retry) || !("parentContent" in retry)) throw new Error("Missing retry snapshot");
    expect(retry.candidate.inputPolicy).toBe("reverse-design-v1");
    const tampered = decodeProject(retry.parentContent); tampered.revision++; tampered.nodes[0].position.x = 1;
    const badContent = JSON.stringify(tampered), hash = (s: string) => createHash("sha256").update(s).digest("hex");
    await expect(candidates.tool(1, { tool: "submit", submission: { projectId: tampered.id, taskId: retry.candidate.taskId, content: badContent, inputSha256: hash(candidateInput(badContent)), resultContent: "{}", resultSha256: hash("{}"), evidenceIndex: ["result.json"] } })).rejects.toThrow(/固定场景 nodes/);
    expect((await candidates.read(1, retry.candidate.taskId)).candidateContent).toBe(retry.parentContent);
    sync(confirmed, "restore");
    await expect(service.generate(1, { confirmationId: draft.confirmationId, beamCatalogId: "arcelor-ipe100", columnCatalogId: "arcelor-hea200" })).rejects.toThrow(/过期/);
    const fresh = service.prepare(1); await service.confirm(1, fresh.confirmationId);
    const anotherWindow = decodeProject(confirmed); anotherWindow.revision++; anotherWindow.nodes[0].position.x = 2;
    await history.record({ projectId: initial.id, snapshots: [{ kind: "confirmation-after", content: encodeProject(anotherWindow) }] });
    const externalHead = await history.checkpoints.head(initial.id);
    await expect(service.generate(1, { confirmationId: fresh.confirmationId, beamCatalogId: "arcelor-ipe100", columnCatalogId: "arcelor-hea200" })).rejects.toThrow(/父状态/);
    expect(await history.checkpoints.head(initial.id)).toBe(externalHead);
  } finally {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid fixture directory");
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

it.each(["geometry", "material", "support", "load", "combination", "rotation", "delete-member", "custom-section", "extra-mass", "release"])("rejects %s changes instead of changing the problem to meet the target", (change) => {
  const project = decodeProject(createReverseDesignBaseline(encodeProject(createProject())));
  if (change === "geometry") project.nodes[0].position.x = 1;
  if (change === "material") project.materials[0].densityKgM3 = 7800;
  if (change === "support") project.supports[0].restraints[0] = false;
  if (change === "load") project.nodalLoads[0].force.x = 0;
  if (change === "combination") project.loadCombinations[0].terms[1].factor = 1;
  if (change === "rotation") project.members[0].rotationDegrees = 90;
  if (change === "delete-member") project.members.pop();
  if (change === "custom-section") project.sections[0].areaM2 /= 2;
  if (change === "extra-mass") project.nodes[0].additionalMassKg = 10;
  if (change === "release") project.members[0].endReleases = { start: { my: true, mz: false }, end: { my: false, mz: false } };
  expect(() => generateReverseDesignCandidate(JSON.stringify(project), { beamCatalogId: "arcelor-ipe100", columnCatalogId: "arcelor-hea200" })).toThrow(/固定场景/);
});

it("rejects fabricated section values, budget overrides and unchanged combinations", () => {
  const content = createReverseDesignBaseline(encodeProject(createProject()));
  expect(() => generateReverseDesignCandidate(content, { beamCatalogId: "custom", columnCatalogId: "arcelor-hea200" })).toThrow(/核验截面库/);
  expect(() => generateReverseDesignCandidate(content, JSON.parse('{"beamCatalogId":"arcelor-ipe100","columnCatalogId":"arcelor-hea200","horizontalLimitMm":100}'))).toThrow(/只允许/);
  expect(() => generateReverseDesignCandidate(content, { beamCatalogId: "arcelor-ipe200", columnCatalogId: "arcelor-hea200" })).toThrow(/未变化/);
});
