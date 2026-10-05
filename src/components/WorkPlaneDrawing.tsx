import { useCallback, useEffect, useState } from "react";
import type { FrameMaterial, FrameNode, FrameSection, Vector3 } from "../domain/project";
import { exactDrawingPoint, PLANE_NORMAL_AXIS, type DrawingPoint, type DrawnMemberInput, type WorkPlane } from "../domain/work-plane";
import { UnitInput, useUnits } from "./UnitPresentation";

export function useWorkPlaneDrawing(nodes: FrameNode[], materials: FrameMaterial[], sections: FrameSection[], onCommit: (input: DrawnMemberInput) => FrameNode | null) {
  const [plane, setPlane] = useState<WorkPlane>("XY");
  const [offsetText, setOffsetText] = useState("0");
  const [snap, setSnap] = useState(true);
  const [start, setStart] = useState<DrawingPoint | null>(null);
  const [candidate, setCandidate] = useState<DrawingPoint | null>(null);
  const [coordinates, setCoordinates] = useState({ x: "0", y: "0", z: "0" });
  const [materialId, setMaterialId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const offset = offsetText.trim() ? Number(offsetText) : NaN;
  const reset = useCallback(() => { setStart(null); setCandidate(null); setError(null); }, []);
  const preview = (point: DrawingPoint | null) => {
    setCandidate(point);
    if (point) setCoordinates({ x: String(point.position.x), y: String(point.position.y), z: String(point.position.z) });
  };
  const accept = (point: DrawingPoint | null, resources: { materialId: string; sectionId: string }) => {
    if (!point) { setError("射线与工作平面平行或交点不可见，请旋转视图或使用数值输入"); return; }
    setError(null); preview(point);
    if (!start) { setStart(point); return; }
    try {
      const end = onCommit({ start, end: point, materialId: resources.materialId as FrameMaterial["id"], sectionId: resources.sectionId as FrameSection["id"], rotationDegrees: 0 });
      if (end) setStart({ position: end.position, nodeId: end.id });
    } catch (error) { setError(error instanceof Error ? error.message : "绘制失败"); }
  };
  const changeCoordinates = (axis: keyof Vector3, value: string) => {
    const next = { ...coordinates, [axis]: value, [PLANE_NORMAL_AXIS[plane]]: offsetText };
    setCoordinates(next);
    const position = { x: Number(next.x), y: Number(next.y), z: Number(next.z) };
    setCandidate(Object.values(next).every((value) => value.trim() && Number.isFinite(Number(value)))
      ? exactDrawingPoint(position, nodes, snap) : null);
  };
  return { plane, offset, offsetText, snap, start, candidate, coordinates,
    materialId: materials.some((item) => item.id === materialId) ? materialId : materials[0]?.id ?? "",
    sectionId: sections.some((item) => item.id === sectionId) ? sectionId : sections[0]?.id ?? "", error, reset, preview, accept, changeCoordinates,
    setMaterialId, setSectionId,
    changePlane(value: WorkPlane) { setPlane(value); reset(); setCoordinates((current) => ({ ...current, [PLANE_NORMAL_AXIS[value]]: offsetText })); },
    changeOffset(value: string) { setOffsetText(value); reset(); setCoordinates((current) => ({ ...current, [PLANE_NORMAL_AXIS[plane]]: value })); },
    changeSnap(value: boolean) { setSnap(value); setCandidate((point) => point ? exactDrawingPoint(point.position, nodes, value) : null); },
  };
}

export type WorkPlaneDrawingState = ReturnType<typeof useWorkPlaneDrawing>;

export function WorkPlaneDrawingPanel({ drawing: d, nodes, materials, sections, onExit, onAlign }: {
  drawing: WorkPlaneDrawingState; nodes: FrameNode[]; materials: FrameMaterial[]; sections: FrameSection[]; onExit(): void; onAlign(): void;
}) {
  const u = useUnits();
  const { materialId, sectionId } = d;
  const label = (point: DrawingPoint) => nodes.find((node) => node.id === point.nodeId)?.label ?? point.nodeId;
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") d.reset(); };
    window.addEventListener("keydown", cancel); return () => window.removeEventListener("keydown", cancel);
  }, [d.reset]);
  return <form className="work-plane-panel" aria-label="工作平面绘杆" onSubmit={(event) => { event.preventDefault(); d.accept(d.candidate, { materialId, sectionId }); }}>
    <div className="drawing-heading"><strong>连续绘杆</strong><button type="button" onClick={onExit}>退出</button></div>
    <div className="drawing-plane-row"><label>平面<select aria-label="工作平面" value={d.plane} onChange={(event) => d.changePlane(event.target.value as WorkPlane)}>{["XY", "XZ", "YZ"].map((plane) => <option key={plane}>{plane}</option>)}</select></label>
      <label>{PLANE_NORMAL_AXIS[d.plane].toUpperCase()} ({u.unit("m")})<UnitInput aria-label="工作平面位置" value={d.offsetText} unit="m" onValueChange={d.changeOffset} /></label>
      <button type="button" onClick={onAlign}>正对平面</button></div>
    <label className="drawing-snap"><input type="checkbox" checked={d.snap} onChange={(event) => d.changeSnap(event.target.checked)} />捕捉已有节点 · {d.snap ? "开启" : "关闭"}</label>
    <div className="drawing-resources"><label>材料<select aria-label="绘杆材料" value={materialId} onChange={(event) => d.setMaterialId(event.target.value)}>{materials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>截面<select aria-label="绘杆截面" value={sectionId} onChange={(event) => d.setSectionId(event.target.value)}>{sections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    <div className="drawing-coordinates">{(["x", "y", "z"] as const).map((axis) => <label key={axis}>{axis.toUpperCase()} ({u.unit("m")})<UnitInput aria-label={`绘杆 ${axis.toUpperCase()} 坐标`} value={axis === PLANE_NORMAL_AXIS[d.plane] ? d.offsetText : d.coordinates[axis]} unit="m" disabled={axis === PLANE_NORMAL_AXIS[d.plane]} onValueChange={(value) => d.changeCoordinates(axis, value)} /></label>)}</div>
    <div className="drawing-actions"><button type="submit" disabled={!d.candidate || !materialId || !sectionId}>{d.start ? "提交当前段" : "设为起点"}</button><button type="button" onClick={d.reset}>取消当前段</button></div>
    <output aria-label="绘杆状态">{d.start ? `起点 ${label(d.start) ?? "未提交"} · ${u.vector(d.start.position, "m")}` : "点击平面或输入坐标设置起点"}<br />{d.candidate ? `端点 ${u.vector(d.candidate.position, "m")} · ${d.candidate.nodeId ? `捕捉 ${label(d.candidate)}` : "自由坐标"}` : "等待有效端点"}</output>
    {(!materialId || !sectionId) && <small>先创建材料与截面，再提交杆段</small>}
    <small>Esc 取消当前段 · 已提交段可撤销<br />左键绘制 · 右键平移 · 滚轮缩放 · 退出后旋转</small>
    {d.error && <p role="alert">{d.error}</p>}
  </form>;
}
