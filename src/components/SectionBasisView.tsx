import type { SectionProperties } from "../domain/project";
import { SECTION_PROPERTY_KEYS } from "../domain/catalog-section";
import { SECTION_DIMENSIONS } from "../domain/section-geometry";
import { useUnits } from "./UnitPresentation";

export function SectionBasisView({ section }: { section: SectionProperties }) {
  const u = useUnits(), basis = section.catalogBasis;
  if (!basis || !section.geometry) return null;
  const comparison = basis.idealizedComparison;
  const labels = { areaM2: "A", secondMomentYM4: "Iy", secondMomentZM4: "Iz", torsionalConstantM4: "J" };
  return <section aria-label="目录与理想化参数依据" className="catalog-source">
    <strong>正式分析采用目录参数 · {basis.designation}</strong>
    <span>{basis.source.edition} · {basis.location}</span>
    <span>{Object.entries(section.geometry).filter(([key]) => key !== "shape").map(([key, value]) => `${SECTION_DIMENSIONS[key as keyof typeof SECTION_DIMENSIONS]} ${u.quantity(Number(value), "m")}`).join("；")}</span>
    <span>原表圆角 r = {u.quantity(basis.rootRadiusM, "m")}；几何示意忽略圆角。</span>
    <span>{comparison.notes}</span>
    {!comparison.withinApproximationLimits && <span>该尺寸超出理想化薄壁分析阈值；以下 J 仅作公式对照。</span>}
    <dl>{SECTION_PROPERTY_KEYS.map((key) => <div key={key}><dt>{labels[key]} · 目录 / 理想化</dt><dd>{u.quantity(section[key], key === "areaM2" ? "m²" : "m⁴")} / {u.quantity(comparison.properties[key], key === "areaM2" ? "m²" : "m⁴")}</dd></div>)}</dl>
    <a href={basis.source.url} target="_blank" rel="noreferrer">目录来源 · 核对于 {basis.source.accessedOn}</a>
    <a href={comparison.basis.url} target="_blank" rel="noreferrer">理想化公式依据 · {comparison.basis.method}</a>
  </section>;
}
