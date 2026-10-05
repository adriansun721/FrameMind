import type { FrameProject } from "../domain/project";
import { captureAiSnapshot, type AiObjectRef } from "./ai-tools";
import { conditionsIssues, type ConditionsProposal } from "./analysis-conditions";
import { buildFramePreview, type FrameProposal } from "./frame-proposal";
import { proposeModelEdits, type ModelEditProposal } from "./model-edits";
import { selectedColumns, type SectionChangeProposal } from "./section-stage";
import { buildTaskDraftPreview, type TaskDraft } from "./task-draft";

export interface DraftCoordination<T> { draft: T; conflicts: string[]; }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function engineeringContent(project: FrameProject): unknown[] {
  return [project.id, ...(["units", "nodes", "members", "materials", "sections", "supports", "nodalLoads", "uniformLoads", "selfWeight", "loadCases", "loadCombinations", "analysisCases"] as const).map((key) => project[key])];
}
export function sameEngineeringState(base: FrameProject, current: FrameProject): boolean {
  return base.revision === current.revision && same(engineeringContent(base), engineeringContent(current));
}
const newIssues = (before: readonly string[], after: readonly string[]) => after.filter((issue) => !before.includes(issue));

// A three-way merge preserves manual changes to fields the draft did not change.
function merge<T>(before: unknown, proposed: T, current: unknown, path: string, conflicts: string[]): T {
  if (same(before, proposed)) return structuredClone(current) as T;
  if (same(before, current) || same(proposed, current)) return structuredClone(proposed);
  if (Array.isArray(before) && Array.isArray(proposed) && Array.isArray(current) && before.length === proposed.length && before.length === current.length) {
    return proposed.map((value, index) => merge(before[index], value, current[index], `${path}[${index}]`, conflicts)) as T;
  }
  if (before && proposed && current && typeof before === "object" && typeof proposed === "object" && typeof current === "object"
    && !Array.isArray(before) && !Array.isArray(proposed) && !Array.isArray(current)) {
    const original = before as Record<string, unknown>;
    const latest = current as Record<string, unknown>;
    return Object.fromEntries(Object.entries(proposed).map(([key, value]) => [key, merge(original[key], value, latest[key], `${path}.${key}`, conflicts)])) as T;
  }
  conflicts.push(`${path}：人工编辑 ${JSON.stringify(before)} → ${JSON.stringify(current)}，草案要求 ${JSON.stringify(proposed)}`);
  return proposed;
}

export function targetConflicts(project: FrameProject, targets: readonly AiObjectRef[]): string[] {
  return targets.filter((target) => !(target.kind === "node" ? project.nodes : project.members).some((item) => item.id === target.id))
    .map((target) => `${target.kind} ${target.id}：任务目标已删除，请明确新的目标`);
}

export function conditionTargets(base: FrameProject, draft: ConditionsProposal | undefined): AiObjectRef[] {
  const targets: AiObjectRef[] = [
    ...(draft?.supports ?? []).map((item) => ({ kind: "node" as const, id: item.nodeId })),
    ...(draft?.nodalLoads ?? []).map((item) => ({ kind: "node" as const, id: item.nodeId })),
    ...(draft?.uniformLoads ?? []).map((item) => ({ kind: "member" as const, id: item.memberId })),
  ];
  return targets.filter((target) => (target.kind === "node" ? base.nodes : base.members).some((item) => item.id === target.id));
}

export function engineeringDraftTargets(base: FrameProject, drafts: {
  taskDraft?: TaskDraft | null;
  modelEdits?: ModelEditProposal | null;
  sectionChange?: SectionChangeProposal | null;
  conditions?: ConditionsProposal | null;
  proposal?: FrameProposal | null;
}, fallback: readonly AiObjectRef[]): readonly AiObjectRef[] {
  if (!Object.values(drafts).some(Boolean)) return fallback;
  return [
    ...conditionTargets(base, drafts.taskDraft?.conditions),
    ...conditionTargets(base, drafts.conditions ?? undefined),
    ...(drafts.sectionChange?.memberIds ?? []).map((id) => ({ kind: "member" as const, id })),
    ...(drafts.modelEdits?.operations ?? []).flatMap((item) => item.type === "merge_nodes"
      ? item.nodeIds.map((id) => ({ kind: "node" as const, id })) : "memberIds" in item
      ? [...item.memberIds.map((id) => ({ kind: "member" as const, id })), ...(item.nodeId ? [{ kind: "node" as const, id: item.nodeId }] : [])]
      : "id" in item && !item.type.endsWith("analysis_case")
      ? [{ kind: item.type.endsWith("node") ? "node" as const : "member" as const, id: item.id }] : []),
  ];
}

export function coordinateConditions(base: FrameProject, current: FrameProject, draft: ConditionsProposal): DraftCoordination<ConditionsProposal> {
  const conflicts: string[] = [];
  const next = structuredClone(draft);
  const rebase = <T extends { id?: string }>(entries: T[] | undefined, before: readonly { id: string }[], latest: readonly { id: string }[], label: string): T[] | undefined => entries?.map((entry) => {
    if (!entry.id) return entry;
    const original = before.find((item) => item.id === entry.id);
    const actual = latest.find((item) => item.id === entry.id);
    if (!original || !actual) { conflicts.push(`${label} ${entry.id}：目标已删除或基础身份不存在`); return entry; }
    return merge(original, entry, { ...actual, source: (entry as T & { source?: string }).source, ref: (entry as T & { ref?: string }).ref }, `${label} ${entry.id}`, conflicts);
  });
  next.supports = rebase(next.supports, base.supports, current.supports, "支座");
  next.nodalLoads = rebase(next.nodalLoads, base.nodalLoads, current.nodalLoads, "节点荷载");
  next.uniformLoads = rebase(next.uniformLoads, base.uniformLoads, current.uniformLoads, "均布荷载");
  next.loadCases = rebase(next.loadCases, base.loadCases, current.loadCases, "工况");
  next.loadCombinations = rebase(next.loadCombinations, base.loadCombinations, current.loadCombinations, "组合");
  if (next.selfWeight) next.selfWeight = merge(base.selfWeight, next.selfWeight, { ...current.selfWeight, source: next.selfWeight.source }, "结构自重", conflicts);
  return { draft: next, conflicts };
}

export function coordinateTaskDraft(base: FrameProject, current: FrameProject, draft: TaskDraft): DraftCoordination<TaskDraft> {
  if (sameEngineeringState(base, current)) return { draft, conflicts: [] };
  if (base.id !== current.id) return { draft, conflicts: ["项目已切换，旧任务不能提交"] };
  const coordinated = draft.conditions ? coordinateConditions(base, current, draft.conditions) : undefined;
  const next = { ...draft, baseRevision: current.revision, version: draft.version + 1, ...(coordinated ? { conditions: coordinated.draft } : {}) };
  const preview = buildTaskDraftPreview(captureAiSnapshot(current, []), next);
  return { draft: next, conflicts: [...(coordinated?.conflicts ?? []), ...newIssues(buildTaskDraftPreview(captureAiSnapshot(base, []), draft).issues, preview.issues)] };
}

export function coordinateModelEdits(base: FrameProject, current: FrameProject, draft: ModelEditProposal): DraftCoordination<ModelEditProposal> {
  if (sameEngineeringState(base, current)) return { draft, conflicts: [] };
  const conflicts: string[] = [];
  const operations = draft.operations.map((operation) => {
    if (operation.type === "merge_nodes") {
      // New incident members/conditions can expand a merge's impact even without moving a node.
      const nodes = new Set(operation.nodeIds);
      const reviewedMembers = draft.preview.nodeMerges?.flatMap((merge) => merge.members) ?? [];
      const ids = new Set(reviewedMembers.map((m) => m.before.id));
      const endpoints = new Set([...nodes, ...reviewedMembers.flatMap((m) => [m.before.startNodeId, m.before.endNodeId, m.after.startNodeId, m.after.endNodeId])]);
      const materials = new Set(reviewedMembers.map((m) => m.before.materialId));
      const sections = new Set(reviewedMembers.map((m) => m.before.sectionId));
      const impact = (project: FrameProject) => [project.nodes.filter((node) => endpoints.has(node.id)),
        project.members.filter((m) => ids.has(m.id) || nodes.has(m.startNodeId) || nodes.has(m.endNodeId)),
        project.supports.filter((s) => nodes.has(s.nodeId)), project.nodalLoads.filter((l) => nodes.has(l.nodeId)),
        project.uniformLoads.filter((l) => ids.has(l.memberId)), project.materials.filter((m) => materials.has(m.id)), project.sections.filter((s) => sections.has(s.id))];
      if (!same(impact(base), impact(current))) conflicts.push("合并目标、关联杆件或边界荷载已变化，请重读并重新确认合并影响");
      return operation;
    }
    if ("memberIds" in operation) {
      const ids = new Set(operation.memberIds);
      const nodes = new Set(base.members.filter((member) => ids.has(member.id)).flatMap((member) => [member.startNodeId, member.endNodeId]));
      const materials = new Set(base.members.filter((member) => ids.has(member.id)).map((member) => member.materialId));
      const sections = new Set(base.members.filter((member) => ids.has(member.id)).map((member) => member.sectionId));
      if (operation.nodeId) nodes.add(operation.nodeId);
      const impact = (project: FrameProject) => [project.members.filter((member) => ids.has(member.id)), project.nodes.filter((node) => nodes.has(node.id)),
        project.uniformLoads.filter((load) => ids.has(load.memberId)), project.supports.filter((support) => nodes.has(support.nodeId)), project.nodalLoads.filter((load) => nodes.has(load.nodeId)),
        project.materials.filter((material) => materials.has(material.id)), project.sections.filter((section) => sections.has(section.id))];
      if (!same(impact(base), impact(current))) conflicts.push("连接／分割目标、端点或边界荷载已变化，请重读并重新确认拓扑影响");
      return operation;
    }
    if (!("id" in operation)) return operation;
    const before = (operation.type.endsWith("analysis_case") ? base.analysisCases : operation.type.endsWith("node") ? base.nodes : base.members).find((item) => item.id === operation.id);
    const actual = (operation.type.endsWith("analysis_case") ? current.analysisCases : operation.type.endsWith("node") ? current.nodes : current.members).find((item) => item.id === operation.id);
    if (!before || !actual) { conflicts.push(`${operation.id}：任务目标已删除`); return operation; }
    if (operation.type === "update_node" && "position" in before && "position" in actual) {
      return { ...operation, position: merge(before.position, operation.position, actual.position, `${operation.id}.position`, conflicts) };
    }
    if (operation.type === "update_analysis_case") return { ...operation, properties: merge(before, operation.properties, actual, operation.id, conflicts) };
    if (operation.type === "update_member") return { ...operation, changes: merge(before, operation.changes, actual, operation.id, conflicts) };
    if (!same(before, actual)) conflicts.push(`${operation.id}：对象已编辑，删除或复制的意图需重新确认`);
    return operation;
  });
  // Deleting a node or member also removes its conditions and connected members.
  for (const change of draft.preview.changes.filter((item) => item.before && !item.after)) {
    const collection = { node: current.nodes, member: current.members, support: current.supports, "nodal-load": current.nodalLoads, "uniform-load": current.uniformLoads, "analysis-case": current.analysisCases }[change.kind];
    if (!same(change.before, collection.find((item) => item.id === change.id))) conflicts.push(`${change.id}：级联删除对象已变化`);
  }
  try {
    const next = proposeModelEdits(current, { operations }, draft);
    if (draft.operations.some((item) => item.type.startsWith("delete_"))) {
      const originalIds = new Set(draft.preview.changes.filter((item) => !item.after).map((item) => item.id));
      if (next.preview.changes.some((item) => !item.after && !originalIds.has(item.id))) conflicts.push("删除影响已扩大，新增关联对象需要重新确认");
    }
    return { draft: next, conflicts };
  } catch (error) { return { draft, conflicts: [...conflicts, error instanceof Error ? error.message : "基础编辑需要重新规划"] }; }
}

export function coordinateSection(base: FrameProject, current: FrameProject, draft: SectionChangeProposal): DraftCoordination<SectionChangeProposal> {
  if (sameEngineeringState(base, current)) return { draft, conflicts: [] };
  const conflicts: string[] = [];
  for (const id of draft.memberIds) {
    const before = base.members.find((item) => item.id === id);
    const actual = current.members.find((item) => item.id === id);
    if (!before || !actual) conflicts.push(`${id}：任务目标已删除`);
    else if (before.sectionId !== actual.sectionId && actual.sectionId !== draft.section.id) conflicts.push(`${id}.sectionId：人工已修改为 ${actual.sectionId}，草案要求 ${draft.section.id}`);
  }
  const section = current.sections.find((item) => item.id === draft.section.id);
  try { selectedColumns(captureAiSnapshot(current, draft.memberIds.map((id) => ({ kind: "member", id })))); }
  catch (error) { conflicts.push(error instanceof Error ? error.message : "柱目标的意图不明确"); }
  if (base.sections.some((item) => item.id === draft.section.id) && !section) conflicts.push(`${draft.section.id}：截面资源已删除`);
  return { draft: { ...draft, version: draft.version + 1, section: section ?? draft.section }, conflicts };
}

export function coordinateFrame(base: FrameProject, current: FrameProject, draft: FrameProposal): DraftCoordination<FrameProposal> {
  if (sameEngineeringState(base, current)) return { draft, conflicts: [] };
  const next = { ...draft, version: draft.version + 1 };
  return { draft: next, conflicts: newIssues(buildFramePreview(captureAiSnapshot(base, []), draft).issues, buildFramePreview(captureAiSnapshot(current, []), next).issues) };
}

export function validateConditions(base: FrameProject, current: FrameProject, draft: ConditionsProposal): DraftCoordination<ConditionsProposal> {
  if (sameEngineeringState(base, current)) return { draft, conflicts: [] };
  const coordinated = coordinateConditions(base, current, draft);
  return { draft: { ...coordinated.draft, version: coordinated.draft.version + 1 }, conflicts: [...coordinated.conflicts, ...newIssues(conditionsIssues(base, draft), conditionsIssues(current, coordinated.draft))] };
}
