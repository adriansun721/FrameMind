import { useEffect, useState } from "react";
import type { RecoveryEntry } from "../../electron/contracts";
import { decodeProject } from "../domain/project-file";
import type { FrameProject } from "../domain/project";

export function recoveryTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Taipei", hour12: false });
}

export function StartupRecovery({ onContinue, onRecover }: { onContinue(): void; onRecover(project: FrameProject, entry: RecoveryEntry): void }) {
  const [candidates, setCandidates] = useState<{ entry: RecoveryEntry; project: FrameProject }[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    void (async () => {
      try {
        const listing = await window.frameMind.listRecovery();
        const seen = new Set<string>(); const warnings = [...listing.issues];
        const valid: typeof candidates = [];
        for (const entry of listing.entries) {
          if (seen.has(entry.projectId)) continue;
          try {
            const project = decodeProject(await window.frameMind.readRecovery(entry.id));
            if (project.id !== entry.projectId) throw new Error("项目身份不一致");
            seen.add(entry.projectId);
            if (!entry.matchesFormalSave) valid.push({ entry, project });
          } catch { warnings.push(`${entry.projectName} 的快照 ${recoveryTime(entry.createdAt)} 无效，正在尝试较早版本。`); }
        }
        if (!current) return;
        setCandidates(valid); setIssues(warnings); setLoading(false);
        if (!valid.length && !warnings.length) onContinue();
      } catch {
        if (current) { setIssues(["无法读取本机恢复目录。可以重试，或进入工作台后打开正式项目；恢复文件保留。"]); setLoading(false); }
      }
    })();
    return () => { current = false; };
  }, [attempt]);

  return <main className="startup-recovery" aria-label="启动恢复">
    <section className="recovery-panel">
      <h1>FrameMind · 恢复未保存工作</h1>
      <p>自动快照保存在本机，与手动保存的项目独立。选择恢复后才进入工作台；任务等待你选择继续。</p>
      {loading ? <p role="status">正在检查恢复快照…</p> : <>
        {issues.length > 0 && <div role="alert">{issues.map((issue) => <p key={issue}>{issue}</p>)}</div>}
        {candidates.map(({ entry, project }) => <article key={entry.id} className="recovery-candidate" aria-label={`恢复 ${entry.projectName}`}>
          <h2>{entry.projectName}</h2>
          <dl>
            <div><dt>项目身份</dt><dd>{entry.projectId}</dd></div>
            <div><dt>自动快照</dt><dd>{recoveryTime(entry.createdAt)} · 本机自动恢复</dd></div>
            <div><dt>正式保存</dt><dd>{entry.formalSave ? `${recoveryTime(entry.formalSave.savedAt)} · ${entry.formalSave.path}` : "尚未手动保存（新项目）"}</dd></div>
            <div><dt>快照内容</dt><dd>{project.nodes.length} 节点 · {project.members.length} 杆件 · {project.taskState?.conversations.length ?? 0} 任务记录</dd></div>
          </dl>
          <button className="button primary" onClick={() => onRecover(project, entry)}>恢复此快照</button>
        </article>)}
        {!candidates.length && <p>没有可用的未保存工作快照。</p>}
        <div className="recovery-actions"><button className="button ghost" onClick={onContinue}>暂不恢复，进入工作台</button>{issues.length > 0 && <button className="button ghost" onClick={() => setAttempt((value) => value + 1)}>重新检查</button>}</div>
      </>}
    </section>
  </main>;
}
