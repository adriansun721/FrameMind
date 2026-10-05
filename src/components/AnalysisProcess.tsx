import { useUnits } from "./UnitPresentation";
import { useEffect, useRef, useState } from "react";
import { createSupplementalAnalysisInput, getOverallAnalysisProcessRecord, type AnalysisProcessDof, type AnalysisResult, type OverallAnalysisProcessRecord } from "../domain/analysis";
import { ProcessDisclosure, PagedItems } from "./ProcessDisclosure";
import { AnalysisCancelledError, startAnalysisTask, type AnalysisTask } from "../workspace/analysis-task";
import { ANALYSIS_STAGE_LABELS } from "../domain/analysis-diagnostics";

interface AnalysisProcessProps {
  result: AnalysisResult;
  resultIsCurrent: boolean;
}

const formatNumber = (value: number) => value === 0 ? "0" : value.toPrecision(6);
const dofLabel = (dof: AnalysisProcessDof) => `${dof.nodeId}.${dof.dof}`;

function MatrixView({ label, matrix, indices, limit }: { label: string; matrix: number[][] | null; indices: number[]; limit: number }) {
  const u = useUnits();
  if (!matrix) return <p className="analysis-process-note">整体矩阵共有 {indices.length} 行，超过单次查看上限 {limit}；按成员贡献或自由度索引局部查看。</p>;
  return <ProcessDisclosure className="member-process-matrix analysis-process-matrix" summary={<>{label} · {matrix.length} × {matrix.length}</>}>{() => <><div className="member-process-matrix-note">行 / 列为整体自由度索引（从 0 起）。刚度行单位 {u.unit("kN")} / {u.unit("kN·m")}，列单位 {u.unit("m")} / {u.unit("rad")}。</div><div className="member-process-matrix-scroll"><table aria-label={label}><thead><tr><th scope="col">行＼列</th>{indices.map((index) => <th scope="col" key={index}>{index}</th>)}</tr></thead><tbody>{matrix.map((row, rowIndex) => <tr key={indices[rowIndex]}><th scope="row">{indices[rowIndex]}</th>{row.map((value, columnIndex) => <td key={indices[columnIndex]}>{formatNumber(u.stiffness(value, indices[rowIndex], indices[columnIndex]))}</td>)}</tr>)}</tbody></table></div></>}</ProcessDisclosure>;
}

function DofTable({ record }: { record: OverallAnalysisProcessRecord }) {
  return <ProcessDisclosure className="analysis-process-disclosure" summary={<>节点自由度与约束状态 · {record.dofs.length} 个</>}>{() => <PagedItems items={record.dofs} label="整体自由度编号" pageSize={100}>{(dofs) => <div className="member-process-dof-table"><table aria-label="整体自由度编号"><thead><tr><th>整体索引</th><th>节点</th><th>自由度</th><th>状态</th></tr></thead><tbody>{dofs.map((dof) => <tr key={dof.globalIndex}><td>{dof.globalIndex}</td><td>{dof.nodeId}</td><td>{dof.dof}</td><td>{dof.restrained ? "约束" : "自由"}</td></tr>)}</tbody></table></div>}</PagedItems>}</ProcessDisclosure>;
}

function AssemblyTable({ record, result }: { record: OverallAnalysisProcessRecord; result: AnalysisResult }) {
  const u = useUnits();
  const memberLabel = (id: string) => result.input.members.find((member) => member.id === id)?.label ?? id;
  return <ProcessDisclosure className="analysis-process-disclosure" summary={<>单元组装条目 · {record.members.length} 根杆件</>}>{() => <PagedItems items={record.members} label="单元组装条目" pageSize={25}>{(members) => <div className="analysis-process-assembly-list">{members.map((member) => <ProcessDisclosure className="member-process-matrix" key={member.memberId} summary={<>{memberLabel(member.memberId)} · {member.memberId} · 整体索引 {member.globalDofIndices.join(", ")}</>}>{() => <><div className="member-process-matrix-note">局部 12 个条目映射到整体自由度后加入整体刚度阵；荷载向量为等效整体荷载。</div><div className="member-process-dof-table"><table aria-label={`${memberLabel(member.memberId)}整体自由度映射`}><thead><tr><th>局部位置</th><th>稳定对象 / 自由度</th><th>整体索引</th><th>状态</th></tr></thead><tbody>{member.dofs.map((dof, index) => <tr key={`${member.memberId}-${dof.globalIndex}`}><td>{index < 6 ? "起点" : "终点"} · {index + 1}</td><td>{dofLabel(dof)}</td><td>{dof.globalIndex}</td><td>{dof.restrained ? "约束" : "自由"}</td></tr>)}</tbody></table></div><p className="analysis-process-vector"><strong>等效整体荷载</strong><span>[{u.mixedVector(member.equivalentGlobalForces, "force").map(formatNumber).join(", ")}] {u.unit("kN")} / {u.unit("kN·m")}</span></p><MatrixView label={`${memberLabel(member.memberId)} · 单元整体刚度贡献`} matrix={member.globalStiffness} indices={member.globalDofIndices} limit={record.matrixLimit} /></>}</ProcessDisclosure>)}</div>}</PagedItems>}</ProcessDisclosure>;
}

function ProcessDetails({ record, result }: { record: OverallAnalysisProcessRecord; result: AnalysisResult }) {
  const u = useUnits();
  const allIndices = record.dofs.map((dof) => dof.globalIndex);
  return <>
    <section className="property-section analysis-process-summary"><h3>整体过程来源</h3><dl>
      <div><dt>记录</dt><dd>{record.origin === "supplemental-reconstruction" ? `补算 ${record.analysisId} · 来源分析 ${record.sourceAnalysisId}` : record.origin === "captured-from-run" ? `本次运行实际快照 · ${record.sourceAnalysisId}` : `按冻结输入重建 · ${record.sourceAnalysisId}`}</dd></div>
      <div><dt>项目版本</dt><dd>R{record.projectRevision}</dd></div>
      <div><dt>自由度 / 约束 / 自由</dt><dd>{record.dofs.length} / {record.constrainedDofs.length} / {record.freeDofs.length}</dd></div>
      <div><dt>求解器</dt><dd>{record.solver.implementation} · {record.solver.algorithm} · {record.solver.constraints}</dd></div>
      <div><dt>运行阶段</dt><dd>{record.service ? record.service.stages.map((item) => ANALYSIS_STAGE_LABELS[item.stage]).join(" → ") : "历史结果未保存运行阶段"}</dd></div>
      <div><dt>矩阵策略</dt><dd>{record.assembledStiffness ? `整体 ${record.assembledStiffness.length} × ${record.assembledStiffness.length} 可按需查看` : `整体矩阵超过 ${record.matrixLimit} 阶，仅显示索引与成员贡献`}</dd></div>
    </dl></section>
    <section className="property-section"><h3>编号与系统状态</h3><p className="analysis-process-equation"><code>K · u = F</code><code>自由自由度子系统：Kff · uf = Ff</code><code>约束自由度：u = 0</code></p><p className="analysis-process-note">共 {result.input.nodes.length} 个节点，标签见模型与项目树；索引从 0 起。支座只约束标记的节点自由度，约束后的方程使用自由自由度子系统。</p><DofTable record={record} /></section>
    <section className="property-section"><h3>整体组装</h3><AssemblyTable record={record} result={result} /><div className="analysis-process-matrices"><MatrixView label="整体刚度 K" matrix={record.assembledStiffness} indices={allIndices} limit={record.matrixLimit} /><MatrixView label="约束后刚度 Kff" matrix={record.reducedStiffness} indices={record.freeDofs} limit={record.matrixLimit} /></div><p className="analysis-process-vector"><strong>整体荷载向量 F</strong><span>[{u.mixedVector(record.loadVector, "force").map(formatNumber).join(", ")}] {u.unit("kN")} / {u.unit("kN·m")}</span></p></section>
    <section className="property-section analysis-process-basis"><h3>教材依据（印刷页 / PDF 页）</h3><p>{record.basis.title}（{record.basis.authors}，{record.basis.publisher}，{record.basis.year}）扫描版。PDF 页序含前置页，不等同书内页码。</p><div className="member-process-dof-table"><table aria-label="教材页码依据"><thead><tr><th>章节</th><th>核查主题</th><th>书内印刷页</th><th>PDF 页序</th></tr></thead><tbody>{record.basis.references.map((reference) => <tr key={reference.section}><td>{reference.section}</td><td>{reference.topic}</td><td>{reference.printedPage}</td><td>{reference.pdfPage ?? "未记录"}</td></tr>)}</tbody></table></div>{record.basis.differences.map((difference) => <details className="analysis-process-disclosure" key={difference.topic}><summary>{difference.topic} · 实现与教材差异</summary><dl><div><dt>实现</dt><dd>{difference.implementation}</dd></div><div><dt>教材</dt><dd>{difference.textbook}</dd></div><div><dt>原因</dt><dd>{difference.reason}</dd></div><div><dt>验证</dt><dd>{difference.validation}</dd></div></dl></details>)}</section>
  </>;
}

export function AnalysisProcess({ result, resultIsCurrent }: AnalysisProcessProps) {
  const [record, setRecord] = useState<OverallAnalysisProcessRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supplementing, setSupplementing] = useState(false);
  const taskRef = useRef<AnalysisTask | null>(null);

  useEffect(() => {
    taskRef.current?.cancel();
    taskRef.current = null;
    setSupplementing(false);
    try {
      setRecord(getOverallAnalysisProcessRecord(result));
      setError(null);
    } catch (cause) {
      setRecord(null);
      setError(cause instanceof Error ? cause.message : "本次分析没有可用的整体过程记录");
    }
    return () => { taskRef.current?.cancel(); taskRef.current = null; };
  }, [result]);

  const supplement = () => {
    if (taskRef.current) return;
    setSupplementing(true);
    const task = startAnalysisTask(createSupplementalAnalysisInput(result), { origin: { kind: "supplemental", sourceAnalysisId: result.id } });
    taskRef.current = task;
    void task.promise.then((supplemental) => {
      const next = getOverallAnalysisProcessRecord(supplemental);
      setRecord({ ...next, sourceAnalysisId: result.id, origin: "supplemental-reconstruction" });
      setError(null);
    }).catch((cause) => {
      if (!(cause instanceof AnalysisCancelledError)) setError(cause instanceof Error ? cause.message : "无法基于冻结输入补算整体过程");
    }).finally(() => {
      if (taskRef.current === task) { taskRef.current = null; setSupplementing(false); }
    });
  };

  return <section className="property-section analysis-process" data-testid="analysis-process" aria-label="整体求解过程">
    <div className="result-section-heading"><h3>整体求解过程</h3><span className="member-process-badge">{resultIsCurrent ? "结果当前" : "结果已过期"}</span></div>
    <p className="member-process-intro">过程绑定分析 {result.id} 的冻结输入，展示自由度编号、单元组装和约束后系统；矩阵按需展开。</p>
    {record ? <ProcessDetails record={record} result={result} /> : <div className="member-process-missing" role="alert"><strong>本次分析未保存可直接重建的整体过程配置</strong><span>{error}</span><button type="button" className="button ghost compact-button" onClick={supplement} disabled={supplementing}>{supplementing ? "正在补算过程…" : "基于冻结输入补算过程"}</button><small>补算生成新的过程分析 ID，仅用于查看，不修改原结果来源。</small></div>}
  </section>;
}
