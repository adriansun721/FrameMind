import { describe, expect, it } from "vitest";
import { freeGeometryFixtures } from "../validation/free-geometry-fixtures";
import { addMember, addNode, updateMember, updateNode, type NodeId } from "./project";
import { applyProjectEdits, batchUpdateNodes } from "./project-operations";
import { decodeProject, encodeProject } from "./project-file";
import { solveFrame } from "./analysis";
import { checkAnalysisInput } from "./analysis-diagnostics";
import { calculateMemberGeometry } from "./member-geometry";
import { captureAiSnapshot, executeAiTool } from "../workspace/ai-tools";
import { ModelEditConfirmation, prepareModelEditConfirmation } from "../workspace/model-edits";
import { ProjectHistory } from "./project-history";

const call = (name: string, args: unknown) => ({ id: "geometry", type: "function", function: { name, arguments: JSON.stringify(args) } });

describe("T2-18 free numerical geometry", () => {
  for (const fixture of freeGeometryFixtures()) it(`preserves ${fixture.id} topology and physical response across save and tool reads`, () => {
    const project = decodeProject(encodeProject(fixture.project));
    expect(project.nodes).toEqual(fixture.project.nodes); expect(project.members).toEqual(fixture.project.members);
    const result = solveFrame(project);
    for (const axis of ["x", "y", "z"] as const) expect(result.nodes[1].displacement[axis]).toBeCloseTo(fixture.expectedTip[axis], 14);
    if (fixture.id === "crossing") {
      expect(project.nodes).toHaveLength(4); expect(project.members).toHaveLength(2);
      for (const value of [...Object.values(result.nodes[3].displacement), ...Object.values(result.nodes[2].reaction)]) expect(Math.abs(value)).toBe(0);
    }
    const read = executeAiTool(captureAiSnapshot(project, []), call("read_model", { collection: "nodes" }));
    expect(read.status).toBe("completed"); expect(JSON.stringify(read.data)).toContain(String(project.nodes[0].position.x));
  });

  it("commits an endpoint swap atomically through manual and confirmed tool batches", () => {
    const project = freeGeometryFixtures()[0].project;
    const updates = [{ id: project.nodes[0].id, position: project.nodes[1].position }, { id: project.nodes[1].id, position: project.nodes[0].position }];
    const manual = batchUpdateNodes(project, updates);
    const draft = executeAiTool(captureAiSnapshot(project, []), call("update_nodes", { updates }));
    expect(draft.status).toBe("awaiting-confirmation"); expect(project.nodes[0].position.x).toBe(-123.125);
    const confirmed = new ModelEditConfirmation().confirm(project, prepareModelEditConfirmation(project, draft.modelEdits!));
    expect(confirmed.result.status).toBe("applied"); expect(confirmed.project.nodes).toEqual(manual.nodes);
    expect(manual.revision).toBe(project.revision + 1); expect(manual.members).toEqual(project.members);
    const history = new ProjectHistory(); history.record(project, manual);
    expect(history.undo(manual)?.nodes).toEqual(project.nodes); expect(history.redo(project)?.nodes).toEqual(manual.nodes);
  });

  it("keeps newly created off-grid nodes isolated in drafts then preserves exact confirmed coordinates", () => {
    const project = freeGeometryFixtures()[0].project;
    const draft = executeAiTool(captureAiSnapshot(project, []), call("create_nodes", { inputUnits: { length: "mm" }, nodes: [
      { position: { x: -200001.125, y: .125, z: -12.5 } }, { position: { x: 1000000000125, y: .001, z: 0 } },
    ] }));
    expect(draft.status).toBe("awaiting-confirmation"); expect(project.nodes).toHaveLength(2);
    const confirmed = new ModelEditConfirmation().confirm(project, prepareModelEditConfirmation(project, draft.modelEdits!));
    expect(confirmed.result.status).toBe("applied");
    const saved = decodeProject(encodeProject(confirmed.project));
    expect(saved.nodes[2].position).toEqual({ x: -200.001125, y: .000125, z: -.0125 });
    expect(saved.nodes[3].position).toEqual({ x: 1000000000.125, y: .000001, z: 0 });
  });

  it("rejects non-finite, invalid references and final collapsed batches without changing the project", () => {
    const project = freeGeometryFixtures()[0].project; const before = structuredClone(project);
    for (const x of [NaN, Infinity, -Infinity]) expect(() => addNode(project, { x, y: 0, z: 0 })).toThrow("有限数值");
    expect(() => updateMember(project, project.members[0].id, { endNodeId: "missing" as NodeId })).toThrow("不存在");
    expect(() => applyProjectEdits(project, project.nodes.map((node) => ({ type: "update_node", id: node.id, position: { x: -20.5, y: 0, z: 0 } })))).toThrow("M1");
    expect(() => updateNode(project, project.nodes[1].id, project.nodes[0].position)).toThrow("零长度");
    const coincident = addNode(project, project.nodes[0].position);
    expect(coincident.nodes[2].id).not.toBe(project.nodes[0].id);
    expect(() => addMember(coincident, { ...project.members[0], endNodeId: coincident.nodes[2].id })).toThrow("同一位置");
    expect(project).toEqual(before);
    const invalid = structuredClone(project); invalid.nodes[1].position.x = Infinity;
    expect(checkAnalysisInput(invalid)).toContainEqual(expect.objectContaining({ code: "invalid-coordinate", target: { kind: "node", id: invalid.nodes[1].id }, field: "position.x" }));
  });

  it("keeps canonical geometry thresholds independent of display units and coordinate scale", () => {
    const project = freeGeometryFixtures()[0].project;
    for (const displayUnitPreset of ["m-kN", "mm-N", "mm-kN"] as const) {
      const contract = executeAiTool(captureAiSnapshot({ ...project, displayUnitPreset }, []), call("read_geometry_contract", {}));
      expect(contract.data).toMatchObject({ coordinateUnit: "m", connectivity: "explicit-node-id-only", duplicates: { automaticMerge: false }, memberLength: { minimumExclusive: 1e-12, scaleWithCoordinates: false } });
    }
    expect(() => calculateMemberGeometry({ x: 0, y: 0, z: 0 }, { x: 1e-12, y: 0, z: 0 }, 0)).toThrow("1e-12 m");
    expect(calculateMemberGeometry({ x: 0, y: 0, z: 0 }, { x: 2e-12, y: 0, z: 0 }, 0).length).toBe(2e-12);
  });
});
