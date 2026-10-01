import type { CatalogSource, MaterialProperties, SectionProperties } from "./project";
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
  accessedOn: "2026-10-02",
  units: "A in m²; Iy, Iz and It (Saint-Venant torsion constant) in m⁴; values converted from cm²/cm⁴",
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

export const SECTION_CATALOG: readonly SectionCatalogEntry[] = Object.freeze([
  { catalogId: "arcelor-ipe100", displayName: "IPE 100 · I 形截面", name: "IPE 100", areaM2: 0.00103, secondMomentYM4: 1.71e-6, secondMomentZM4: 1.591e-7, torsionalConstantM4: 1.157e-8, source: SECTION_SOURCE, fieldNotes: SECTION_NOTES },
  { catalogId: "arcelor-ipe200", displayName: "IPE 200 · I 形截面", name: "IPE 200", areaM2: 0.00285, secondMomentYM4: 1.943e-5, secondMomentZM4: 1.423e-6, torsionalConstantM4: 6.915e-8, source: SECTION_SOURCE, fieldNotes: SECTION_NOTES },
  { catalogId: "arcelor-hea200", displayName: "HEA 200 · 宽翼缘 H 形截面", name: "HEA 200", areaM2: 0.00538, secondMomentYM4: 3.692e-5, secondMomentZM4: 1.335e-5, torsionalConstantM4: 2.104e-7, source: SECTION_SOURCE, fieldNotes: SECTION_NOTES },
]);

export function getMaterialCatalogEntry(catalogId: string): MaterialCatalogEntry | undefined {
  return MATERIAL_CATALOG.find((entry) => entry.catalogId === catalogId);
}

export function getSectionCatalogEntry(catalogId: string): SectionCatalogEntry | undefined {
  return SECTION_CATALOG.find((entry) => entry.catalogId === catalogId);
}
