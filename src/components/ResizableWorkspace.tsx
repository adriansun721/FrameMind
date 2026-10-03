import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function ResizableWorkspace({ resourceOpen, assistantOpen, resourcePanelId, children }: {
  resourceOpen: boolean;
  assistantOpen: boolean;
  resourcePanelId: string;
  children: ReactNode;
}) {
  const workspaceRef = useRef<HTMLElement>(null);
  const [areaWidth, setAreaWidth] = useState(1080);
  const [resourceWidth, setResourceWidth] = useState<number | null>(null);
  const [assistantWidth, setAssistantWidth] = useState<number | null>(null);
  const minimum = 220;
  // Keep at least 360px for the model, even with both sidebars at their limits.
  const visiblePanels = Number(resourceOpen) + Number(assistantOpen);
  const maximum = Math.max(minimum, Math.min(600, Math.floor((areaWidth - 48 - 360) / Math.max(1, visiblePanels))));
  const clamp = (width: number) => Math.max(minimum, Math.min(maximum, width));
  const compact = areaWidth <= 1160;
  const leftWidth = clamp(resourceWidth ?? (compact ? 220 : 230));
  const rightWidth = clamp(assistantWidth ?? (compact ? 220 : 260));

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const measure = () => setAreaWidth(workspace.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  return <section ref={workspaceRef} className="workspace" style={{ gridTemplateColumns: `48px ${resourceOpen ? leftWidth : 0}px minmax(0, 1fr) ${assistantOpen ? rightWidth : 0}px` }}>
    {children}
    <SidePanelResizer side="left" open={resourceOpen} label="调整项目面板宽度" panelId={resourcePanelId} width={leftWidth} minimum={minimum} maximum={maximum} onResize={(width) => setResourceWidth(clamp(width))} />
    <SidePanelResizer side="right" open={assistantOpen} label="调整 AI 对话面板宽度" panelId="assistant-panel" width={rightWidth} minimum={minimum} maximum={maximum} onResize={(width) => setAssistantWidth(clamp(width))} />
  </section>;
}

function SidePanelResizer({ side, open, label, panelId, width, minimum, maximum, onResize }: {
  side: "left" | "right";
  open: boolean;
  label: string;
  panelId: string;
  width: number;
  minimum: number;
  maximum: number;
  onResize(width: number): void;
}) {
  const dragRef = useRef<{ x: number; width: number; pointerId: number } | null>(null);
  const direction = side === "left" ? 1 : -1;
  return <div className={`side-panel-resizer ${side}`} hidden={!open} role="separator" tabIndex={open ? 0 : -1} aria-label={label} aria-orientation="vertical" aria-controls={panelId} aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={Math.round(width)}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragRef.current = { x: event.clientX, width, pointerId: event.pointerId };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      const drag = dragRef.current;
      if (drag?.pointerId === event.pointerId) onResize(drag.width + direction * (event.clientX - drag.x));
    }}
    onPointerUp={(event) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => { dragRef.current = null; }}
    onLostPointerCapture={() => { dragRef.current = null; }}
    onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      onResize(event.key === "Home" ? minimum : event.key === "End" ? maximum : width + direction * (event.key === "ArrowRight" ? 16 : -16));
    }} />;
}
