import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowDownToLine, ChevronDown, Plus, Weight } from "lucide-react";

interface LoadMenuProps {
  disabled: boolean;
  hasMembers: boolean;
  selfWeightEnabled: boolean;
  onNodalLoad(): void;
  onUniformLoad(): void;
  onSelfWeight(): void;
}

export function LoadMenu({ disabled, hasMembers, selfWeightEnabled, onNodalLoad, onUniformLoad, onSelfWeight }: LoadMenuProps) {
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
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || disabled) return;
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      const items = Array.from(containerRef.current!.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)"));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
      items[next]?.focus();
    }}>
    <button ref={triggerRef} className={`tool-button ${open ? "active" : ""}`} aria-label="荷载" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      title={disabled ? "选择工况后设置荷载" : "节点荷载、均布荷载与结构自重"} disabled={disabled} onClick={() => setOpen((value) => !value)}><Plus size={15} />荷载<ChevronDown size={13} /></button>
    {open && <div id={menuId} className="file-menu load-menu" role="menu" aria-label="荷载类型">
      <button className="menu-item" role="menuitem" aria-label="创建荷载" onClick={() => select(onNodalLoad)}><span><Plus size={15} />节点荷载</span></button>
      <button className="menu-item" role="menuitem" aria-label="创建均布荷载" disabled={!hasMembers} title={hasMembers ? "整根杆件均布力 · kN/m" : "请先创建杆件"} onClick={() => select(onUniformLoad)}><span><ArrowDownToLine size={15} />均布荷载</span></button>
      <button className="menu-item" role="menuitem" aria-label="设置自重" onClick={() => select(onSelfWeight)}><span><Weight size={15} />自重</span>{selfWeightEnabled && <small>已启用</small>}</button>
    </div>}
  </div>;
}
