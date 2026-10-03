import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export interface ProposalRow { label: string; value: ReactNode; changed?: boolean; }

/** The chat owns a compact receipt; the nonmodal drawer owns inspection and editing. */
export function ProposalCard({ title, label, rows, issues = [], current, busy, dirty, visible = true, updateDisabled = busy, confirmLabel, onConfirm, onCancelEdit, details, children }: {
  title: string; label: string; rows: ProposalRow[]; issues?: string[];
  current: boolean; busy: boolean; dirty: boolean; visible?: boolean; updateDisabled?: boolean; confirmLabel: string;
  onConfirm(): void; onCancelEdit(): void; details: ReactNode; children: ReactNode;
}) {
  const [view, setView] = useState<"details" | "edit" | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const close = () => { if (view === "edit") onCancelEdit(); setView(null); trigger.current?.focus(); };
  useEffect(() => { if (view) closeButton.current?.focus(); }, [view]);
  useEffect(() => {
    if (!view) return;
    const originalTrigger = trigger.current;
    return () => { queueMicrotask(() => {
      if (originalTrigger?.isConnected) return;
      const replacement = [...document.querySelectorAll<HTMLElement>(".proposal-summary-card")].find((card) => card.getAttribute("aria-label") === label);
      replacement?.querySelector<HTMLButtonElement>(".proposal-card-actions button:nth-child(2)")?.focus();
    }); };
  }, [view, label]);
  useEffect(() => { if (!visible && view) close(); }, [visible]);
  return <section className="frame-proposal-card proposal-summary-card" aria-label={label}>
    <div className="frame-proposal-heading"><strong>{title}</strong><span>{!current ? "已失效" : issues.length ? "待补充" : "待确认"}</span></div>
    <dl className="proposal-summary">{rows.map((row) => <div key={row.label} className={row.changed ? "proposal-row-changed" : undefined}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
    {issues.length > 0 && <ul className="frame-issues" role="alert">{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
    {dirty && <p className="frame-draft-notice">侧栏有未保存编辑，请更新预览或取消编辑后再用文字修改。当前仍显示原方案预览。</p>}
    <div className="proposal-card-actions">
      <button type="button" disabled={dirty} onClick={(event) => { trigger.current = event.currentTarget; setView("details"); }}>详情</button>
      <button type="button" onClick={(event) => { trigger.current = event.currentTarget; setView("edit"); }}>编辑</button>
      <button type="button" className="proposal-confirm" disabled={busy || dirty || !current || issues.length > 0} onClick={onConfirm}>{confirmLabel}</button>
    </div>
    {visible && view && createPortal(<aside className="proposal-drawer frame-proposal-card" role="dialog" aria-modal="false" aria-label={`${title} · ${view === "edit" ? "编辑" : "详情"}`} onKeyDown={(event) => {
      if (event.key === "Escape") { event.stopPropagation(); close(); }
    }}>
      <header className="proposal-drawer-heading"><div><strong>{title}</strong><span>{view === "edit" ? "编辑方案" : "方案详情"}</span></div><button ref={closeButton} type="button" className="icon-button" aria-label={view === "edit" ? "关闭编辑侧栏" : "关闭详情"} onClick={close}><X size={18} /></button></header>
      <div ref={content} className="proposal-drawer-content">{view === "edit" ? children : details}</div>
      {view === "edit" && <footer className="proposal-drawer-footer proposal-card-actions"><button type="button" onClick={close}>取消编辑</button><button className="proposal-confirm" type="button" disabled={updateDisabled} onClick={() => content.current?.querySelector("form")?.requestSubmit()}>更新预览</button></footer>}
    </aside>, document.body)}
  </section>;
}
