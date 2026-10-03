import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowDownToLine, ChevronDown, Layers3, Plus } from "lucide-react";

interface LoadMenuProps {
  disabled: boolean;
  hasMembers: boolean;
  onNodalLoad(): void;
  onUniformLoad(): void;
  onLoadCases(): void;
}

export function LoadMenu({ disabled, hasMembers, onNodalLoad, onUniformLoad, onLoadCases }: LoadMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useLayoutEffect(() => {
    if (open) containerRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']:not(:disabled)")?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  const select = (action: () => void) => { setOpen(false); triggerRef.current?.focus(); action(); };

  return <div className="load-menu-container" ref={containerRef}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      const items = Array.from(containerRef.current!.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)"));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
      items[next]?.focus();
    }}>
    <button ref={triggerRef} className={`tool-button ${open ? "active" : ""}`} aria-label="荷载" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      title="节点荷载、均布荷载与工况" onClick={() => setOpen((value) => !value)}><Plus size={15} />荷载<ChevronDown size={13} /></button>
    {open && <div id={menuId} className="file-menu load-menu" role="menu" aria-label="荷载类型">
      <button className="menu-item" role="menuitem" aria-label="创建荷载" disabled={disabled} title={disabled ? "选择工况后设置荷载" : undefined} onClick={() => select(onNodalLoad)}><span><Plus size={15} />节点荷载</span></button>
      <button className="menu-item" role="menuitem" aria-label="创建均布荷载" disabled={disabled || !hasMembers} title={disabled ? "选择工况后设置荷载" : hasMembers ? "整根杆件均布力 · kN/m" : "请先创建杆件"} onClick={() => select(onUniformLoad)}><span><ArrowDownToLine size={15} />均布荷载</span></button>
      <button className="menu-item" role="menuitem" aria-label="工况" onClick={() => select(onLoadCases)}><span><Layers3 size={15} />工况</span></button>
    </div>}
  </div>;
}
