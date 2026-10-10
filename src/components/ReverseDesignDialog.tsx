import { useEffect, useRef, useState } from "react";
import type { ReverseDesignDraft, ReverseDesignGenerated } from "../../electron/contracts";
import { reverseDesignParentState } from "../../electron/reverse-design-model";
import { encodeProject } from "../domain/project-file";
import type { FrameProject } from "../domain/project";

export function ReverseDesignDialog({ project, sessionId, onApply, onClose }: { project: FrameProject; sessionId: string; onApply(content: string, parentContent: string): void; onClose(): void; }) {
  const [draft, setDraft] = useState<ReverseDesignDraft | null>(null), [confirmed, setConfirmed] = useState(false);
  const [beam, setBeam] = useState("arcelor-ipe200"), [column, setColumn] = useState("arcelor-hea200");
  const [generated, setGenerated] = useState<ReverseDesignGenerated | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState("");
  const accepted = useRef({ signature: "", sessionId: "" });
  const signature = reverseDesignParentState(encodeProject(project));
  useEffect(() => {
    if (accepted.current.signature === signature && accepted.current.sessionId === sessionId) return;
    let active = true;
    setBusy(true); setDraft(null); setConfirmed(false); setGenerated(null); setError("");
    void window.frameMind.prepareReverseDesign().then((value) => {
      if (!active) return;
      setDraft(value);
      const baseline = JSON.parse(value.baselineContent) as FrameProject;
      setColumn(baseline.sections[0].provenance.catalogId!); setBeam(baseline.sections[1].provenance.catalogId!);
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "固定场景预览失败"); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [signature, sessionId]);
  const run = (action: () => Promise<void>) => { setBusy(true); setError(""); void action().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "反向设计操作失败")).finally(() => setBusy(false)); };
  const baseline = draft ? JSON.parse(draft.baselineContent) as FrameProject : null;
  const unchanged = baseline?.sections[0].provenance.catalogId === column && baseline.sections[1].provenance.catalogId === beam;
  return <div className="dialog-backdrop"><section className="node-dialog wide-dialog" role="dialog" aria-modal="true" aria-label="反向设计固定场景"><div className="dialog-form">
    <h2>反向设计固定场景</h2>
    <p>仅覆盖水平位移约束下的截面减重，不包含强度、屈曲或规范验算。有限预算搜索不保证遍历全部组合或全局最优。</p>
    {draft && baseline && <>
      <section aria-label="固定输入与预算">
        <h3>固定输入</h3>
        <p>X 一跨 6 m，Y 一跨 4 m，两层各 3 m，原点 (0,0,0) m；12 节点、16 工程杆件。全部刚接，底层四节点六自由度全固定，截面转角 0°。</p>
        <p>S355JR：E=210 GPa，ν=0.3，ρ=7850 kg/m³。初始柱 HEA200、梁 IPE200。</p>
        <p>全结构自重 g=(0,0,-9.81) m/s²。屋面 (6,0,6) m 节点 F=(5,0,0) kN，力矩为零；屋面 (0,0,6)→(6,0,6) m 梁全局 q=(0,0,-2) kN/m。</p>
        <p>所选用户演示组合：恒载×1 + 演示外荷载×1.5。全结构最大水平合位移 √(ux²+uy²) ≤ {draft.rules.horizontalLimitMm} mm。</p>
        <p>目标：最小化结构总质量 ΣρAL。当前父快照质量 {draft.initialMassKg.toFixed(3)} kg。变量仅为梁组与柱组的已核验库截面；面积变化后重算自重。</p>
        <p>预算：最多 {draft.rules.maxRounds} 轮或 {draft.rules.maxDurationSeconds / 60} 分钟；work 最多 {draft.rules.workTimeoutSeconds} 秒、{draft.rules.maxToolRetries} 次工具重试，inspect 最多 {draft.rules.inspectTimeoutSeconds} 秒。确认后生成候选；多 agent 搜索与数值检查尚待后续接入。</p>
        <details><summary>核验截面库与来源</summary><table><thead><tr><th>条目</th><th>A (m²)</th><th>Iy / Iz / J (m⁴)</th><th>来源</th></tr></thead><tbody>{draft.catalog.map((s) => <tr key={s.provenance.catalogId}><td>{s.name}</td><td>{s.areaM2}</td><td>{s.secondMomentYM4} / {s.secondMomentZM4} / {s.torsionalConstantM4}</td><td><a href={s.catalogBasis.source.url} target="_blank" rel="noreferrer">{s.catalogBasis.source.publisher}</a> · {s.catalogBasis.location}</td></tr>)}</tbody></table></details>
        <details><summary>父快照与确认身份</summary><p>{draft.confirmationId}</p><p>父输入 SHA-256：{draft.parentInputSha256}</p></details>
        <button className="button primary" disabled={busy || confirmed} onClick={() => run(async () => {
          const parentContent = encodeProject(project), content = await window.frameMind.confirmReverseDesign(draft.confirmationId);
          accepted.current = { signature: reverseDesignParentState(content), sessionId };
          onApply(content, parentContent); setConfirmed(true);
        })}>{confirmed ? "固定输入已确认" : "确认固定输入、变量、目标和预算"}</button>
      </section>
      <section aria-label="受控截面变量"><h3>截面变量</h3>
        <label className="field"><span>梁组候选截面</span><select aria-label="梁组候选截面" value={beam} disabled={busy} onChange={(e) => setBeam(e.target.value)}>{draft.catalog.map((s) => <option key={s.provenance.catalogId} value={s.provenance.catalogId}>{s.name}</option>)}</select></label>
        <label className="field"><span>柱组候选截面</span><select aria-label="柱组候选截面" value={column} disabled={busy} onChange={(e) => setColumn(e.target.value)}>{draft.catalog.map((s) => <option key={s.provenance.catalogId} value={s.provenance.catalogId}>{s.name}</option>)}</select></label>
        <button className="button primary" disabled={busy || !confirmed || unchanged} onClick={() => run(async () => { setGenerated(await window.frameMind.generateReverseDesign({ confirmationId: draft.confirmationId, beamCatalogId: beam, columnCatalogId: column })); })}>确认截面并生成隔离候选</button>
      </section>
    </>}
    {generated && <section aria-label="候选生成记录"><h3>候选生成记录</h3>
      <p>{generated.report.beforeMassKg.toFixed(3)} → {generated.report.afterMassKg.toFixed(3)} kg；质量减少 {generated.report.reductionKg.toFixed(3)} kg。</p>
      {generated.report.changes.map((c) => <p key={c.group}>{c.group === "beam" ? "梁组" : "柱组"}：{c.beforeCatalogId} → {c.afterCatalogId}，{c.memberIds.length} 根。</p>)}
      <p>{generated.report.diagnostic}</p>
      <details><summary>候选身份与自重记录</summary><p>{generated.candidate.taskId} · {generated.candidate.branch}</p><p>父提交 {generated.candidate.parentCommit} · 候选提交 {generated.candidate.commit}</p><p>证据 SHA-256：{generated.evidenceSha256}</p><table><thead><tr><th>杆件</th><th>长度 (m)</th><th>质量 (kg)</th><th>自重 qz (kN/m)</th></tr></thead><tbody>{generated.report.selfWeight.map((m) => <tr key={m.memberId}><td>{m.memberId}</td><td>{m.lengthM}</td><td>{m.massKg.toFixed(3)}</td><td>{m.intensityKnM.z.toFixed(9)}</td></tr>)}</tbody></table></details>
    </section>}
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">正在处理固定输入与候选…</p>}
    <div className="dialog-actions"><button className="button ghost" disabled={busy} onClick={onClose}>关闭反向设计</button></div>
  </div></section></div>;
}
