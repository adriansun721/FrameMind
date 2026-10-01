import { describe, expect, it } from "vitest";
import { addMaterial, addMember, addNode, addNodalLoad, addSection, addSupport, addUniformLoad, attachAnalysisResult, createProject, updateMember, updateUniformLoad, deleteUniformLoad } from "./project";
import { captureAnalysisInput, getMemberAnalysisRecord, getMemberSectionForces, solveFrame } from "./analysis";
import { decodeProject, encodeProject } from "./project-file";
import { ProjectHistory } from "./project-history";
import { applyProjectTransaction, deleteMembers, deleteNodes } from "./project-operations";

function beam() {
  let p = createProject("T09 reference");
  p = addNode(p, { x: 0, y: 0, z: 0 });
  p = addNode(p, { x: 4, y: 0, z: 0 });
  p = addMaterial(p, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  p = addSection(p, { name: "Reference", areaM2: 0.01, secondMomentYM4: 0.0002, secondMomentZM4: 0.0001, torsionalConstantM4: 0.00015 });
  p = addMember(p, { startNodeId: p.nodes[0].id, endNodeId: p.nodes[1].id, materialId: p.materials[0].id, sectionId: p.sections[0].id, rotationDegrees: 0 });
  return addSupport(p, p.nodes[0].id, [true, true, true, true, true, true]);
}

const close = (actual: number, reference: number) => expect(Math.abs(actual - reference)).toBeLessThanOrEqual(Math.max(1e-9, Math.abs(reference) * 1e-8));
const vectorClose = (actual: number[], reference: number[]) => actual.forEach((v, i) => close(v, reference[i]));

describe("T09 uniform member loading", () => {
  it("matches independent cantilever axial and two-plane bending solutions, including section equilibrium", () => {
    let p = beam();
    p = addUniformLoad(p, { kind: "uniform", memberId: p.members[0].id, coordinateSystem: "local", loadCaseId: "LC1", intensity: { x: 2, y: -3, z: 4 } });
    const r = solveFrame(p);
    const tip = r.nodes[1]; const root = r.nodes[0];
    // u=qL^2/(2EA); v=qL^4/(8EI); theta=qL^3/(6EI).
    vectorClose([tip.displacement.x, tip.displacement.y, tip.displacement.z, tip.rotation.x, tip.rotation.y, tip.rotation.z], [0.000008, -0.0048, 0.0032, 0, -0.0010666666666666667, -0.0016]);
    vectorClose([root.reaction.x, root.reaction.y, root.reaction.z, root.reactionMoment.x, root.reactionMoment.y, root.reactionMoment.z], [-8, 12, -16, 0, 32, 24]);
    vectorClose(r.members[0].localEndForces.start, [-8, 12, -16, 0, 32, 24]);
    vectorClose(r.members[0].localEndForces.end, [0, 0, 0, 0, 0, 0]);
    for (const [x, expected] of [[0, [8, -12, 16, 0, -32, -24]], [2, [4, -6, 8, 0, -8, -6]], [4, [0, 0, 0, 0, 0, 0]]] as const) {
      vectorClose(getMemberSectionForces(r, p.members[0].id, x).forces, [...expected]);
    }
    expect(() => getMemberSectionForces(r, p.members[0].id, 4.01)).toThrow(/位置/);
  });

  it("preserves frozen loads and queryable section results through edits, history and file roundtrip", () => {
    const base = beam();
    const input = { kind: "uniform", memberId: base.members[0].id, coordinateSystem: "global", loadCaseId: "LC1", intensity: { x: 0, y: -3, z: 0 } } as const;
    const loaded = addUniformLoad(base, input);
    const snapshot = captureAnalysisInput(loaded);
    const result = solveFrame(snapshot);
    const saved = attachAnalysisResult(loaded, result);
    const edited = updateUniformLoad(saved, saved.uniformLoads[0].id, { ...input, intensity: { x: 0, y: -6, z: 0 } });
    const history = new ProjectHistory(); history.record(saved, edited);
    expect(history.undo(edited)?.uniformLoads[0].intensity.y).toBe(-3);
    expect(history.redo(saved)?.uniformLoads[0].intensity.y).toBe(-6);
    const reopened = decodeProject(encodeProject(edited));
    expect(reopened.uniformLoads[0].intensity.y).toBe(-6);
    expect(reopened.latestAnalysis!.input.uniformLoads![0].intensity.y).toBe(-3);
    close(getMemberSectionForces(reopened.latestAnalysis!, base.members[0].id, 2).forces[5], -6);
    expect(Object.isFrozen(reopened.latestAnalysis!.input.uniformLoads![0].intensity)).toBe(true);
    const deleted = applyProjectTransaction(edited, (p) => deleteUniformLoad(p, p.uniformLoads[0].id));
    history.record(edited, deleted);
    expect(history.undo(deleted)?.uniformLoads).toHaveLength(1);
    const cascading = deleteMembers(loaded, [loaded.members[0].id]);
    history.record(loaded, cascading);
    expect(cascading.uniformLoads).toHaveLength(0);
    expect(history.undo(cascading)?.uniformLoads).toEqual(loaded.uniformLoads);
    expect(deleteNodes(loaded, [loaded.nodes[0].id]).uniformLoads).toHaveLength(0);
  });

  it("matches the fixed-fixed beam reference across two members and recovers the load curvature", () => {
    let p = beam();
    p = addNode(p, { x: 8, y: 0, z: 0 });
    p = addMember(p, { startNodeId: p.nodes[1].id, endNodeId: p.nodes[2].id, materialId: p.materials[0].id, sectionId: p.sections[0].id, rotationDegrees: 0 });
    p = addSupport(p, p.nodes[2].id, [true, true, true, true, true, true]);
    for (const member of p.members) p = addUniformLoad(p, { kind: "uniform", memberId: member.id, coordinateSystem: "global", loadCaseId: "LC1", intensity: { x: 0, y: -3, z: 0 } });
    const r = solveFrame(p);
    // Fixed-fixed beam: midspan v=qL^4/(384EI), end moments=-qL^2/12.
    close(r.nodes[1].displacement.y, -0.0016); close(r.nodes[1].rotation.z, 0);
    close(r.nodes[0].reaction.y, 12); close(r.nodes[2].reaction.y, 12);
    close(r.nodes[0].reactionMoment.z, 16); close(r.nodes[2].reactionMoment.z, -16);
    close(getMemberSectionForces(r, p.members[0].id, 0).forces[5], -16);
    close(getMemberSectionForces(r, p.members[0].id, 2).forces[5], 2);
    close(getMemberSectionForces(r, p.members[0].id, 4).forces[5], 8);
    close(getMemberSectionForces(r, p.members[1].id, 0).forces[5], 8);
    close(getMemberSectionForces(r, p.members[1].id, 4).forces[5], -16);
    const record = getMemberAnalysisRecord(r, p.members[0].id);
    vectorClose(record.equivalentLocalForces, [0, -6, 0, 0, 0, -4, 0, -6, 0, 0, 0, 4]);
  });

  it("resolves rotated local axes and globally fixed loading, superposes nodal loads and conserves global balance", () => {
    let p = beam();
    // A 90-degree section rotation must not rotate a global load.
    p = { ...p, nodes: [p.nodes[0], { ...p.nodes[1], position: { x: 0, y: 4, z: 0 } }] };
    p = updateMember(p, p.members[0].id, { rotationDegrees: 90 });
    const local = addUniformLoad(p, { kind: "uniform", memberId: p.members[0].id, coordinateSystem: "local", loadCaseId: "LC1", intensity: { x: 2, y: -3, z: 4 } });
    let global = addUniformLoad(p, { kind: "uniform", memberId: p.members[0].id, coordinateSystem: "global", loadCaseId: "LC1", intensity: { x: 4, y: 2, z: -3 } });
    const a = solveFrame(local); const b = solveFrame(global);
    for (let i = 0; i < 2; i += 1) for (const field of ["displacement", "rotation", "reaction", "reactionMoment"] as const) for (const axis of ["x", "y", "z"] as const) close(a.nodes[i][field][axis], b.nodes[i][field][axis]);
    vectorClose([b.nodes[1].displacement.x, b.nodes[1].displacement.y, b.nodes[1].displacement.z], [0.0032, 0.000008, -0.0048]);
    vectorClose([b.nodes[0].reaction.x, b.nodes[0].reaction.y, b.nodes[0].reaction.z, b.nodes[0].reactionMoment.x, b.nodes[0].reactionMoment.y, b.nodes[0].reactionMoment.z], [-16, -8, 12, 24, 0, 32]);
    global = addNodalLoad(global, p.nodes[1].id, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    const combined = solveFrame(global);
    close(combined.nodes[0].reaction.x, -17); close(combined.nodes[0].reactionMoment.z, 36);
    const reversed = updateMember(global, p.members[0].id, { startNodeId: p.nodes[1].id, endNodeId: p.nodes[0].id });
    const reversedResult = solveFrame(reversed);
    for (let i = 0; i < 2; i += 1) for (const axis of ["x", "y", "z"] as const) close(reversedResult.nodes[i].displacement[axis], combined.nodes[i].displacement[axis]);
  });

  it("matches a skew member reference with multiple global loads and balances moments about the origin", () => {
    let p = beam();
    p = { ...p, nodes: [p.nodes[0], { ...p.nodes[1], position: { x: 2.4, y: 3.2, z: 0 } }] };
    for (let i = 0; i < 2; i += 1) p = addUniformLoad(p, { kind: "uniform", memberId: p.members[0].id, coordinateSystem: "global", loadCaseId: "LC1", intensity: { x: 1.8, y: -0.1, z: 2 } });
    const r = solveFrame(p);
    // Independent axes: ex=(.6,.8,0), ey=(-.8,.6,0), ez=(0,0,1).
    vectorClose([r.nodes[1].displacement.x, r.nodes[1].displacement.y, r.nodes[1].displacement.z], [0.0038448, -0.0028736, 0.0032]);
    vectorClose([r.nodes[0].reaction.x, r.nodes[0].reaction.y, r.nodes[0].reaction.z, r.nodes[0].reactionMoment.x, r.nodes[0].reactionMoment.y, r.nodes[0].reactionMoment.z], [-14.4, 0.8, -16, -25.6, 19.2, 24]);
    vectorClose(getMemberSectionForces(r, p.members[0].id, 2).forces, [4, -6, 8, 0, -8, -6]);
    const reordered = solveFrame({ ...p, nodes: [...p.nodes].reverse(), uniformLoads: [...p.uniformLoads].reverse() });
    for (const node of r.nodes) {
      const other = reordered.nodes.find((item) => item.nodeId === node.nodeId)!;
      for (const field of ["displacement", "rotation", "reaction", "reactionMoment"] as const) for (const axis of ["x", "y", "z"] as const) close(other[field][axis], node[field][axis]);
    }
  });

  it("rejects unsupported loads at editing, decoding and analysis boundaries and reads old projects", () => {
    const p = beam();
    const valid = { kind: "uniform", memberId: p.members[0].id, coordinateSystem: "global", loadCaseId: "LC1", intensity: { x: 0, y: -3, z: 0 } } as const;
    const loaded = addUniformLoad(p, valid);
    for (const bad of [{ ...valid, kind: "point" }, { ...valid, endIntensity: { x: 0, y: -6, z: 0 } }, { ...valid, loadCaseId: "LC2" }, { ...valid, coordinateSystem: "screen" }, { ...valid, intensity: { x: 0, y: NaN, z: 0 } }]) {
      expect(() => addUniformLoad(p, bad as typeof valid)).toThrow();
      expect(() => solveFrame({ ...loaded, uniformLoads: [{ ...loaded.uniformLoads[0], ...bad } as typeof loaded.uniformLoads[number]] })).toThrow();
      expect(() => decodeProject(JSON.stringify({ ...loaded, uniformLoads: [{ ...loaded.uniformLoads[0], ...bad }] }))).toThrow();
    }
    expect(() => solveFrame({ ...loaded, uniformLoads: [{ ...loaded.uniformLoads[0], intensity: { x: 0, y: 1e308, z: 0 } }] })).toThrow(/有限/);
    expect(() => decodeProject(JSON.stringify({ ...loaded, nextUniformLoadNumber: 1 }))).toThrow(/编号/);
    expect(() => decodeProject(JSON.stringify({ ...loaded, uniformLoads: [{ ...loaded.uniformLoads[0], memberId: "missing" }] }))).toThrow(/杆件/);
    const legacy = { ...p, uniformLoads: undefined, nextUniformLoadNumber: undefined };
    expect(decodeProject(JSON.stringify(legacy)).uniformLoads).toEqual([]);
    const r = solveFrame(p);
    const legacyResult = { ...r, input: { ...r.input, uniformLoads: undefined, solver: { ...r.input.solver!, implementation: "framemind-frame/2" } } };
    vectorClose(getMemberAnalysisRecord(legacyResult, p.members[0].id).equivalentLocalForces, Array(12).fill(0));
    expect(() => getMemberSectionForces({ ...r, input: { ...r.input, solver: undefined } }, p.members[0].id, 2)).toThrow(/版本/);
  });

  it("opens stored uniform-load results from unknown implementations without claiming recoverable section data", () => {
    const base = beam();
    const p = addUniformLoad(base, { kind: "uniform", memberId: base.members[0].id, coordinateSystem: "global", loadCaseId: "LC1", intensity: { x: 0, y: -3, z: 0 } });
    const result = solveFrame(p);
    for (const implementation of [undefined, "framemind-frame/2", "future/4"]) {
      const stored = { ...result, input: { ...result.input, solver: implementation ? { ...result.input.solver!, implementation } : undefined } };
      const reopened = decodeProject(encodeProject(attachAnalysisResult(p, stored)));
      expect(reopened.latestAnalysis!.members).toEqual(result.members);
      expect(reopened.latestAnalysis!.input.solver?.implementation).toBe(implementation);
      expect(() => getMemberSectionForces(reopened.latestAnalysis!, p.members[0].id, 2)).toThrow(/版本/);
      expect(() => getMemberAnalysisRecord(reopened.latestAnalysis!, p.members[0].id)).toThrow(/版本/);
    }
  });
});
