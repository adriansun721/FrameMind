import type { CatalogSource, SectionProperties } from "./project";
import { sectionMechanicalProperties, sectionParameterBasis, validateSectionDimensions, validateSectionGeometry, type SectionGeometry } from "./section-geometry";

export type SectionMechanicalValues = ReturnType<typeof sectionMechanicalProperties>;
export const SECTION_PROPERTY_KEYS = ["areaM2", "secondMomentYM4", "secondMomentZM4", "torsionalConstantM4"] as const;

/** Archived source row: project loading never consults the installed catalog. */
export interface CatalogSectionBasis {
  method: "catalog-section-v1";
  catalogId: string;
  designation: string;
  source: CatalogSource;
  location: string;
  rootRadiusM: number;
  referenceGeometry: SectionGeometry;
  referenceProperties: SectionMechanicalValues;
  /** Frozen comparison uses canonical m/m²/m⁴ and never enters the solver. */
  idealizedComparison: ReturnType<typeof idealizedCatalogComparison>;
}

export function validateCatalogSectionBasis(value: unknown, geometry: SectionGeometry | undefined, properties: Partial<SectionMechanicalValues>): CatalogSectionBasis {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("目录截面依据无效");
  const b = value as CatalogSectionBasis;
  if (b.method !== "catalog-section-v1" || !geometry || typeof b.rootRadiusM !== "number" || !Number.isFinite(b.rootRadiusM) || b.rootRadiusM <= 0) throw new Error("目录截面尺寸或圆角依据无效");
  for (const text of [b.catalogId, b.designation, b.location, b.source?.publisher, b.source?.title, b.source?.edition, b.source?.url, b.source?.accessedOn, b.source?.units]) {
    if (typeof text !== "string" || !text.trim()) throw new Error("目录截面来源字段缺失");
  }
  const referenceGeometry = validateSectionDimensions(b.referenceGeometry);
  sectionMechanicalProperties(referenceGeometry, "catalog-comparison");
  if (referenceGeometry.shape !== geometry.shape || Object.entries(referenceGeometry).some(([key, v]) => v !== (geometry as unknown as Record<string, unknown>)[key])) throw new Error("目录几何已修改，请明确转换为自定义截面并重新确认");
  const referenceProperties = {} as SectionMechanicalValues;
  for (const key of SECTION_PROPERTY_KEYS) {
    const ref = b.referenceProperties?.[key];
    if (typeof ref !== "number" || !Number.isFinite(ref) || ref <= 0 || properties[key] !== ref) throw new Error("目录力学参数已修改，请明确转换为自定义截面并重新确认");
    referenceProperties[key] = ref;
  }
  const comparison = b.idealizedComparison;
  if (!comparison || comparison.basis?.method !== "idealized-section-v1" || typeof comparison.withinApproximationLimits !== "boolean"
    || [comparison.notes, comparison.basis.source, comparison.basis.url, comparison.basis.notes].some((text) => typeof text !== "string" || !text.trim())
    || SECTION_PROPERTY_KEYS.some((key) => typeof comparison.properties?.[key] !== "number" || !Number.isFinite(comparison.properties[key]) || comparison.properties[key] <= 0)) throw new Error("目录截面缺少归档理想化对照依据");
  return { method: b.method, catalogId: b.catalogId, designation: b.designation, source: { ...b.source }, location: b.location, rootRadiusM: b.rootRadiusM, referenceGeometry, referenceProperties,
    idealizedComparison: structuredClone(comparison) };
}

export function idealizedCatalogComparison(geometry: SectionGeometry) {
  let withinApproximationLimits = true;
  try { validateSectionGeometry(geometry); } catch { withinApproximationLimits = false; }
  return { properties: sectionMechanicalProperties(geometry, "catalog-comparison"), basis: sectionParameterBasis(geometry.shape), withinApproximationLimits,
    notes: "几何示意忽略轧制圆角；理想化 A/I/J 仅供对照，正式分析采用目录 A/I/J。圆角、交汇及目录舍入使两者不同。" };
}

export function describeSection<T extends SectionProperties>(section: T) {
  return { ...section, geometryStatus: section.geometry ? "几何已定义" : "几何未定义", ...(!section.geometry ? { displayMode: "analysis-line" } : {}),
    ...(section.catalogBasis && section.geometry ? { idealizedComparison: section.catalogBasis.idealizedComparison } : {}) };
}
