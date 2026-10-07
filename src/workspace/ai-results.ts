import { RANDOM_RESPONSE_MEANING, randomSpectra } from "../domain/random-response";
import { getMemberSectionForces, type AnalysisResult } from "../domain/analysis";
import { indeterminateRotationComponents } from "../domain/member-releases";
import { ANALYSIS_FORCE_COMPONENTS } from "../domain/analysis-comparison";
import { selectedMeshLevel } from "../domain/analysis-mesh";
import type { FrameProject, Vector3 } from "../domain/project";
import { BUCKLING_MEANING } from "../domain/buckling";
import { SECOND_ORDER_MEANING } from "../domain/second-order";
import { modalDampingStatus, modalTruncationCheck } from "../domain/modal-damping";

export interface ResultReference {
  token: string;
  analysisId: string;
  inputRevision: number;
  createdAt: string;
  current: boolean;
  source: { id: string; name: string; kind: "case" | "combination"; terms?: { loadCaseId: string; factor: number }[] };
  object: { kind: "node" | "member"; id: string; label: string; position: Vector3; endPosition?: Vector3 };
  quantity: string;
  component: string;
  coordinateSystem: "global XYZ" | "local xyz";
  position?: number;
  value: number;
  unit: string;
}

interface ResultQuery { field: string; equals?: string | number | boolean; min?: number; max?: number; }
const resultFields: Record<string, readonly string[]> = {
  nodes: ["nodeId", "object.id", "object.label", "displacement.x", "displacement.y", "displacement.z", "rotation.x", "rotation.y", "rotation.z", "reaction.x", "reaction.y", "reaction.z", "reactionMoment.x", "reactionMoment.y", "reactionMoment.z"],
  members: ["memberId", "object.id", "object.label", "length", "localEndForces.start.0", "localEndForces.start.1", "localEndForces.start.2", "localEndForces.start.3", "localEndForces.start.4", "localEndForces.start.5", "localEndForces.end.0", "localEndForces.end.1", "localEndForces.end.2", "localEndForces.end.3", "localEndForces.end.4", "localEndForces.end.5"],
};

function readPath(value: unknown, path: string): unknown {
  if (value && typeof value === "object" && Object.hasOwn(value, path)) return (value as Record<string, unknown>)[path];
  return path.split(".").reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, value);
}

function validateQuery(collection: string, fields: unknown, query: unknown): void {
  if (fields !== undefined && (!Array.isArray(fields) || fields.length < 1 || fields.length > 12 || fields.some((field) => typeof field !== "string" || !resultFields[collection]?.includes(field)))) throw new Error("结果 fields 不是该集合支持的字段列表");
  if (query === undefined) return;
  if (!query || typeof query !== "object" || Array.isArray(query)) throw new Error("结果 query 必须是对象");
  const value = query as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["field", "equals", "min", "max"].includes(key)) || typeof value.field !== "string" || !resultFields[collection]?.includes(value.field)) throw new Error("结果 query.field 不是该集合的可查询字段");
  if (Array.isArray(fields) && !fields.includes(value.field)) throw new Error("结果 fields 必须包含 query.field");
  const hasEquals = value.equals !== undefined; const hasRange = value.min !== undefined || value.max !== undefined;
  if ((hasEquals && hasRange) || !hasEquals && !hasRange) throw new Error("结果 query 必须提供 equals 或 min/max");
  if (hasEquals && !["string", "number", "boolean"].includes(typeof value.equals)) throw new Error("结果 query.equals 类型无效");
  for (const key of ["min", "max"] as const) if (value[key] !== undefined && (typeof value[key] !== "number" || !Number.isFinite(value[key]))) throw new Error(`结果 query.${key} 必须是有限数值`);
  if (typeof value.min === "number" && typeof value.max === "number" && value.min > value.max) throw new Error("结果 query.min 不能大于 query.max");
}

function filterResults(items: readonly unknown[], fields: unknown, query: unknown): readonly unknown[] {
  const projected = items.map((item) => Array.isArray(fields) ? Object.fromEntries(fields.map((field) => [field, readPath(item, field)])) : item);
  if (!query) return projected;
  const condition = query as ResultQuery;
  return projected.filter((item) => {
    const actual = readPath(item, condition.field);
    if (condition.equals !== undefined) return actual === condition.equals;
    return typeof actual === "number" && (condition.min === undefined || actual >= condition.min) && (condition.max === undefined || actual <= condition.max);
  });
}

export function analysisProvenance(result: AnalysisResult, current: boolean) {
  const combination = result.input.combination?.definition;
  return { analysisId: result.id, inputRevision: result.input.projectRevision, createdAt: result.createdAt, current,
    source: result.input.analysisCase ? { id: result.input.analysisCase.id, name: result.input.analysisCase.name, kind: "case" as const }
      : combination ? { id: combination.id, name: combination.name, kind: "combination" as const, terms: combination.terms }
      : { id: result.input.loadCase?.id ?? "LC1", name: result.input.loadCase?.name ?? "旧版工况", kind: "case" as const },
    analysisCase: result.input.analysisCase, assumptions: result.input.assumptions, solver: result.input.solver, service: result.service,
    meshPolicy: result.input.meshPlan?.policy,
    discretization: result.discretization ? { ...result.discretization, runs: result.discretization.runs.map(({ divisions, error }) => ({ divisions, error })) } : undefined, status: current ? "当前模型结果" : "历史输入结果，当前模型需重新计算" };
}

function fields(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error("结果工具含未定义字段");
}

export function readResults(result: AnalysisResult, current: boolean, input: Record<string, unknown>, project?: FrameProject) {
  fields(input, ["analysisId", "collection", "offset", "limit", "fields", "query"]);
  const collection = input.collection;
  if (typeof collection !== "string" || !["summary", "nodes", "members", "mesh", "modes", "mass", "psd", "input-psd"].includes(collection)) throw new Error("结果集合必须为 summary、nodes、members、mesh、modes、mass、psd 或 input-psd");
  const offset = input.offset === undefined ? 0 : input.offset; const limit = input.limit === undefined ? 50 : input.limit;
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0
    || typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("结果分页须为非负 offset 与 1 至 100 的 limit");
  const provenance = { ...analysisProvenance(result, current), ...(result.secondOrder ? { method: "second-order", meaning: SECOND_ORDER_MEANING, completion: result.secondOrder.status } : {}), ...(result.modal ? { damping: project ? modalDampingStatus(project, result) : { status: "missing", message: "需读取项目阻尼配置", truncation: modalTruncationCheck(result) } } : {}) };
  if (result.random) {
    if (input.fields !== undefined || input.query !== undefined || !["summary", "psd", "input-psd"].includes(collection)) throw new Error("随机结果仅支持 summary、psd 与 input-psd；统计量不是静力位移、内力或振型");
    const r = result.random, s = result.input.analysisCase!.settings.random!, basis = result.input.randomBasis!;
    const spectra = randomSpectra(basis);
    const inputSources = spectra.map(({ sourceId, spectrum: { points, ...metadata } }) => ({ sourceId, ...metadata, totalPoints: points.length }));
    const { points: _points, ...spectrumMetadata } = spectra[0].spectrum;
    const spectrumPoints = spectra.flatMap(({ sourceId, spectrum }) => spectrum.points.map((point) => ({ ...point, sourceId, psdSpectrumId: spectrum.id })));
    if (collection === "summary") return { ...provenance, method: "random", meaning: RANDOM_RESPONSE_MEANING, response: r.response, coordinateSystem: r.coordinateSystem,
      rms: r.rms, rmsUnit: "m", variance: r.variance, varianceUnit: "m²", densityUnit: "m²/Hz", sidedness: r.sidedness, frequencyUnit: "Hz", bandHz: s.bandHz,
      frozenRandomSettings: s, modalAnalysisId: basis.modal.id, modalCreatedAt: basis.modal.createdAt, modeCount: r.modeCount,
      damping: basis.damping, inputSources, ...("spectrum" in basis ? { inputSpectrum: { ...spectrumMetadata, totalPoints: _points.length } } : {}), convergence: { ...r.convergence, runs: r.convergence.runs.map((run) => ({ ...run, rmsUnit: "m", varianceUnit: "m²" })) }, totalPoints: r.points.length };
    if (collection === "input-psd") {
      const items = spectrumPoints.slice(offset, offset + limit).map((p) => ({ sourceId: p.sourceId, psdSpectrumId: p.psdSpectrumId, frequencyHz: p.frequency, density: p.density, densityUnit: "kN²/Hz", frequencyUnit: "Hz" }));
      return { ...provenance, method: "random", collection, ...("spectrum" in basis ? { inputSpectrum: spectrumMetadata } : {}), inputSources, total: spectrumPoints.length, offset, limit, items,
        page: { empty: !items.length, hasMore: offset + items.length < spectrumPoints.length, nextOffset: offset + items.length } };
    }
    const items = r.points.slice(offset, offset + limit).map((p) => ({ ...p, densityUnit: "m²/Hz", frequencyUnit: "Hz", response: r.response, coordinateSystem: r.coordinateSystem }));
    return { ...provenance, method: "random", meaning: RANDOM_RESPONSE_MEANING, collection, total: r.points.length, offset, limit, items,
      page: { empty: !items.length, hasMore: offset + items.length < r.points.length, nextOffset: offset + items.length } };
  }
  if (["psd", "input-psd"].includes(collection)) throw new Error("本结果不是随机响应；输入谱请从 read_model psd-spectra 读取");
  if (result.buckling) {
    if (input.fields !== undefined || input.query !== undefined || !["summary", "modes", "mesh"].includes(collection)) throw new Error("屈曲仅支持 summary、modes、mesh；屈曲形态不是静力位移、内力或质量");
    const b = result.buckling;
    if (collection === "summary") return { ...provenance, method: "buckling", meaning: BUCKLING_MEANING, loads: result.input.bucklingLoads, modes: b.modes.map(({ number, factor, residual }) => ({ number, factor, residual })), convergence: b.convergence, counts: b.counts, prestress: b.prestress, normalization: b.normalization };
    const items = collection === "modes" ? b.modes : result.input.meshPlan!.levels.find((l) => l.divisions === b.selectedDivisions)!.elements;
    const pageItems = items.slice(offset, offset + limit);
    return { ...provenance, meaning: BUCKLING_MEANING, collection, total: items.length, offset, limit, items: pageItems, page: { empty: !pageItems.length, hasMore: offset + pageItems.length < items.length, nextOffset: offset + pageItems.length } };
  }
  if (result.modal) {
    if (input.fields !== undefined || input.query !== undefined) throw new Error("模态仅支持完整条目的分页读取");
    if (["nodes", "members"].includes(collection)) throw new Error("模态振型不是静力位移或内力；请读取 modes");
    const modal = result.modal;
    if (collection === "summary") return { ...provenance, method: "modal", totalMassKg: modal.totalMassKg, structuralMassKg: modal.structuralMassKg ?? modal.totalMassKg, additionalMassKg: modal.additionalMassKg ?? 0, modes: modal.modes.map(({ number, frequencyHz, kind, residual }) => ({ number, frequencyHz, kind, residual })), convergence: modal.convergence, counts: modal.counts, normalization: modal.normalization, amplitudeMeaning: "振型幅值仅表示归一化形态，显示缩放不代表受载实际位移", zeroEnergyModes: modal.zeroEnergyModes };
    const effective = project ? modalDampingStatus(project, result) : undefined;
    const items = collection === "modes" ? modal.modes.map((m) => ({ ...m, effectiveDamping: effective?.modes.find((v) => v.number === m.number)?.damping ?? null })) : collection === "mass" ? [...modal.sources.map((s) => ({ kind: "structural", ...s })), ...modal.additionalSources ?? []] : result.input.meshPlan!.levels.find((l) => l.divisions === modal.selectedDivisions)!.elements;
    const pageItems = items.slice(offset, offset + limit);
    return { ...provenance, collection, total: items.length, offset, limit, items: pageItems, page: { empty: !pageItems.length, hasMore: offset + pageItems.length < items.length, nextOffset: offset + pageItems.length } };
  }
  if (["modes", "mass"].includes(collection)) throw new Error("本结果不是模态分析");
  if (collection === "mesh") {
    if (input.fields !== undefined || input.query !== undefined) throw new Error("mesh 只支持完整映射条目的分页读取");
    const level = selectedMeshLevel(result);
    const items = level?.elements.slice(offset, offset + limit) ?? [];
    return { ...provenance, collection, total: level?.elements.length ?? 0, offset, limit, items,
      page: { empty: items.length === 0, hasMore: offset + items.length < (level?.elements.length ?? 0), nextOffset: offset + items.length },
      scope: "冻结工程杆件到实际内部单元及沿杆位置的映射。内部身份不能用于建模编辑或工程结果选中。" };
  }
  if (collection === "summary") {
    if (input.fields !== undefined || input.query !== undefined) throw new Error("summary 只能读取完整分析摘要，不能按字段或范围筛选");
    const displacementExtrema = (["x", "y", "z"] as const).map((component) => {
      const node = result.nodes.reduce<typeof result.nodes[number] | undefined>((best, item) => !best || Math.abs(item.displacement[component]) > Math.abs(best.displacement[component]) ? item : best, undefined);
      return node ? { nodeId: node.nodeId, component, value: node.displacement[component], unit: "m", criterion: "节点平移分量绝对值最大，非沿杆连续极值" } : null;
    });
    return { ...provenance, ...(result.secondOrder ? { secondOrder: { ...result.secondOrder, runs: result.secondOrder.runs.map(({ divisions, error, calculation }) => ({ divisions, error, equations: calculation.vector.length, iterations: calculation.iterations.map(({ displacement: _u, correction: _d, ...record }) => record), linearIdentity: calculation.linearRun.service, linearNodes: calculation.linearRun.nodes.slice(0, result.input.nodes.length) })) } } : {}), counts: { nodes: result.nodes.length, members: result.members.length }, displacementExtrema,
      frozenConditions: { supports: result.input.supports.slice(0, limit), nodalLoads: result.input.nodalLoads.slice(0, limit),
        uniformLoads: (result.input.uniformLoads ?? []).slice(0, limit), selfWeight: result.input.selfWeight,
        originalCombinationLoads: result.input.combination ? {
          nodalLoads: result.input.combination.cases.flatMap((item) => item.nodalLoads).slice(0, limit),
          uniformLoads: result.input.combination.cases.flatMap((item) => item.uniformLoads).slice(0, limit),
          selfWeight: result.input.combination.cases.slice(0, limit).map((item) => ({ ...item.selfWeight, loadCaseId: item.loadCase.id })),
          scope: "仅供核对的原工况荷载，尚未乘组合系数；上层nodalLoads/uniformLoads/selfWeight是已加权有效荷载，禁止再次加权。各类原荷载最多limit项。",
        } : undefined,
        total: { supports: result.input.supports.length, nodalLoads: result.input.nodalLoads.length, uniformLoads: result.input.uniformLoads?.length ?? 0 },
        limit, scope: "冻结输入的有效条件；组合荷载已按用户系数加权。仅展示各类前limit项，不是完整大模型荷载清单。" } };
  }
  const items = collection === "nodes" ? result.nodes.map((node) => ({ ...node,
    rotation: Object.fromEntries(Object.entries(node.rotation).map(([axis, value]) => [axis, indeterminateRotationComponents(result, node.nodeId).includes(axis as "x" | "y" | "z") ? null : value])),
    object: result.input.nodes.find((item) => item.id === node.nodeId),
    units: { displacement: "m", rotation: "rad", reaction: "kN", reactionMoment: "kN·m" }, coordinateSystem: "global XYZ" }))
    : result.members.map((member) => ({ ...member, object: result.input.members.find((item) => item.id === member.memberId),
      components: ANALYSIS_FORCE_COMPONENTS, signConvention: "杆端节点作用力；截面正局部 x 面内力由 read_result sectionForces 获取" }));
  validateQuery(collection, input.fields, input.query);
  const filtered = filterResults(items, input.fields, input.query);
  const pageItems = filtered.slice(offset, offset + limit);
  return { ...provenance, collection, total: filtered.length, offset, limit, items: pageItems, query: input.query, fields: input.fields,
    ...(collection === "nodes" && result.process?.releaseNullRotations?.length ? { rotationMeaning: "null = undetermined disconnected node rotation; solver coordinates are reference values. Beam-end slopes are recovered separately." } : {}),
    page: { empty: pageItems.length === 0, hasMore: offset + pageItems.length < filtered.length, nextOffset: offset + pageItems.length } };
}

export function readResult(result: AnalysisResult, current: boolean, input: Record<string, unknown>, callId: string): ResultReference {
  fields(input, ["analysisId", "kind", "id", "quantity", "component", "position"]);
  if (typeof input.id !== "string" || typeof input.component !== "string" || typeof input.quantity !== "string") throw new Error("结果项需提供稳定对象身份、类型与分量");
  const provenance = analysisProvenance(result, current);
  const quantity = input.quantity; const component = input.component;
  if (result.random) {
    const r = result.random;
    if (input.kind !== "node" || input.id !== r.response.nodeId || component !== r.response.component || quantity !== "rms" || input.position !== undefined) throw new Error("随机结果只提供所选节点平移分量的统计 RMS；PSD 使用 read_results psd 分页读取");
    const node = result.input.nodes.find((n) => n.id === r.response.nodeId)!;
    return { token: `[[result:${callId}]]`, analysisId: result.id, inputRevision: provenance.inputRevision, createdAt: result.createdAt, current,
      source: provenance.source, object: { kind: "node", id: node.id, label: node.label, position: node.position }, quantity: "rms", component, coordinateSystem: "global XYZ", value: r.rms, unit: "m" };
  }
  let object: ResultReference["object"]; let value: number; let unit: string;
  if (input.kind === "node") {
    if (input.position !== undefined) throw new Error("节点结果不接受沿杆位置");
    const node = result.input.nodes.find((item) => item.id === input.id);
    const response = result.nodes.find((item) => item.nodeId === input.id);
    if (!node || !response) throw new Error("本次分析无此节点");
    if (component !== "x" && component !== "y" && component !== "z") throw new Error("节点分量须为全局 x、y、z");
    if (quantity === "rotation" && indeterminateRotationComponents(result, node.id).includes(component)) throw new Error("该节点转角分量含完全脱开的转动方向，数值只是坐标参考，不能作为真实响应引用；梁端转角见原生杆件恢复记录");
    const quantities = { displacement: { vector: response.displacement, unit: "m" }, rotation: { vector: response.rotation, unit: "rad" },
      reaction: { vector: response.reaction, unit: "kN" }, reactionMoment: { vector: response.reactionMoment, unit: "kN·m" } };
    if (!Object.hasOwn(quantities, quantity)) throw new Error("无效节点结果类型");
    const item = quantities[quantity as keyof typeof quantities]; value = item.vector[component]; unit = item.unit;
    object = { kind: "node", id: node.id, label: node.label, position: node.position };
  } else if (input.kind === "member") {
    const member = result.input.members.find((item) => item.id === input.id);
    const response = result.members.find((item) => item.memberId === input.id);
    if (!member || !response) throw new Error("本次分析无此杆件");
    const index = ANALYSIS_FORCE_COMPONENTS.findIndex((item) => item.label === component);
    if (index < 0) throw new Error("杆件分量须为 N、Vy、Vz、T、My、Mz");
    if (quantity === "sectionForces") {
      if (typeof input.position !== "number") throw new Error("截面内力需指定距起点位置（m）");
      value = getMemberSectionForces(result, member.id, input.position).forces[index];
    } else if (quantity === "startEndForces" || quantity === "endEndForces") {
      if (input.position !== undefined) throw new Error("杆端作用力不接受截面位置");
      value = response.localEndForces[quantity === "startEndForces" ? "start" : "end"][index];
    } else throw new Error("无效杆件结果类型");
    unit = ANALYSIS_FORCE_COMPONENTS[index].unit;
    object = { kind: "member", id: member.id, label: member.label,
      position: result.input.nodes.find((node) => node.id === member.startNodeId)!.position,
      endPosition: result.input.nodes.find((node) => node.id === member.endNodeId)!.position };
  } else throw new Error("结果对象须为 node 或 member");
  if (!Number.isFinite(value)) throw new Error("结果包含非有限数值");
  return { token: `[[result:${callId}]]`, analysisId: result.id, inputRevision: provenance.inputRevision, createdAt: result.createdAt, current,
    source: provenance.source, object, quantity, component, coordinateSystem: input.kind === "node" ? "global XYZ" : "local xyz",
    ...(quantity === "sectionForces" ? { position: input.position as number } : {}), value, unit };
}

export const RESULT_QUANTITY_LABELS: Record<string, string> = { rms: "平移 RMS（统计均方根，非瞬时峰值）", displacement: "位移", rotation: "转角", reaction: "反力", reactionMoment: "反力矩",
  sectionForces: "截面内力（正局部 x 面）", startEndForces: "起点杆端作用力", endEndForces: "终点杆端作用力" };
export function resultReferenceLabel(ref: ResultReference): string {
  return `${ref.object.label} · ${RESULT_QUANTITY_LABELS[ref.quantity]} ${ref.component}${ref.position !== undefined ? ` @ ${ref.position} m` : ""} = ${ref.value.toPrecision(8)} ${ref.unit}`;
}
