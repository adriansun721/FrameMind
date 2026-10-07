import { unitPresentation } from "../domain/units";
import { useUnits } from "./UnitPresentation";
import type { AiTaskResult } from "../workspace/ai-task";
import { resultReferenceLabel, type ResultReference } from "../workspace/ai-results";
import type { AnalysisPairIds } from "../workspace/ai-comparison";
import type { FrameProject } from "../domain/project";
import { isAnalysisResultCurrent } from "../domain/analysis";

function displayReference(ref: ResultReference, u: ReturnType<typeof unitPresentation>): string {
  return resultReferenceLabel({ ...ref, value: ref.unit === "归一化幅值" ? ref.value : u.value(ref.value, ref.unit), unit: ref.unit === "归一化幅值" ? ref.unit : u.unit(ref.unit), position: undefined }) + (ref.position === undefined ? "" : ` · x=${u.quantity(ref.position, "m")}`);
}

export function AiResultExplanation({ project, result, onLocate, onCompare }: { project: FrameProject; result: Pick<AiTaskResult, "assistant" | "records">; onLocate(ref: ResultReference): void; onCompare(pair: AnalysisPairIds): void }) {
  const u = useUnits();
  const current = (id: string) => { const analysis = project.analysisResults.find((item) => item.id === id); return Boolean(analysis && isAnalysisResultCurrent(project, analysis)); };
  const references = result.records.flatMap((record) => record.result.reference ? [record.result.reference] : []);
  const comparisons = result.records.flatMap((record) => record.result.comparisonReference ? [record.result.comparisonReference] : []);
  if (!result.assistant) return null;
  const parts = result.assistant.split(/(\[\[(?:result|comparison):[^\]\r\n]+\]\])/g);
  return <div className="ai-result-explanation">
    {references.length + comparisons.length > 0 && <p className="ai-result-note">引用数值来自本地分析；原因说明属于 AI 推断，不提供规范验算结论。</p>}
    <p className="ai-assistant-message">{parts.map((part, index) => {
      const ref = references.find((item) => item.token === part);
      const comparison = comparisons.find((item) => item.token === part);
      if (comparison) return <button key={index} className="ai-result-reference ai-comparison-reference" onClick={() => onCompare({ beforeId: comparison.before.analysisId, afterId: comparison.after.analysisId })}>
        {comparison.after.object.label} · {comparison.after.component}：{u.number(comparison.before.value, comparison.unit)} → {u.quantity(comparison.after.value, comparison.unit)} · Δ {u.quantity(comparison.delta, comparison.unit)}
        <small>{comparison.before.source.id} · 输入 R{comparison.before.inputRevision} → R{comparison.after.inputRevision}{!current(comparison.before.analysisId) || !current(comparison.after.analysisId) ? " · 含历史结果" : ""} · 查看同一对比表</small>
      </button>;
      return ref ? <button key={index} className="ai-result-reference" onClick={() => onLocate(ref)} title={`${ref.analysisId} · 输入 R${ref.inputRevision} · ${ref.source.id}`}>
        {displayReference(ref, u)}<small>{ref.source.id} · 输入 R{ref.inputRevision}{current(ref.analysisId) ? "" : " · 历史结果"}</small>
      </button> : <span key={index}>{part}</span>;
    })}</p>
  </div>;
}

export function ResultReferenceDetails({ reference, current, exists, onClose }: { reference: ResultReference; current: boolean; exists: boolean; onClose(): void }) {
  const u = useUnits();
  const ref = reference;
  const vector = (v: { x: number; y: number; z: number }) => u.vector(v, "m");
  return <section className="property-section ai-reference-details" aria-label="引用结果项">
    <div className="result-section-heading"><h3>引用结果项</h3><button onClick={onClose} aria-label="关闭引用结果">×</button></div>
    <strong>{displayReference(ref, u)}</strong>
    <dl>
      <div><dt>分析身份</dt><dd>{ref.analysisId}</dd></div>
      <div><dt>冻结输入</dt><dd>R{ref.inputRevision} · {ref.createdAt}</dd></div>
      <div><dt>来源{ref.source.kind === "combination" ? "组合" : "工况"}</dt><dd>{ref.source.id} · {ref.source.name}</dd></div>
      {ref.method && <div><dt>方法 / 含义</dt><dd>{ref.method} · {ref.meaning}</dd></div>}
      {ref.modeNumber !== undefined && <div><dt>形态阶次</dt><dd>第 {ref.modeNumber} 阶 · 归一化形态，不是实际位移</dd></div>}
      <div><dt>稳定对象</dt><dd>{ref.object.id}</dd></div>
      <div><dt>输入坐标</dt><dd>{vector(ref.object.position)}{ref.object.endPosition && ` → ${vector(ref.object.endPosition)}`}</dd></div>
      <div><dt>坐标与符号</dt><dd>{ref.coordinateSystem} · {ref.modeNumber !== undefined ? "归一化形态 / 特征值，符号不表示受载方向" : ref.quantity === "sectionForces" ? "正局部 x 面截面内力" : ref.object.kind === "member" && ref.quantity !== "displacement" ? "杆端节点作用力" : "全局分量"}</dd></div>
      <div><dt>原始数值</dt><dd>{ref.unit === "归一化幅值" ? `${ref.value.toPrecision(12)} ${ref.unit}` : u.quantity(ref.value, ref.unit, 12)}</dd></div>
    </dl>
    {ref.source.terms && <p>用户自定义组合：{ref.source.terms.map((term) => `${term.loadCaseId} × ${term.factor}`).join(" + ")}</p>}
    <p className="ai-result-note">{current ? "引用分析与当前模型输入一致。" : "历史输入结果；当前模型需重新计算。"}{!exists && " 对象已从当前模型删除，保留冻结输入位置。"}</p>
  </section>;
}
