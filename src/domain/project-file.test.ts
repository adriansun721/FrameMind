import { describe, expect, it } from "vitest";
import { addMaterial, addMember, addNode, addNodalLoad, addSection, addSupport, attachAnalysisResult, createProject } from "./project";
import { decodeProject, encodeProject } from "./project-file";
import { solveFrame } from "./analysis";

describe("FrameMind project file", () => {
  it("round-trips support, nodal loads, and the latest analysis source", () => {
    let project = createProject("T03 persisted analysis");
    project = addNode(project, { x: 0, y: 0, z: 0 }); project = addNode(project, { x: 2, y: 0, z: 0 });
    project = addMaterial(project, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
    project = addSection(project, { name: "Box", areaM2: 0.01, secondMomentYM4: 0.0001, secondMomentZM4: 0.0001, torsionalConstantM4: 0.0001 });
    project = addMember(project, { startNodeId: project.nodes[0].id, endNodeId: project.nodes[1].id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
    project = addSupport(project, project.nodes[0].id, [true, true, true, true, true, true]);
    project = addNodalLoad(project, project.nodes[1].id, { x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    project = attachAnalysisResult(project, solveFrame(project));
    const reopened = decodeProject(encodeProject(project));
    expect(reopened.supports[0]).toMatchObject({ id: "support_0001", nodeId: "node_0001" });
    expect(reopened.nodalLoads[0]).toMatchObject({ id: "load_0001", nodeId: "node_0002", force: { x: 2, y: 0, z: 0 } });
    expect(reopened.latestAnalysis?.input.projectRevision).toBe(project.revision - 1);
    expect(reopened.latestAnalysis?.members[0].memberId).toBe("member_0001");
  });

  it("rejects malformed analysis assumptions and object references", () => {
    let project = createProject("Invalid analysis");
    project = addNode(project, { x: 0, y: 0, z: 0 }); project = addNode(project, { x: 1, y: 0, z: 0 });
    project = addMaterial(project, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
    project = addSection(project, { name: "Box", areaM2: 0.01, secondMomentYM4: 0.0001, secondMomentZM4: 0.0001, torsionalConstantM4: 0.0001 });
    project = addMember(project, { startNodeId: project.nodes[0].id, endNodeId: project.nodes[1].id, materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 });
    project = addSupport(project, project.nodes[0].id, [true, true, true, true, true, true]); project = addNodalLoad(project, project.nodes[1].id, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }); project = attachAnalysisResult(project, solveFrame(project));
    const malformed = JSON.parse(encodeProject(project)) as { latestAnalysis: { input: { assumptions: unknown }; nodes: Array<{ nodeId: string }> } };
    malformed.latestAnalysis.input.assumptions = {};
    expect(() => decodeProject(JSON.stringify(malformed))).toThrow("分析结果输入来源无效");
    const crossReferenced = JSON.parse(encodeProject(project)) as { latestAnalysis: { nodes: Array<{ nodeId: string }> } };
    crossReferenced.latestAnalysis.nodes[0].nodeId = "node_9999";
    expect(() => decodeProject(JSON.stringify(crossReferenced))).toThrow("分析结果对象引用无效");
  });
  it("round-trips project metadata, node identity, and coordinates", () => {
    const original = addNode(createProject("Portal frame"), {
      x: 4.2,
      y: 0,
      z: 6.8,
    });

    const reopened = decodeProject(encodeProject(original));

    expect(reopened).toEqual(original);
  });

  it("rejects a newer incompatible format version with a clear message", () => {
    const futureFile = JSON.stringify({
      ...createProject("From the future"),
      formatVersion: 99,
    });

    expect(() => decodeProject(futureFile)).toThrow(
      "项目版本 99 暂不受支持（当前支持版本 2）",
    );
  });

  it("rejects malformed node data instead of silently repairing it", () => {
    const malformed = JSON.stringify({
      ...createProject("Malformed"),
      nodes: [{ id: "node_0001", label: "N1", position: { x: "1", y: 0, z: 0 } }],
    });

    expect(() => decodeProject(malformed)).toThrow("节点 node_0001 的坐标无效");
  });

  it("keeps T01 root fields required while allowing absent T02 collections", () => {
    const t01Project = createProject("T01 compatibility");
    const { materials: _materials, sections: _sections, members: _members, nextMaterialNumber: _nextMaterialNumber, nextSectionNumber: _nextSectionNumber, nextMemberNumber: _nextMemberNumber, ...t01File } = t01Project;

    expect(decodeProject(JSON.stringify(t01File))).toMatchObject({ materials: [], sections: [], members: [] });
    const { nodes: _nodes, ...missingNodes } = t01File;
    expect(() => decodeProject(JSON.stringify(missingNodes))).toThrow("项目节点列表无效");
    const { nextNodeNumber: _nextNodeNumber, ...missingNextNode } = t01File;
    expect(() => decodeProject(JSON.stringify(missingNextNode))).toThrow("项目版本信息无效");
  });

  it("rejects a next-node counter that would reuse an existing identity", () => {
    const project = addNode(createProject("Conflicting counter"), { x: 0, y: 0, z: 0 });
    const malformed = JSON.stringify({ ...project, nextNodeNumber: 1 });

    expect(() => decodeProject(malformed)).toThrow("下一节点编号与已有节点冲突");
  });

  it("reopens a safe terminal counter but refuses to increment it", () => {
    const terminal = JSON.stringify({
      ...createProject("Unsafe counter"),
      nextNodeNumber: Number.MAX_SAFE_INTEGER,
    });

    const reopened = decodeProject(terminal);
    expect(() => addNode(reopened, { x: 0, y: 0, z: 0 })).toThrow(
      "项目编号状态无法安全递增",
    );
  });

  it("round-trips custom materials, sections, members, and their stable references", () => {
    let original = createProject("Single member");
    original = addNode(original, { x: 0, y: 0, z: 0 });
    original = addNode(original, { x: 2, y: 1, z: 3 });
    original = addMaterial(original, { name: "Q355", elasticModulusGPa: 206, poissonRatio: 0.3, densityKgM3: 7850 });
    original = addSection(original, { name: "Custom box", areaM2: 0.02, secondMomentYM4: 0.0002, secondMomentZM4: 0.0003, torsionalConstantM4: 0.0004 });
    original = addMember(original, {
      startNodeId: original.nodes[0].id,
      endNodeId: original.nodes[1].id,
      materialId: original.materials[0].id,
      sectionId: original.sections[0].id,
      rotationDegrees: 27,
    });

    expect(decodeProject(encodeProject(original))).toEqual(original);
  });

  it("rejects a saved member with a missing material reference", () => {
    let project = createProject("Broken reference");
    project = addNode(project, { x: 0, y: 0, z: 0 });
    project = addNode(project, { x: 1, y: 0, z: 0 });
    project = addMaterial(project, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
    project = addSection(project, { name: "I", areaM2: 0.01, secondMomentYM4: 0.0001, secondMomentZM4: 0.0002, torsionalConstantM4: 0.00005 });
    project = addMember(project, {
      startNodeId: project.nodes[0].id,
      endNodeId: project.nodes[1].id,
      materialId: project.materials[0].id,
      sectionId: project.sections[0].id,
      rotationDegrees: 0,
    });
    const malformed = JSON.stringify({
      ...project,
      members: [{ ...project.members[0], materialId: "material_9999" }],
    });

    expect(() => decodeProject(malformed)).toThrow("杆件 M1 引用了不存在的材料 material_9999");
  });

  it("rejects malformed stable identities and display labels", () => {
    const project = addMaterial(createProject("Bad identity"), { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });

    expect(() => decodeProject(JSON.stringify({ ...project, materials: [{ ...project.materials[0], id: "steel" }] }))).toThrow(
      "材料 M1 的稳定标识格式无效",
    );
    expect(() => decodeProject(JSON.stringify({ ...project, materials: [{ ...project.materials[0], label: "Steel 1" }] }))).toThrow(
      "材料显示编号 Steel 1 格式无效",
    );
    expect(() => decodeProject(JSON.stringify({ ...project, materials: [{ ...project.materials[0], id: "material_00001" }] }))).toThrow(
      "材料 M1 的稳定标识格式无效",
    );
  });
});
