import { getSelfWeightSummary, sameInputValue, type AnalysisResult } from "../domain/analysis";
import { ANALYSIS_FORCE_COMPONENTS, compareAnalysisResults } from "../domain/analysis-comparison";
import { analysisProvenance, readResult, type ResultReference } from "./ai-results";

export interface AnalysisPairIds { beforeId: string; afterId: string; }
export interface AiAnalysisPair { before: AnalysisResult; after: AnalysisResult; beforeCurrent: boolean; afterCurrent: boolean; }
export interface ComparisonReference { token: string; before: Omit<ResultReference, "token">; after: Omit<ResultReference, "token">; delta: number; unit: string; }

function validatePairInput(pair: AiAnalysisPair, input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some((key) => !["beforeId", "afterId", ...allowed].includes(key))) throw new Error("对比工具含未定义字段");
  if (input.beforeId !== undefined && input.beforeId !== pair.before.id || input.afterId !== undefined && input.afterId !== pair.after.id) throw new Error("对比身份与所选的两次分析不一致");
  if (pair.before.id === pair.after.id) throw new Error("前后必须选择两份不同的分析");
}

export function readComparison(pair: AiAnalysisPair, input: Record<string, unknown>) {
  validatePairInput(pair, input, ["collection", "offset", "limit"]);
  if (!["summary", "nodes", "members"].includes(String(input.collection))) throw new Error("对比集合须为 summary、nodes 或 members");
  const offset = input.offset ?? 0; const limit = input.limit ?? 50;
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("对比分页须为非负 offset 与 1 至 100 的 limit");
  const comparison = compareAnalysisResults(pair.before, pair.after);
  const sameInputMethodComparison = comparison.compatible && (pair.before.input.analysisCase?.method ?? "static") !== (pair.after.input.analysisCase?.method ?? "static") && Boolean(pair.before.secondOrder || pair.after.secondOrder);
  const sectionAndSelfWeightOnly = comparison.compatible && comparison.changes.length > 0 && comparison.changes.every((change) => change.kind === "section"
    || change.kind === "member" && change.changes.every((field) => field === "截面引用"))
    && sameInputValue(pair.before.input.combination?.cases, pair.after.input.combination?.cases);
  const provenance = { before: { ...analysisProvenance(pair.before, pair.beforeCurrent), status: pair.beforeCurrent ? "当前模型结果" : "前份历史输入，保留冻结来源" },
    after: { ...analysisProvenance(pair.after, pair.afterCurrent), status: pair.afterCurrent ? "当前模型结果" : "后份历史输入，保留冻结来源" },
    pairMatchesCurrentInput: pair.beforeCurrent || pair.afterCurrent,
    compatible: comparison.compatible, issues: comparison.issues, sectionAndSelfWeightOnly,
    attribution: sameInputMethodComparison ? "冻结基础输入和内部网格相同；差值反映初应力弹性二阶近似与线性静力的方法差异，不代表通用非线性或材料效应。" : sectionAndSelfWeightOnly ? "仅截面相关输入变化；启用自重时同时包含面积变化引起的自重影响，不能归因于刚度单独作用。" : "存在其他变化或来源不兼容，不能解释为单纯截面影响。",
    convention: "差值 = 后一份 - 前一份；共用前后结果对比表的计算入口。" };
  if (input.collection === "summary" || !comparison.compatible) return { ...provenance, changes: comparison.changes.slice(offset, offset + limit), total: comparison.changes.length, offset, limit,
    objects: { nodes: pair.after.input.nodes.slice(offset, offset + limit).map((node) => ({ id: node.id, label: node.label, position: node.position })),
      members: pair.after.input.members.slice(offset, offset + limit).map((member) => ({ id: member.id, label: member.label, startNodeId: member.startNodeId, endNodeId: member.endNodeId })),
      totalNodes: pair.after.input.nodes.length, totalMembers: pair.after.input.members.length },
    selfWeight: Object.fromEntries((["before", "after"] as const).map((side) => {
      const weight = getSelfWeightSummary(pair[side].input);
      return [side, { ...weight, members: weight.members.slice(offset, offset + limit), totalMembers: weight.members.length }];
    })) };
  const items = input.collection === "nodes" ? comparison.nodes : comparison.members;
  return { ...provenance, collection: input.collection, items: items.slice(offset, offset + limit), total: items.length, offset, limit };
}

export function readComparisonResult(pair: AiAnalysisPair, input: Record<string, unknown>, callId: string): ComparisonReference {
  validatePairInput(pair, input, ["kind", "id", "quantity", "component", "position"]);
  const comparison = compareAnalysisResults(pair.before, pair.after);
  if (!comparison.compatible) throw new Error(comparison.issues.join("；"));
  const { beforeId: _before, afterId: _after, ...item } = input;
  const { token: _beforeToken, ...before } = readResult(pair.before, pair.beforeCurrent, item, `${callId}:before`);
  const { token: _afterToken, ...after } = readResult(pair.after, pair.afterCurrent, item, `${callId}:after`);
  // Match the table's shared deltas for its supported quantities; other quantities use the same after-before convention.
  let delta = after.value - before.value;
  if (item.kind === "node" && (item.quantity === "displacement" || item.quantity === "reaction")) {
    const row = comparison.nodes.find((node) => node.id === item.id)!;
    delta = (item.quantity === "displacement" ? row.displacementDelta : row.reactionDelta)[item.component as "x" | "y" | "z"];
  } else if (item.kind === "member" && (item.quantity === "startEndForces" || item.quantity === "endEndForces")) {
    const row = comparison.members.find((member) => member.id === item.id)!;
    const index = ANALYSIS_FORCE_COMPONENTS.findIndex((component) => component.label === item.component);
    delta = (item.quantity === "startEndForces" ? row.startDelta : row.endDelta)[index];
  }
  if (!Number.isFinite(delta)) throw new Error("对比差值超出有限数值范围");
  return { token: `[[comparison:${callId}]]`, before, after, delta, unit: after.unit };
}
