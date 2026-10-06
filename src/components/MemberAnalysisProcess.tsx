import { releaseLabel } from "../domain/member-releases";
import { useUnits } from "./UnitPresentation";
import { useEffect, useRef, useState } from "react";
import { createSupplementalAnalysisInput, getMemberAnalysisRecord, type AnalysisResult, type MemberAnalysisRecord } from "../domain/analysis";
import { ProcessDisclosure } from "./ProcessDisclosure";
import { AnalysisCancelledError, startAnalysisTask, type AnalysisTask } from "../workspace/analysis-task";

interface MemberAnalysisProcessProps {
  result: AnalysisResult;
  memberId: string;
  memberLabel: string;
  resultIsCurrent: boolean;
}

const FORCE_LABELS = ["Fx", "Fy", "Fz", "Mx", "My", "Mz"];
const formatNumber = (value: number) => value === 0 ? "0" : value.toPrecision(6);
const axisText = (value: { x: number; y: number; z: number }) => `(${formatNumber(value.x)}, ${formatNumber(value.y)}, ${formatNumber(value.z)})`;

function ProcessVector({ label, values, units, order }: { label: string; values: number[]; units: string; order: string }) {
  const u = useUnits();
  const converted = u.mixedVector(values, units === "m / rad" ? "displacement" : "force");
  const text = `[${converted.map(formatNumber).join(", ")}] ${units === "m / rad" ? `${u.unit("m")} / ${u.unit("rad")}` : `${u.unit("kN")} / ${u.unit("kN·m")}`}`;
  return <div className="member-process-vector"><strong>{label}</strong><span title={`${order} · ${text}`}>{text}</span><small>{order}</small></div>;
}

function MatrixView({ label, matrix, order }: { label: string; matrix: number[][]; order: string[] }) {
  const u = useUnits();
  return <ProcessDisclosure className="member-process-matrix" summary={<>{label} · 12 × 12</>}>{() => <><div className="member-process-matrix-note">行 / 列顺序：{order.join(" · ")}。刚度行单位 {u.unit("kN")} / {u.unit("kN·m")}，列单位 {u.unit("m")} / {u.unit("rad")}；T 无量纲。</div><div className="member-process-matrix-scroll"><table aria-label={label}><thead><tr><th scope="col">行＼列</th>{order.map((item) => <th scope="col" key={item}>{item}</th>)}</tr></thead><tbody>{matrix.map((row, rowIndex) => <tr key={rowIndex}><th scope="row">{order[rowIndex]}</th>{row.map((value, columnIndex) => <td key={columnIndex}>{formatNumber(label.includes("转换 T") ? value : u.stiffness(value, rowIndex, columnIndex))}</td>)}</tr>)}</tbody></table></div></>}</ProcessDisclosure>;
}

function SavedMemberResult({ result, memberId }: { result: AnalysisResult; memberId: string }) {
  const u = useUnits();
  const saved = result.members.find((member) => member.memberId === memberId);
  if (!saved) return null;
  return <section className="property-section member-process-saved"><h3>已保存的杆件结果</h3><dl>
    <div><dt>杆长</dt><dd>{u.quantity(saved.length, "m")}</dd></div>
    <div><dt>局部 x</dt><dd>{axisText(saved.localAxes.x)}</dd></div>
    <div><dt>局部 y</dt><dd>{axisText(saved.localAxes.y)}</dd></div>
    <div><dt>局部 z</dt><dd>{axisText(saved.localAxes.z)}</dd></div>
    <div><dt>起点杆端力</dt><dd>{u.forceVector(saved.localEndForces.start)}</dd></div>
    <div><dt>终点杆端力</dt><dd>{u.forceVector(saved.localEndForces.end)}</dd></div>
  </dl></section>;
}

function MemberProcessDetails({ record, result }: { record: MemberAnalysisRecord; result: AnalysisResult }) {
  const u = useUnits();
  const nodeLabel = (id: string) => result.input.nodes.find((node) => node.id === id)?.label ?? id;
  const matrixOrder = record.dofs.map(({ nodeId, dof }) => `${nodeLabel(nodeId)}.${dof}`);
  const origin = record.origin === "supplemental-reconstruction"
    ? `补算任务 ${record.analysisId} · 来源分析 ${record.sourceAnalysisId}`
    : record.origin === "captured-from-run" ? `本次原生释放恢复实际记录 · ${record.sourceAnalysisId}` : `按 ${record.sourceAnalysisId} 的冻结输入重建 · 未保存消元轨迹`;
  return <>
    <section className="property-section member-process-summary"><h3>过程来源</h3><dl>
      <div><dt>记录</dt><dd>{origin}</dd></div>
      <div><dt>项目版本</dt><dd>R{record.projectRevision}</dd></div>
      <div><dt>求解器</dt><dd>{record.solver.implementation} · {record.solver.algorithm} · {record.solver.constraints}</dd></div>
      <div><dt>主元阈值</dt><dd>{record.solver.relativePivotTolerance.toExponential(2)}</dd></div>
      <div><dt>假设</dt><dd>Euler-Bernoulli · 未释放分量刚接 · 忽略剪切变形 · m / kN / kN·m</dd></div>
      <div><dt>杆端连接</dt><dd>{releaseLabel(result.input.members.find((m) => m.id === record.memberId)?.endReleases?.start)} / {releaseLabel(result.input.members.find((m) => m.id === record.memberId)?.endReleases?.end)}</dd></div>
    </dl></section>
    <section className="property-section"><h3>局部坐标与自由度</h3><dl>
      <div><dt>局部 x</dt><dd>{axisText(record.geometry.localX)}</dd></div>
      <div><dt>局部 y</dt><dd>{axisText(record.geometry.localY)}</dd></div>
      <div><dt>局部 z</dt><dd>{axisText(record.geometry.localZ)}</dd></div>
      <div><dt>杆长</dt><dd>{u.quantity(record.geometry.length, "m")}</dd></div>
    </dl><div className="member-process-dof-table"><table aria-label="杆件自由度映射"><thead><tr><th>局部位置</th><th>节点</th><th>自由度</th><th>整体索引</th></tr></thead><tbody>{record.dofs.map((dof, index) => <tr key={`${dof.nodeId}-${dof.dof}`}><td>{index < 6 ? "起点" : "终点"} · {index + 1}</td><td>{nodeLabel(dof.nodeId)} · {dof.nodeId}</td><td>{dof.dof}</td><td>{dof.globalIndex}</td></tr>)}</tbody></table></div></section>
    <section className="property-section"><h3>转换关系与实际数值</h3><p className="member-process-equation"><code>{record.origin === "captured-from-run" ? "u_beam = H · T · u_node + Krr⁻¹ fr" : "u_local = T · u_global"}</code><code>K_global = Tᵀ · K_local · T</code></p><div className="member-process-vectors">
      <ProcessVector label="整体位移 / 转角" values={record.globalDisplacement} units="m / rad" order={matrixOrder.join(" · ")} />
      <ProcessVector label="局部位移 / 转角" values={record.localDisplacement} units="m / rad" order={matrixOrder.join(" · ")} />
      <ProcessVector label="等效局部荷载" values={record.equivalentLocalForces} units="kN / kN·m" order={FORCE_LABELS.join(" · ")} />
      <ProcessVector label="等效整体荷载" values={record.equivalentGlobalForces} units="kN / kN·m" order={FORCE_LABELS.join(" · ")} />
      <ProcessVector label="起点杆端力" values={record.localEndForces.start} units="kN / kN·m" order={FORCE_LABELS.join(" · ")} />
      <ProcessVector label="终点杆端力" values={record.localEndForces.end} units="kN / kN·m" order={FORCE_LABELS.join(" · ")} />
    </div><div className="member-process-matrices">{record.releaseRecovery && <MatrixView label="释放前原始刚度 K_original" matrix={record.releaseRecovery.originalLocalStiffness} order={matrixOrder} />}<MatrixView label="局部单元刚度 K_local" matrix={record.localStiffness} order={matrixOrder} /><MatrixView label="坐标转换 T" matrix={record.transformation} order={matrixOrder} /><MatrixView label="整体单元刚度 K_global" matrix={record.globalStiffness} order={matrixOrder} /></div></section>
    <section className="property-section member-process-basis"><h3>课本依据与实现边界</h3><p>《计算结构力学》（阎军、杨春秋，科学出版社，2014）第 5 章印刷页 117、5.2 页 118、5.3 页 122、5.4—5.5 页 127、5.6 页 129，以及附录 IV 页 180，作为直接刚度法、局部到总体转换、单元刚度、自由度对号、整体组装和荷载向量的核查线索。</p><p>本实现采用 6 自由度顺序 <code>[ux, uy, uz, rx, ry, rz]</code>、局部轴由杆件几何构造，并把局部轴作为 <code>T</code> 的行向量，因此使用 <code>u_local = T · u_global</code> 和 <code>K_global = Tᵀ · K_local · T</code>。教材在 5.2 节的 <code>[T]</code> 采用相反的转置记法；两者是同一正交转换的转置表示，已按此差异核对，未改变单元理论。教材页码是印刷页，不声明未核对的公式编号。过程记录来自指定分析的冻结输入与结果，矩阵按需重建，不表示保存了完整消元轨迹。</p></section>
  </>;
}

export function MemberAnalysisProcess({ result, memberId, memberLabel, resultIsCurrent }: MemberAnalysisProcessProps) {
  const [record, setRecord] = useState<MemberAnalysisRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supplementing, setSupplementing] = useState(false);
  const supplementTaskRef = useRef<AnalysisTask | null>(null);

  useEffect(() => {
    supplementTaskRef.current?.cancel();
    supplementTaskRef.current = null;
    setSupplementing(false);
    try {
      setRecord(getMemberAnalysisRecord(result, memberId));
      setError(null);
    } catch (cause) {
      setRecord(null);
      setError(cause instanceof Error ? cause.message : "本次分析没有可用的杆件过程记录");
    }
    return () => {
      supplementTaskRef.current?.cancel();
      supplementTaskRef.current = null;
    };
  }, [result, memberId]);

  const supplement = () => {
    if (supplementTaskRef.current) return;
    setSupplementing(true);
    const task = startAnalysisTask(createSupplementalAnalysisInput(result), { origin: { kind: "supplemental", sourceAnalysisId: result.id } });
    supplementTaskRef.current = task;
    void task.promise.then((supplemental) => {
      const next = getMemberAnalysisRecord(supplemental, memberId);
      setRecord({ ...next, sourceAnalysisId: result.id, origin: "supplemental-reconstruction" });
      setError(null);
    }).catch((cause) => {
      if (!(cause instanceof AnalysisCancelledError)) setError(cause instanceof Error ? cause.message : "无法基于冻结输入补算杆件过程");
    }).finally(() => {
      if (supplementTaskRef.current === task) {
        supplementTaskRef.current = null;
        setSupplementing(false);
      }
    });
  };

  return <section className="property-section member-process" data-testid="member-analysis-process" aria-label={`${memberLabel}计算过程`}>
    <div className="result-section-heading"><h3>本次杆件计算过程</h3><span className="member-process-badge">{resultIsCurrent ? "结果当前" : "结果已过期"}</span></div>
    <p className="member-process-intro">过程绑定分析 {result.id} · 对象 {memberLabel}。展开矩阵可核对行列自由度、局部轴、单位和转换关系。</p>
    {record ? <MemberProcessDetails record={record} result={result} /> : <><SavedMemberResult result={result} memberId={memberId} /><div className="member-process-missing" role="alert"><strong>本次分析未保存可直接重建的过程配置</strong><span>{error}</span><button type="button" className="button ghost compact-button" onClick={supplement} disabled={supplementing}>{supplementing ? "正在补算过程…" : "基于冻结输入补算过程"}</button><small>补算会生成新的过程分析 ID，仅用于查看当前杆件过程，不修改原结果的来源记录。</small></div></>}
  </section>;
}
