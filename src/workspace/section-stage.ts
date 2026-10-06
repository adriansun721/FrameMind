import { addSection, updateMember, validateSection, type FrameProject, type FrameSection, type SectionId, type SectionInput } from "../domain/project";
import { applyProjectTransaction } from "../domain/project-operations";
import { SECTION_CATALOG } from "../domain/resource-library";
import { captureAiSnapshot, type AiObjectRef, type AiSnapshot, type AiToolResult } from "./ai-tools";
import type { FramePreview } from "./frame-proposal";
import { savedOperation, recordOperation, sameProjectInput } from "./task-persistence";

export const SECTION_PARAMETERS = { areaM2: "A (m²)", secondMomentYM4: "Iy (m⁴)", secondMomentZM4: "Iz (m⁴)", torsionalConstantM4: "J (m⁴)" } as const;
export interface SectionChangeProposal {
  id: string;
  version: number;
  memberIds: string[];
  section: FrameSection;
  source: "user" | "suggestion";
}

export function selectedColumns(snapshot: AiSnapshot): string[] {
  const selection = snapshot.context.selection;
  if (!selection.length) throw new Error("请先选择需要修改的柱，不会自动扩展到全结构");
  if (selection.some((ref) => ref.kind !== "member" || !ref.exists)) throw new Error("选中引用已失效或包含节点，请重新仅选择柱杆件");
  for (const ref of selection) {
    const member = snapshot.model.members.find((m) => m.id === ref.id)!;
    const a = snapshot.model.nodes.find((n) => n.id === member.startNodeId)?.position;
    const b = snapshot.model.nodes.find((n) => n.id === member.endNodeId)?.position;
    if (!a || !b || Math.abs(a.x - b.x) > 1e-9 || Math.abs(a.y - b.y) > 1e-9 || Math.abs(a.z - b.z) <= 1e-9) {
      throw new Error(`${ref.label} 不是全局 Z 向柱，请明确选择柱，或手动修改该杆件截面`);
    }
  }
  return [...new Set(selection.map((ref) => ref.id))];
}

/** The target set comes exclusively from the captured selection, never from AI guesses. */
export function proposeSectionChange(snapshot: AiSnapshot, input: Record<string, unknown>, previous?: SectionChangeProposal): SectionChangeProposal {
  const allowed = ["memberIds", "sectionId", "section", "source"];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error("截面方案含未定义字段");
  const memberIds = selectedColumns(snapshot);
  if (input.memberIds !== undefined && (!Array.isArray(input.memberIds) || input.memberIds.length !== memberIds.length
    || new Set(input.memberIds).size !== memberIds.length || input.memberIds.some((id) => !memberIds.includes(id)))) throw new Error("工具对象必须与当前选中的柱完全一致，请重新读取选择");
  if (input.source !== "user" && input.source !== "suggestion") throw new Error("截面参数必须标明用户提供或建议");
  if ((input.sectionId === undefined) === (input.section === undefined)) throw new Error("请选择已有截面或提供一份新截面参数");
  let section: FrameSection;
  if (input.sectionId !== undefined) {
    if (typeof input.sectionId !== "string") throw new Error("截面身份无效");
    const existing = snapshot.model.sections.find((item) => item.id === input.sectionId);
    const catalog = SECTION_CATALOG.find((item) => item.catalogId === input.sectionId);
    if (!existing && !catalog) throw new Error("截面资源已不存在，请重新选择");
    section = existing ? structuredClone(existing) : { ...catalog!, id: `preview_section:${catalog!.catalogId}` as SectionId,
      label: "待确认库截面", provenance: { kind: "catalog", catalogId: catalog!.catalogId, source: structuredClone(catalog!.source) } };
  } else {
    if (!input.section || typeof input.section !== "object" || Array.isArray(input.section)) throw new Error("新截面必须包含名称和 A/Iy/Iz/J 参数");
    const raw = input.section as Record<string, unknown>;
    if (Object.keys(raw).some((key) => !["name", "geometry", ...Object.keys(SECTION_PARAMETERS)].includes(key)) || typeof raw.name !== "string"
      || raw.geometry === undefined && Object.keys(SECTION_PARAMETERS).some((key) => typeof raw[key] !== "number")) throw new Error("新截面参数格式无效");
    section = { ...validateSection("待确认截面", raw as unknown as SectionInput), id: "preview_section:custom" as SectionId,
      label: "待确认自定义截面", provenance: { kind: "custom" } };
  }
  return { id: previous?.id ?? `section_change_${crypto.randomUUID()}`, version: (previous?.version ?? 0) + 1, memberIds, section, source: input.source };
}

export function buildSectionPreview(snapshot: Pick<AiSnapshot, "model">, proposal: SectionChangeProposal): FramePreview {
  const members = snapshot.model.members.filter((member) => proposal.memberIds.includes(member.id)).map((member) => ({ ...member, sectionId: proposal.section.id, role: "column" as const }));
  const nodeIds = new Set(members.flatMap((member) => [member.startNodeId, member.endNodeId]));
  return { status: "awaiting-confirmation", issues: [], members, nodes: structuredClone(snapshot.model.nodes.filter((node) => nodeIds.has(node.id))),
    materials: snapshot.model.materials.map((material) => structuredClone(material)), sections: [structuredClone(proposal.section)], sectionChange: true };
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export function prepareSectionConfirmation(project: FrameProject, selection: readonly AiObjectRef[], proposal: SectionChangeProposal) {
  return Object.freeze({ requestId: `confirm_${crypto.randomUUID()}`, baseProject: project, selection: freeze(structuredClone(selection)),
    proposal: freeze(structuredClone(proposal)), preview: freeze(buildSectionPreview({ model: project }, proposal)) });
}
export type SectionConfirmation = ReturnType<typeof prepareSectionConfirmation>;

export class SectionStageConfirmation {
  private applied = new Map<string, AiToolResult>();
  confirm(project: FrameProject, selection: readonly AiObjectRef[], confirmation: SectionConfirmation): { project: FrameProject; result: AiToolResult } {
    const snapshot = captureAiSnapshot(project, selection);
    const context = snapshot.context;
    const failed = (message: string) => ({ project, result: { status: "failed" as const, message, context } });
    if (project.id !== confirmation.baseProject.id) return failed("项目已切换，请重新准备截面方案");
    const key = `${project.id}:${confirmation.proposal.id}:${confirmation.proposal.version}`;
    const receipt = savedOperation(project, key) ?? this.applied.get(key);
    if (receipt) return { project, result: { ...receipt, message: "该截面阶段已确认过，本次未重复应用" } };
    if (!sameProjectInput(project, confirmation.baseProject)) return failed("正式模型已变化，请重新生成截面预览");
    if (selection.length !== confirmation.selection.length || selection.some((ref) => !confirmation.selection.some((item) => item.kind === ref.kind && item.id === ref.id))) return failed("选中对象已变化，请重新生成截面预览");
    try {
      const targets = selectedColumns(snapshot);
      if (targets.length !== confirmation.proposal.memberIds.length || confirmation.proposal.memberIds.some((id) => !targets.includes(id))) return failed("截面方案对象与选中柱不一致");
      validateSection("待确认截面", confirmation.proposal.section);
      const next = applyProjectTransaction(project, (initial) => {
        let current = initial;
        let sectionId = confirmation.proposal.section.id;
        if (!initial.sections.some((item) => item.id === sectionId)) {
          current = addSection(current, validateSection("待确认截面", confirmation.proposal.section), structuredClone(confirmation.proposal.section.provenance));
          sectionId = current.sections.at(-1)!.id;
        }
        for (const id of confirmation.proposal.memberIds) {
          const member = current.members.find((item) => item.id === id);
          if (!member) throw new Error(`柱 ${id} 已不存在`);
          current = updateMember(current, member.id, { ...member, sectionId });
        }
        return current;
      });
      const result: AiToolResult = { status: "applied", message: "截面修改阶段已应用，可整组撤销和重做", context: { ...context, modelRevision: next.revision },
        data: { requestId: confirmation.requestId, memberIds: confirmation.proposal.memberIds, section: confirmation.proposal.section, baseRevision: project.revision, appliedRevision: next.revision } };
      this.applied.set(key, result); return { project: recordOperation(next, key, result), result };
    } catch (error) { return failed(error instanceof Error ? error.message : "截面修改失败，正式模型保留"); }
  }
}
