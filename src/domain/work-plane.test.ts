import { describe, expect, it } from "vitest";
import { intersectWorkPlane, exactDrawingPoint, prepareDrawnMemberEdits, snapDrawingNode, type WorkPlane } from "./work-plane";
import { freeGeometryFixtures } from "../validation/free-geometry-fixtures";
import { applyProjectEdits } from "./project-operations";
import { ProjectHistory } from "./project-history";
import { decodeProject, encodeProject } from "./project-file";
import { captureAiSnapshot, executeAiTool } from "../workspace/ai-tools";
import { ModelEditConfirmation, prepareModelEditConfirmation } from "../workspace/model-edits";

const zero = { x: 0, y: 0, z: 0 };
const call = (name: string, args: unknown) => ({ id: "drawing", type: "function", function: { name, arguments: JSON.stringify(args) } });

describe("T2-19 work-plane drawing", () => {
  it("intersects oblique rays with all three offset planes without a grid boundary", () => {
    const origin = { x: 10, y: -20, z: 30 }; const direction = { x: -2, y: 4, z: -6 };
    for (const [plane, offset] of [["XY", 0], ["XZ", 0], ["YZ", 0]] as [WorkPlane, number][]) {
      expect(intersectWorkPlane(origin, direction, plane, offset, zero)).toEqual(zero);
    }
    expect(intersectWorkPlane(origin, direction, "XY", 18, zero)).toEqual({ x: 6, y: -12, z: 18 });
    expect(intersectWorkPlane({ x: 200, y: 250, z: 5 }, { x: 0, y: 0, z: -1 }, "XY", -2.125, zero)).toEqual({ x: 200, y: 250, z: -2.125 });
    expect(intersectWorkPlane(origin, { x: 1, y: 1, z: 0 }, "XY", 0, zero)).toBeNull();
    expect(intersectWorkPlane(origin, { x: 0, y: 0, z: 1 }, "XY", 0, zero)).toBeNull();
    expect(intersectWorkPlane(origin, direction, "XY", NaN, zero)).toBeNull();
    expect(intersectWorkPlane({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -Infinity }, "XY", 0, zero)).toBeNull();
    expect(intersectWorkPlane({ ...origin, z: Infinity }, direction, "XY", 0, zero)).toBeNull();
    expect(intersectWorkPlane(origin, direction, "XY", 0, { ...zero, z: NaN })).toBeNull();
  });

  it("retains small offsets at large world coordinates in a local ray intersection", () => {
    expect(intersectWorkPlane({ x: .0001220703125, y: 0, z: 2 }, { x: 0, y: 0, z: -1 }, "XY", 1e9, { x: 1e9, y: -1e9, z: 1e9 }))
      .toEqual({ x: 1000000000.0001221, y: -1e9, z: 1e9 });
  });

  it("snaps only visible centres on the active plane within 12 CSS pixels", () => {
    const nodes = freeGeometryFixtures()[0].project.nodes;
    const node = { ...nodes[0], position: zero };
    const projected = [{ node, x: 100, y: 100, depth: 0 }];
    expect(snapDrawingNode(projected, { x: 112, y: 100 }, "XY", 0)?.id).toBe(node.id);
    expect(snapDrawingNode(projected, { x: 112.01, y: 100 }, "XY", 0)).toBeUndefined();
    expect(snapDrawingNode(projected, { x: 100, y: 100 }, "XY", .000001)).toBeUndefined();
    expect(snapDrawingNode([{ ...projected[0], depth: 2 }], { x: 100, y: 100 }, "XY", 0)).toBeUndefined();
    expect(exactDrawingPoint(zero, [node], false).nodeId).toBeUndefined();
    expect(exactDrawingPoint(zero, [node], true).nodeId).toBe(node.id);
    expect(exactDrawingPoint({ ...zero, x: 1e-9 }, [node], true).nodeId).toBeUndefined();
  });

  it("commits each segment atomically, reuses explicit identities, and survives history, storage and agent reads", () => {
    const project = freeGeometryFixtures()[0].project;
    const input = { start: { position: project.nodes[1].position, nodeId: project.nodes[1].id }, end: { position: { x: -100.5, y: -22.25, z: 3.5 } },
      materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 };
    const operations = prepareDrawnMemberEdits(project, input);
    expect(project.nodes).toHaveLength(2); expect(operations).toHaveLength(2);
    const manual = applyProjectEdits(project, operations).project;
    expect(manual.nodes).toHaveLength(3); expect(manual.members[1].startNodeId).toBe(project.nodes[1].id);
    expect(manual.revision).toBe(project.revision + 1);
    const draft = executeAiTool(captureAiSnapshot(project, []), call("draw_member", { ...input,
      end: { position: { x: -100500, y: -22250, z: 3500 } }, start: { ...input.start, position: { x: input.start.position.x * 1000, y: input.start.position.y * 1000, z: input.start.position.z * 1000 } }, inputUnits: { length: "mm" } }));
    expect(draft.status).toBe("awaiting-confirmation");
    const confirmed = new ModelEditConfirmation().confirm(project, prepareModelEditConfirmation(project, draft.modelEdits!));
    expect(confirmed.result.status).toBe("applied"); expect(confirmed.project.nodes).toEqual(manual.nodes); expect(confirmed.project.members).toEqual(manual.members);
    const saved = decodeProject(encodeProject(manual)); expect(saved.nodes).toEqual(manual.nodes); expect(saved.members).toEqual(manual.members);
    const read = executeAiTool(captureAiSnapshot(saved, []), call("read_model", { collection: "members" }));
    expect(JSON.stringify(read.data)).toContain(manual.nodes[2].id);
    const history = new ProjectHistory(); history.record(project, manual);
    expect(history.undo(manual)?.nodes).toEqual(project.nodes); expect(history.redo(project)?.members).toEqual(manual.members);
    const next = applyProjectEdits(manual, prepareDrawnMemberEdits(manual, { ...input, start: { position: manual.nodes[2].position, nodeId: manual.nodes[2].id }, end: { position: { x: -90, y: -20, z: 3.5 } } })).project;
    expect(next.nodes).toHaveLength(4); expect(next.members[2].startNodeId).toBe(manual.nodes[2].id);
  });

  it("rejects stale snaps and zero-length segments without orphan endpoints; intersections remain separate", () => {
    const project = freeGeometryFixtures().find((fixture) => fixture.id === "crossing")!.project;
    const before = structuredClone(project);
    const input = { start: { position: project.nodes[0].position, nodeId: project.nodes[0].id }, end: { position: project.nodes[1].position, nodeId: project.nodes[1].id },
      materialId: project.materials[0].id, sectionId: project.sections[0].id, rotationDegrees: 0 };
    expect(() => prepareDrawnMemberEdits(project, { ...input, end: input.start })).toThrow();
    expect(() => prepareDrawnMemberEdits(project, { ...input, end: { ...input.end, position: zero } })).toThrow("已移动");
    const next = applyProjectEdits(project, prepareDrawnMemberEdits(project, { ...input, start: { position: { x: -1, y: -1, z: 0 } }, end: { position: { x: 1, y: 1, z: 0 } } })).project;
    expect(next.nodes).toHaveLength(6); expect(next.members.slice(0, 2)).toEqual(project.members);
    expect(next.members[2].startNodeId).not.toBe(project.nodes[0].id); expect(project).toEqual(before);
  });
});
