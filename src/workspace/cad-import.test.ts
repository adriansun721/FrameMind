// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CadParserHost } from "../../electron/cad-parser";
import { createProject, addNode } from "../domain/project";
import { encodeProject, decodeProject } from "../domain/project-file";
import { ProjectHistory } from "../domain/project-history";
import { createCadImportDraft, reviewCadImport, prepareCadImport, applyCadImport, getCadImportReadiness } from "./cad-import";
import { applyCadAiVerification } from "./cad-resources";
import { prismStep } from "../../scripts/fixtures/p25-04-prism.mjs";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "cad-import-")); directories.push(directory);
  const path = join(directory, "prism.step"); await writeFile(path, prismStep());
  const host = new CadParserHost({ worker: resolve("scripts/cad-parser-worker.mjs") });
  try {
    const messages = await host.run(1, { requestId: `cad_${crypto.randomUUID()}`, inputPath: path });
    const result = messages.at(-1); if (result?.kind !== "result") throw new Error(`Fixture parse failed: ${JSON.stringify(result)}`);
    result.sourceFile = { name: "prism.step", importedAt: new Date().toISOString() };
    const parent = addNode(createProject(), { x: 6, y: 2, z: 1 });
    const draft = await createCadImportDraft(parent, result);
    draft.resources.material = { name: "S355JR", elasticModulusGPa: 210, poissonRatio: .3, densityKgM3: 7850, source: "user", confirmed: true };
    draft.resources.rigidJointsConfirmed = true;
    let review = reviewCadImport(draft);
    draft.resources.acceptedWarningCodes = review.review.checks.filter((c) => c.severity === "warning").map((c) => c.code);
    review = reviewCadImport(draft);
    const verified = applyCadAiVerification(review.review, { decision: "accept", findings: review.review.checks.map((c) => ({ checkCode: c.code, decision: "accept", evidence: c.evidence, message: "Test transport evidence only" })) });
    verified.ai.origin = "online"; // Transport fixture; never claims real online acceptance.
    draft.resources.verification = { inputKey: review.inputKey, ai: verified.ai };
    return { parent, draft, directory, path };
  } finally { host.dispose(); }
}

it("confirms one frozen draft, replaces all engineering objects atomically, and saves/reopens without STEP", async () => {
  const { parent, draft, path, directory } = await fixture();
  const before = encodeProject(parent);
  const confirmation = await prepareCadImport(parent, draft);
  const outcome = await applyCadImport(parent, draft, confirmation);
  expect(encodeProject(parent)).toBe(before);
  expect(outcome.project.revision).toBe(parent.revision + 1);
  expect(outcome.project.nodes.map((n) => n.position)).toEqual([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }]);
  expect(outcome.project.members).toHaveLength(1);
  expect(outcome.project.sections[0].areaM2).toBeCloseTo(.01, 12);
  expect(outcome.project.supports).toEqual([]); expect(outcome.project.nodalLoads).toEqual([]);
  expect(outcome.project.selfWeight.enabled).toBe(false);
  expect(outcome.receipt.readiness).toEqual(["missing-supports", "missing-loads"]);
  expect(outcome.receipt.mappings[0].sourceEntityIds.length).toBeGreaterThan(0);
  expect(outcome.receipt).toMatchObject({ source: { name: "prism.step", units: draft.result.intermediateState.units, counts: draft.result.diagnostics, kernel: draft.result.kernel }, evidence: { file: "cad-draft.json", sha256: confirmation.draftHash } });
  const savedPath = join(directory, "model.framemind"); await writeFile(savedPath, encodeProject(outcome.project)); await rm(path);
  const reopened = decodeProject(await readFile(savedPath, "utf8"));
  expect(reopened.cadImports?.[0]).toEqual(outcome.receipt);
  expect(reopened.nodes).toEqual(outcome.project.nodes);
  const history = new ProjectHistory(); history.record(parent, outcome.project);
  expect(history.undo(outcome.project)?.nodes).toEqual(parent.nodes);
});

it("rejects a changed draft, same-revision parent edits, restored verification, and replay status without altering the parent", async () => {
  const { parent, draft } = await fixture();
  const confirmation = await prepareCadImport(parent, draft);
  const before = encodeProject(parent);
  await expect(applyCadImport({ ...parent, name: "edited during confirmation" }, draft, confirmation)).rejects.toThrow(/父快照/);
  await expect(applyCadImport(parent, { ...draft, pose: { translationM: [1, 0, 0], rotationDegrees: [0, 0, 0] } }, confirmation)).rejects.toThrow();
  const restored = decodeProject(encodeProject({ ...parent, cadImportDraft: draft })).cadImportDraft!;
  await expect(prepareCadImport(parent, restored)).rejects.toThrow(/恢复/);
  const replay = structuredClone(draft); replay.resources.verification!.ai.origin = "manual";
  await expect(prepareCadImport(parent, replay)).rejects.toThrow(/核验/);
  const forged = structuredClone(draft); forged.resources.verification!.ai.response = undefined;
  await expect(prepareCadImport(parent, forged)).rejects.toThrow(/核验/);
  expect(encodeProject(parent)).toBe(before);
});

it("rejects malformed persisted drafts and receipts before they can crash the preview or claim confirmation", async () => {
  const { parent, draft } = await fixture();
  const invalid = JSON.parse(encodeProject({ ...parent, cadImportDraft: draft }));
  invalid.cadImportDraft.result.intermediateState.entities = "corrupt";
  expect(() => decodeProject(JSON.stringify(invalid))).toThrow(/草稿/);
  const malformedGeometry = JSON.parse(encodeProject({ ...parent, cadImportDraft: draft }));
  malformedGeometry.cadImportDraft.resources.manualSections.sample = { properties: {}, reference: "", confirmed: false, geometry: { shape: "bogus" } };
  expect(() => decodeProject(JSON.stringify(malformedGeometry))).toThrow(/草稿/);
  for (const corrupt of [
    (v: typeof draft) => { v.result.intermediateState.normalization.coordinateSystem = { bad: true } as never; },
    (v: typeof draft) => { v.result.intermediateState.units.sourceLength = { bad: true } as never; },
    (v: typeof draft) => { v.result.intermediateState.units.lengthToM = { bad: true } as never; },
    (v: typeof draft) => { v.resources.material.name = { bad: true } as never; },
  ]) {
    const damaged = structuredClone(draft); corrupt(damaged);
    expect(() => decodeProject(encodeProject({ ...parent, cadImportDraft: damaged }))).toThrow(/草稿/);
  }
  const confirmation = await prepareCadImport(parent, draft);
  const outcome = await applyCadImport(parent, draft, confirmation);
  const malformedReceipt = JSON.parse(encodeProject(outcome.project));
  malformedReceipt.cadImports[0].mappings = [null];
  expect(() => decodeProject(JSON.stringify(malformedReceipt))).toThrow(/回执/);
});

it("retains a missing-condition warning after saving and reopening an imported model", async () => {
  const { parent, draft } = await fixture();
  const outcome = await applyCadImport(parent, draft, await prepareCadImport(parent, draft));
  expect(getCadImportReadiness(decodeProject(encodeProject(outcome.project)))).toEqual(["missing-supports", "missing-loads"]);
});
