import { describe, expect, it } from "vitest";
import {
  addMaterial,
  addMember,
  addNode,
  addSection,
  createProject,
  updateMember,
  updateNode,
} from "./project";

describe("project modeling commands", () => {
  it("creates a spatial node with a stable identity and metre coordinates", () => {
    const empty = createProject("Teaching frame");
    const updated = addNode(empty, { x: 1.25, y: -2, z: 3.5 });

    expect(updated.nodes).toHaveLength(1);
    expect(updated.nodes[0]).toMatchObject({
      label: "N1",
      position: { x: 1.25, y: -2, z: 3.5 },
    });
    expect(updated.nodes[0].id).toMatch(/^node_/);
    expect(updated.nodes[0].id).toBe(addNode(empty, { x: 9, y: 9, z: 9 }).nodes[0].id);
    expect(updated.units.length).toBe("m");
  });

  it("rejects coordinates that are not finite numbers", () => {
    const project = createProject("Invalid coordinates");

    expect(() => addNode(project, { x: Number.NaN, y: 0, z: 0 })).toThrow(
      "坐标必须是有限数值",
    );
  });

  it("creates a member with stable material and section references", () => {
    let project = createProject("Teaching frame");
    project = addNode(project, { x: 0, y: 0, z: 0 });
    project = addNode(project, { x: 4, y: 0, z: 0 });
    project = addMaterial(project, {
      name: "Q355 steel",
      elasticModulusGPa: 206,
      poissonRatio: 0.3,
      densityKgM3: 7850,
    });
    project = addSection(project, {
      name: "Box 300",
      areaM2: 0.01,
      secondMomentYM4: 0.00012,
      secondMomentZM4: 0.00012,
      torsionalConstantM4: 0.0002,
    });

    const updated = addMember(project, {
      startNodeId: project.nodes[0].id,
      endNodeId: project.nodes[1].id,
      materialId: project.materials[0].id,
      sectionId: project.sections[0].id,
      rotationDegrees: 15,
    });

    expect(updated.members[0]).toMatchObject({
      id: "member_0001",
      label: "M1",
      startNodeId: "node_0001",
      endNodeId: "node_0002",
      materialId: "material_0001",
      sectionId: "section_0001",
      rotationDegrees: 15,
    });
  });

  it("rejects a zero-length member and invalid references", () => {
    let project = createProject("Invalid members");
    project = addNode(project, { x: 1, y: 2, z: 3 });
    project = addNode(project, { x: 1, y: 2, z: 3 });
    project = addMaterial(project, {
      name: "Steel",
      elasticModulusGPa: 200,
      poissonRatio: 0.3,
      densityKgM3: 7850,
    });
    project = addSection(project, {
      name: "Section",
      areaM2: 0.01,
      secondMomentYM4: 0.0001,
      secondMomentZM4: 0.0001,
      torsionalConstantM4: 0.0001,
    });
    const input = {
      startNodeId: project.nodes[0].id,
      endNodeId: project.nodes[1].id,
      materialId: project.materials[0].id,
      sectionId: project.sections[0].id,
      rotationDegrees: 0,
    };

    expect(() => addMember(project, input)).toThrow("杆件 M1 的两个节点不能位于同一位置");
    expect(() => addMember(project, { ...input, endNodeId: "node_9999" as never })).toThrow(
      "杆件 M1 引用了不存在的终点节点 node_9999",
    );
  });

  it("rejects invalid physical properties instead of silently correcting them", () => {
    const project = createProject("Invalid properties");

    expect(() =>
      addMaterial(project, {
        name: "Broken steel",
        elasticModulusGPa: -1,
        poissonRatio: 0.3,
        densityKgM3: 7850,
      }),
    ).toThrow("材料 M1 的弹性模量必须为正有限数值");
    expect(() =>
      addSection(project, {
        name: "Broken section",
        areaM2: 0,
        secondMomentYM4: 0.0001,
        secondMomentZM4: 0.0001,
        torsionalConstantM4: 0.0001,
      }),
    ).toThrow("截面 S1 的面积必须为正有限数值");
  });

  it("prevents node edits that would collapse a connected member", () => {
    let project = createProject("Editable frame");
    project = addNode(project, { x: 0, y: 0, z: 0 });
    project = addNode(project, { x: 2, y: 0, z: 0 });
    project = addMaterial(project, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
    project = addSection(project, { name: "I", areaM2: 0.01, secondMomentYM4: 0.0001, secondMomentZM4: 0.0002, torsionalConstantM4: 0.00005 });
    project = addMember(project, {
      startNodeId: project.nodes[0].id,
      endNodeId: project.nodes[1].id,
      materialId: project.materials[0].id,
      sectionId: project.sections[0].id,
      rotationDegrees: 0,
    });

    expect(() => updateNode(project, project.nodes[1].id, { x: 0, y: 0, z: 0 })).toThrow(
      "节点修改会使杆件 M1 变为零长度",
    );
    expect(updateMember(project, project.members[0].id, { rotationDegrees: 30 }).members[0].rotationDegrees).toBe(30);
  });
});
