import { captureAnalysisInput, NATIVE_STATIC_SOLVER } from "../src/domain/analysis";
import { createAnalysisRequest } from "../src/domain/analysis-service";
import { decodeProject, decodeAnalysisResult } from "../src/domain/project-file";
import { canonicalJson } from "../electron/candidate-model";
import { reverseDesignMass, validateReverseDesignParent } from "../electron/reverse-design-model";

export function createRequest(content: string) {
  validateReverseDesignParent(content);
  return createAnalysisRequest({ ...captureAnalysisInput(decodeProject(content)), solver: { ...NATIVE_STATIC_SOLVER } });
}

/** Decode the real native wire at the existing domain boundary, then recompute observations. */
export function inspectResult(content: string, request: ReturnType<typeof createRequest>, messages: unknown[]) {
  const packets = messages as Array<{ kind: string; requestId: string; result?: unknown }>;
  if (packets.length !== 5 || packets.some((p) => p.requestId !== request.requestId) || packets.at(-1)?.kind !== "result") throw new Error("原生求解未完成或阶段不完整");
  const result = decodeAnalysisResult(packets.at(-1)!.result);
  if (result.id !== request.analysisId || result.service?.requestId !== request.requestId || canonicalJson(result.input) !== canonicalJson(request.input)) throw new Error("原生结果与冻结输入不一致");
  const project = decodeProject(content);
  if (result.nodes.length !== project.nodes.length || result.members.length !== project.members.length || result.nodes.some((n) => !project.nodes.some((p) => p.id === n.nodeId))) throw new Error("原生结果数据不完整");
  const force = [0, 0, 0], moment = [0, 0, 0];
  if (!result.process || result.process.loadVector.length !== project.nodes.length * 6) throw new Error("缺少真实求解荷载向量");
  for (const [index, node] of project.nodes.entries()) {
    const response = result.nodes.find((n) => n.nodeId === node.id)!;
    const load = result.process.loadVector.slice(index * 6, index * 6 + 6);
    const f = [response.reaction.x + load[0], response.reaction.y + load[1], response.reaction.z + load[2]];
    const m = [response.reactionMoment.x + load[3], response.reactionMoment.y + load[4], response.reactionMoment.z + load[5]];
    const { x, y, z } = node.position;
    for (let axis = 0; axis < 3; axis++) { force[axis] += f[axis]; moment[axis] += m[axis]; }
    moment[0] += y * f[2] - z * f[1]; moment[1] += z * f[0] - x * f[2]; moment[2] += x * f[1] - y * f[0];
  }
  const frozenMassKg = result.input.members.reduce((sum, member) => {
    const start = result.input.nodes.find((node) => node.id === member.startNodeId)?.position;
    const end = result.input.nodes.find((node) => node.id === member.endNodeId)?.position;
    const section = result.input.sections.find((candidate) => candidate.id === member.sectionId);
    const material = result.input.materials.find((candidate) => candidate.id === member.materialId);
    if (!start || !end || !section || !material) throw new Error("冻结输入缺少质量来源");
    return sum + Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) * section.areaM2 * material.densityKgM3;
  }, 0);
  const massResidualKg = Math.abs(frozenMassKg - reverseDesignMass(content));
  const observations = [
    { name: "source", value: 1, threshold: 1 }, { name: "resources", value: 1, threshold: 1 }, { name: "stiffness", value: 1, threshold: 1 },
    { name: "horizontal-displacement", value: Math.max(...result.nodes.map((n) => Math.hypot(n.displacement.x, n.displacement.y))) * 1000, threshold: 15 },
    { name: "force-balance", value: Math.hypot(...force), threshold: 1e-7 }, { name: "moment-balance", value: Math.hypot(...moment), threshold: 1e-7 },
    { name: "mass", value: massResidualKg, threshold: 1e-9 },
  ];
  if (observations.some((o) => !Number.isFinite(o.value))) throw new Error("原生检查出现非有限数值");
  return { massKg: reverseDesignMass(content), result, checks: observations.map((o) => ({ ...o, passed: o.value <= o.threshold })) };
}
