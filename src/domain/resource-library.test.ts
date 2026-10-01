import { describe, expect, it } from "vitest";
import { addCatalogMaterial, addCatalogSection, addMember, addNode, createProject, updateMaterial, updateSection } from "./project";
import { decodeProject, encodeProject } from "./project-file";
import { getMaterialCatalogEntry, getSectionCatalogEntry, MATERIAL_CATALOG, SECTION_CATALOG } from "./resource-library";

describe("T13 checked material and section catalog", () => {
  it("publishes first-release entries with physical field definitions and traceable sources", () => {
    expect(MATERIAL_CATALOG.map((entry) => entry.catalogId)).toEqual(["en10025-s235jr", "en10025-s275jr", "en10025-s355jr"]);
    expect(SECTION_CATALOG.map((entry) => entry.catalogId)).toEqual(["arcelor-ipe100", "arcelor-ipe200", "arcelor-hea200"]);
    for (const entry of [...MATERIAL_CATALOG, ...SECTION_CATALOG]) {
      expect(entry.source.publisher).toBeTruthy();
      expect(entry.source.edition).toBeTruthy();
      expect(entry.source.url).toMatch(/^https:\/\//);
      expect(entry.source.accessedOn).toMatch(/^2026-10-02$/);
    }
    expect(getSectionCatalogEntry("arcelor-ipe200")?.fieldNotes.torsionalConstant).toContain("扭转常数");
    expect(getSectionCatalogEntry("arcelor-ipe100")).toMatchObject({ areaM2: 0.00103, secondMomentYM4: 1.71e-6, secondMomentZM4: 1.591e-7, torsionalConstantM4: 1.157e-8 });
    expect(getSectionCatalogEntry("arcelor-ipe200")).toMatchObject({ areaM2: 0.00285, secondMomentYM4: 1.943e-5, secondMomentZM4: 1.423e-6, torsionalConstantM4: 6.915e-8 });
    expect(getSectionCatalogEntry("arcelor-hea200")).toMatchObject({ areaM2: 0.00538, secondMomentYM4: 3.692e-5, secondMomentZM4: 1.335e-5, torsionalConstantM4: 2.104e-7 });
  });

  it("copies catalog values into project instances and preserves provenance after reopen", () => {
    const steel = getMaterialCatalogEntry("en10025-s355jr")!;
    const section = getSectionCatalogEntry("arcelor-ipe200")!;
    let project = createProject("Catalog frame");
    project = addCatalogMaterial(project, steel, { kind: "catalog", catalogId: steel.catalogId, source: steel.source });
    project = addCatalogSection(project, section, { kind: "catalog", catalogId: section.catalogId, source: section.source });
    expect(project.materials[0]).toMatchObject({ name: "S355JR", provenance: { kind: "catalog", catalogId: steel.catalogId } });
    expect(project.sections[0]).toMatchObject({ name: "IPE 200", areaM2: 0.00285, secondMomentYM4: 1.943e-5, provenance: { catalogId: section.catalogId } });
    const reopened = decodeProject(encodeProject(project));
    expect(reopened.materials[0].provenance.source?.edition).toBe(steel.source.edition);
    expect(reopened.sections[0].provenance.source?.units).toContain("m⁴");
  });

  it("retains the catalog source while marking edited values as custom", () => {
    const steel = getMaterialCatalogEntry("en10025-s355jr")!;
    const section = getSectionCatalogEntry("arcelor-ipe100")!;
    let project = createProject("Edited catalog frame");
    project = addCatalogMaterial(project, steel, { kind: "catalog", catalogId: steel.catalogId, source: steel.source });
    project = addCatalogSection(project, section, { kind: "catalog", catalogId: section.catalogId, source: section.source });
    project = updateMaterial(project, project.materials[0].id, { ...project.materials[0], name: "S355JR custom", elasticModulusGPa: 205, poissonRatio: 0.3, densityKgM3: 7800 });
    project = updateSection(project, project.sections[0].id, { ...project.sections[0], name: "IPE 100 custom", areaM2: 0.0011, secondMomentYM4: section.secondMomentYM4, secondMomentZM4: section.secondMomentZM4, torsionalConstantM4: section.torsionalConstantM4 });
    expect(project.materials[0].provenance).toMatchObject({ kind: "custom", derivedFrom: { catalogId: steel.catalogId } });
    expect(project.sections[0].provenance).toMatchObject({ kind: "custom", derivedFrom: { catalogId: section.catalogId } });
  });

  it("keeps catalog instances usable in member assignment", () => {
    const steel = getMaterialCatalogEntry("en10025-s235jr")!;
    const section = getSectionCatalogEntry("arcelor-ipe100")!;
    let project = createProject();
    project = addNode(project, { x: 0, y: 0, z: 0 });
    project = addNode(project, { x: 3, y: 0, z: 0 });
    project = addCatalogMaterial(project, steel, { kind: "catalog", catalogId: steel.catalogId, source: steel.source });
    project = addCatalogSection(project, section, { kind: "catalog", catalogId: section.catalogId, source: section.source });
    project = addMember(project, { startNodeId: project.nodes[0].id, endNodeId: project.nodes[1].id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
    expect(project.members[0].materialId).toBe(project.materials[0].id);
    expect(project.members[0].sectionId).toBe(project.sections[0].id);
  });
});
