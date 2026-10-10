/** Rebuild only when the reviewed catalog or the PRD fixed scenario changes. */
import { writeFileSync } from "node:fs";
import { addMaterial, addSection, addNode, addMember, addSupport, addNodalLoad, addUniformLoad, addLoadCase, updateLoadCase, updateSelfWeight, addLoadCombination, selectLoadCombination, createProject } from "../src/domain/project";
import { MATERIAL_CATALOG, SECTION_CATALOG } from "../src/domain/resource-library";

let p = createProject("反向设计固定两层钢架");
const steel = MATERIAL_CATALOG.find((m) => m.catalogId === "en10025-s355jr")!;
p = addMaterial(p, steel, { kind: "catalog", catalogId: steel.catalogId, source: steel.source });
const sections = SECTION_CATALOG.map((entry) => addSection(createProject(), entry).sections[0]);
for (const catalogId of ["arcelor-hea200", "arcelor-ipe200"]) p = addSection(p, SECTION_CATALOG.find((s) => s.catalogId === catalogId)!);
for (const z of [0, 3, 6]) for (const y of [0, 4]) for (const x of [0, 6]) p = addNode(p, { x, y, z });
for (let k = 1; k <= 2; k++) for (let j = 0; j <= 1; j++) for (let i = 0; i <= 1; i++) {
  const index = k * 4 + j * 2 + i;
  const member = (a: number, b: number, section: number) => { p = addMember(p, { startNodeId: p.nodes[a].id, endNodeId: p.nodes[b].id, materialId: p.materials[0].id, sectionId: p.sections[section].id, rotationDegrees: 0 }); };
  member(index - 4, index, 0);
  if (i > 0) member(index - 1, index, 1);
  if (j > 0) member(index - 2, index, 1);
}
for (const node of p.nodes.slice(0, 4)) p = addSupport(p, node.id, [true, true, true, true, true, true]);
p = updateLoadCase(p, "LC1", "恒载", "结构自重");
p = addLoadCase(p, "演示外荷载", "屋面均布力和水平节点力");
p = addNodalLoad(p, p.nodes[9].id, { x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, "LC2");
p = addUniformLoad(p, { kind: "uniform", memberId: p.members[10].id, coordinateSystem: "global", loadCaseId: "LC2", intensity: { x: 0, y: 0, z: -2 } });
p = updateSelfWeight(p, { enabled: true, loadCaseId: "LC1", gravity: { x: 0, y: 0, z: -9.81 } });
p = addLoadCombination(p, "演示用户组合", [{ loadCaseId: "LC1", factor: 1 }, { loadCaseId: "LC2", factor: 1.5 }]);
p = selectLoadCombination(p, p.loadCombinations[0].id);
const { id: _id, createdAt: _created, updatedAt: _updated, revision: _revision, ...template } = p;
writeFileSync("electron/reverse-design-fixture.ts", `// Archived PRD2.5 fixed input and verified T2-23 catalog. Rebuild: npm run fixture:plan2:p2509\nexport const REVERSE_DESIGN_TEMPLATE = ${JSON.stringify(template, null, 2)};\nexport const REVERSE_DESIGN_SECTIONS = ${JSON.stringify(sections, null, 2)};\n`);
