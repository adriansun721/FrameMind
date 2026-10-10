import { useEffect, useState } from "react";
import type { FrameProject } from "../domain/project";
import type { ProjectCheckpointRecord } from "../../electron/contracts";
import { decodeProject } from "../domain/project-file";
import { diffProjectSnapshots, type ProjectSnapshotChange } from "../workspace/project-snapshot-diff";
import { PagedItems } from "./ProcessDisclosure";

export function CadImportHistory({ project, general = false, onClose, onRestore }: { project: FrameProject; general?: boolean; onClose(): void; onRestore(content: string): Promise<void> }) {
  const [records, setRecords] = useState<ProjectCheckpointRecord[]>([]), [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [preview, setPreview] = useState<{ record: ProjectCheckpointRecord; content: string; parent: FrameProject; changes: ProjectSnapshotChange[] } | null>(null);
  useEffect(() => {
    let active = true;
    void window.frameMind.listProjectCheckpoints(project.id).then((value) => { if (active) setRecords(value); }, (cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "历史读取失败"); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [project.id]);
  useEffect(() => { setPreview(null); }, [project]);
  const receipt = project.cadImports?.at(-1);
  return <div className="dialog-backdrop"><section className="node-dialog wide-dialog" role="dialog" aria-modal="true" aria-label={general ? "项目历史" : "STEP 导入历史"}>
    <header><h2>{general ? "项目历史" : "STEP 导入历史"}</h2><button className="icon-button" disabled={busy} onClick={onClose} aria-label="关闭">×</button></header>
    {general && <p>本地独立 Git 历史 · 确认、保存与恢复点。另存为默认复制历史，也可选择从新历史开始。</p>}
    {receipt && <div><p>确认回执 {receipt.id} · R{receipt.parentRevision} → R{receipt.appliedRevision} · {receipt.mappings.length} 根工程杆件</p><p>{receipt.source.name} · 导入 {receipt.source.importedAt} · 确认 {receipt.confirmedAt}</p><p>输入 SHA-256 {receipt.inputSha256}</p><p>草稿 SHA-256 {receipt.draftHash}</p><p>导入时刚接已确认，支座与荷载未设置。项目中保存来源摘要；完整中间态与 AI 核验依据保存在确认 checkpoint 的旁车证据。</p></div>}
    {busy && <p role="status">正在读取 checkpoint…</p>}
    {!busy && !records.length && <p role="status">本机项目历史旁车缺失或不可读取。正式模型仍可编辑和保存；无法恢复旧 checkpoint 或复核历史提交。</p>}
    <div className="cad-preview-body">{records.filter((record) => general || record.kind.startsWith("step-")).map((record) => <p key={record.commit}>{record.kind} · R{record.revision} · {record.recordedAt} · {record.commit.slice(0, 12)}{record.taskId && <span> · 任务 {record.taskId}</span>}{record.copiedFrom && <span> · 复制自 {record.copiedFrom.commit.slice(0, 12)}</span>} <button className="button ghost" disabled={busy} onClick={() => {
      setBusy(true); setError(""); setPreview(null);
      void window.frameMind.readProjectCheckpoint({ projectId: project.id, commit: record.commit }).then((content) => {
        const target = decodeProject(content);
        setPreview({ record, content, parent: project, changes: diffProjectSnapshots(project, target) });
      }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "历史读取失败，当前模型未修改")).finally(() => setBusy(false));
    }}>查看恢复差异</button>{record.evidenceSha256 && <button className="button ghost" disabled={busy} onClick={() => {
      setBusy(true); setError("");
      void window.frameMind.readProjectCheckpointEvidence({ projectId: project.id, commit: record.commit }).then((content) => window.frameMind.exportCadPreview({ suggestedName: `cad-draft-${record.commit.slice(0, 12)}`, content })).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "完整中间态旁车不可读取；模型仍可编辑和保存")).finally(() => setBusy(false));
    }}>导出完整核验证据</button>}</p>)}</div>
    {preview && preview.parent === project && <section className="cad-history-diff" aria-label="checkpoint 恢复差异"><h3>恢复 R{preview.record.revision} · {preview.changes.length} 项对象与字段差异</h3><p>方向：当前项目 → 所选快照。确认后整体替换，原文件无需存在。</p>
      <PagedItems items={preview.changes} label="恢复差异" pageSize={20}>{(changes) => <table><thead><tr><th>对象 / 字段</th><th>操作</th><th>当前值</th><th>恢复后</th></tr></thead><tbody>{changes.map((change, i) => <tr key={`${change.collection}:${change.id}:${change.field}:${i}`}><td>{change.collection} / {change.id} / {change.field}</td><td>{{ create: "新增", delete: "删除", update: "修改" }[change.action]}</td><td>{formatValue(change.before)}</td><td>{formatValue(change.after)}</td></tr>)}</tbody></table>}</PagedItems>
      <button className="button" disabled={busy} onClick={() => {
        if (!window.confirm(`已查看 ${preview.changes.length} 项差异。恢复 ${preview.record.kind} / R${preview.record.revision} 将替换当前项目全部状态，是否继续？`)) return;
        setBusy(true); setError("");
        void onRestore(preview.content).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "恢复失败，当前模型未修改")).finally(() => setBusy(false));
      }}>确认整体恢复</button>
    </section>}
    {error && <p role="alert">{error}</p>}
    <div className="dialog-actions"><button className="button" disabled={busy} onClick={onClose}>关闭历史</button></div>
  </section></div>;
}

function formatValue(value: unknown): string {
  if (value === undefined) return "—";
  const text = JSON.stringify(value);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}
