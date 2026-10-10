import type { CadParseResult, CadPose, CadPoseDecision } from "../../electron/contracts";
import { addMaterial, addMember, addNode, addSection, createProject, type FrameProject } from "../domain/project";
import { decodeProject, encodeProject } from "../domain/project-file";
import { CAD_ORIGINAL_POSE, transformCadPoint } from "./cad-geometry";
import { buildCadTopologyPreview } from "./cad-topology";
import { applyCadAiVerification, buildCadAiVerificationInput, buildCadResourceReview, canApplyCadResourceReview, createCadResourceDraft, type CadResourceDraft } from "./cad-resources";

export interface CadImportDraft {
  schemaVersion: 1;
  id: string;
  parent: { projectId: string; revision: number; snapshotHash: string };
  result: CadParseResult;
  pose: CadPose;
  poseDecisions: CadPoseDecision[];
  approvedContactIds: string[];
  resources: CadResourceDraft;
  /** Restored drafts need a fresh review, even when their parent revision matches. */
  restored?: boolean;
}
export interface CadImportConfirmation {
  schemaVersion: 1;
  id: string;
  draftId: string;
  draftHash: string;
  parentHash: string;
  projectId: string;
  parentRevision: number;
}
export interface CadImportReceipt extends CadImportConfirmation {
  inputSha256: string;
  geometryHash: string;
  parserVersion: string;
  appliedRevision: number;
  confirmedAt: string;
  rigidJointsConfirmed: true;
  pose: CadPose;
  readiness: string[];
  mappings: Array<{ memberId: string; draftMemberId: string; centerlineId: string; instanceId: number | null; sourceEntityIds: number[]; range: [number, number] }>;
  resourceEvidence: ReturnType<typeof buildCadAiVerificationInput>;
  ignoredEntities: CadParseResult["intermediateState"]["ignoredEntities"];
  source: { name: string; importedAt: string; sizeBytes: number; units: CadParseResult["intermediateState"]["units"]; counts: CadParseResult["diagnostics"]; kernel: CadParseResult["kernel"]; parameters: Record<string, unknown> };
  decisions: { pose: CadPoseDecision[]; approvedContactIds: string[]; acceptedWarningCodes: string[] };
  evidence: { file: "cad-draft.json"; sha256: string };
}

/** Missing conditions are reported continuously; clearing this list is not a solvability verdict. */
export function getCadImportReadiness(project: FrameProject): string[] {
  const missing: string[] = [];
  if (!project.supports.some((s) => s.restraints.some(Boolean))) missing.push("missing-supports");
  const loaded = project.nodalLoads.some((l) => [...Object.values(l.force), ...Object.values(l.moment)].some((n) => n !== 0))
    || project.uniformLoads.some((l) => Object.values(l.intensity).some((n) => n !== 0)) || project.selfWeight.enabled;
  if (!loaded) missing.push("missing-loads");
  return missing;
}

export function encodeCadImportDraft(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : v;
  return JSON.stringify(canonical(value));
}

async function hash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(encodeCadImportDraft(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

const parentSnapshotHash = (project: FrameProject) => hash(JSON.parse(encodeProject({ ...project, cadImportDraft: undefined })));

export async function createCadImportDraft(parent: FrameProject, result: CadParseResult): Promise<CadImportDraft> {
  return { schemaVersion: 1, id: crypto.randomUUID(), parent: { projectId: parent.id, revision: parent.revision, snapshotHash: await parentSnapshotHash(parent) }, result: structuredClone(result),
    pose: structuredClone(CAD_ORIGINAL_POSE), poseDecisions: [], approvedContactIds: [], resources: createCadResourceDraft() };
}

/** Shared by the preview and final confirmation: never accepts caller-supplied topology or resource verdicts. */
export function reviewCadImport(draft: CadImportDraft) {
  const { result, pose, resources } = draft;
  const original = buildCadTopologyPreview(result.intermediateState, draft.approvedContactIds);
  const topology = { ...original, nodes: original.nodes.map((node) => {
    const [x, y, z] = transformCadPoint(Object.values(node.position), pose); return { ...node, position: { x, y, z } };
  }) };
  const centerlines = (result.intermediateState.engineeringGeometry?.centerlines ?? []).map((line) => {
    const start = transformCadPoint(line.start, pose), end = transformCadPoint(line.end, pose);
    return { ...line, start, end, direction: end.map((v, i) => (v - start[i]) / line.lengthM), endSections: line.endSections.map((section) => section.map((p) => transformCadPoint(p, pose))) };
  });
  const review = buildCadResourceReview({ topology, centerlines, geometryHash: result.intermediateState.geometryHash, units: result.intermediateState.units,
    material: resources.material, rigidJointsConfirmed: resources.rigidJointsConfirmed, manualSections: resources.manualSections,
    correctionHistory: resources.correctionHistory, acceptedWarningCodes: resources.acceptedWarningCodes });
  const inputKey = JSON.stringify([buildCadAiVerificationInput(review), pose, draft.approvedContactIds]);
  const ai = resources.verification?.inputKey === inputKey ? resources.verification.ai : review.ai;
  return { topology, centerlines, review, inputKey, ai };
}

function requireApplicable(project: FrameProject, draft: CadImportDraft) {
  if (draft.schemaVersion !== 1 || draft.restored || draft.parent.projectId !== project.id || draft.parent.revision !== project.revision) throw new Error("导入草稿已过期或已恢复，请重新核验当前项目");
  const { result } = draft, state = result.intermediateState;
  if (!result.sourceFile?.name || !Number.isFinite(Date.parse(result.sourceFile.importedAt))) throw new Error("导入原文件名或时间缺失，请重新读取 STEP");
  if (state.schemaVersion !== 2 || !/^[a-f0-9]{64}$/.test(result.input.sha256) || state.source.inputSha256 !== result.input.sha256
    || state.source.parserVersion !== result.parserVersion || !/^[a-f0-9]{64}$/.test(state.geometryHash ?? "")) throw new Error("导入来源或中间态身份不一致");
  const reviewed = reviewCadImport(draft);
  const sourceIds = new Set(state.entities.map((e) => e.id));
  if (!reviewed.topology.members.length || reviewed.topology.members.some((m) => !m.sourceEntityIds.length || m.sourceEntityIds.some((id) => !sourceIds.has(id)))
    || reviewed.centerlines.some((line) => !sourceIds.has(line.solidId) || line.sourceEntityIds.some((id) => !sourceIds.has(id)))) throw new Error("导入杆件来源实体不完整");
  if (draft.approvedContactIds.some((id) => !reviewed.topology.contacts.some((c) => c.id === id))) throw new Error("接触确认引用已失效");
  // Revalidate the structured findings rather than trusting a stored status string.
  const verified = applyCadAiVerification(reviewed.review, reviewed.ai.response);
  verified.ai.origin = reviewed.ai.origin;
  if (!canApplyCadResourceReview(reviewed.review, reviewed.ai) || verified.ai.status !== "accepted") throw new Error("来源、资源、拓扑、刚接或在线 AI 核验尚未全部通过");
  return reviewed;
}

export async function prepareCadImport(project: FrameProject, draft: CadImportDraft): Promise<CadImportConfirmation> {
  requireApplicable(project, draft);
  const parentHash = await parentSnapshotHash(project);
  if (parentHash !== draft.parent.snapshotHash) throw new Error("草稿绑定的父快照已变化，请重新解析");
  return { schemaVersion: 1, id: crypto.randomUUID(), draftId: draft.id, draftHash: await hash(draft), parentHash,
    projectId: project.id, parentRevision: project.revision };
}

export async function applyCadImport(project: FrameProject, draft: CadImportDraft, confirmation: CadImportConfirmation): Promise<{ project: FrameProject; receipt: CadImportReceipt }> {
  const { topology, review } = requireApplicable(project, draft);
  if (confirmation.schemaVersion !== 1 || confirmation.projectId !== project.id || confirmation.parentRevision !== project.revision || confirmation.draftId !== draft.id
    || confirmation.draftHash !== await hash(draft) || confirmation.parentHash !== draft.parent.snapshotHash || confirmation.parentHash !== await parentSnapshotHash(project)) throw new Error("确认绑定的草稿或父快照已变化");
  const empty = createProject(project.name);
  let next: FrameProject = { ...empty, id: project.id, createdAt: project.createdAt, revision: project.revision,
    displayUnitPreset: project.displayUnitPreset, analysisResults: project.analysisResults, latestAnalysis: project.latestAnalysis,
    nextNodeNumber: project.nextNodeNumber, nextMemberNumber: project.nextMemberNumber, nextMaterialNumber: project.nextMaterialNumber, nextSectionNumber: project.nextSectionNumber };
  const material = review.material;
  next = addMaterial(next, { name: material.name!, elasticModulusGPa: material.elasticModulusGPa!, poissonRatio: material.poissonRatio!, densityKgM3: material.densityKgM3! });
  const materialId = next.materials[0].id, sectionIds = new Map<string, typeof next.sections[number]["id"]>();
  for (const section of review.sections) {
    next = addSection(next, { name: section.id, ...section.properties!, torsionalConstantM4: section.properties!.torsionalConstantM4! });
    for (const memberId of section.memberIds) sectionIds.set(memberId, next.sections.at(-1)!.id);
  }
  const nodeIds = new Map<string, typeof next.nodes[number]["id"]>();
  for (const node of topology.nodes) { next = addNode(next, node.position); nodeIds.set(node.id, next.nodes.at(-1)!.id); }
  const mappings: CadImportReceipt["mappings"] = [];
  for (const member of topology.members) {
    const profile = review.sections.flatMap((s) => s.memberProfiles ?? []).find((p) => p.memberId === member.id);
    const sectionId = sectionIds.get(member.id); if (!sectionId || !profile) throw new Error("导入截面或局部轴来源缺失");
    next = addMember(next, { startNodeId: nodeIds.get(member.startNodeId)!, endNodeId: nodeIds.get(member.endNodeId)!, materialId, sectionId, rotationDegrees: profile.rotationDegrees });
    mappings.push({ memberId: next.members.at(-1)!.id, draftMemberId: member.id, centerlineId: member.parentId, instanceId: member.instanceId, sourceEntityIds: member.sourceEntityIds, range: member.range });
  }
  const receipt: CadImportReceipt = { ...confirmation, inputSha256: draft.result.input.sha256, geometryHash: draft.result.intermediateState.geometryHash!,
    parserVersion: draft.result.parserVersion, appliedRevision: project.revision + 1, confirmedAt: new Date().toISOString(), rigidJointsConfirmed: true,
    pose: structuredClone(draft.pose), readiness: getCadImportReadiness(next), mappings, resourceEvidence: buildCadAiVerificationInput(review), ignoredEntities: draft.result.intermediateState.ignoredEntities,
    source: { ...draft.result.sourceFile!, sizeBytes: draft.result.input.sizeBytes, units: structuredClone(draft.result.intermediateState.units), counts: structuredClone(draft.result.diagnostics), kernel: structuredClone(draft.result.kernel), parameters: structuredClone(draft.result.audit?.parameters ?? {}) },
    decisions: { pose: structuredClone(draft.poseDecisions), approvedContactIds: [...draft.approvedContactIds], acceptedWarningCodes: [...draft.resources.acceptedWarningCodes] }, evidence: { file: "cad-draft.json", sha256: confirmation.draftHash } };
  next = { ...next, revision: receipt.appliedRevision, cadImports: [...(project.cadImports ?? []), receipt] };
  // Read the actual persisted objects back through the existing format decoder.
  const readback = decodeProject(encodeProject(next));
  if (readback.nodes.length !== topology.nodes.length || readback.members.length !== mappings.length || mappings.some((m) => !readback.members.some((v) => v.id === m.memberId))) throw new Error("正式对象回读核对失败");
  return { project: readback, receipt: readback.cadImports!.at(-1)! };
}
