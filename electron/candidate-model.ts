/** Pure persisted-input boundary shared by the desktop host and difference view. */
export const CANDIDATE_INPUT_FIELDS = ["units", "nodes", "members", "materials", "sections", "supports", "nodalLoads", "uniformLoads", "selfWeight", "loadCases", "loadCombinations", "analysisCases", "psdSpectra", "activeLoadCaseId", "activeLoadCombinationId", "activeAnalysisCaseId"] as const;
export function canonicalJson(value: unknown): string {
  const order = (item: unknown): unknown => Array.isArray(item) ? item.map(order) : item && typeof item === "object"
    ? Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, order(v)])) : item;
  return JSON.stringify(order(value));
}
export function candidateInput(content: string): string {
  const project = parseCandidateProject(content);
  return canonicalJson(Object.fromEntries(["id", ...CANDIDATE_INPUT_FIELDS].map((key) => [key, project[key]])));
}
/** Execution bookkeeping and display choices cannot overwrite formal engineering/history state. */
export function candidateParentState(content: string): string {
  const { taskState: _task, displayUnitPreset: _display, updatedAt: _time, ...parent } = parseCandidateProject(content);
  return canonicalJson(parent);
}

export function normalizeCheckpointRestore<T extends { id: unknown; projectHistory?: unknown; taskState?: unknown; cadImportDraft?: { resources: object } }>(current: T, snapshot: T): T {
  if (snapshot.id !== current.id) throw new Error("恢复快照属于其他项目");
  return { ...snapshot, projectHistory: current.projectHistory, taskState: undefined,
    cadImportDraft: snapshot.cadImportDraft ? { ...snapshot.cadImportDraft, restored: true, resources: { ...snapshot.cadImportDraft.resources, verification: undefined } } : undefined };
}
export function parseCandidateProject(content: string): Record<string, unknown> {
  if (typeof content !== "string" || content.length > 64 * 1024 * 1024) throw new Error("候选项目内容无效");
  const p = JSON.parse(content);
  if (!p || p.format !== "framemind-project" || !/^project_[A-Za-z0-9_-]{8,100}$/.test(p.id) || !Number.isSafeInteger(p.revision) || p.revision < 0) throw new Error("候选项目身份或修订无效");
  return p;
}

export interface CandidateFieldChange { collection: string; id: string; field: string; parent: unknown; candidate: unknown; current: unknown; conflict: boolean; }
export function candidateDifferences(parentContent: string, candidateContent: string, currentContent: string): CandidateFieldChange[] {
  const parent = parseCandidateProject(parentContent), candidate = parseCandidateProject(candidateContent), current = parseCandidateProject(currentContent);
  if (parent.id !== candidate.id || parent.id !== current.id) throw new Error("候选差异项目身份不一致");
  const changes: CandidateFieldChange[] = [];
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
  const walk = (collection: string, id: string, field: string, a: unknown, b: unknown, c: unknown) => {
    if (object(a) && object(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(collection, id, field ? `${field}.${key}` : key, a[key], b[key], object(c) ? c[key] : undefined);
    } else if (!same(a, b) || !same(a, c)) changes.push({ collection, id, field, parent: a, candidate: b, current: c, conflict: !same(a, c) });
  };
  for (const key of CANDIDATE_INPUT_FIELDS) {
    const a = parent[key], b = candidate[key], c = current[key];
    if (Array.isArray(a) && Array.isArray(b) && Array.isArray(c) && [...a, ...b, ...c].every((v) => object(v) && typeof v.id === "string")) {
      const old = new Map(a.map((v) => [v.id, v])), proposed = new Map(b.map((v) => [v.id, v])), actual = new Map(c.map((v) => [v.id, v]));
      for (const id of new Set([...old.keys(), ...proposed.keys(), ...actual.keys()])) walk(key, id, "", old.get(id), proposed.get(id), actual.get(id));
      walk("project", String(parent.id), `${key}.order`, a.map((v) => v.id), b.map((v) => v.id), c.map((v) => v.id));
    } else walk("project", String(parent.id), key, a, b, c);
  }
  return changes;
}
