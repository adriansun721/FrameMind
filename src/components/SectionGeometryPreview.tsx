import { useId } from "react";
import type { SectionGeometry } from "../domain/section-geometry";
import { SECTION_SHAPES, sectionParameterBasis } from "../domain/section-geometry";
import { useUnits } from "./UnitPresentation";

/** Viewed from the +x end toward the start: unrotated y right, z up. */
export function SectionGeometryPreview({ geometry: g, rotationDegrees = 0 }: { geometry?: SectionGeometry; rotationDegrees?: number }) {
  const u = useUnits(); const maskId = useId();
  if (!g) return <p>几何未定义 · 仅力学属性</p>;
  const b = "width" in g ? g.width : g.diameter, h = "height" in g ? g.height : g.diameter;
  const scale = 120 / Math.hypot(b, h);
  const rectangle = (width: number, height: number, z = 0) => <rect x={-width * scale / 2} y={(-z - height / 2) * scale} width={width * scale} height={height * scale} />;
  const basis = sectionParameterBasis(g.shape);
  return <div className="section-geometry-preview">
    <svg viewBox="-90 -90 180 180" role="img" aria-label={`截面几何 · ${SECTION_SHAPES[g.shape]} · 转角 ${rotationDegrees}°`}>
      <defs><mask id={maskId}><rect x="-90" y="-90" width="180" height="180" fill="white" />
        <g fill="black">{g.shape === "rectangular-tube" && rectangle(b - 2 * g.thickness, h - 2 * g.thickness)}
          {g.shape === "circular-tube" && <circle r={(g.diameter / 2 - g.thickness) * scale} />}</g></mask></defs>
      <g transform={`rotate(${-rotationDegrees})`} fill="currentColor" fillOpacity=".35" stroke="currentColor" strokeWidth=".5">
        <g mask={`url(#${maskId})`}>
          {(g.shape === "rectangle" || g.shape === "rectangular-tube") && rectangle(b, h)}
          {(g.shape === "circle" || g.shape === "circular-tube") && <circle r={g.diameter * scale / 2} />}
          {g.shape === "i-section" && <>{rectangle(g.webThickness, h - 2 * g.flangeThickness)}{rectangle(b, g.flangeThickness, (h - g.flangeThickness) / 2)}{rectangle(b, g.flangeThickness, -(h - g.flangeThickness) / 2)}</>}
        </g>
        <path d="M0,0 H70 M0,0 V-70" fill="none" /><text x="73" y="4" fillOpacity="1" stroke="none" fontSize="10">y</text><text x="-3" y="-75" fillOpacity="1" stroke="none" fontSize="10">z</text>
      </g>
    </svg>
    <p>{SECTION_SHAPES[g.shape]} · {u.quantity(b, "m")} × {u.quantity(h, "m")} · 转角 {u.quantity(rotationDegrees, "°")}</p>
    <p>从 +x 端看向起点；宽沿局部 y，高沿局部 z。右手转角绕 x。</p>
    <p>{basis.notes} <a href={basis.url} target="_blank" rel="noreferrer">公式来源</a></p>
  </div>;
}
