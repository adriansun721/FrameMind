import { getMemberResponseSamples, type AnalysisResult } from "../domain/analysis";
import { PROCESS_SECTIONS, readRecordedProcess, resultIdentity } from "../domain/result-inspection";
import { ProcessDisclosure, PagedItems } from "./ProcessDisclosure";
import { useUnits } from "./UnitPresentation";

const SECTION_LABELS = { settings: "参数与设置", mesh: "实际离散映射", stages: "实际运行阶段", coordinates: "实际自由度映射", stiffness: "刚度矩阵", mass: "质量矩阵", geometric: "几何刚度矩阵", iterations: "实际加载与迭代" };

/** Shared by every method, including historical results whose objects were deleted. */
export function ResultInspection({ result, current, modeNumber = 1, onLocate }: { result: AnalysisResult; current: boolean; modeNumber?: number; onLocate(kind: "node" | "member", id: string, position?: number): void }) {
  const u = useUnits(), identity = resultIdentity(result, current);
  const source = result.input.analysisCase ?? result.input.combination?.definition ?? result.input.loadCase;
  const modes = result.modal?.modes ?? result.buckling?.modes;
  const mode = modes?.find((item) => item.number === modeNumber) ?? modes?.[0];
  return <section className="property-section" aria-label="统一结果来源">
    <h3>{identity.methodName} · {current ? "当前有效" : "历史输入 · 已过期"}</h3>
    <dl><div><dt>分析身份</dt><dd>{result.id}</dd></div>
      <div><dt>冻结工况</dt><dd>{source?.id ?? "LC1"} · {source?.name ?? "旧版工况"}</dd></div>
      <div><dt>输入 / 完成状态</dt><dd>R{identity.inputRevision} · {identity.completion === "budget-exhausted" ? "预算停止 · 未收敛" : identity.completion} · {result.createdAt}</dd></div>
      <div><dt>显示单位</dt><dd>{u.unit("m")} / {u.unit("kN")} / {u.unit("kN·m")} · Hz</dd></div>
      <div><dt>求解器 / 内部单位</dt><dd>{identity.solver?.implementation ?? "未记录"} · {identity.canonicalUnits}</dd></div></dl>
    <p>{identity.meaning}</p>
    <p>图形与定位使用本次冻结工程几何；当前属性编辑仍属于当前正式模型。</p>
    <p>结果比较：{identity.support.resultComparison ? "静力或二阶按来源、冻结输入和网格核查；二阶效应比较须基础相同。" : "不提供跨结果相减。"}响应叠加：{identity.support.responseSuperposition ? "仅线性静力支持线性规律；组合由加权输入重算。" : "不支持。"}</p>
    <ProcessDisclosure className="analysis-process-disclosure" summary="冻结工程对象与沿杆位置">{() => <>
      <PagedItems items={result.input.nodes} label="冻结节点">{(nodes) => <div>{nodes.map((node) => <p key={node.id}><button className="button ghost" onClick={() => onLocate("node", node.id)}>{node.label} · {node.id}</button> · XYZ {u.vector(node.position, "m")}</p>)}</div>}</PagedItems>
      <PagedItems items={result.input.members} label="冻结杆件">{(members) => <div>{members.map((member) => <p key={member.id}><button className="button ghost" onClick={() => onLocate("member", member.id, 0)}>{member.label} · {member.id}</button> · {member.startNodeId} → {member.endNodeId}</p>)}</div>}</PagedItems>
    </>}</ProcessDisclosure>
    {!mode && !result.random && <ProcessDisclosure className="analysis-process-disclosure" summary="沿杆实际位移与定位">{() => <PagedItems items={result.members} label="沿杆位移杆件">{(members) => members.map((member) => <ProcessDisclosure key={member.memberId} className="analysis-process-disclosure" summary={member.memberId}>{() => {
      try {
        const samples = getMemberResponseSamples(result, member.memberId);
        return <div className="load-case-table-scroll"><table aria-label="沿杆实际位移"><thead><tr><th>工程杆件 / 位置</th><th>全局位移 X / Y / Z ({u.unit("m")})</th></tr></thead><tbody>{samples.map((sample) => <tr key={sample.position}><td><button className="button ghost" onClick={() => onLocate("member", sample.memberId, sample.position)}>{sample.memberId} · {u.quantity(sample.position, "m")}</button></td><td>{u.vector(sample.globalDisplacement, "m")}</td></tr>)}</tbody></table></div>;
      } catch { return <p>本历史结果不具备兼容的沿杆恢复记录；未借用当前工程或其他结果。</p>; }
    }}</ProcessDisclosure>)}</PagedItems>}</ProcessDisclosure>}
    {mode && <ProcessDisclosure className="analysis-process-disclosure" summary={`第 ${mode.number} 阶沿杆形态样本与定位`}>{() => <PagedItems items={mode.members.flatMap((member) => member.samples.map((sample) => ({ memberId: member.memberId, ...sample })))} label="沿杆形态样本">{(samples) => <div className="load-case-table-scroll"><table aria-label="沿杆归一化形态"><thead><tr><th>工程杆件 / 位置</th><th>归一化平移 X / Y / Z</th></tr></thead><tbody>{samples.map((sample) => <tr key={`${sample.memberId}:${sample.position}`}><td><button className="button ghost" onClick={() => onLocate("member", sample.memberId, sample.position)}>{sample.memberId} · {u.quantity(sample.position, "m")}</button></td><td>{Object.values(sample.translation).map((value) => value.toPrecision(8)).join(" / ")}</td></tr>)}</tbody></table></div>}</PagedItems>}</ProcessDisclosure>}
    <ProcessDisclosure className="analysis-process-disclosure" summary="本次运行实际记录">{() => <>
      <p>仅显示已保存记录；参数、矩阵和混合自由度向量保留内部规范单位。内部节点用于计算映射，不替代工程对象。</p>
      {PROCESS_SECTIONS.map((section) => <ProcessDisclosure key={section} className="analysis-process-disclosure" summary={SECTION_LABELS[section]}>{() => {
        const first = readRecordedProcess(result, section);
        return <><p>{first.message} · 来源分析 {first.sourceAnalysisId}{first.matrixLimit ? ` · 矩阵记录上限 ${first.matrixLimit}` : ""}</p>
          {first.available && <PagedItems items={Array.from({ length: first.total }, (_, i) => i)} label={`实际 ${section}`} pageSize={20}>{(indices) => {
            const page = readRecordedProcess(result, section, indices[0] ?? 0, 20);
            return <div className="load-case-table-scroll"><table aria-label={`实际 ${section}`}><tbody>{page.items.map((item, i) => <tr key={i}><th>{(indices[0] ?? 0) + i}</th><td>{section === "mesh" && item && typeof item === "object" && "memberId" in item && "start" in item ? <button className="button ghost" onClick={() => onLocate("member", String(item.memberId), Number(item.start))}>定位工程杆件 {String(item.memberId)}</button> : null}<pre>{JSON.stringify(item, null, 2)}</pre></td></tr>)}</tbody></table></div>;
          }}</PagedItems>}
          {first.role === "separate-fixed-and-reference" && <p>fixed 为固定预荷载几何刚度，reference 为参考荷载几何刚度，λ 仅作用于 reference。</p>}
        </>;
      }}</ProcessDisclosure>)}
    </>}</ProcessDisclosure>
  </section>;
}
