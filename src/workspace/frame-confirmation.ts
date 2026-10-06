import { addMaterial, addMember, addNode, addSection, validateSection, type FrameProject, type MaterialId, type NodeId, type SectionId } from "../domain/project";
import { applyProjectTransaction } from "../domain/project-operations";
import { captureAiSnapshot, type AiContext, type AiToolResult } from "./ai-tools";
import { buildFramePreview, type FramePreview, type FrameProposal } from "./frame-proposal";
import { savedOperation, recordOperation, sameProjectInput } from "./task-persistence";

export interface FrameConfirmation {
  readonly requestId: string;
  readonly proposal: FrameProposal;
  readonly preview: FramePreview;
  readonly context: AiContext;
  readonly baseProject: FrameProject;
}

function freezeContent<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeContent);
    Object.freeze(value);
  }
  return value;
}

/** Captures the exact parameter content, preview objects and base reviewed by the user. */
export function prepareFrameConfirmation(project: FrameProject, proposal: FrameProposal): FrameConfirmation {
  const snapshot = captureAiSnapshot(project, []);
  const content = freezeContent(structuredClone(proposal));
  return Object.freeze({ requestId: `confirm_${crypto.randomUUID()}`, proposal: content,
    preview: freezeContent(structuredClone(buildFramePreview(snapshot, content))), context: snapshot.context, baseProject: project });
}

function applyPreview(project: FrameProject, preview: FramePreview): FrameProject {
  return applyProjectTransaction(project, (initial) => {
    let next = initial;
    const materials = new Map<MaterialId, MaterialId>();
    const sections = new Map<SectionId, SectionId>();
    const nodes = new Map<NodeId, NodeId>();
    for (const material of preview.materials) {
      next = addMaterial(next, { name: material.name, elasticModulusGPa: material.elasticModulusGPa,
        poissonRatio: material.poissonRatio, densityKgM3: material.densityKgM3 }, structuredClone(material.provenance));
      materials.set(material.id, next.materials.at(-1)!.id);
    }
    for (const section of preview.sections) {
      next = addSection(next, validateSection(section.label, section), structuredClone(section.provenance));
      sections.set(section.id, next.sections.at(-1)!.id);
    }
    for (const node of preview.nodes) {
      next = addNode(next, node.position);
      nodes.set(node.id, next.nodes.at(-1)!.id);
    }
    for (const member of preview.members) {
      next = addMember(next, { startNodeId: nodes.get(member.startNodeId)!, endNodeId: nodes.get(member.endNodeId)!,
        materialId: materials.get(member.materialId)!, sectionId: sections.get(member.sectionId)!, rotationDegrees: member.rotationDegrees });
    }
    return next;
  });
}

/** One session's confirmation receipts; retries never create another edit, including after undo. */
export class FrameStageConfirmation {
  private applied = new Map<string, AiToolResult>();

  confirm(project: FrameProject, confirmation: FrameConfirmation): { project: FrameProject; result: AiToolResult } {
    const key = `${confirmation.context.projectId}:${confirmation.proposal.id}:${confirmation.proposal.version}`;
    const context = captureAiSnapshot(project, []).context;
    const failed = (message: string) => ({ project, result: { status: "failed" as const, message, context } });
    if (project.id !== confirmation.context.projectId) return failed("项目已切换，请重新生成并确认方案");
    const receipt = savedOperation(project, key) ?? this.applied.get(key);
    if (receipt) return { project, result: { ...receipt, message: "该阶段已确认过，本次未重复应用" } };
    if (!sameProjectInput(project, confirmation.baseProject) || project.revision !== confirmation.context.modelRevision) {
      return failed("正式模型已变化，请重新生成预览并再次确认");
    }
    if (confirmation.preview.status !== "awaiting-confirmation") return failed("方案尚不完整，请补齐或澄清参数后确认");
    try {
      const next = applyPreview(project, confirmation.preview);
      const result: AiToolResult = { status: "applied", message: "建模阶段已应用，可整组撤销和重做", context: captureAiSnapshot(next, []).context,
        data: { requestId: confirmation.requestId, proposalId: confirmation.proposal.id, proposalVersion: confirmation.proposal.version,
          baseRevision: project.revision, appliedRevision: next.revision,
          objects: { nodes: next.nodes.slice(project.nodes.length), members: next.members.slice(project.members.length),
            materials: next.materials.slice(project.materials.length), sections: next.sections.slice(project.sections.length) } } };
      this.applied.set(key, result);
      return { project: recordOperation(next, key, result), result };
    } catch (error) {
      return failed(error instanceof Error ? error.message : "阶段应用失败，正式模型保持原状");
    }
  }
}
