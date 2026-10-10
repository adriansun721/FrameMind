import { useEffect, useState } from "react";
import type { ProjectCandidate, CandidateSnapshot } from "../../electron/contracts";
import { candidateDifferences } from "../../electron/candidate-model";
import type { FrameProject } from "../domain/project";
import { encodeProject } from "../domain/project-file";
import { PagedItems } from "./ProcessDisclosure";

const labels: Record<ProjectCandidate["state"], string> = { working: "生成中", submitted: "待检查", blocked: "受阻", passed: "检查通过", stale: "已过期", cancelled: "已取消", merged: "已合并" };
export function ProjectCandidatesDialog({ project, onClose, onMerge, onRestore }: {
  project: FrameProject; onClose(): void; onMerge(taskId: string, commit: string): Promise<void>; onRestore(taskId: string): Promise<void>;
}) {
  const [tasks, setTasks] = useState<ProjectCandidate[]>([]), [preview, setPreview] = useState<CandidateSnapshot | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const refresh = async () => { const result = await window.frameMind.candidateTool({ tool: "list" }); if (!Array.isArray(result)) throw new Error("候选索引无效"); setTasks(result); };
  useEffect(() => {
    let active = true; setPreview(null); setBusy(true);
    void window.frameMind.candidateTool({ tool: "list" }).then((result) => { if (active && Array.isArray(result)) setTasks(result); }, (cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "候选历史读取失败"); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [project]);
  const run = (action: () => Promise<unknown>) => { setBusy(true); setError(""); void action().then(refresh).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "候选操作失败；正式模型未应用")).finally(() => setBusy(false)); };
  const differences = preview ? candidateDifferences(preview.parentContent, preview.candidateContent, encodeProject(project)) : [];
  const current = tasks.find((t) => t.taskId === preview?.candidate.taskId);
  return <div className="dialog-backdrop"><section className="node-dialog wide-dialog" role="dialog" aria-modal="true" aria-label="候选与差异">
    <header><h2>候选与差异</h2><button className="icon-button" disabled={busy} onClick={onClose} aria-label="关闭">×</button></header>
    <p>候选单独保存。正式编辑、取消、切换或恢复后，旧候选仅供查看；重新尝试会创建新任务。</p>
    {busy && <p role="status">正在核对候选历史…</p>}
    {!busy && !tasks.length && <p>暂无候选。候选生成任务启动后可在这里查看和取消。</p>}
    <div className="cad-preview-body"><PagedItems items={tasks} label="候选任务" pageSize={10}>{(items) => items.map((task) => <section key={task.taskId} aria-label={`候选 ${task.taskId}`}>
      <p>{task.taskId} · {labels[task.state]} · 父 R{task.parentRevision} · {task.parentCommit.slice(0, 12)} → {task.commit.slice(0, 12)}{task.retryOf && ` · 重试自 ${task.retryOf}`}</p>
      {task.diagnostic && <p role="status">{task.diagnostic}</p>}
      <button className="button ghost" disabled={busy} onClick={() => run(async () => { const result = await window.frameMind.candidateTool({ tool: "read", taskId: task.taskId }); if (!Array.isArray(result) && "parentContent" in result) setPreview(result); })}>查看三方差异</button>
      <button className="button ghost" disabled={busy || ["stale", "cancelled", "merged"].includes(task.state)} onClick={() => run(() => window.frameMind.candidateTool({ tool: "cancel", taskId: task.taskId }))}>取消任务</button>
      <button className="button ghost" disabled={busy || !["stale", "cancelled", "blocked"].includes(task.state)} onClick={() => run(() => window.frameMind.candidateTool({ tool: "fork", retryOf: task.taskId }))}>新任务重试</button>
      <button className="button ghost" disabled={busy || task.state !== "submitted"} onClick={() => run(() => window.frameMind.inspectCandidate(task.taskId))}>检查候选</button>
      <button className="button ghost" disabled={busy} onClick={() => { if (window.confirm("恢复该任务的父快照会替换当前模型并使所有旧候选失效，是否继续？")) run(() => onRestore(task.taskId)); }}>恢复任务父快照</button>
    </section>)}</PagedItems></div>
    {preview && <section className="cad-history-diff" aria-label="候选三方差异"><h3>{differences.length} 项对象与字段差异</h3>
      <p>{current ? labels[current.state] : "证据快照"} · {differences.some((d) => d.conflict) ? "正式状态与父快照存在冲突，禁止合并" : "正式输入与父快照一致"}</p>
      <PagedItems items={differences} label="候选差异" pageSize={20}>{(items) => <table><thead><tr><th>对象 / 字段</th><th>父值</th><th>候选值</th><th>人工编辑值</th><th>冲突</th></tr></thead><tbody>{items.map((d, i) => <tr key={i}><td>{d.collection} / {d.id} / {d.field || "*"}</td><td>{format(d.parent)}</td><td>{format(d.candidate)}</td><td>{format(d.current)}</td><td>{d.conflict ? "是" : "否"}</td></tr>)}</tbody></table>}</PagedItems>
      <button className="button" disabled={busy || current?.state !== "passed" || current.commit !== preview.candidate.commit || differences.some((d) => d.conflict)} onClick={() => {
        if (window.confirm(`确认合并已检查的候选 ${preview.candidate.commit.slice(0, 12)}？`)) run(() => onMerge(preview.candidate.taskId, preview.candidate.commit));
      }}>确认合并此版本</button>
    </section>}
    {error && <p role="alert">{error}</p>}
    <div className="dialog-actions"><button className="button" disabled={busy} onClick={onClose}>关闭候选</button></div>
  </section></div>;
}
function format(value: unknown): string { const text = value === undefined ? "—" : JSON.stringify(value); return text.length > 400 ? `${text.slice(0, 400)}…` : text; }
