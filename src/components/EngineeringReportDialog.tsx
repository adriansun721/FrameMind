import { useState } from "react";
import { X } from "lucide-react";
import { isAnalysisResultCurrent } from "../domain/analysis";
import { captureEngineeringReport, reportSourceLabel } from "../domain/engineering-report";
import type { FrameProject } from "../domain/project";

export function EngineeringReportDialog({ project, initialAnalysisId, onClose, onStatus }: {
  project: FrameProject; initialAnalysisId?: string; onClose(): void; onStatus(tone: "neutral" | "success" | "error", text: string): void;
}) {
  const [analysisId, setAnalysisId] = useState(initialAnalysisId ?? project.analysisResults.at(-1)?.id ?? "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const selected = project.analysisResults.find((item) => item.id === analysisId);
  async function exportWord() {
    if (busy) return;
    setError(""); setNotice("");
    try {
      const report = captureEngineeringReport(project, analysisId);
      setBusy(true);
      const { buildReportWord, reportBytesToBase64 } = await import("../workspace/report-word");
      const bytes = await buildReportWord(report);
      const outcome = await window.frameMind.exportReportWord({ suggestedName: `${report.projectName}_${reportSourceLabel(report.result).split(" · ")[0]}_R${report.result.projectRevision}_计算书`, base64: reportBytesToBase64(bytes) });
      if (outcome.status === "cancelled") { setNotice("已取消导出"); onStatus("neutral", "已取消 Word 计算书导出"); }
      else { setNotice(`已导出 ${outcome.path}`); onStatus("success", `已导出 Word 计算书 · R${report.result.projectRevision} · ${outcome.path}`); }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "计算书导出失败";
      setError(message); onStatus("error", `Word 计算书导出失败：${message}`);
    } finally { setBusy(false); }
  }
  return <div className="dialog-backdrop" onMouseDown={onClose}>
    <section className="node-dialog wide-dialog" role="dialog" aria-modal="true" aria-label="工程计算书" onMouseDown={(event) => event.stopPropagation()}>
      <header><h2>工程计算书</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={15} /></button></header>
      <p className="dialog-copy">选择已完成分析，导出含模型、参数、荷载与结果的可编辑 Word 正文。</p>
      <div className="dialog-form">
        <label className="field"><span>报告分析来源</span><select aria-label="报告分析来源" value={analysisId} disabled={busy} onChange={(event) => { setAnalysisId(event.target.value); setNotice(""); setError(""); }}>
          {!project.analysisResults.length && <option value="">尚无已完成分析</option>}
          {project.analysisResults.map((item) => <option key={item.id} value={item.id}>{reportSourceLabel(item)} · R{item.projectRevision} · {item.createdAt} · {item.id.slice(-8)}</option>)}
        </select></label>
        {selected && <section className="report-source"><strong>{reportSourceLabel(selected)} · R{selected.projectRevision}</strong><p>分析 ID {selected.id}</p><p>{isAnalysisResultCurrent(project, selected) ? "结果当前" : "历史结果 · 使用该次分析的原模型与荷载，不使用当前编辑值"}</p></section>}
        <p className="dialog-copy">正文包含模型概况、理论假设与边界、材料截面、支座、工况组合与自重、节点响应及杆端内力，附模型图和位移幅值图。开始导出时冻结来源，后续编辑不改变本次报告。</p>
        <p className="dialog-copy">此计算书记录线弹性分析响应，不给出未经验证的规范验算结论。</p>
        {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="report-notice">{notice}</p>}
        <div className="dialog-actions"><button className="button ghost" onClick={onClose}>关闭</button><button className="button primary" disabled={!selected || busy} onClick={() => void exportWord()}>{busy ? "正在导出 Word…" : "导出 Word"}</button></div>
      </div>
    </section>
  </div>;
}
