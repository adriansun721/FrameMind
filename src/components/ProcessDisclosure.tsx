import { useState, type ReactNode } from "react";

/** Build process tables only when requested; closing releases their DOM. */
export function ProcessDisclosure({ summary, className, children }: { summary: ReactNode; className: string; children(): ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details className={className} onToggle={(event) => setOpen(event.currentTarget.open)}><summary>{summary}</summary>{open && children()}</details>;
}

/** All entries remain accessible, while each render has a bounded number of rows. */
export function PagedItems<T>({ items, label, pageSize = 50, children }: { items: readonly T[]; label: string; pageSize?: number; children(items: readonly T[]): ReactNode }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pages - 1);
  return <>{items.length > pageSize && <nav className="process-pagination" aria-label={`${label}分页`}><button type="button" className="button ghost compact-button" disabled={current === 0} onClick={() => setPage(current - 1)}>上一页</button><span>{current + 1} / {pages} 页 · {items.length} 项</span><button type="button" className="button ghost compact-button" disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>下一页</button></nav>}{children(items.slice(current * pageSize, (current + 1) * pageSize))}</>;
}
