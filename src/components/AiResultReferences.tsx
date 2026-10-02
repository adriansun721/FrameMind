import type { AiTaskResult } from "../workspace/ai-task";
import { resultReferenceLabel, type ResultReference } from "../workspace/ai-results";

export function AiResultExplanation({ result, onLocate }: { result: AiTaskResult; onLocate(ref: ResultReference): void }) {
  const references = result.records.flatMap((record) => record.result.reference ? [record.result.reference] : []);
  if (!result.assistant) return null;
  const parts = result.assistant.split(/(\[\[result:[^\]\r\n]+\]\])/g);
  return <div className="ai-result-explanation">
    {references.length > 0 && <p className="ai-result-note">引用数值来自本地分析；原因说明属于 AI 推断，不提供规范验算结论。</p>}
    <p className="ai-assistant-message">{parts.map((part, index) => {
      const ref = references.find((item) => item.token === part);
      return ref ? <button key={index} className="ai-result-reference" onClick={() => onLocate(ref)} title={`${ref.analysisId} · 输入 R${ref.inputRevision} · ${ref.source.id}`}>
        {resultReferenceLabel(ref)}<small>{ref.source.id} · 输入 R{ref.inputRevision}{ref.current ? "" : " · 历史结果"}</small>
      </button> : <span key={index}>{part}</span>;
    })}</p>
  </div>;
}

export function ResultReferenceDetails({ reference, current, exists, onClose }: { reference: ResultReference; current: boolean; exists: boolean; onClose(): void }) {
  const ref = reference;
  const vector = (v: { x: number; y: number; z: number }) => `(${v.x}, ${v.y}, ${v.z}) m`;
  return <section className="property-section ai-reference-details" aria-label="引用结果项">
    <div className="result-section-heading"><h3>引用结果项</h3><button onClick={onClose} aria-label="关闭引用结果">×</button></div>
    <strong>{resultReferenceLabel(ref)}</strong>
    <dl>
      <div><dt>分析身份</dt><dd>{ref.analysisId}</dd></div>
      <div><dt>冻结输入</dt><dd>R{ref.inputRevision} · {ref.createdAt}</dd></div>
      <div><dt>来源{ref.source.kind === "combination" ? "组合" : "工况"}</dt><dd>{ref.source.id} · {ref.source.name}</dd></div>
      <div><dt>稳定对象</dt><dd>{ref.object.id}</dd></div>
      <div><dt>输入坐标</dt><dd>{vector(ref.object.position)}{ref.object.endPosition && ` → ${vector(ref.object.endPosition)}`}</dd></div>
      <div><dt>坐标与符号</dt><dd>{ref.coordinateSystem} · {ref.quantity === "sectionForces" ? "正局部 x 面截面内力" : ref.object.kind === "member" ? "杆端节点作用力" : "全局分量"}</dd></div>
      <div><dt>原始数值</dt><dd>{ref.value} {ref.unit}</dd></div>
    </dl>
    {ref.source.terms && <p>用户自定义组合：{ref.source.terms.map((term) => `${term.loadCaseId} × ${term.factor}`).join(" + ")}</p>}
    <p className="ai-result-note">{current ? "引用分析与当前模型输入一致。" : "历史输入结果；当前模型需重新计算。"}{!exists && " 对象已从当前模型删除，保留冻结输入位置。"}</p>
  </section>;
}
