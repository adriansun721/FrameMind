import { useUnits } from "./UnitPresentation";
import { CANONICAL_UNITS } from "../domain/units";
import { convertToolQuantities, toolFieldDimension } from "../workspace/unit-tools";
import { useMemo, useState } from "react";
import type { AiSnapshot } from "../workspace/ai-tools";
import { buildTaskDraftPreview, type TaskDraft } from "../workspace/task-draft";

const sourceLabel: Record<string, string> = { existing: "已有", user: "用户提供", catalog: "目录", suggestion: "建议", assumption: "假设", unknown: "未知" };

export function TaskDraftCard({ snapshot, draft, busy, current, onConfirm, onReject, onRevise }: {
  snapshot: AiSnapshot;
  draft: TaskDraft;
  busy: boolean;
  current: boolean;
  onConfirm(): void;
  onReject(): void;
  onRevise(prompt: string): void;
}) {
  const u = useUnits();
  const changeText = (label: string, value: unknown) => {
    const dimension = toolFieldDimension(label);
    const converted = convertToolQuantities(value, (v, d) => u.value(v, CANONICAL_UNITS[d]), dimension);
    return JSON.stringify(converted) + (dimension ? ` ${u.unit(CANONICAL_UNITS[dimension])}` : value && typeof value === "object" && !Array.isArray(value) ? `（力 ${u.unit("kN")}；力矩 ${u.unit("kN·m")}；均布力 ${u.unit("kN/m")}；重力 ${u.unit("m/s²")}）` : "");
  };
  const [revision, setRevision] = useState("");
  const preview = useMemo(() => buildTaskDraftPreview(snapshot, draft), [snapshot, draft]);
  const categoryCount = (category: string) => preview.changes.filter((change) => change.category === category).length;
  const frameCount = preview.frame ? `${preview.frame.nodes.length} 节点 / ${preview.frame.members.length} 杆件` : "保留已有几何";
  const conditionCount = `${draft.conditions?.supports?.length ?? snapshot.model.supports.length} 支座 / ${draft.conditions?.nodalLoads?.length ?? snapshot.model.nodalLoads.length} 节点荷载 / ${draft.conditions?.uniformLoads?.length ?? snapshot.model.uniformLoads.length} 均布荷载 / ${draft.conditions?.loadCases?.length ?? snapshot.model.loadCases.length} 工况 / ${draft.conditions?.loadCombinations?.length ?? snapshot.model.loadCombinations.length} 组合`;
  const changedIds = {
    supports: new Set((draft.conditions?.supports ?? []).flatMap((item) => item.id ? [item.id] : [])),
    nodalLoads: new Set((draft.conditions?.nodalLoads ?? []).flatMap((item) => item.id ? [item.id] : [])),
    uniformLoads: new Set((draft.conditions?.uniformLoads ?? []).flatMap((item) => item.id ? [item.id] : [])),
    loadCases: new Set((draft.conditions?.loadCases ?? []).flatMap((item) => item.id ? [item.id] : [])),
    loadCombinations: new Set((draft.conditions?.loadCombinations ?? []).flatMap((item) => item.id ? [item.id] : [])),
  };
  const retainedConditions = [
    ...snapshot.model.supports.filter((item) => !changedIds.supports.has(item.id)).map((item) => `${item.label} · 支座 · ${item.nodeId}`),
    ...snapshot.model.nodalLoads.filter((item) => !changedIds.nodalLoads.has(item.id)).map((item) => `${item.label} · 节点荷载 · ${item.nodeId} · ${item.loadCaseId}`),
    ...snapshot.model.uniformLoads.filter((item) => !changedIds.uniformLoads.has(item.id)).map((item) => `${item.label} · 均布荷载 · ${item.memberId} · ${item.loadCaseId}`),
    ...(snapshot.model.selfWeight.enabled && !draft.conditions?.selfWeight ? [`结构自重 · ${snapshot.model.selfWeight.loadCaseId}`] : []),
    ...snapshot.model.loadCases.filter((item) => !changedIds.loadCases.has(item.id)).map((item) => `${item.id} · 工况 · ${item.name}`),
    ...snapshot.model.loadCombinations.filter((item) => !changedIds.loadCombinations.has(item.id)).map((item) => `${item.id} · 用户组合 · ${item.name}`),
  ];
  return <section className="frame-proposal-card proposal-summary-card task-draft-card" aria-label="完整任务草案">
    <div className="frame-proposal-heading"><strong>完整任务草案</strong><span>{!current ? "已失效" : preview.issues.length || preview.missing.length ? "待补充" : "待一次确认"}</span></div>
    <dl className="proposal-summary">
      <div><dt>任务目标</dt><dd>{draft.goal ?? "未填写"}</dd></div>
      <div><dt>草案版本</dt><dd>V{draft.version} · 基础 R{draft.baseRevision}</dd></div>
      <div><dt>几何与资源</dt><dd>{frameCount} · {categoryCount("resource")} 项资源</dd></div>
      <div><dt>支座与荷载</dt><dd>{conditionCount}</dd></div>
      <div><dt>确认后分析</dt><dd>{draft.analysis?.requested ? draft.analysis.sourceId ?? draft.conditions?.analysisSourceId ?? "待指定来源" : "未请求计算"}</dd></div>
    </dl>
    {(preview.issues.length > 0 || preview.missing.length > 0) && <ul className="frame-issues" role="alert">
      {[...preview.issues, ...preview.missing.map((item) => item.reason)].map((issue, index) => <li key={`${issue}:${index}`}>{issue}</li>)}
    </ul>}
    {!current && <p className="frame-draft-notice">正式模型已变化，请基于当前模型重新准备草案。</p>}
    <details className="proposal-details"><summary>查看目标、差异与影响</summary>
      <p>对象：{preview.objectRefs.filter((item) => item.category === "new").length} 个新对象，{preview.objectRefs.filter((item) => item.category === "existing").length} 个已有对象可引用。</p>
      {retainedConditions.length > 0 && <p>确认后保留已有条件：{retainedConditions.join("；")}</p>}
      <ol>{preview.changes.map((change, index) => <li key={`${change.category}:${change.label}:${index}`}><strong>{change.label}</strong> · {sourceLabel[change.source] ?? change.source}<br />{change.before === undefined ? "缺失" : changeText(change.label, change.before)} → {change.after === undefined ? "未改变" : changeText(change.label, change.after)}{change.impact ? ` · ${change.impact}` : ""}</li>)}</ol>
    </details>
    <form className="task-draft-revision" onSubmit={(event) => { event.preventDefault(); if (revision.trim() && !busy && current) { onRevise(revision.trim()); setRevision(""); } }}>
      <label>修订完整任务<textarea aria-label="完整任务修订" rows={2} value={revision} disabled={busy || !current} placeholder={current ? "补充或修改几何、支座、荷载或分析要求" : "正式模型已变化，请重新准备完整任务草案"} onChange={(event) => setRevision(event.target.value)} /></label>
      <button type="submit" disabled={busy || !current || !revision.trim()}>提交修订</button>
    </form>
    <div className="proposal-card-actions">
      <button type="button" disabled={busy} onClick={onReject}>拒绝草案</button>
      <button type="button" className="proposal-confirm" disabled={busy || !current || preview.issues.length > 0 || preview.missing.length > 0} onClick={onConfirm}>确认整体任务</button>
    </div>
  </section>;
}
