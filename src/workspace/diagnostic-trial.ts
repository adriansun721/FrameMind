import {
  captureAnalysisInput,
  type AnalysisResult,
} from "../domain/analysis";
import { compareAnalysisResults } from "../domain/analysis-comparison";
import { AnalysisServiceFailure, createAnalysisRequest, executeAnalysisRequest } from "../domain/analysis-service";
import type { AnalysisRunRecord } from "../domain/analysis-service-contract";
import type { AnalysisDiagnostic, AnalysisStage, AnalysisTarget } from "../domain/analysis-diagnostics";
import { AnalysisFailure, checkAnalysisInput } from "../domain/analysis-diagnostics";
import type {
  DofRestraints,
  FrameProject,
  FrameSelfWeight,
  FrameUniformLoad,
  MemberProperties,
  NodeId,
  ProjectId,
  SupportId,
  LoadId,
  Vector3,
  MemberId,
} from "../domain/project";
import {
  addNodalLoad,
  addSupport,
  addUniformLoad,
  deleteNodalLoad,
  deleteSupport,
  deleteUniformLoad,
  updateNodalLoad,
  updateNode,
  updateSelfWeight,
  updateSupport,
  updateUniformLoad,
  updateMember,
} from "../domain/project";

/** A diagnostic copy is a disposable engineering workspace, never a project history entry. */
export type DiagnosticSourceKind = "formal-model" | "analysis-input";
export type DiagnosticCopyCollection = "summary" | "nodes" | "members" | "supports" | "loads" | "trials";

export interface DiagnosticCopySource {
  kind: DiagnosticSourceKind;
  projectId: string;
  projectRevision: number;
  analysisId?: string;
  activeLoadCaseId?: string;
  activeLoadCombinationId?: string;
  snapshotKey: string;
}

export type DiagnosticOperation =
  | { type: "set_support"; id?: SupportId; nodeId: NodeId; restraints: DofRestraints }
  | { type: "remove_support"; id: SupportId }
  | { type: "set_nodal_load"; id?: LoadId; nodeId: NodeId; loadCaseId: string; force: Vector3; moment: Vector3 }
  | { type: "remove_nodal_load"; id: LoadId }
  | { type: "set_uniform_load"; id?: LoadId; memberId: MemberId; coordinateSystem: FrameUniformLoad["coordinateSystem"]; loadCaseId: string; intensity: Vector3 }
  | { type: "remove_uniform_load"; id: LoadId }
  | { type: "set_self_weight"; input: FrameSelfWeight }
  | { type: "set_node_position"; id: NodeId; position: Partial<Vector3> }
  | { type: "set_member"; id: MemberId; changes: Partial<MemberProperties> };

export interface DiagnosticCheck {
  status: "valid" | "invalid";
  copyId: string;
  projectId: string;
  projectRevision: number;
  diagnostics: AnalysisDiagnostic[];
  targets: AnalysisTarget[];
  sourceId?: string;
}

export interface DiagnosticSummary {
  evidence: string[];
  proven: string[];
  hypotheses: string[];
  attempted: string[];
  impact: string[];
  remaining: string[];
}

export interface DiagnosticTrial {
  id: string;
  copyId: string;
  label: string;
  createdAt: string;
  source: DiagnosticCopySource;
  operations: DiagnosticOperation[];
  status: "complete" | "failed";
  engineeringValidity: "numerically-solved-not-engineering-validated" | "not-solved";
  evidence: DiagnosticCheck & { stages: AnalysisStage[]; stage?: AnalysisStage; solverMessage?: string; service?: AnalysisRunRecord };
  result?: AnalysisResult;
  summary: DiagnosticSummary;
}

export interface DiagnosticCopy {
  id: string;
  source: DiagnosticCopySource;
  model: FrameProject;
  trials: DiagnosticTrial[];
}

export interface DiagnosticComparison {
  copyId: string;
  beforeId: string;
  afterId: string;
  compatible: boolean;
  issues: string[];
  analysis?: ReturnType<typeof compareAnalysisResults>;
  summary: string;
}

export interface DiagnosticReadResult {
  copyId: string;
  source: DiagnosticCopySource;
  collection: DiagnosticCopyCollection;
  total: number;
  items: readonly unknown[];
  page: { offset: number; limit: number; hasMore: boolean; nextOffset: number };
}

function copyId(): string {
  return `diagnostic_${globalThis.crypto.randomUUID()}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function targetKey(target: AnalysisTarget): string {
  return `${target.kind}:${target.id}`;
}

function diagnosticTargets(diagnostics: readonly AnalysisDiagnostic[]): AnalysisTarget[] {
  const targets = new Map<string, AnalysisTarget>();
  for (const diagnostic of diagnostics) if (diagnostic.target) targets.set(targetKey(diagnostic.target), clone(diagnostic.target));
  return [...targets.values()];
}

function sourceFor(project: FrameProject, kind: DiagnosticSourceKind, analysisId?: string): DiagnosticCopySource {
  return { kind, projectId: project.id, projectRevision: project.revision, analysisId, activeLoadCaseId: project.activeLoadCaseId, activeLoadCombinationId: project.activeLoadCombinationId, snapshotKey: JSON.stringify({ projectId: project.id, revision: project.revision, activeLoadCaseId: project.activeLoadCaseId, activeLoadCombinationId: project.activeLoadCombinationId }) };
}

export function createDiagnosticCopy(project: FrameProject, source?: Partial<DiagnosticCopySource>): DiagnosticCopy {
  const id = copyId();
  const model = clone({ ...project, id: id as ProjectId, name: `${project.name} · 诊断副本`, analysisResults: [], latestAnalysis: undefined });
  const base = sourceFor(project, source?.kind ?? "formal-model", source?.analysisId);
  return { id, source: { ...base, ...clone(source), projectId: project.id, projectRevision: project.revision, snapshotKey: source?.snapshotKey ?? base.snapshotKey }, model, trials: [] };
}

function applyOperation(model: FrameProject, operation: DiagnosticOperation): FrameProject {
  switch (operation.type) {
    case "set_support":
      return operation.id ? updateSupport(model, operation.id, operation.nodeId, operation.restraints) : addSupport(model, operation.nodeId, operation.restraints);
    case "remove_support": return deleteSupport(model, operation.id);
    case "set_nodal_load":
      return operation.id ? updateNodalLoad(model, operation.id, operation.nodeId, operation.force, operation.moment, operation.loadCaseId) : addNodalLoad(model, operation.nodeId, operation.force, operation.moment, operation.loadCaseId);
    case "remove_nodal_load": return deleteNodalLoad(model, operation.id);
    case "set_uniform_load": {
      const input = { kind: "uniform" as const, memberId: operation.memberId, coordinateSystem: operation.coordinateSystem, loadCaseId: operation.loadCaseId, intensity: operation.intensity };
      return operation.id ? updateUniformLoad(model, operation.id, input) : addUniformLoad(model, input);
    }
    case "remove_uniform_load": return deleteUniformLoad(model, operation.id);
    case "set_self_weight": return updateSelfWeight(model, operation.input);
    case "set_node_position": {
      const node = model.nodes.find((item) => item.id === operation.id);
      if (!node) throw new Error(`节点 ${operation.id} 不存在`);
      return updateNode(model, operation.id, { ...node.position, ...operation.position });
    }
    case "set_member": return updateMember(model, operation.id, operation.changes);
  }
}

/** Apply a candidate only to the diagnostic copy. Every operation remains subject to confirmation before formal use. */
export function applyDiagnosticOperations(copy: DiagnosticCopy, operations: readonly DiagnosticOperation[]): DiagnosticCopy {
  let model = clone(copy.model);
  for (const operation of operations) model = applyOperation(model, operation);
  return { ...copy, model, trials: clone(copy.trials) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requiredId(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new Error(`${field} 必须是有效对象身份`);
  return value;
}

function vector(value: unknown, field: string, partial = false): Vector3 | Partial<Vector3> {
  if (!isRecord(value)) throw new Error(`${field} 必须是坐标对象`);
  const keys = Object.keys(value);
  const allowed = ["x", "y", "z"];
  if (keys.some((key) => !allowed.includes(key)) || (!partial && keys.length !== 3) || (partial && keys.length === 0)) throw new Error(`${field} 必须包含有限 XYZ 分量`);
  if (keys.some((key) => typeof value[key] !== "number" || !Number.isFinite(value[key]))) throw new Error(`${field} 必须包含有限 XYZ 分量`);
  return { ...(keys.includes("x") ? { x: value.x as number } : {}), ...(keys.includes("y") ? { y: value.y as number } : {}), ...(keys.includes("z") ? { z: value.z as number } : {}) };
}

function only(value: Record<string, unknown>, fields: readonly string[]): void {
  if (Object.keys(value).some((key) => !fields.includes(key))) throw new Error("诊断候选操作含未定义字段");
}

/** Runtime validation keeps malformed provider calls as structured trial evidence. */
export function validateDiagnosticOperations(value: unknown): DiagnosticOperation[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error("operations 必须是最多 20 项的候选改动");
  return value.map((raw) => {
    if (!isRecord(raw) || typeof raw.type !== "string") throw new Error("诊断候选操作缺少 type");
    const id = raw.id === undefined ? undefined : requiredId(raw.id, "id");
    switch (raw.type) {
      case "set_support":
        only(raw, ["type", "id", "nodeId", "restraints"]); if (!Array.isArray(raw.restraints) || raw.restraints.length !== 6 || !raw.restraints.every((item) => typeof item === "boolean")) throw new Error("restraints 必须是六个布尔自由度");
        return { type: raw.type, ...(id ? { id: id as SupportId } : {}), nodeId: requiredId(raw.nodeId, "nodeId") as NodeId, restraints: [...raw.restraints] as DofRestraints };
      case "remove_support": only(raw, ["type", "id"]); if (!id) throw new Error("remove_support 需要 id"); return { type: raw.type, id: id as SupportId };
      case "set_nodal_load":
        only(raw, ["type", "id", "nodeId", "loadCaseId", "force", "moment"]); if (typeof raw.loadCaseId !== "string" || !/^LC[1-9]\d*$/.test(raw.loadCaseId)) throw new Error("loadCaseId 无效");
        return { type: raw.type, ...(id ? { id: id as LoadId } : {}), nodeId: requiredId(raw.nodeId, "nodeId") as NodeId, loadCaseId: raw.loadCaseId, force: vector(raw.force, "force") as Vector3, moment: vector(raw.moment, "moment") as Vector3 };
      case "remove_nodal_load": only(raw, ["type", "id"]); if (!id) throw new Error("remove_nodal_load 需要 id"); return { type: raw.type, id: id as LoadId };
      case "set_uniform_load":
        only(raw, ["type", "id", "memberId", "coordinateSystem", "loadCaseId", "intensity"]); if (raw.coordinateSystem !== "global" && raw.coordinateSystem !== "local") throw new Error("coordinateSystem 无效"); if (typeof raw.loadCaseId !== "string" || !/^LC[1-9]\d*$/.test(raw.loadCaseId)) throw new Error("loadCaseId 无效");
        return { type: raw.type, ...(id ? { id: id as LoadId } : {}), memberId: requiredId(raw.memberId, "memberId") as MemberId, coordinateSystem: raw.coordinateSystem, loadCaseId: raw.loadCaseId, intensity: vector(raw.intensity, "intensity") as Vector3 };
      case "remove_uniform_load": only(raw, ["type", "id"]); if (!id) throw new Error("remove_uniform_load 需要 id"); return { type: raw.type, id: id as LoadId };
      case "set_self_weight":
        only(raw, ["type", "input"]); if (!isRecord(raw.input) || typeof raw.input.enabled !== "boolean" || typeof raw.input.loadCaseId !== "string" || !/^LC[1-9]\d*$/.test(raw.input.loadCaseId)) throw new Error("self-weight input 无效");
        return { type: raw.type, input: { enabled: raw.input.enabled, loadCaseId: raw.input.loadCaseId, gravity: vector(raw.input.gravity, "gravity") as Vector3 } };
      case "set_node_position": only(raw, ["type", "id", "position"]); return { type: raw.type, id: requiredId(raw.id, "id") as NodeId, position: vector(raw.position, "position", true) as Partial<Vector3> };
      case "set_member": only(raw, ["type", "id", "changes"]); if (!isRecord(raw.changes)) throw new Error("changes 无效"); return { type: raw.type, id: requiredId(raw.id, "id") as MemberId, changes: clone(raw.changes) as Partial<MemberProperties> };
      default: throw new Error(`不支持的诊断候选操作 ${raw.type}`);
    }
  });
}

export function captureDiagnosticInput(copy: DiagnosticCopy, sourceId?: string) {
  if (!sourceId) return captureAnalysisInput(copy.model);
  if (/^CB[1-9]\d*$/.test(sourceId)) return captureAnalysisInput({ ...copy.model, activeLoadCombinationId: sourceId });
  if (/^LC[1-9]\d*$/.test(sourceId)) return captureAnalysisInput({ ...copy.model, activeLoadCombinationId: undefined, activeLoadCaseId: sourceId }, sourceId);
  throw new Error(`分析来源 ${sourceId} 无效`);
}

export function checkDiagnosticCopy(copy: DiagnosticCopy, sourceId?: string): DiagnosticCheck {
  const input = captureDiagnosticInput(copy, sourceId);
  const diagnostics = checkAnalysisInput(input);
  return { status: diagnostics.length ? "invalid" : "valid", copyId: copy.id, projectId: copy.model.id, projectRevision: copy.model.revision, sourceId, diagnostics: clone(diagnostics), targets: diagnosticTargets(diagnostics) };
}

function summaryFor(label: string, source: DiagnosticCopySource, check: DiagnosticCheck, operations: readonly DiagnosticOperation[], status: DiagnosticTrial["status"], stage?: AnalysisStage): DiagnosticSummary {
  const solverCodes = new Set(["singular-system", "solver-error", "non-finite-displacement", "non-finite-reaction", "non-finite-stiffness", "non-finite-load"]);
  const proven = check.diagnostics.filter((item) => !solverCodes.has(item.code)).map((item) => `已证实输入问题：${item.message}`);
  const hypotheses: string[] = [];
  for (const diagnostic of check.diagnostics.filter((item) => solverCodes.has(item.code))) hypotheses.push(`已观察到${diagnostic.message}；约束不足、机构或数值病态等原因仍待验证`);
  if (status === "complete") hypotheses.push("数值求解成功，但尚未证明支座、连接、荷载和工程意图合理");
  const attempted = ["检查工具输入完整性、几何拓扑、连接关系和约束自由度"];
  if (stage) attempted.push(`执行${stage}阶段试算`);
  if (operations.length) attempted.push(`在隔离副本中尝试 ${operations.length} 项候选处理：${label}`);
  const impact = operations.length ? ["候选改动只存在于诊断副本，不改变正式模型；若要改变工程含义，必须另行形成草案并确认"] : ["没有候选改动写入正式模型"];
  const remaining = status === "complete" ? ["仍需由工程人员确认边界条件、连接和荷载是否符合原意", "数值成功不能作为安全或规范符合性结论"] : ["修复假设尚未被正式模型确认", "需要补充证据或由用户选择下一步候选处理"];
  return { evidence: [`副本 ${check.copyId} 来源于项目 ${source.projectId} · R${source.projectRevision}`, `${check.diagnostics.length} 条结构化诊断证据`], proven, hypotheses, attempted, impact, remaining };
}

export interface DiagnosticTrialRequest { label: string; operations: readonly DiagnosticOperation[]; sourceId?: string; }

export function prepareDiagnosticTrial(copy: DiagnosticCopy, request: DiagnosticTrialRequest) {
  if (!request.label.trim()) throw new Error("诊断试算标签不能为空");
  let candidate = copy;
  let normalized: DiagnosticOperation[] = [];
  let check: DiagnosticCheck;
  try {
    normalized = validateDiagnosticOperations(request.operations);
    candidate = applyDiagnosticOperations(copy, normalized);
    const operationSources = [...new Set(normalized.flatMap((operation) => {
      if (operation.type === "set_nodal_load" || operation.type === "set_uniform_load") return [operation.loadCaseId];
      if (operation.type === "set_self_weight") return [operation.input.loadCaseId];
      return [];
    }))];
    const sourceId = request.sourceId ?? (operationSources.length === 1 ? operationSources[0] : undefined);
    if (!sourceId && operationSources.length > 1) throw new Error("候选操作涉及多个工况，请明确 sourceId");
    check = checkDiagnosticCopy(candidate, sourceId);
  } catch (error) {
    check = { status: "invalid", copyId: copy.id, projectId: copy.model.id, projectRevision: copy.model.revision, sourceId: request.sourceId, diagnostics: [{ code: "invalid-diagnostic-operation", message: error instanceof Error ? error.message : String(error) }], targets: [] };
  }
  return { candidate, normalized, check, request };
}

export function finishDiagnosticTrial(prepared: ReturnType<typeof prepareDiagnosticTrial>, result?: AnalysisResult, error?: unknown, stages: AnalysisStage[] = []): { copy: DiagnosticCopy; trial: DiagnosticTrial } {
  const { candidate, normalized, check, request } = prepared;
  const status: DiagnosticTrial["status"] = result ? "complete" : "failed";
  let stage: AnalysisStage | undefined;
  let solverMessage: string | undefined;
  let failedRun: AnalysisRunRecord | undefined;
  if (error instanceof AnalysisFailure) {
    if (error instanceof AnalysisServiceFailure) failedRun = clone(error.run);
    stage = error.stage; solverMessage = error.message;
    check.diagnostics = [...check.diagnostics, ...clone(error.diagnostics)];
    check.targets = diagnosticTargets(check.diagnostics);
  } else if (error) {
    stage = stages.at(-1) ?? "model-check"; solverMessage = error instanceof Error ? error.message : String(error);
    check.diagnostics = [...check.diagnostics, { code: "solver-error", message: solverMessage }];
  }
  const trial: DiagnosticTrial = {
    id: `${candidate.id}_trial_${candidate.trials.length + 1}_${globalThis.crypto.randomUUID().slice(0, 8)}`,
    copyId: candidate.id,
    label: request.label.trim(),
    createdAt: new Date().toISOString(),
    source: clone(candidate.source),
    operations: clone(normalized.length ? normalized : [...request.operations]),
    status,
    engineeringValidity: status === "complete" ? "numerically-solved-not-engineering-validated" : "not-solved",
    evidence: { ...check, stages: stages.length ? stages : ["model-check"], service: result?.service ?? failedRun, ...(stage ? { stage } : {}), ...(solverMessage ? { solverMessage } : {}) },
    ...(result ? { result } : {}),
    summary: summaryFor(request.label.trim(), candidate.source, check, normalized.length ? normalized : request.operations, status, stage),
  };
  const next = { ...candidate, model: clone(candidate.model), trials: [...candidate.trials, clone(trial)] };
  return { copy: next, trial: clone(trial) };
}

/** Synchronous TypeScript reference for tests only; desktop dispatch uses the native task. */
export function runDiagnosticTrial(copy: DiagnosticCopy, request: DiagnosticTrialRequest): { copy: DiagnosticCopy; trial: DiagnosticTrial } {
  const prepared = prepareDiagnosticTrial(copy, request);
  const stages: AnalysisStage[] = [];
  if (prepared.check.status !== "valid") return finishDiagnosticTrial(prepared);
  try {
    const result = executeAnalysisRequest(createAnalysisRequest(captureDiagnosticInput(prepared.candidate, prepared.check.sourceId), diagnosticAnalysisOrigin(prepared.candidate)), (record) => stages.push(record.stage));
    return finishDiagnosticTrial(prepared, result, undefined, stages);
  } catch (error) { return finishDiagnosticTrial(prepared, undefined, error, stages); }
}

export function diagnosticAnalysisOrigin(copy: DiagnosticCopy) {
  return { kind: "diagnostic-copy" as const, copyId: copy.id, sourceProjectId: copy.source.projectId,
    sourceProjectRevision: copy.source.projectRevision, sourceAnalysisId: copy.source.analysisId };
}


export function readDiagnosticCopy(copy: DiagnosticCopy, options: { collection: DiagnosticCopyCollection; offset?: number; limit?: number } = { collection: "summary" }): DiagnosticReadResult {
  const offset = options.offset ?? 0; const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("诊断读取分页参数无效");
  const collections: Record<DiagnosticCopyCollection, readonly unknown[]> = {
    summary: [{ copyId: copy.id, source: copy.source, modelRevision: copy.model.revision, counts: { nodes: copy.model.nodes.length, members: copy.model.members.length, supports: copy.model.supports.length, loads: copy.model.nodalLoads.length + copy.model.uniformLoads.length, trials: copy.trials.length } }],
    nodes: copy.model.nodes,
    members: copy.model.members,
    supports: copy.model.supports,
    loads: [...copy.model.nodalLoads.map((item) => ({ kind: "nodal", ...item })), ...copy.model.uniformLoads],
    trials: copy.trials,
  };
  const items = collections[options.collection];
  const page = items.slice(offset, offset + limit);
  return { copyId: copy.id, source: clone(copy.source), collection: options.collection, total: items.length, items: clone(page), page: { offset, limit, hasMore: offset + page.length < items.length, nextOffset: offset + page.length } };
}

export function compareDiagnosticTrials(beforeCopy: DiagnosticCopy, beforeId: string, afterCopy: DiagnosticCopy, afterId: string): DiagnosticComparison;
export function compareDiagnosticTrials(copy: DiagnosticCopy, beforeId: string, afterId: string): DiagnosticComparison;
export function compareDiagnosticTrials(first: DiagnosticCopy, beforeId: string, third: DiagnosticCopy | string, fourth?: string): DiagnosticComparison {
  const second = typeof third === "string" ? first : third;
  const afterId = typeof third === "string" ? third : fourth!;
  const before = first.trials.find((item) => item.id === beforeId); const after = second.trials.find((item) => item.id === afterId);
  const issues: string[] = [];
  if (!before || !after) issues.push("指定的诊断试算不存在");
  if (before && after && first.id !== second.id) issues.push("两份试算属于不同诊断副本，不能比较");
  if (before && after && before.status !== "complete") issues.push("前一份试算没有成功数值结果");
  if (before && after && after.status !== "complete") issues.push("后一份试算没有成功数值结果");
  const analysis = before?.result && after?.result && !issues.length ? compareAnalysisResults(before.result, after.result) : undefined;
  if (analysis && !analysis.compatible) issues.push(...analysis.issues);
  const summary = !before || !after ? "无法读取指定诊断试算" : issues.length ? `诊断试算不可比：${issues.join("；")}` : `已比较“${before.label}”与“${after.label}”；数值差异仍需结合工程条件核对，不能把成功等同于工程合理`;
  return { copyId: first.id, beforeId, afterId, compatible: issues.length === 0 && Boolean(analysis), issues, ...(analysis ? { analysis } : {}), summary };
}
