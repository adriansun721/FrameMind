import { addMaterial, addMember, addNode, addSection, addNodalLoad, addSupport, updateNodalLoad, updateSupport, selectAnalysisSource, type FrameProject, type MemberId, type NodeId, type SectionId, type MaterialId } from "../domain/project";
import { applyLoadStage, type LoadStage } from "./load-stage";
import type { NodalLoadProposal, SupportProposal } from "./analysis-conditions";
import { applyProjectTransaction, applyProjectEdits, type ProjectEditReceipt } from "../domain/project-operations";
import { captureAiSnapshot, type AiToolResult } from "./ai-tools";
import { buildTaskDraftPreview, taskEditOperations, taskObjectId, taskEngineeringPreview, type TaskDraft } from "./task-draft";
import { readModelEditObjects, type ModelEditReadback } from "./model-edits";
import { savedOperation, recordOperation, sameProjectInput } from "./task-persistence";

export interface TaskDraftConfirmation {
  readonly requestId: string;
  readonly draft: TaskDraft;
  readonly baseProject: FrameProject;
  readonly context: ReturnType<typeof captureAiSnapshot>["context"];
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export function prepareTaskDraftConfirmation(project: FrameProject, draft: TaskDraft): TaskDraftConfirmation {
  const context = captureAiSnapshot(project, []).context;
  return Object.freeze({ requestId: `confirm_${crypto.randomUUID()}`, draft: freeze(structuredClone(draft)), baseProject: project, context });
}

interface TaskAppliedObjects {
  nodes: string[];
  members: string[];
  materials: string[];
  sections: string[];
  supports: string[];
  nodalLoads: string[];
  uniformLoads: string[];
  loadCases: string[];
  loadCombinations: string[];
}

interface TaskApplicationVerification {
  edits?: ProjectEditReceipt;
  readback?: ModelEditReadback;
  status: "verified";
  objects: TaskAppliedObjects;
}

interface TaskApplication {
  project: FrameProject;
  mapping: Record<string, string>;
  references: Record<string, string>;
  verification: TaskApplicationVerification;
}

function same(value: unknown, expected: unknown): boolean {
  return JSON.stringify(value) === JSON.stringify(expected);
}

function verifyTaskApplication(project: FrameProject, next: FrameProject, draft: TaskDraft, preview: ReturnType<typeof buildTaskDraftPreview>, mapping: Record<string, string>, references: Record<string, string>): TaskApplicationVerification {
  const reviewed = taskEngineeringPreview(captureAiSnapshot(project, []), draft).project;
  const objects: TaskAppliedObjects = { nodes: [], members: [], materials: [], sections: [], supports: [], nodalLoads: [], uniformLoads: [], loadCases: [], loadCombinations: [] };
  const formal = (id: string) => mapping[id] ?? id;
  const draftRef = (id: string) => taskObjectId(draft, id, mapping);
  const sourceRef = (id: string) => references[id] ?? id;
  const requireObject = <T extends { id: string }>(items: readonly T[], id: string, label: string): T => {
    const item = items.find((value) => value.id === id);
    if (!item) throw new Error(`应用后核验失败：${label} ${id} 不存在`);
    return item;
  };
  const newlyCreated = <T extends { id: string }>(items: readonly T[], before: readonly T[]) => items.filter((item) => !before.some((previous) => previous.id === item.id));
  const addObject = (collection: keyof TaskAppliedObjects, id: string) => { objects[collection].push(id); };
  const usedSupportIds = new Set<string>();
  const usedNodalLoadIds = new Set<string>();
  const usedUniformLoadIds = new Set<string>();

  for (const node of preview.frame?.nodes ?? []) {
    const id = formal(node.id); const expected = reviewed.nodes.find((n) => n.id === node.id);
    if (!expected) { if (next.nodes.some((n) => n.id === id)) throw new Error("应用后删除节点核验失败"); continue; }
    const actual = requireObject(next.nodes, id, "节点");
    if (!same(actual.position, expected.position) || actual.additionalMassKg !== expected.additionalMassKg) throw new Error(`应用后核验失败：节点 ${id} 坐标或质量不一致`);
    addObject("nodes", id);
  }
  for (const original of preview.frame?.materials ?? []) {
    const material = reviewed.materials.find((item) => item.id === original.id);
    if (!material) { if (next.materials.some((item) => item.id === formal(original.id))) throw new Error("应用后删除材料核验失败"); continue; }
    const id = formal(material.id); const actual = requireObject(next.materials, id, "材料");
    if (!same({ name: actual.name, elasticModulusGPa: actual.elasticModulusGPa, poissonRatio: actual.poissonRatio, densityKgM3: actual.densityKgM3, provenance: actual.provenance },
      { name: material.name, elasticModulusGPa: material.elasticModulusGPa, poissonRatio: material.poissonRatio, densityKgM3: material.densityKgM3, provenance: material.provenance })) throw new Error(`应用后核验失败：材料 ${id} 参数不一致`);
    addObject("materials", id);
  }
  for (const original of preview.frame?.sections ?? []) {
    const section = reviewed.sections.find((item) => item.id === original.id);
    if (!section) { if (next.sections.some((item) => item.id === formal(original.id))) throw new Error("应用后删除截面核验失败"); continue; }
    const id = formal(section.id); const actual = requireObject(next.sections, id, "截面");
    if (!same({ name: actual.name, areaM2: actual.areaM2, secondMomentYM4: actual.secondMomentYM4, secondMomentZM4: actual.secondMomentZM4, torsionalConstantM4: actual.torsionalConstantM4, ...(actual.geometry ? { geometry: actual.geometry, parameterBasis: actual.parameterBasis, ...(actual.catalogBasis ? { catalogBasis: actual.catalogBasis } : {}) } : {}), provenance: actual.provenance },
      { name: section.name, areaM2: section.areaM2, secondMomentYM4: section.secondMomentYM4, secondMomentZM4: section.secondMomentZM4, torsionalConstantM4: section.torsionalConstantM4, ...(section.geometry ? { geometry: section.geometry, parameterBasis: section.parameterBasis, ...(section.catalogBasis ? { catalogBasis: section.catalogBasis } : {}) } : {}), provenance: section.provenance })) throw new Error(`应用后核验失败：截面 ${id} 参数不一致`);
    addObject("sections", id);
  }
  for (const member of preview.frame?.members ?? []) {
    const reviewedMember = reviewed.members.find((m) => m.id === member.id);
    if (!reviewedMember) { if (next.members.some((m) => m.id === formal(member.id))) throw new Error("应用后删除杆件核验失败"); continue; }
    const id = formal(member.id); const actual = requireObject(next.members, id, "杆件");
    const expected = { startNodeId: formal(reviewedMember.startNodeId), endNodeId: formal(reviewedMember.endNodeId), materialId: formal(reviewedMember.materialId), sectionId: formal(reviewedMember.sectionId), rotationDegrees: reviewedMember.rotationDegrees };
    if (!same({ startNodeId: actual.startNodeId, endNodeId: actual.endNodeId, materialId: actual.materialId, sectionId: actual.sectionId, rotationDegrees: actual.rotationDegrees }, expected)) throw new Error(`应用后核验失败：杆件 ${id} 引用不一致`);
    if (!same(actual.endReleases, reviewedMember.endReleases) || actual.additionalLineMassKgM !== reviewedMember.additionalLineMassKgM) throw new Error(`应用后核验失败：杆件 ${id} 释放或质量不一致`);
    addObject("members", id);
  }

  const conditions = draft.conditions;
  const findSupport = (item: SupportProposal) => {
    const nodeId = draftRef(item.nodeId);
    return item.id ? requireObject(next.supports, item.id, "支座") : newlyCreated(next.supports, project.supports).find((support) => !usedSupportIds.has(support.id) && support.nodeId === nodeId && same(support.restraints, item.restraints));
  };
  for (const item of conditions?.supports ?? []) {
    const actual = findSupport(item);
    if (!actual || actual.nodeId !== draftRef(item.nodeId) || !same(actual.restraints, item.restraints)) throw new Error(`应用后核验失败：支座 ${item.id ?? item.nodeId} 不一致`);
    usedSupportIds.add(actual.id);
    addObject("supports", actual.id);
  }
  const findNodalLoad = (item: NodalLoadProposal) => {
    const nodeId = draftRef(item.nodeId); const loadCaseId = sourceRef(item.loadCaseId);
    return item.id ? requireObject(next.nodalLoads, item.id, "节点荷载") : newlyCreated(next.nodalLoads, project.nodalLoads).find((load) => !usedNodalLoadIds.has(load.id) && load.nodeId === nodeId && load.loadCaseId === loadCaseId && same(load.force, item.force) && same(load.moment, item.moment));
  };
  for (const item of conditions?.nodalLoads ?? []) {
    const actual = findNodalLoad(item);
    if (!actual || actual.nodeId !== draftRef(item.nodeId) || actual.loadCaseId !== sourceRef(item.loadCaseId) || !same(actual.force, item.force) || !same(actual.moment, item.moment)) throw new Error(`应用后核验失败：节点荷载 ${item.id ?? item.nodeId} 不一致`);
    usedNodalLoadIds.add(actual.id);
    addObject("nodalLoads", actual.id);
  }
  for (const item of conditions?.uniformLoads ?? []) {
    const memberId = draftRef(item.memberId); const loadCaseId = sourceRef(item.loadCaseId);
    const actual = item.id ? requireObject(next.uniformLoads, item.id, "均布荷载") : newlyCreated(next.uniformLoads, project.uniformLoads).find((load) => !usedUniformLoadIds.has(load.id) && load.memberId === memberId && load.loadCaseId === loadCaseId && load.coordinateSystem === item.coordinateSystem && same(load.intensity, item.intensity));
    if (!actual || actual.memberId !== memberId || actual.loadCaseId !== loadCaseId || actual.coordinateSystem !== item.coordinateSystem || !same(actual.intensity, item.intensity)) throw new Error(`应用后核验失败：均布荷载 ${item.id ?? item.memberId} 不一致`);
    usedUniformLoadIds.add(actual.id);
    addObject("uniformLoads", actual.id);
  }
  if (conditions?.selfWeight) {
    const expected = { enabled: conditions.selfWeight.enabled, loadCaseId: sourceRef(conditions.selfWeight.loadCaseId), gravity: conditions.selfWeight.gravity };
    if (!same(next.selfWeight, expected)) throw new Error("应用后核验失败：结构自重不一致");
  }
  for (const item of conditions?.loadCases ?? []) {
    const id = item.id ?? sourceRef(item.ref); const actual = requireObject(next.loadCases, id, "工况");
    if (!same({ name: actual.name, description: actual.description }, { name: item.name.trim(), description: item.description.trim() })) throw new Error(`应用后核验失败：工况 ${id} 不一致`);
    addObject("loadCases", id);
  }
  for (const item of conditions?.loadCombinations ?? []) {
    const id = item.id ?? sourceRef(item.ref); const actual = requireObject(next.loadCombinations, id, "组合");
    const expected = { name: item.name.trim(), terms: item.terms.map((term) => ({ loadCaseId: sourceRef(term.loadCaseId), factor: term.factor })) };
    if (!same({ name: actual.name, terms: actual.terms }, expected)) throw new Error(`应用后核验失败：组合 ${id} 不一致`);
    addObject("loadCombinations", id);
  }
  return { status: "verified", objects };
}

function applyTask(project: FrameProject, draft: TaskDraft): TaskApplication {
  const preview = buildTaskDraftPreview(captureAiSnapshot(project, []), draft);
  if (preview.status !== "awaiting-confirmation") throw new Error(preview.issues.concat(preview.missing.map((item) => item.reason)).join("；") || "完整任务草案尚未补齐");
  const mapping: Record<string, string> = {};
  let references: Record<string, string> = {};
  let appliedEdits: ProjectEditReceipt | undefined;
  const next = applyProjectTransaction(project, (initial) => {
    let current = initial;
    const materials = new Map<string, MaterialId>();
    const sections = new Map<string, SectionId>();
    const nodes = new Map<string, NodeId>();
    const members = new Map<string, MemberId>();
    for (const material of preview.frame?.materials ?? []) {
      current = addMaterial(current, { name: material.name, elasticModulusGPa: material.elasticModulusGPa, poissonRatio: material.poissonRatio, densityKgM3: material.densityKgM3 }, structuredClone(material.provenance));
      const id = current.materials.at(-1)!.id; materials.set(material.id, id); mapping[material.id] = id;
    }
    for (const section of preview.frame?.sections ?? []) {
      current = addSection(current, { name: section.name, areaM2: section.areaM2, secondMomentYM4: section.secondMomentYM4, secondMomentZM4: section.secondMomentZM4, torsionalConstantM4: section.torsionalConstantM4, ...(section.geometry ? { geometry: section.geometry } : {}), ...(section.catalogBasis ? { catalogBasis: section.catalogBasis } : {}) }, structuredClone(section.provenance));
      const id = current.sections.at(-1)!.id; sections.set(section.id, id); mapping[section.id] = id;
    }
    for (const node of preview.frame?.nodes ?? []) {
      current = addNode(current, node.position);
      const id = current.nodes.at(-1)!.id; nodes.set(node.id, id); mapping[node.id] = id;
    }
    for (const member of preview.frame?.members ?? []) {
      const startNodeId = nodes.get(member.startNodeId) ?? member.startNodeId as NodeId;
      const endNodeId = nodes.get(member.endNodeId) ?? member.endNodeId as NodeId;
      const materialId = materials.get(member.materialId) ?? member.materialId as MaterialId;
      const sectionId = sections.get(member.sectionId) ?? member.sectionId as SectionId;
      current = addMember(current, { startNodeId, endNodeId, materialId, sectionId, rotationDegrees: member.rotationDegrees });
      const id = current.members.at(-1)!.id; members.set(member.id, id); mapping[member.id] = id;
    }
    if (draft.edits) {
      const edited = applyProjectEdits(current, taskEditOperations(draft, mapping));
      current = edited.project; appliedEdits = edited.receipt;
    }
    const proposed = draft.conditions;
    if (proposed) {
      const mapNode = (id: string) => taskObjectId(draft, id, mapping) as NodeId;
      const mapMember = (id: string) => taskObjectId(draft, id, mapping) as MemberId;
      const stage: LoadStage = {
        uniformLoads: proposed.uniformLoads?.map((item) => ({ ...item, memberId: mapMember(item.memberId) })),
        selfWeight: proposed.selfWeight,
        loadCases: proposed.loadCases,
        loadCombinations: proposed.loadCombinations,
      };
      const applied = applyLoadStage(current, stage);
      current = applied.project;
      references = applied.references;
      const resolveCase = (id: string) => applied.references[id] ?? id;
      for (const item of proposed.supports ?? []) {
        const nodeId = mapNode(item.nodeId);
        current = item.id ? updateSupport(current, item.id, nodeId, item.restraints) : addSupport(current, nodeId, item.restraints);
      }
      for (const item of proposed.nodalLoads ?? []) {
        const nodeId = mapNode(item.nodeId);
        const loadCaseId = resolveCase(item.loadCaseId);
        current = item.id ? updateNodalLoad(current, item.id, nodeId, item.force, item.moment, loadCaseId) : addNodalLoad(current, nodeId, item.force, item.moment, loadCaseId);
      }
      const sourceId = draft.analysis?.sourceId ?? proposed.analysisSourceId;
      if (sourceId) {
        const resolved = resolveCase(sourceId);
        current = selectAnalysisSource(current, resolved);
      }
    }
    if (draft.analysis?.sourceId && !draft.conditions) current = selectAnalysisSource(current, draft.analysis.sourceId);
    return current;
  });
  if (appliedEdits && preview.edits) {
    const reviewed = (receipt: ProjectEditReceipt) => ({ changes: receipt.changes, created: receipt.created, affectedMemberIds: receipt.affectedMemberIds });
    const normalize = (value: unknown, key = ""): unknown => {
      if (typeof value === "string") return /(?:^id$|Id$|Ids$)/.test(key) ? mapping[value] ?? value : value;
      if (Array.isArray(value)) return value.map((child) => normalize(child, key));
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([field]) => field !== "label").sort(([a], [b]) => a.localeCompare(b)).map(([field, child]) => [field, normalize(child, field)]));
      return value;
    };
    if (!same(normalize(reviewed(preview.edits)), normalize(reviewed(appliedEdits)))) throw new Error("应用后工程操作与已核对差异不一致，正式模型保留");
  }
  return { project: next, mapping, references, verification: { ...verifyTaskApplication(project, next, draft, preview, mapping, references), edits: appliedEdits ? { ...appliedEdits, baseRevision: project.revision, appliedRevision: next.revision } : undefined, readback: appliedEdits ? readModelEditObjects(next, appliedEdits) : undefined } };
}

export class TaskDraftStageConfirmation {
  private applied = new Map<string, AiToolResult>();
  private latestVersion = new Map<string, number>();

  confirm(project: FrameProject, confirmation: TaskDraftConfirmation): { project: FrameProject; result: AiToolResult } {
    const context = captureAiSnapshot(project, []).context;
    const failed = (message: string) => ({ project, result: { status: "failed" as const, message, context } });
    if (project.id !== confirmation.context.projectId) return failed("项目已切换，请重新准备完整任务草案");
    if (confirmation.draft.projectId !== confirmation.context.projectId || confirmation.draft.baseRevision !== confirmation.context.modelRevision) return failed("任务草案身份或基础修订不一致，请重新生成");
    const taskKey = `${confirmation.context.projectId}:${confirmation.draft.id}`;
    const latest = this.latestVersion.get(taskKey);
    if (latest !== undefined && confirmation.draft.version < latest) return failed("任务草案版本已过期，请使用最新修订");
    const key = `${taskKey}:${confirmation.draft.version}`;
    const previous = savedOperation(project, key) ?? this.applied.get(key);
    if (previous) return { project, result: { ...previous, message: "该完整任务已确认过，本次仅返回幂等回执，未重复应用，也未恢复模型" } };
    if (!sameProjectInput(project, confirmation.baseProject) || project.revision !== confirmation.context.modelRevision) return failed("正式模型已变化，请重新生成完整任务草案");
    try {
      const outcome = applyTask(project, confirmation.draft);
      const requestedSource = confirmation.draft.analysis?.sourceId ?? confirmation.draft.conditions?.analysisSourceId;
      const result: AiToolResult = { status: "applied", message: "完整任务已原子应用并完成对象核验，可整组撤销和重做", context: captureAiSnapshot(outcome.project, []).context,
        data: { requestId: confirmation.requestId, taskId: confirmation.draft.id, taskVersion: confirmation.draft.version, baseRevision: project.revision, appliedRevision: outcome.project.revision, mapping: outcome.mapping,
          references: outcome.references, verification: outcome.verification, analysis: { requested: confirmation.draft.analysis?.requested ?? false,
            ...(requestedSource ? { sourceId: outcome.references[requestedSource] ?? requestedSource } : {}) },
          objects: outcome.verification.objects } };
      this.applied.set(key, result);
      this.latestVersion.set(taskKey, confirmation.draft.version);
      return { project: recordOperation(outcome.project, key, result), result };
    } catch (error) { return failed(error instanceof Error ? error.message : "完整任务应用失败，正式模型保持原状"); }
  }
}
