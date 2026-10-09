import type { CadCenterline } from "./cad-geometry";
import type { CadTopologyPreview } from "./cad-topology";

export const CAD_SECTION_TOLERANCE_M = 1e-7;
export const CAD_SECTION_METHOD = "planar-polygon-v1";
export const CAD_RECTANGULAR_TORSION_METHOD = "saint-venant-rectangle-v1";

export type CadResourceStatus = "verified" | "blocked" | "needs-user-confirmation";

export interface CadSectionProperties {
  areaM2: number;
  secondMomentYM4: number;
  secondMomentZM4: number;
  torsionalConstantM4?: number;
}

export interface CadSectionResource {
  id: string;
  sourceEntityIds: number[];
  memberIds: string[];
  status: CadResourceStatus;
  properties?: CadSectionProperties;
  profile?: { verticesM: Array<[number, number]>; centroidM: [number, number]; normal: [number, number, number] };
  memberProfiles?: Array<{ memberId: string; verticesM: Array<[number, number]>; normal: [number, number, number] }>;
  basis: {
    method: string;
    units: { area: "m²"; secondMoment: "m⁴"; torsion: "m⁴" };
    applicability: string;
    uncertainty: string;
    references: string[];
  };
  issues: string[];
}

/** A user supplied replacement is evidence, rather than a silent overwrite. */
export interface CadSectionCorrection {
  sectionId: string;
  original?: CadSectionProperties;
  replacement: CadSectionProperties;
  reference: string;
  confirmed: boolean;
  recordedAt?: string;
  recordedBy?: "user";
}

export interface CadMaterialResource {
  status: CadResourceStatus;
  name?: string;
  elasticModulusGPa?: number;
  poissonRatio?: number;
  densityKgM3?: number;
  source: "user" | "step" | "catalog" | "missing";
  confirmed?: boolean;
  issues: string[];
}

export interface CadJointAssumption {
  kind: "rigid";
  status: "confirmed" | "needs-user-confirmation";
  source: "user" | "unset";
  evidence: string;
}

export interface CadResourceReview {
  schemaVersion: 1;
  status: CadResourceStatus;
  sections: CadSectionResource[];
  material: CadMaterialResource;
  joint: CadJointAssumption;
  checks: CadResourceCheck[];
  ai: CadAiVerification;
  corrections: CadSectionCorrection[];
}

export interface CadResourceCheck {
  code: string;
  status: "passed" | "failed" | "needs-user-confirmation";
  severity: "error" | "warning";
  message: string;
  evidence: string[];
}

export interface CadAiVerification {
  status: "not-requested" | "pending" | "accepted" | "rejected" | "needs-human" | "invalid" | "format-error" | "timeout" | "failed";
  request: { schemaVersion: 1; geometryHash?: string; sections: unknown[]; material: unknown; joint: unknown; corrections?: CadSectionCorrection[]; checks: CadResourceCheck[] };
  response?: { decision: "accept" | "reject" | "needs-human"; findings: Array<{ checkCode: string; decision: "accept" | "reject" | "needs-human"; evidence: string[]; message: string }> };
  error?: string;
}

export interface CadAiVerificationTransport {
  chatDeepSeek(request: { requestId: string; messages: Array<{ role: "system" | "user"; content: string }> }): Promise<{ status: string; message: string; assistant?: { content: string | null } }>;
  cancelDeepSeekChat?(requestId: string): Promise<void>;
}

type Point2 = [number, number];
type Point3 = [number, number, number];
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const cross = (a: number[], b: number[]): Point3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => Math.hypot(...a);
const unit = (a: number[]): Point3 => { const n = norm(a); if (!(n > CAD_SECTION_TOLERANCE_M)) throw new Error("截面主轴长度无效"); return [a[0] / n, a[1] / n, a[2] / n]; };
const round = (v: number) => Math.round(v * 1e12) / 1e12;

function profileBasis(axis: number[], points: number[][]): { origin: number[]; u: Point3; v: Point3; n: Point3 } {
  const n = unit(axis), candidate = points.find((p) => norm(sub(p, points[0])) > CAD_SECTION_TOLERANCE_M);
  if (!candidate) throw new Error("端截面至少需要两个不同点");
  let u = sub(candidate, points[0]); u = sub(u, n.map((x) => x * dot(u, n))); const uUnit = unit(u);
  const v = unit(cross(n, uUnit));
  return { origin: points[0], u: uUnit, v, n };
}

function orderProfile(points: Point2[]): Point2[] {
  if (points.length < 3) throw new Error("端截面至少需要三个点");
  const center: Point2 = [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
  const ordered = [...points].sort((a, b) => Math.atan2(a[1] - center[1], a[0] - center[0]) - Math.atan2(b[1] - center[1], b[0] - center[0]));
  const orientation = (a: Point2, b: Point2, c: Point2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const intersects = (a: Point2, b: Point2, c: Point2, d: Point2) => {
    const ab = orientation(a, b, c), ab2 = orientation(a, b, d), cd = orientation(c, d, a), cd2 = orientation(c, d, b);
    return ((ab > CAD_SECTION_TOLERANCE_M && ab2 < -CAD_SECTION_TOLERANCE_M) || (ab < -CAD_SECTION_TOLERANCE_M && ab2 > CAD_SECTION_TOLERANCE_M))
      && ((cd > CAD_SECTION_TOLERANCE_M && cd2 < -CAD_SECTION_TOLERANCE_M) || (cd < -CAD_SECTION_TOLERANCE_M && cd2 > CAD_SECTION_TOLERANCE_M));
  };
  for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
    if (j === i + 1 || (i === 0 && j === ordered.length - 1)) continue;
    if (intersects(ordered[i], ordered[(i + 1) % ordered.length], ordered[j], ordered[(j + 1) % ordered.length])) throw new Error("端截面边界自相交，无法确定面积");
  }
  return ordered;
}

function polygonProperties(input: Point2[]): { area: number; centroid: Point2; iy: number; iz: number } {
  const points = orderProfile(input), terms = points.map((p, i) => { const q = points[(i + 1) % points.length]; return p[0] * q[1] - q[0] * p[1]; });
  const signed = terms.reduce((s, v) => s + v, 0) / 2;
  if (Math.abs(signed) <= CAD_SECTION_TOLERANCE_M ** 2) throw new Error("端截面面积接近零");
  const area = Math.abs(signed), sign = signed < 0 ? -1 : 1;
  const centroid: Point2 = [terms.reduce((s, t, i) => s + (points[i][0] + points[(i + 1) % points.length][0]) * t, 0) / (6 * signed), terms.reduce((s, t, i) => s + (points[i][1] + points[(i + 1) % points.length][1]) * t, 0) / (6 * signed)];
  let ixx = 0, iyy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i], [q, r] = points[(i + 1) % points.length], t = terms[i];
    ixx += (y * y + y * r + r * r) * t; iyy += (x * x + x * q + q * q) * t;
  }
  // y is the local section y axis and z is local section z; area moments are
  // reported about centroidal axes after the parallel-axis correction.
  const iy = Math.abs(ixx / 12 - signed * centroid[1] ** 2);
  const iz = Math.abs(iyy / 12 - signed * centroid[0] ** 2);
  if (![area, ...centroid, iy, iz, sign].every(finite) || iy <= 0 || iz <= 0) throw new Error("端截面惯性矩无效");
  return { area, centroid, iy, iz };
}

function rectangleTorsion(width: number, height: number): number {
  const a = Math.max(width, height), c = Math.min(width, height), ratio = c / a;
  return a * c ** 3 * (1 / 3 - 0.21 * ratio * (1 - ratio ** 4 / 12));
}

function rectangularProfile(points: Point2[], centroid: Point2): { width: number; height: number } | null {
  const unique = [...new Map(points.map((p) => [`${round(p[0])}:${round(p[1])}`, p])).values()];
  if (unique.length !== 4) return null;
  const xs = [...new Set(unique.map((p) => round(p[0])))], ys = [...new Set(unique.map((p) => round(p[1])))];
  if (xs.length !== 2 || ys.length !== 2 || unique.some((p) => Math.abs(p[0] - centroid[0]) > 1e9 || Math.abs(p[1] - centroid[1]) > 1e9)) return null;
  const expected = xs.flatMap((x) => ys.map((y) => `${x}:${y}`));
  if (unique.some((p) => !expected.includes(`${round(p[0])}:${round(p[1])}`))) return null;
  return { width: Math.abs(xs[1] - xs[0]), height: Math.abs(ys[1] - ys[0]) };
}

function profilesEquivalent(a: CadSectionResource, b: CadSectionResource): boolean {
  if (!a.profile || !b.profile || a.profile.verticesM.length !== b.profile.verticesM.length) return false;
  return a.profile.verticesM.every((point) => b.profile!.verticesM.some((other) => Math.hypot(point[0] - other[0], point[1] - other[1]) <= CAD_SECTION_TOLERANCE_M));
}

export function calculateCadSectionResource(centerline: CadCenterline, memberIds: string[] = [], manual?: { properties: CadSectionProperties; reference: string; confirmed: boolean }): CadSectionResource {
  const base = { id: `cad-section:${centerline.solidId}`, sourceEntityIds: [...centerline.sourceEntityIds], memberIds: [...memberIds], basis: { method: CAD_SECTION_METHOD, units: { area: "m²" as const, secondMoment: "m⁴" as const, torsion: "m⁴" as const }, applicability: "平面、闭合、直边、恒截面且中心对称的端截面；主轴和端截面来自确定性 CAD 几何识别", uncertainty: "顶点坐标和识别容差传播；未对圆角、孔洞、曲线边界或制造偏差作外推", references: ["独立 CAD/人工截面测量须在确认前登记"] }, issues: [] as string[] };
  try {
    if (!centerline.endSections?.length || centerline.endSections.some((section) => section.length < 3)) throw new Error("缺少可靠端截面顶点");
    const basis = profileBasis(centerline.direction, centerline.endSections[0]);
    const projected = centerline.endSections[0].map((p) => [dot(sub(p, basis.origin), basis.u), dot(sub(p, basis.origin), basis.v)] as Point2);
    const second = centerline.endSections[1].map((p) => [dot(sub(p, basis.origin), basis.u), dot(sub(p, basis.origin), basis.v)] as Point2);
    if (second.length !== projected.length || projected.some((point) => !second.some((other) => Math.hypot(point[0] - other[0], point[1] - other[1]) <= CAD_SECTION_TOLERANCE_M))) throw new Error("两端截面不一致，不能假定恒截面");
    const props = polygonProperties(projected), ordered = orderProfile(projected), rectangle = rectangularProfile(ordered, props.centroid);
    if (!rectangle) throw new Error("一般多边形的 Saint-Venant J 未经独立参考验证，不能猜测");
    const torsionalConstantM4 = rectangleTorsion(rectangle.width, rectangle.height);
    const profile = { verticesM: ordered.map(([y, z]) => [round(y), round(z)] as [number, number]), centroidM: [round(props.centroid[0]), round(props.centroid[1])] as [number, number], normal: basis.n };
    return { ...base, status: "verified", profile, memberProfiles: memberIds.map((memberId) => ({ memberId, verticesM: profile.verticesM, normal: profile.normal })), properties: { areaM2: props.area, secondMomentYM4: props.iy, secondMomentZM4: props.iz, torsionalConstantM4 }, basis: { ...base.basis, method: `${CAD_SECTION_METHOD}+${CAD_RECTANGULAR_TORSION_METHOD}`, applicability: `${base.basis.applicability}；矩形端截面使用 SCI P385 矩形 Saint-Venant 近似` } };
  } catch (error) {
    if (manual?.confirmed && [manual.properties.areaM2, manual.properties.secondMomentYM4, manual.properties.secondMomentZM4, manual.properties.torsionalConstantM4].every((value) => finite(value) && value > 0) && manual.reference.trim() && centerline.direction.every(finite) && norm(centerline.direction) > CAD_SECTION_TOLERANCE_M) {
      return { ...base, status: "verified", memberProfiles: memberIds.map((memberId) => ({ memberId, verticesM: [], normal: unit(centerline.direction) })), properties: structuredClone(manual.properties), basis: { ...base.basis, method: "user-supplied-section-v1", applicability: "几何无法可靠计算；用户明确提供并确认 A/Iy/Iz/J", uncertainty: "依赖用户提供值及其独立参考", references: [manual.reference] }, issues: [error instanceof Error ? error.message : "几何参数未采用；已使用用户确认值"] };
    }
    return { ...base, status: "blocked", issues: [error instanceof Error ? error.message : "截面几何无法核验"] };
  }
}

export function validateCadMaterial(input: Partial<CadMaterialResource> | null | undefined): CadMaterialResource {
  const issues: string[] = [];
  if (!input || !input.name?.trim()) issues.push("材料名称未确认");
  if (!finite(input?.elasticModulusGPa) || input!.elasticModulusGPa! <= 0) issues.push("E 必须为正有限 GPa");
  if (!finite(input?.poissonRatio) || input!.poissonRatio! <= -1 || input!.poissonRatio! >= 0.5) issues.push("ν 必须位于 (-1, 0.5)");
  if (!finite(input?.densityKgM3) || input!.densityKgM3! <= 0) issues.push("ρ 必须为正有限 kg/m³");
  const source = input?.source ?? "missing";
  if (!["user", "step", "catalog", "missing"].includes(source)) issues.push("材料来源类型无效");
  if (source === "missing") issues.push("材料来源未确认");
  if (!input?.confirmed) issues.push("材料尚未由用户明确确认");
  return { status: issues.length ? "needs-user-confirmation" : "verified", name: input?.name?.trim(), elasticModulusGPa: input?.elasticModulusGPa, poissonRatio: input?.poissonRatio, densityKgM3: input?.densityKgM3, source, confirmed: input?.confirmed, issues };
}

export function makeRigidJointAssumption(confirmed = false): CadJointAssumption {
  return { kind: "rigid", status: confirmed ? "confirmed" : "needs-user-confirmation", source: confirmed ? "user" : "unset", evidence: confirmed ? "用户明确确认：导入拓扑的工程连接按刚接建模；几何接触本身不构成该事实" : "待用户明确确认；几何接触不自动推断连接刚度" };
}

export function buildCadResourceReview(input: { topology: CadTopologyPreview; centerlines: CadCenterline[]; geometryHash?: string; material?: Partial<CadMaterialResource> | null; rigidJointsConfirmed?: boolean; manualSections?: Record<string, { properties: CadSectionProperties; reference: string; confirmed: boolean; recordedAt?: string; recordedBy?: "user" }> }): CadResourceReview {
  const byId = new Map(input.centerlines.map((line) => [line.id, line]));
  const membersByLine = new Map<string, string[]>();
  for (const member of input.topology.members) membersByLine.set(member.parentId, [...(membersByLine.get(member.parentId) ?? []), member.id]);
  const originalCalculated = input.centerlines.map((line) => calculateCadSectionResource(line, membersByLine.get(line.id) ?? []));
  const calculated = input.centerlines.map((line) => calculateCadSectionResource(line, membersByLine.get(line.id) ?? [], input.manualSections?.[line.id]));
  const corrections: CadSectionCorrection[] = Object.entries(input.manualSections ?? {}).map(([sectionId, manual]) => ({ sectionId, original: originalCalculated.find((section) => section.id === `cad-section:${input.centerlines.find((line) => line.id === sectionId)?.solidId}`)?.properties, replacement: structuredClone(manual.properties), reference: manual.reference, confirmed: manual.confirmed, ...(manual.recordedAt ? { recordedAt: manual.recordedAt } : {}), recordedBy: manual.recordedBy ?? "user" }));
  // A resource is shared only when all calculated properties agree within the
  // registered geometry tolerance. Blocked sections stay separate so one
  // unresolved solid cannot hide another solid's provenance.
  const sections: CadSectionResource[] = [];
  for (const section of calculated) {
    const match = section.status === "verified" ? sections.find((candidate) => candidate.status === "verified" && profilesEquivalent(candidate, section) && candidate.properties && section.properties
      && Math.abs(candidate.properties.areaM2 - section.properties.areaM2) <= 1e-9
      && Math.abs(candidate.properties.secondMomentYM4 - section.properties.secondMomentYM4) <= 1e-12
      && Math.abs(candidate.properties.secondMomentZM4 - section.properties.secondMomentZM4) <= 1e-12
      && Math.abs((candidate.properties.torsionalConstantM4 ?? 0) - (section.properties.torsionalConstantM4 ?? 0)) <= 1e-12) : undefined;
    if (match) {
      match.memberIds = [...new Set([...match.memberIds, ...section.memberIds])];
      match.memberProfiles = [...(match.memberProfiles ?? []), ...(section.memberProfiles ?? [])];
      match.sourceEntityIds = [...new Set([...match.sourceEntityIds, ...section.sourceEntityIds])].sort((a, b) => a - b);
    } else sections.push(section);
  }
  for (const member of input.topology.members) if (!byId.has(member.parentId)) sections.push({ id: `cad-section:missing:${member.parentId}`, sourceEntityIds: member.sourceEntityIds, memberIds: [member.id], status: "blocked", basis: { method: CAD_SECTION_METHOD, units: { area: "m²", secondMoment: "m⁴", torsion: "m⁴" }, applicability: "需要中心线端截面", uncertainty: "无几何依据", references: [] }, issues: ["工程杆件缺少可追溯中心线"] });
  const material = validateCadMaterial(input.material);
  const joint = makeRigidJointAssumption(input.rigidJointsConfirmed);
  const checks: CadResourceCheck[] = [];
  if (!sections.length) checks.push({ code: "sections-present", status: "failed", severity: "error", message: "没有可追溯的工程截面资源", evidence: [] });
  const seenCenterlineIds = new Set<string>();
  for (const line of input.centerlines) {
    if (!Number.isInteger(line.solidId) || line.solidId < 0) checks.push({ code: `schema:centerline:${line.id}`, status: "failed", severity: "error", message: "中心线实体 ID 无效", evidence: [line.id] });
    if (seenCenterlineIds.has(line.id)) checks.push({ code: `duplicate:centerline:${line.id}`, status: "failed", severity: "error", message: "中心线 ID 重复", evidence: [line.id] });
    seenCenterlineIds.add(line.id);
    if (![...line.start, ...line.end, ...line.direction].every(finite)) checks.push({ code: `schema:coordinates:${line.id}`, status: "failed", severity: "error", message: "中心线坐标和方向必须为有限数值", evidence: [line.id] });
    if (!Number.isFinite(line.lengthM) || line.lengthM <= CAD_SECTION_TOLERANCE_M) checks.push({ code: `zero-length:${line.id}`, status: "failed", severity: "error", message: "中心线长度必须为正有限值", evidence: [line.id] });
    const lineEntityIds = new Set<number>();
    for (const entityId of line.sourceEntityIds) {
      if (!Number.isInteger(entityId) || entityId < 0) checks.push({ code: `schema:entity:${line.id}:${entityId}`, status: "failed", severity: "error", message: "来源实体 ID 无效", evidence: [line.id] });
      if (lineEntityIds.has(entityId)) checks.push({ code: `duplicate:entity:${line.id}:${entityId}`, status: "failed", severity: "error", message: "同一中心线重复引用来源实体", evidence: [`STEP 实体 #${entityId}`] });
      lineEntityIds.add(entityId);
    }
  }
  const memberIds = new Set(input.topology.members.map((member) => member.id));
  if (memberIds.size !== input.topology.members.length) checks.push({ code: "duplicate:member", status: "failed", severity: "error", message: "工程杆件 ID 重复", evidence: [] });
  const nodeIds = new Set(input.topology.nodes.map((node) => node.id));
  if (nodeIds.size !== input.topology.nodes.length) checks.push({ code: "duplicate:node", status: "failed", severity: "error", message: "拓扑节点 ID 重复", evidence: [] });
  for (const member of input.topology.members) {
    if (!member.parentId || !member.startNodeId || !member.endNodeId || member.startNodeId === member.endNodeId || !nodeIds.has(member.startNodeId) || !nodeIds.has(member.endNodeId) || !Array.isArray(member.range) || member.range.length !== 2 || member.range.some((value) => !finite(value))) checks.push({ code: `schema:member:${member.id}`, status: "failed", severity: "error", message: "工程杆件拓扑引用无效", evidence: [member.id] });
  }
  for (const section of sections) {
    const properties = section.properties;
    const complete = properties && [properties.areaM2, properties.secondMomentYM4, properties.secondMomentZM4, properties.torsionalConstantM4].every((value) => finite(value) && value > 0);
    checks.push({ code: `section:${section.id}`, status: section.status === "verified" && complete ? "passed" : "failed", severity: "error", message: section.status === "verified" && complete ? "A/Iy/Iz/J 已由确定性几何计算或用户引用确认" : section.issues.concat(complete ? [] : ["A/Iy/Iz/J 必须为正有限值"]).join("；"), evidence: section.sourceEntityIds.map((id) => `STEP 实体 #${id}`) });
  }
  checks.push({ code: "material", status: material.status === "verified" ? "passed" : "needs-user-confirmation", severity: "error", message: material.status === "verified" ? "材料参数已由用户/目录确认" : material.issues.join("；"), evidence: material.name ? [material.name] : [] });
  checks.push({ code: "rigid-joints", status: joint.status === "confirmed" ? "passed" : "needs-user-confirmation", severity: "error", message: joint.evidence, evidence: joint.status === "confirmed" ? ["用户刚接确认记录"] : [] });
  for (const issue of input.topology.issues) checks.push({ code: `topology:${issue.code}`, status: issue.severity === "blocking" ? "failed" : "needs-user-confirmation", severity: issue.severity === "blocking" ? "error" : "warning", message: issue.message, evidence: issue.sourceEntityIds?.map((id) => `STEP 实体 #${id}`) ?? [] });
  const status: CadResourceStatus = checks.some((check) => check.status === "failed") ? "blocked" : checks.some((check) => check.status === "needs-user-confirmation") ? "needs-user-confirmation" : "verified";
  const request = { schemaVersion: 1 as const, ...(input.geometryHash ? { geometryHash: input.geometryHash } : {}), sections: sections.map((section) => ({ id: section.id, memberIds: section.memberIds, sourceEntityIds: section.sourceEntityIds, status: section.status, properties: section.properties, basis: section.basis, issues: section.issues })), material: { name: material.name, elasticModulusGPa: material.elasticModulusGPa, poissonRatio: material.poissonRatio, densityKgM3: material.densityKgM3, source: material.source, confirmed: material.confirmed }, joint: { kind: joint.kind, status: joint.status, source: joint.source }, corrections: structuredClone(corrections), checks };
  return { schemaVersion: 1, status, sections, material, joint, checks, corrections, ai: { status: "not-requested", request } };
}

export function buildCadAiVerificationInput(review: CadResourceReview): CadAiVerification["request"] { return structuredClone(review.ai.request); }

export function applyCadAiVerification(review: CadResourceReview, response: unknown): CadResourceReview {
  try {
    if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("AI 核验响应必须为对象");
    const value = response as Record<string, unknown>, decision = value.decision;
    if (decision !== "accept" && decision !== "reject" && decision !== "needs-human") throw new Error("AI 核验结论无效");
    if (!Array.isArray(value.findings)) throw new Error("AI 核验必须逐项返回 findings");
    const findings = value.findings.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("AI 核验条目无效");
      const item = raw as Record<string, unknown>;
      if (typeof item.checkCode !== "string" || !["accept", "reject", "needs-human"].includes(String(item.decision)) || !Array.isArray(item.evidence) || !item.evidence.every((e) => typeof e === "string") || typeof item.message !== "string") throw new Error("AI 核验条目必须包含结论、证据和说明");
      const check = review.checks.find((candidate) => candidate.code === item.checkCode);
      if (!check) throw new Error(`AI 引用了未知检查 ${item.checkCode}`);
      if (!item.evidence.length || item.evidence.some((e) => !check.evidence.includes(e))) throw new Error(`AI 检查 ${item.checkCode} 未引用程序证据`);
      return { checkCode: item.checkCode, decision: item.decision as "accept" | "reject" | "needs-human", evidence: item.evidence as string[], message: item.message };
    });
    if (new Set(findings.map((item) => item.checkCode)).size !== findings.length) throw new Error("AI 核验不能重复引用同一检查");
    const complete = review.checks.every((check) => findings.some((item) => item.checkCode === check.code));
    const accepted = decision === "accept" && review.checks.length > 0 && complete && review.status === "verified" && !review.checks.some((check) => check.status !== "passed") && findings.every((item) => item.decision === "accept");
    const needsHuman = decision === "needs-human" || findings.some((item) => item.decision === "needs-human");
    const rejected = decision === "reject" || findings.some((item) => item.decision === "reject") || complete;
    const next = structuredClone(review); next.ai = { status: accepted ? "accepted" : needsHuman ? "needs-human" : rejected ? "rejected" : "invalid", request: buildCadAiVerificationInput(review), response: { decision, findings } }; return next;
  } catch (error) {
    return { ...structuredClone(review), ai: { status: "format-error", request: buildCadAiVerificationInput(review), error: error instanceof Error ? error.message : "AI 核验响应格式错误" } };
  }
}

/** Run the configured online model with a bounded request. The model receives only
 * the deterministic, already-redacted request and cannot mutate the review. */
export async function requestCadAiVerification(review: CadResourceReview, transport: CadAiVerificationTransport, options: { requestId?: string; timeoutMs?: number } = {}): Promise<CadResourceReview> {
  const requestId = options.requestId ?? `cad-resource-review:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const request = buildCadAiVerificationInput(review);
  const pending = structuredClone(review);
  pending.ai = { status: "pending", request };
  const timeoutMs = options.timeoutMs ?? 30_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("AI 核验请求超时")), timeoutMs); });
    const result = await Promise.race([transport.chatDeepSeek({ requestId, messages: [
      { role: "system", content: "你是只读 CAD 资源核验器。只能引用 request 中已有的 checkCode 和 evidence，不能修改数值或拓扑。返回 JSON：{decision:'accept'|'reject'|'needs-human',findings:[{checkCode,decision,evidence,message}]}。" },
      { role: "user", content: JSON.stringify(request) },
    ] }), timeout]);
    if (result.status !== "success" || !result.assistant?.content) return { ...pending, ai: { status: "failed", request, error: result.message || `AI 状态 ${result.status}` } };
    let parsed: unknown;
    try { parsed = JSON.parse(result.assistant.content); } catch { return { ...pending, ai: { status: "format-error", request, error: "AI 返回内容不是 JSON" } }; }
    return applyCadAiVerification(review, parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 核验失败";
    if (transport.cancelDeepSeekChat) await transport.cancelDeepSeekChat(requestId).catch(() => undefined);
    return { ...pending, ai: { status: message.includes("超时") ? "timeout" : "failed", request, error: message } };
  } finally { if (timer) clearTimeout(timer); }
}
