import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

export function BottomProperties({ open, label, onClose, children }: {
  open: boolean;
  label: string;
  onClose(): void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ y: number; height: number } | null>(null);
  const [requestedHeight, setRequestedHeight] = useState(260);
  const [areaHeight, setAreaHeight] = useState(520);
  const maximum = Math.max(120, Math.floor(areaHeight / 2));
  const minimum = Math.min(160, maximum);
  const height = Math.max(minimum, Math.min(maximum, requestedHeight));
  const resize = (next: number) => setRequestedHeight(Math.max(minimum, Math.min(maximum, next)));

  useLayoutEffect(() => {
    const area = panelRef.current?.parentElement;
    if (!area) return;
    const measure = () => setAreaHeight(area.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  return <section ref={panelRef} id="property-panel" className="sidebar-pane property-pane" aria-label="对象属性" hidden={!open} style={{ height }}>
    <div className="property-resizer" role="separator" tabIndex={open ? 0 : -1} aria-label="调整属性面板高度" aria-orientation="horizontal" aria-controls="property-panel" aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={Math.round(height)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragRef.current = { y: event.clientY, height };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (dragRef.current) resize(dragRef.current.height + dragRef.current.y - event.clientY);
      }}
      onPointerUp={(event) => {
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => { dragRef.current = null; }}
      onKeyDown={(event) => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        resize(event.key === "Home" ? minimum : event.key === "End" ? maximum : height + (event.key === "ArrowUp" ? 16 : -16));
      }} />
    <div className="panel-heading"><span>属性 · {label}</span><button className="icon-button" aria-label="收起属性面板" title="收起属性面板" onClick={onClose}><X size={15} /></button></div>
    <div className="property-body">{children}</div>
  </section>;
}
