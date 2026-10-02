import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { createSupplementalAnalysisInput, isAnalysisResultCurrent, type AnalysisResult } from "../domain/analysis";
import { captureEngineeringReport, reportSourceLabel, withSupplementalReportProcess } from "../domain/engineering-report";
import type { FrameProject } from "../domain/project";
import { REPORT_APPENDIX_STEPS, type ReportAppendixSelection, type ReportAppendixStep } from "../domain/report-appendix";
import { AnalysisCancelledError, startAnalysisTask, type AnalysisTask } from "../workspace/analysis-task";
import { prepareProjectReport } from "../workspace/report-task";

export function EngineeringReportDialog({ project, initialAnalysisId, onClose, onStatus }: {
  project: FrameProject; initialAnalysisId?: string; onClose(): void; onStatus(tone: "neutral" | "success" | "error", text: string): void;
}) {
  const [analysisId, setAnalysisId] = useState(initialAnalysisId ?? project.analysisResults.at(-1)?.id ?? "");
  const [busy, setBusy] = useState<"Word" | "PDF" | null>(null); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [selection, setSelection] = useState<ReportAppendixSelection>({ memberIds: [], steps: [] });
  const [supplemental, setSupplemental] = useState<AnalysisResult | null>(null);
  const [supplementing, setSupplementing] = useState(false);
  const taskRef = useRef<AnalysisTask | null>(null);
  useEffect(() => () => { taskRef.current?.cancel(); taskRef.current = null; }, []);
  const selected = project.analysisResults.find((item) => item.id === analysisId);
  const preview = useMemo(() => {
    if (!selected || !selection.steps.length) return null;
    try {
      const report = captureEngineeringReport(project, selected.id, selection);
      return supplemental ? withSupplementalReportProcess(report, supplemental).appendix : report.appendix;
    } catch { return null; } // Export displays source validation failures through the existing alert.
  }, [project, selected, selection, supplemental]);
  const canSupplement = !supplemental && preview && (
    (selection.steps.includes("member-process") && selection.memberIds.length > preview.members.length) ||
    (selection.steps.some((step) => step !== "member-process") && !preview.overall)
  );
  const locked = busy !== null || supplementing;
  const changeSource = (id: string) => {
    taskRef.current?.cancel(); taskRef.current = null; setSupplementing(false);
    setAnalysisId(id); setSelection({ memberIds: [], steps: [] }); setSupplemental(null); setNotice(""); setError("");
  };
  const toggleStep = (step: ReportAppendixStep) => setSelection((value) => ({ ...value, steps: value.steps.includes(step) ? value.steps.filter((item) => item !== step) : [...value.steps, step] }));
  const toggleMember = (id: string) => setSelection((value) => ({ ...value, memberIds: value.memberIds.includes(id) ? value.memberIds.filter((item) => item !== id) : [...value.memberIds, id] }));
  async function supplementProcess() {
    if (locked) return;
    setError(""); setNotice("");
    try {
      const report = captureEngineeringReport(project, analysisId, selection);
      const task = startAnalysisTask(createSupplementalAnalysisInput(report.result));
      taskRef.current = task; setSupplementing(true);
      try {
        const result = await task.promise;
        if (taskRef.current !== task) return;
        withSupplementalReportProcess(report, result);
        setSupplemental(result); setNotice(`补算过程 ${result.id} · 来源分析 ${report.result.id}；正文保留原结果。`);
      } finally { if (taskRef.current === task) { taskRef.current = null; setSupplementing(false); } }
    } catch (failure) { if (!(failure instanceof AnalysisCancelledError)) setError(failure instanceof Error ? failure.message : "附录过程补算失败"); }
  }
  async function exportReport(format: "Word" | "PDF") {
    if (locked) return;
    setError(""); setNotice("");
    try {
      if (!selected) throw new Error("请选择本项目已完成且可对应的分析结果");
      setBusy(format);
      const revision = selected.projectRevision;
      const suggestedName = `${project.name}_${reportSourceLabel(selected).split(" · ")[0]}_R${revision}_计算书`;
      let outcome;
      const prepared = await prepareProjectReport(project, analysisId, selection, supplemental, format);
      if (format === "Word") {
        if (prepared.format !== "Word") throw new Error("计算书导出格式不一致");
        const { reportBytesToBase64 } = await import("../workspace/report-word");
        outcome = await window.frameMind.exportReportWord({ suggestedName, base64: reportBytesToBase64(prepared.bytes) });
      } else {
        if (prepared.format !== "PDF") throw new Error("计算书导出格式不一致");
        outcome = await window.frameMind.exportReportPdf({ suggestedName, html: prepared.html });
      }
      if (outcome.status === "cancelled") { setNotice("已取消导出"); onStatus("neutral", `已取消 ${format} 计算书导出`); }
      else { setNotice(`已导出 ${outcome.path}`); onStatus("success", `已导出 ${format} 计算书 · R${revision} · ${outcome.path}`); }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "计算书导出失败";
      setError(message); onStatus("error", `${format} 计算书导出失败：${message}`);
    } finally { setBusy(null); }
  }
  return <div className="dialog-backdrop" onMouseDown={onClose}>
    <section className="node-dialog wide-dialog report-dialog" role="dialog" aria-modal="true" aria-label="工程计算书" onMouseDown={(event) => event.stopPropagation()}>
      <header><h2>工程计算书</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={15} /></button></header>
      <p className="dialog-copy">选择已完成分析，导出含模型、参数、荷载与结果的 Word 或 PDF 计算书。</p>
      <div className="dialog-form">
        <label className="field"><span>报告分析来源</span><select aria-label="报告分析来源" value={analysisId} disabled={locked} onChange={(event) => changeSource(event.target.value)}>
          {!project.analysisResults.length && <option value="">尚无已完成分析</option>}
          {project.analysisResults.map((item) => <option key={item.id} value={item.id}>{reportSourceLabel(item)} · R{item.projectRevision} · {item.createdAt} · {item.id.slice(-8)}</option>)}
        </select></label>
        {selected && <section className="report-source"><strong>{reportSourceLabel(selected)} · R{selected.projectRevision}</strong><p>分析 ID {selected.id}</p><p>{isAnalysisResultCurrent(project, selected) ? "结果当前" : "历史结果 · 使用该次分析的原模型与荷载，不使用当前编辑值"}</p></section>}
        <p className="dialog-copy">正文包含模型概况、理论假设与边界、材料截面、支座、工况组合与自重、节点响应及杆端内力，附模型图和位移幅值图。开始导出时冻结来源，后续编辑不改变本次报告。</p>
        {selected && <fieldset className="report-appendix" disabled={locked}>
          <legend>可选过程附录</legend>
          <p>默认只导出正文。杆件过程与组装贡献使用下方所选杆件；整体步骤使用全部模型。</p>
          <div className="report-step-list">{(Object.entries(REPORT_APPENDIX_STEPS) as [ReportAppendixStep, string][]).map(([step, label]) => <label key={step}><input type="checkbox" checked={selection.steps.includes(step)} onChange={() => toggleStep(step)} />{label}</label>)}</div>
          <p>整体矩阵须单独勾选；超过采集上限时标记缺少记录，矩阵按列分块输出。</p>
          <details className="report-member-picker" open={selection.steps.includes("member-process") || selection.steps.includes("assembly")}>
            <summary>附录杆件 · 已选 {selection.memberIds.length} / {selected.input.members.length}</summary>
            <div className="report-member-actions"><button type="button" className="button ghost compact-button" onClick={() => setSelection((value) => ({ ...value, memberIds: selected.input.members.map((member) => member.id) }))}>选择全部杆件</button><button type="button" className="button ghost compact-button" onClick={() => setSelection((value) => ({ ...value, memberIds: [] }))}>清空杆件</button></div>
            <div className="report-member-list">{selected.input.members.map((member) => <label key={member.id}><input type="checkbox" aria-label={`附录杆件 ${member.label} · ${member.id}`} checked={selection.memberIds.includes(member.id)} onChange={() => toggleMember(member.id)} /><span>{member.label} · {member.id}<small>{member.startNodeId} → {member.endNodeId}</small></span></label>)}</div>
          </details>
        </fieldset>}
        {preview?.missing.length ? <div className="report-missing" role="note">{preview.missing.map((message) => <p key={message}>{message}</p>)}<p>导出会保留缺少记录的提示，正文完整。补算使用所选分析的冻结输入并另记过程分析 ID。</p>{canSupplement && <button type="button" className="button ghost" disabled={locked} onClick={() => void supplementProcess()}>基于冻结输入补算附录过程</button>}</div> : null}
        {supplementing && <p className="report-notice">正在补算附录过程… <button type="button" className="button ghost compact-button" onClick={() => { taskRef.current?.cancel(); taskRef.current = null; setSupplementing(false); setNotice("已取消附录过程补算，原结果保持可用。"); }}>取消补算</button></p>}
        {supplemental && <p className="report-notice">附录使用补算过程 {supplemental.id} · 来源分析 {analysisId}；正文保留原结果。</p>}
        <p className="dialog-copy">此计算书记录线弹性分析响应，不给出未经验证的规范验算结论。</p>
        {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="report-notice">{notice}</p>}
      </div>
      <div className="dialog-actions"><button className="button ghost" onClick={onClose}>关闭</button><button className="button ghost" disabled={!selected || locked} onClick={() => void exportReport("Word")}>{busy === "Word" ? "正在导出 Word…" : "导出 Word"}</button><button className="button primary" disabled={!selected || locked} onClick={() => void exportReport("PDF")}>{busy === "PDF" ? "正在导出 PDF…" : "导出 PDF"}</button></div>
    </section>
  </div>;
}
