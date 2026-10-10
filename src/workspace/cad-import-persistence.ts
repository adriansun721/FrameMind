import type { CadImportDraft, CadImportReceipt } from "./cad-import";

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const arrayOf = (v: unknown, check: (item: unknown) => boolean): boolean => Array.isArray(v) && v.every(check);
const vector = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
const pose = (v: unknown) => record(v) && vector(v.translationM) && vector(v.rotationDegrees);
const bounds = (v: unknown) => record(v) && vector(v.min) && vector(v.max);
const matrix = (v: unknown) => Array.isArray(v) && v.length === 4 && v.every((row) => Array.isArray(row) && row.length === 4 && row.every((n) => typeof n === "number" && Number.isFinite(n)));
const properties = (v: unknown) => record(v) && ["areaM2", "secondMomentYM4", "secondMomentZM4", "torsionalConstantM4"].every((key) => v[key] === undefined || v[key] === null || typeof v[key] === "number");

export function decodeCadImportDraft(value: unknown, projectId: string): CadImportDraft | undefined {
  if (value === undefined) return undefined;
  try {
    if (!record(value) || value.schemaVersion !== 1 || !text(value.id) || !record(value.parent) || value.parent.projectId !== projectId || !integer(value.parent.revision)
      || !hash(value.parent.snapshotHash) || !pose(value.pose) || !arrayOf(value.approvedContactIds, text)
      || !arrayOf(value.poseDecisions, (v) => record(v) && integer(v.revision) && text(v.recordedAt) && hash(v.inputSha256) && hash(v.geometryHash) && pose(v.pose) && v.source === "user")) throw new Error();
    const result = value.result;
    if (!record(result) || result.kind !== "result" || !text(result.requestId) || !text(result.parserVersion) || !record(result.kernel) || !record(result.diagnostics)
      || !record(result.input) || !hash(result.input.sha256) || !integer(result.input.sizeBytes) || ![".step", ".stp"].includes(String(result.input.extension))) throw new Error();
    const state = result.intermediateState;
    if (!record(state) || state.schemaVersion !== 2 || !record(state.source) || state.source.inputSha256 !== result.input.sha256 || state.source.parserVersion !== result.parserVersion
      || !hash(state.geometryHash) || !record(state.units) || !record(state.normalization)
      || !arrayOf(state.entities, (e) => record(e) && integer(e.id) && text(e.type) && integer(e.line))
      || !arrayOf(state.ignoredEntities, (e) => record(e) && integer(e.id) && text(e.type) && text(e.reason))) throw new Error();
    const geometry = state.engineeringGeometry;
    if (geometry !== undefined && (!record(geometry) || geometry.schemaVersion !== 1
      || !arrayOf(geometry.centerlines, (c) => record(c) && text(c.id) && integer(c.solidId) && (c.instanceId === null || integer(c.instanceId)) && arrayOf(c.sourceEntityIds, integer)
        && vector(c.start) && vector(c.end) && vector(c.direction) && typeof c.lengthM === "number" && c.lengthM > 0 && bounds(c.boundingBox)
        && Array.isArray(c.endSections) && c.endSections.length === 2 && c.endSections.every((section) => arrayOf(section, vector)) && text(c.method))
      || !arrayOf(geometry.definitions, (d) => record(d) && integer(d.solidId) && text(d.status) && (d.rejections === undefined || arrayOf(d.rejections, text)))
      || !arrayOf(geometry.solidInstances, (s) => record(s) && integer(s.solidId) && (s.instanceId === null || integer(s.instanceId)) && text(s.status) && bounds(s.bounds) && matrix(s.transform) && arrayOf(s.sourceEntityIds, integer))
      || !arrayOf(geometry.issues, (i) => record(i) && text(i.code) && text(i.severity) && text(i.message) && arrayOf(i.sourceEntityIds, integer)))) throw new Error();
    if (state.diagnostics !== undefined && (!record(state.diagnostics) || !arrayOf(state.diagnostics.blockingIssues, text))) throw new Error();
    const resources = value.resources;
    if (!record(resources) || !record(resources.material) || typeof resources.rigidJointsConfirmed !== "boolean" || !record(resources.manualSections)
      || !Object.values(resources.manualSections).every((v) => record(v) && properties(v.properties) && typeof v.reference === "string" && typeof v.confirmed === "boolean")
      || !arrayOf(resources.correctionHistory, (c) => record(c) && text(c.sectionId) && properties(c.replacement) && typeof c.reference === "string" && typeof c.confirmed === "boolean")
      || !arrayOf(resources.acceptedWarningCodes, text)) throw new Error();
    const draft = structuredClone(value) as unknown as CadImportDraft;
    draft.restored = true; draft.resources.verification = undefined;
    return draft;
  } catch { throw new Error("STEP 待修复草稿无效，无法恢复预览"); }
}

export function decodeCadImportReceipts(value: unknown, projectId: string, revision: number): CadImportReceipt[] | undefined {
  if (value === undefined) return undefined;
  if (!arrayOf(value, (r) => record(r) && r.schemaVersion === 1 && text(r.id) && text(r.draftId) && r.projectId === projectId
    && integer(r.parentRevision) && integer(r.appliedRevision) && r.appliedRevision > r.parentRevision && r.appliedRevision <= revision
    && hash(r.draftHash) && hash(r.parentHash) && hash(r.inputSha256) && hash(r.geometryHash) && text(r.parserVersion) && text(r.confirmedAt)
    && r.rigidJointsConfirmed === true && pose(r.pose) && arrayOf(r.readiness, text)
    && arrayOf(r.mappings, (m) => record(m) && text(m.memberId) && text(m.draftMemberId) && text(m.centerlineId) && (m.instanceId === null || integer(m.instanceId))
      && arrayOf(m.sourceEntityIds, integer) && Array.isArray(m.range) && m.range.length === 2 && m.range.every((n) => typeof n === "number" && Number.isFinite(n)) && m.range[0] >= 0 && m.range[1] <= 1 && m.range[0] < m.range[1])
    && record(r.resourceEvidence) && r.resourceEvidence.schemaVersion === 1 && Array.isArray(r.resourceEvidence.checks)
    && arrayOf(r.ignoredEntities, (e) => record(e) && integer(e.id) && text(e.type) && text(e.reason)))) throw new Error("STEP 导入回执无效");
  const receipts = structuredClone(value) as CadImportReceipt[];
  if (new Set(receipts.map((r) => r.id)).size !== receipts.length) throw new Error("STEP 导入回执身份重复");
  return receipts;
}
