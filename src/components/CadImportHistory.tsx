import { useEffect, useState } from "react";
import type { FrameProject } from "../domain/project";
import type { ProjectCheckpointRecord } from "../../electron/contracts";

export function CadImportHistory({ project, onClose, onRestore }: { project: FrameProject; onClose(): void; onRestore(content: string): Promise<void> }) {
  const [records, setRecords] = useState<ProjectCheckpointRecord[]>([]), [busy, setBusy] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void window.frameMind.listProjectCheckpoints(project.id).then((value) => { if (active) setRecords(value); }, (cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "历史读取失败"); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [project.id]);
  const receipt = project.cadImports?.at(-1);
  return <div className="dialog-backdrop"><section className="node-dialog wide-dialog" role="dialog" aria-modal="true" aria-label="STEP 导入历史">
    <header><h2>STEP 导入历史</h2><button className="icon-button" disabled={busy} onClick={onClose} aria-label="关闭">×</button></header>
    {receipt && <div><p>确认回执 {receipt.id} · R{receipt.parentRevision} → R{receipt.appliedRevision} · {receipt.mappings.length} 根工程杆件</p><p>输入 SHA-256 {receipt.inputSha256}</p><p>草稿 SHA-256 {receipt.draftHash}</p><p>导入时刚接已确认，支座与荷载未设置。原 STEP 几何与完整 CAD 依据需要原文件重新核验。</p></div>}
    {busy && <p role="status">正在读取 checkpoint…</p>}
    {!busy && !records.length && <p role="status">本机项目历史旁车缺失或不可读取。正式模型仍可编辑和保存；无法恢复旧 checkpoint 或复核历史提交。</p>}
    <div className="cad-preview-body">{records.map((record) => <p key={record.commit}>{record.kind} · R{record.revision} · {record.commit.slice(0, 12)} <button className="button ghost" disabled={busy} onClick={() => {
      if (!window.confirm(`恢复 ${record.kind} / R${record.revision} 将替换当前项目全部状态，是否继续？`)) return;
      setBusy(true); setError("");
      void window.frameMind.readProjectCheckpoint({ projectId: project.id, commit: record.commit }).then(onRestore).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "恢复失败，当前模型未修改")).finally(() => setBusy(false));
    }}>恢复此 checkpoint</button></p>)}</div>
    {error && <p role="alert">{error}</p>}
    <div className="dialog-actions"><button className="button" disabled={busy} onClick={onClose}>关闭历史</button></div>
  </section></div>;
}
