import { addMaterial, addMember, addNode, addSection, addNodalLoad, addSupport, updateNodalLoad, updateSupport, selectLoadCase, selectLoadCombination, type FrameProject, type MemberId, type NodeId, type SectionId, type MaterialId } from "../domain/project";
import { applyLoadStage, type LoadStage } from "./load-stage";
import { applyProjectTransaction } from "../domain/project-operations";
import { captureAiSnapshot, type AiToolResult } from "./ai-tools";
import { buildTaskDraftPreview, type TaskDraft } from "./task-draft";

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

function applyTask(project: FrameProject, draft: TaskDraft): { project: FrameProject; mapping: Record<string, string> } {
  const preview = buildTaskDraftPreview(captureAiSnapshot(project, []), draft);
  if (preview.status !== "awaiting-confirmation") throw new Error(preview.issues.concat(preview.missing.map((item) => item.reason)).join("；") || "完整任务草案尚未补齐");
  const mapping: Record<string, string> = {};
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
      current = addSection(current, { name: section.name, areaM2: section.areaM2, secondMomentYM4: section.secondMomentYM4, secondMomentZM4: section.secondMomentZM4, torsionalConstantM4: section.torsionalConstantM4 }, structuredClone(section.provenance));
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
    const proposed = draft.conditions;
    if (proposed) {
      const normalize = (id: string) => id.startsWith("draft:") ? id.slice("draft:".length) : id;
      const mapNode = (id: string) => nodes.get(normalize(id)) ?? id as NodeId;
      const mapMember = (id: string) => members.get(normalize(id)) ?? id as MemberId;
      const stage: LoadStage = {
        uniformLoads: proposed.uniformLoads?.map((item) => ({ ...item, memberId: mapMember(item.memberId) })),
        selfWeight: proposed.selfWeight,
        loadCases: proposed.loadCases,
        loadCombinations: proposed.loadCombinations,
      };
      const applied = applyLoadStage(current, stage);
      current = applied.project;
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
        current = current.loadCases.some((item) => item.id === resolved) ? selectLoadCase(current, resolved) : selectLoadCombination(current, resolved);
      }
    }
    return current;
  });
  return { project: next, mapping };
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
    const previous = this.applied.get(key);
    if (previous) return { project, result: { ...previous, message: "该完整任务已确认过，本次未重复应用" } };
    if (project !== confirmation.baseProject || project.revision !== confirmation.context.modelRevision) return failed("正式模型已变化，请重新生成完整任务草案");
    try {
      const outcome = applyTask(project, confirmation.draft);
      const result: AiToolResult = { status: "applied", message: "完整任务已原子应用，可整组撤销和重做", context: captureAiSnapshot(outcome.project, []).context,
        data: { requestId: confirmation.requestId, taskId: confirmation.draft.id, taskVersion: confirmation.draft.version, baseRevision: project.revision, appliedRevision: outcome.project.revision, mapping: outcome.mapping,
          objects: { nodes: outcome.project.nodes.slice(project.nodes.length), members: outcome.project.members.slice(project.members.length), supports: outcome.project.supports, nodalLoads: outcome.project.nodalLoads } } };
      this.applied.set(key, result);
      this.latestVersion.set(taskKey, confirmation.draft.version);
      return { project: outcome.project, result };
    } catch (error) { return failed(error instanceof Error ? error.message : "完整任务应用失败，正式模型保持原状"); }
  }
}
