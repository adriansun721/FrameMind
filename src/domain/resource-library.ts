import type { CatalogSource, MaterialProperties, SectionProperties } from "./project";
import type { SectionGeometry } from "./section-geometry";
import type { SectionMechanicalValues } from "./catalog-section";
export type { CatalogSource } from "./project";

export interface MaterialCatalogEntry extends MaterialProperties {
  catalogId: string;
  displayName: string;
  source: CatalogSource;
}

export interface SectionCatalogEntry extends SectionProperties {
  catalogId: string;
  displayName: string;
  source: CatalogSource;
  /** Short field definitions shown beside the values in the picker. */
  fieldNotes: {
    area: string;
    secondMomentY: string;
    secondMomentZ: string;
    torsionalConstant: string;
  };
}

const STEEL_SOURCE: CatalogSource = Object.freeze({
  publisher: "European Committee for Standardization",
  title: "EN 10025-2 Hot rolled products of structural steels",
  edition: "EN 10025-2:2019",
  url: "https://standards.iteh.ai/catalog/standards/cen/8f2a1a15-6f06-4f07-8b43-2c84b7c99f0b/en-10025-2-2019",
  accessedOn: "2026-10-02",
  units: "E in GPa; density in kg/m³; ν dimensionless",
});

const SECTION_SOURCE: CatalogSource = Object.freeze({
  publisher: "ArcelorMittal Europe - Long Products",
  title: "Sections and Merchant Bars - ArcelorMittal",
  edition: "V2026-1, EN sections sheet",
  url: "https://sections.arcelormittal.com/repo/Sections/Sections%20and%20Merchant%20Bars-ArcelorMittal_V2026-1.xlsx",
  accessedOn: "2026-10-06",
  units: "Dimensions and root radius converted mm → m; A cm² → m²; Iy, Iz and It (Saint-Venant torsion constant) cm⁴ → m⁴",
});

/** Checked first-release catalog entries. Values are copied into a project when selected. */
export const MATERIAL_CATALOG: readonly MaterialCatalogEntry[] = Object.freeze([
  { catalogId: "en10025-s235jr", displayName: "S235JR · structural steel", name: "S235JR", elasticModulusGPa: 210, poissonRatio: 0.3, densityKgM3: 7850, source: STEEL_SOURCE },
  { catalogId: "en10025-s275jr", displayName: "S275JR · structural steel", name: "S275JR", elasticModulusGPa: 210, poissonRatio: 0.3, densityKgM3: 7850, source: STEEL_SOURCE },
  { catalogId: "en10025-s355jr", displayName: "S355JR · structural steel", name: "S355JR", elasticModulusGPa: 210, poissonRatio: 0.3, densityKgM3: 7850, source: STEEL_SOURCE },
]);

const SECTION_NOTES = {
  area: "A：截面面积",
  secondMomentY: "Iy：关于局部 y 轴的二次面积矩",
  secondMomentZ: "Iz：关于局部 z 轴的二次面积矩",
  torsionalConstant: "J：Saint-Venant 扭转常数",
} as const;

function catalogSection(catalogId: string, name: string, designation: string, row: number, dimensions: [number, number, number, number, number], properties: SectionMechanicalValues): SectionCatalogEntry {
  const [h, b, tw, tf, r] = dimensions;
  const geometry: SectionGeometry = { shape: "i-section", height: h / 1000, width: b / 1000, webThickness: tw / 1000, flangeThickness: tf / 1000 };
  return { catalogId, displayName: `${name} · I/H 形截面`, name, ...properties, geometry, source: SECTION_SOURCE, fieldNotes: SECTION_NOTES,
    catalogBasis: { method: "catalog-section-v1", catalogId, designation, source: { ...SECTION_SOURCE }, location: `EN sections!C${row}:AN${row}; h/G, b/H, tw/I, tf/J, r/K, A/N, Iy/AD, Iz/AI, It/AN`,
      rootRadiusM: r / 1000, referenceGeometry: { ...geometry }, referenceProperties: { ...properties } } };
}

export const SECTION_CATALOG: readonly SectionCatalogEntry[] = Object.freeze([
  catalogSection("arcelor-ipe100", "IPE 100", "IPE 100", 70, [100, 55, 4.1, 5.7, 7], { areaM2: .00103, secondMomentYM4: 1.71e-6, secondMomentZM4: 1.591e-7, torsionalConstantM4: 1.157e-8 }),
  catalogSection("arcelor-ipe200", "IPE 200", "IPE 200", 54, [200, 100, 5.6, 8.5, 12], { areaM2: .00285, secondMomentYM4: 1.943e-5, secondMomentZM4: 1.423e-6, torsionalConstantM4: 6.915e-8 }),
  catalogSection("arcelor-hea200", "HEA 200", "HE 200 A", 174, [190, 200, 6.5, 10, 18], { areaM2: .00538, secondMomentYM4: 3.692e-5, secondMomentZM4: 1.335e-5, torsionalConstantM4: 2.104e-7 }),
]);

export function getMaterialCatalogEntry(catalogId: string): MaterialCatalogEntry | undefined {
  return MATERIAL_CATALOG.find((entry) => entry.catalogId === catalogId);
}

export function getSectionCatalogEntry(catalogId: string): SectionCatalogEntry | undefined {
  return SECTION_CATALOG.find((entry) => entry.catalogId === catalogId);
}
