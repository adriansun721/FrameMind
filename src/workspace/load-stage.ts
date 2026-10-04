import {
  addLoadCase, updateLoadCase, addUniformLoad, updateUniformLoad, updateSelfWeight,
  addLoadCombination, updateLoadCombination, validateSelfWeight, validateUniformLoad, validateLoadCombination,
  type FrameProject, type LoadId, type MemberId, type Vector3, type LoadCombinationTerm, type SelfWeightProperties,
} from "../domain/project";
import { conditionIdentity as identity, conditionObject as object, conditionSource as source, conditionVector as vector, type ConditionSource } from "./condition-input";

export interface UniformLoadProposal { id?: LoadId; memberId: MemberId; loadCaseId: string; coordinateSystem: "global" | "local"; intensity: Vector3; source: ConditionSource; }
export interface LoadCaseProposal { id?: string; ref: string; name: string; description: string; source: ConditionSource; }
export interface CombinationProposal { id?: string; ref: string; name: string; terms: LoadCombinationTerm[]; source: ConditionSource; }
export interface LoadStage {
  uniformLoads?: UniformLoadProposal[];
  selfWeight?: SelfWeightProperties & { source: ConditionSource };
  loadCases?: LoadCaseProposal[];
  loadCombinations?: CombinationProposal[];
}
export const LOAD_STAGE_FIELDS = ["uniformLoads", "selfWeight", "loadCases", "loadCombinations"] as const;

function entries(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("每类荷载阶段最多 100 个条目");
  return value;
}
function namedEntry(raw: unknown, fields: string[]) {
  const e = object(raw, ["id", "ref", "name", "source", ...fields]);
  if (typeof e.name !== "string" || !e.name.trim() || e.name.length > 200) throw new Error("工况/组合名称不能为空且最多 200 字");
  return { e, common: { ...(e.id === undefined ? {} : { id: identity(e.id) }), ref: identity(e.ref), name: e.name.trim(), source: source(e.source) } };
}

/** Parse only declared inputs. Reference resolution and domain validation happen before confirmation. */
export function parseLoadStage(request: Record<string, unknown>): LoadStage {
  const next: LoadStage = {};
  if (request.uniformLoads !== undefined) next.uniformLoads = entries(request.uniformLoads).map((raw) => {
    const e = object(raw, ["id", "memberId", "loadCaseId", "coordinateSystem", "intensity", "source"]);
    if (e.coordinateSystem !== "global" && e.coordinateSystem !== "local") throw new Error("均布荷载坐标系必须为 global 或 local");
    const entrySource = source(e.source);
    return { ...(e.id === undefined ? {} : { id: identity(e.id) as LoadId }), memberId: identity(e.memberId) as MemberId,
      loadCaseId: identity(e.loadCaseId), coordinateSystem: e.coordinateSystem, intensity: vector(e.intensity), source: entrySource };
  });
  if (request.selfWeight !== undefined) {
    const e = object(request.selfWeight, ["enabled", "loadCaseId", "gravity", "source"]);
    if (typeof e.enabled !== "boolean") throw new Error("自重启用状态无效");
    const entrySource = source(e.source);
    next.selfWeight = { enabled: e.enabled, loadCaseId: identity(e.loadCaseId), gravity: vector(e.gravity), source: entrySource };
  }
  if (request.loadCases !== undefined) next.loadCases = entries(request.loadCases).map((raw) => {
    const { e, common } = namedEntry(raw, ["description"]);
    if (typeof e.description !== "string" || e.description.length > 2000) throw new Error("工况说明必须为文本且最多 2000 字");
    return { ...common, description: e.description.trim() };
  });
  if (request.loadCombinations !== undefined) next.loadCombinations = entries(request.loadCombinations).map((raw) => {
    const { e, common } = namedEntry(raw, ["terms"]);
    const terms = entries(e.terms).map((rawTerm) => {
      const term = object(rawTerm, ["loadCaseId", "factor"]);
      if (typeof term.factor !== "number" || !Number.isFinite(term.factor)) throw new Error("组合系数必须为有限数值（无量纲）");
      return { loadCaseId: identity(term.loadCaseId), factor: term.factor };
    });
    return { ...common, terms };
  });
  return next;
}

interface ReadableLoadModel {
  nodes: readonly { id: string }[];
  members: readonly { id: string }[];
  materials: readonly { id: string }[];
  sections: readonly { id: string }[];
  supports: readonly { id: string; nodeId: string; label: string }[];
  nodalLoads: readonly { id: string }[];
  uniformLoads: readonly { id: string }[];
  loadCases: readonly FrameProject["loadCases"][number][];
  loadCombinations: readonly { id: string }[];
}

/** Resolve draft references for validation without inventing persistent identities. */
export function loadStageReferences(project: ReadableLoadModel, stage: LoadStage) {
  const references = new Map<string, string>();
  const issues: string[] = [];
  const seenIds = new Set<string>();
  const formalIds = new Set([project.nodes, project.members, project.materials, project.sections, project.supports,
    project.nodalLoads, project.uniformLoads, project.loadCases, project.loadCombinations].flatMap((items) => items.map((item) => item.id)));
  for (const [kind, proposed, existing] of [
    ["工况", stage.loadCases ?? [], project.loadCases],
    ["组合", stage.loadCombinations ?? [], project.loadCombinations],
  ] as const) for (const entry of proposed) {
    if (references.has(entry.ref) || formalIds.has(entry.ref) && entry.id !== entry.ref) issues.push(`方案引用 ${entry.ref} 重复或与正式身份冲突`);
    if (entry.id && (!existing.some((item) => item.id === entry.id) || seenIds.has(entry.id))) issues.push(`${kind} ${entry.id} 不存在或重复修改`);
    if (entry.id) seenIds.add(entry.id);
    references.set(entry.ref, entry.id ?? entry.ref);
  }
  return { references, issues };
}

export function loadStageIssues(project: ReadableLoadModel, stage: LoadStage): string[] {
  const { references, issues } = loadStageReferences(project, stage);
  const resolve = (ref: string) => references.get(ref) ?? ref;
  const cases = [...project.loadCases, ...(stage.loadCases ?? []).filter((c) => !c.id).map((c) => ({ id: c.ref, name: c.name, description: c.description }))];
  const checkCase = (ref: string) => { if (!cases.some((c) => c.id === resolve(ref))) issues.push(`工况 ${ref} 已不存在或未在方案中定义`); };
  const ids = new Set<string>();
  for (const load of stage.uniformLoads ?? []) {
    if (load.source === "unknown") issues.push("均布荷载来源未知，请补充或确认");
    if (!project.members.some((m) => m.id === load.memberId)) issues.push(`杆件 ${load.memberId} 已不存在`);
    if (load.id && (!project.uniformLoads.some((l) => l.id === load.id) || ids.has(load.id))) issues.push(`均布荷载 ${load.id} 不存在或重复修改`);
    if (load.id) ids.add(load.id);
    checkCase(load.loadCaseId);
    try { validateUniformLoad({ kind: "uniform", memberId: load.memberId, coordinateSystem: load.coordinateSystem, intensity: load.intensity, loadCaseId: "LC1" }); }
    catch (e) { issues.push((e as Error).message); }
  }
  if (stage.selfWeight) {
    if (stage.selfWeight.source === "unknown") issues.push("结构自重来源未知，请补充或确认");
    checkCase(stage.selfWeight.loadCaseId);
    try { validateSelfWeight({ enabled: stage.selfWeight.enabled, gravity: stage.selfWeight.gravity, loadCaseId: "LC1" }); }
    catch (e) { issues.push((e as Error).message); }
  }
  for (const combo of stage.loadCombinations ?? []) {
    if (combo.source === "unknown") issues.push("组合来源未知，请补充或确认");
    try { validateLoadCombination({ loadCases: cases }, { id: combo.id ?? "CB1", name: combo.name, terms: combo.terms.map((term) => ({ ...term, loadCaseId: resolve(term.loadCaseId) })) }); }
    catch (e) { issues.push((e as Error).message); }
  }
  for (const loadCase of stage.loadCases ?? []) if (loadCase.source === "unknown") issues.push("工况来源未知，请补充或确认");
  return issues;
}

/** Calls the same commands as manual editing; no physics or solver code belongs here. */
export function applyLoadStage(project: FrameProject, stage: LoadStage): { project: FrameProject; references: Record<string, string> } {
  let current = project;
  const references: Record<string, string> = Object.create(null);
  for (const entry of stage.loadCases ?? []) {
    current = entry.id ? updateLoadCase(current, entry.id, entry.name, entry.description) : addLoadCase(current, entry.name, entry.description);
    references[entry.ref] = entry.id ?? current.loadCases.at(-1)!.id;
  }
  const resolve = (ref: string) => references[ref] ?? ref;
  for (const load of stage.uniformLoads ?? []) {
    const input = { kind: "uniform" as const, memberId: load.memberId, coordinateSystem: load.coordinateSystem, intensity: load.intensity, loadCaseId: resolve(load.loadCaseId) };
    current = load.id ? updateUniformLoad(current, load.id, input) : addUniformLoad(current, input);
  }
  if (stage.selfWeight) current = updateSelfWeight(current, { enabled: stage.selfWeight.enabled, gravity: stage.selfWeight.gravity, loadCaseId: resolve(stage.selfWeight.loadCaseId) });
  for (const combo of stage.loadCombinations ?? []) {
    const terms = combo.terms.map((term) => ({ ...term, loadCaseId: resolve(term.loadCaseId) }));
    current = combo.id ? updateLoadCombination(current, combo.id, combo.name, terms) : addLoadCombination(current, combo.name, terms);
    references[combo.ref] = combo.id ?? current.loadCombinations.at(-1)!.id;
  }
  return { project: current, references };
}
