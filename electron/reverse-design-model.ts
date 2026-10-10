import { candidateInput, canonicalJson, CANDIDATE_INPUT_FIELDS, parseCandidateProject } from "./candidate-model";
import { REVERSE_DESIGN_TEMPLATE, REVERSE_DESIGN_SECTIONS } from "./reverse-design-fixture";

export const REVERSE_DESIGN_RULES = Object.freeze({ scenario: "P25-09-two-storey-v1", horizontalLimitMm: 15, objective: "minimize-structural-mass-kg", maxRounds: 8, maxDurationSeconds: 1200, workTimeoutSeconds: 120, maxToolRetries: 2, inspectTimeoutSeconds: 90 });
export interface ReverseDesignSelection { beamCatalogId: string; columnCatalogId: string; }
type ReverseProject = typeof REVERSE_DESIGN_TEMPLATE & { id: string; revision: number; updatedAt: string };
export interface ReverseDesignReport {
  scenario: string; status: "blocked"; diagnostic: string; horizontalLimitMm: number;
  beforeMassKg: number; afterMassKg: number; reductionKg: number;
  changes: Array<{ group: "beam" | "column"; memberIds: string[]; beforeCatalogId: string; afterCatalogId: string; source: typeof REVERSE_DESIGN_SECTIONS[number]["provenance"]; }>;
  selfWeight: Array<{ memberId: string; lengthM: number; areaM2: number; densityKgM3: number; massKg: number; intensityKnM: { x: number; y: number; z: number }; }>;
}
export const reverseDesignCatalog = () => structuredClone(REVERSE_DESIGN_SECTIONS);
/** Binding includes revision/history/results; display and execution bookkeeping may change. */
export function reverseDesignParentState(content: string): string {
  const { taskState: _task, displayUnitPreset: _display, updatedAt: _time, ...parent } = parseCandidateProject(content);
  return canonicalJson(parent);
}
function section(catalogId: string, slot: number) {
  const entry = REVERSE_DESIGN_SECTIONS.find((s) => s.provenance.catalogId === catalogId);
  if (!entry) throw new Error("只能选择已核验截面库条目，禁止自造参数");
  return { ...structuredClone(entry), id: REVERSE_DESIGN_TEMPLATE.sections[slot].id, label: REVERSE_DESIGN_TEMPLATE.sections[slot].label };
}
export function createReverseDesignBaseline(content: string): string {
  const p = parseCandidateProject(content);
  if (["nodes", "members", "supports", "nodalLoads", "uniformLoads", "analysisResults", "analysisCases"].some((key) => !Array.isArray(p[key]) || (p[key] as unknown[]).length) || p.cadImportDraft || p.cadImports) throw new Error("请从空项目创建固定场景，已有模型须另建项目");
  if (Number(p.revision) >= Number.MAX_SAFE_INTEGER) throw new Error("修订无法安全递增");
  return JSON.stringify({ ...p, ...structuredClone(REVERSE_DESIGN_TEMPLATE), revision: Number(p.revision) + 1, updatedAt: new Date().toISOString() });
}
/** Reject every fixed-field difference, including extra resources and member releases/mass. */
export function validateReverseDesignParent(content: string): ReverseProject {
  const p = parseCandidateProject(content);
  if (!Array.isArray(p.sections) || p.sections.length !== 2) throw new Error("固定场景截面资源已变化");
  const slots = p.sections as Array<{ provenance?: { catalogId?: string } }>;
  const expected = { ...REVERSE_DESIGN_TEMPLATE, sections: [section(slots[0].provenance?.catalogId ?? "", 0), section(slots[1].provenance?.catalogId ?? "", 1)] };
  for (const key of CANDIDATE_INPUT_FIELDS) if (canonicalJson(p[key]) !== canonicalJson(expected[key as keyof typeof expected])) throw new Error(`固定场景 ${key} 已变化；禁止改变题目生成候选`);
  if (Number(p.revision) >= Number.MAX_SAFE_INTEGER) throw new Error("修订无法安全递增");
  return p as unknown as ReverseProject;
}
function massRecords(p: ReverseProject): ReverseDesignReport["selfWeight"] {
  return p.members.map((m) => {
    const a = p.nodes.find((n) => n.id === m.startNodeId)!.position, b = p.nodes.find((n) => n.id === m.endNodeId)!.position;
    const lengthM = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), areaM2 = p.sections.find((s) => s.id === m.sectionId)!.areaM2, densityKgM3 = p.materials[0].densityKgM3;
    const massKg = densityKgM3 * areaM2 * lengthM, intensity = densityKgM3 * areaM2 / 1000;
    return { memberId: m.id, lengthM, areaM2, densityKgM3, massKg, intensityKnM: { x: intensity * p.selfWeight.gravity.x, y: intensity * p.selfWeight.gravity.y, z: intensity * p.selfWeight.gravity.z } };
  });
}
export function reverseDesignMass(content: string): number { return massRecords(validateReverseDesignParent(content)).reduce((sum, m) => sum + m.massKg, 0); }
export function generateReverseDesignCandidate(parentContent: string, selection: ReverseDesignSelection): { content: string; report: ReverseDesignReport } {
  if (!selection || Object.keys(selection).length !== 2 || Object.keys(selection).some((k) => !["beamCatalogId", "columnCatalogId"].includes(k))) throw new Error("只允许梁组和柱组的库截面编号");
  const parent = validateReverseDesignParent(parentContent);
  const proposed = { ...parent, sections: [section(selection.columnCatalogId, 0), section(selection.beamCatalogId, 1)], revision: parent.revision + 1, updatedAt: new Date().toISOString() };
  const content = JSON.stringify(proposed);
  validateReverseDesignParent(content);
  const selfWeight = massRecords(proposed), beforeMassKg = massRecords(parent).reduce((sum, m) => sum + m.massKg, 0), afterMassKg = selfWeight.reduce((sum, m) => sum + m.massKg, 0);
  const report: ReverseDesignReport = { scenario: REVERSE_DESIGN_RULES.scenario, status: "blocked", diagnostic: "候选已生成；尚未求解与 inspect，不能判断可行或合并。仅覆盖位移约束下截面减重，不包含强度、屈曲或规范验算；不保证全局最优。", horizontalLimitMm: 15,
    beforeMassKg, afterMassKg, reductionKg: beforeMassKg - afterMassKg, selfWeight,
    changes: (["column", "beam"] as const).map((group, slot) => ({ group, memberIds: parent.members.filter((m) => m.sectionId === parent.sections[slot].id).map((m) => m.id), beforeCatalogId: parent.sections[slot].provenance.catalogId, afterCatalogId: proposed.sections[slot].provenance.catalogId, source: proposed.sections[slot].provenance })) };
  if (![beforeMassKg, afterMassKg].every((x) => Number.isFinite(x) && x > 0) || candidateInput(content) === candidateInput(parentContent)) throw new Error("质量无效或截面组合未变化");
  return { content, report };
}
