import { describe, expect, it } from "vitest";
import { buildCadTopologyPreview } from "./cad-topology";
import type { CadCenterline, CadEngineeringGeometry } from "./cad-geometry";
import { transformCadPoint } from "./cad-geometry";
const line = (id: string, start: number[], end: number[]): CadCenterline => ({
  id, instanceId: 1, solidId: 1, sourceEntityIds: [1], start, end,
  lengthM: Math.hypot(...start.map((v, i) => end[i] - v)), direction: end.map((v, i) => v - start[i]),
  endSections: [[start, start, start], [end, end, end]],
  boundingBox: { min: start.map((v, i) => Math.min(v, end[i]) - .01), max: start.map((v, i) => Math.max(v, end[i]) + .01) },
  method: "fixture",
});
const geometry = (centerlines: CadCenterline[]): { engineeringGeometry: CadEngineeringGeometry } => ({
  engineeringGeometry: { schemaVersion: 1, recognitionToleranceM: 1e-7, centerlines, definitions: [], solidInstances: [], issues: [] },
});
describe("CAD engineering topology review", () => {
  it("requires contact review before splitting a long member and preserves parent ranges", () => {
    const input = geometry([line("long", [0, 0, 0], [2, 0, 0]), line("branch", [1, 0, 0], [1, 1, 0])]);
    const original = structuredClone(input), preview = buildCadTopologyPreview(input);
    expect(preview.members).toHaveLength(2); expect(preview.contacts).toHaveLength(1);
    const reviewed = buildCadTopologyPreview(input, [preview.contacts[0].id]);
    expect(reviewed.members.filter((m) => m.parentId === "long").map((m) => m.range)).toEqual([[0, .5], [.5, 1]]);
    expect(reviewed.nodes.find((n) => n.position.x === 1 && n.position.y === 0)?.mergedFrom).toEqual(["long", "branch"]);
    expect(input).toEqual(original);
  });
  it("does not connect spatial crossings or projected crossings", () => {
    for (const z of [0, .1]) {
      const preview = buildCadTopologyPreview(geometry([line("x", [-1, 0, 0], [1, 0, 0]), line("y", [0, -1, z], [0, 1, z])]));
      expect(preview.contacts).toEqual([]); expect(preview.members).toHaveLength(2); expect(preview.nodes).toHaveLength(4);
    }
  });
  it("blocks contact chains that collapse distinct positions on the same parent", () => {
    for (const length of [.0001, 1]) {
      const offset = .0001;
      const input = geometry([line("parent", [0, 0, 0], [length, 0, 0]), line("a", [0, 0, 0], [0, 1, 0]), line("b", [offset, 0, 0], [offset, -1, 0])]);
      const preview = buildCadTopologyPreview(input);
      const reviewed = buildCadTopologyPreview(input, preview.contacts.map((c) => c.id));
      expect(reviewed.issues).toContainEqual(expect.objectContaining({ code: "collapsed-member-contact", severity: "blocking" }));
      expect(reviewed.members.every((m) => m.startNodeId !== m.endNodeId)).toBe(true);
    }
  });
  it("blocks malformed axes and partial collinear overlap instead of silently dropping errors", () => {
    const preview = buildCadTopologyPreview(geometry([line("a", [0, 0, 0], [2, 0, 0]), line("b", [1, 0, 0], [3, 0, 0]), line("bad", [NaN, 0, 0], [1, 0, 0])]));
    expect(preview.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid-centerline", severity: "blocking" }), expect.objectContaining({ code: "overlap", severity: "blocking" })]));
  });
  it("retains unsupported geometry and nested parser blockers", () => {
    const preview = buildCadTopologyPreview({ ignoredEntities: [{ id: 7, reason: "curved" }], diagnostics: { blockingIssues: ["unit-unknown"] } });
    expect(preview.issues.every((i) => i.severity === "blocking")).toBe(true);
    expect(preview.issues.some((i) => i.sourceEntityIds?.includes(7))).toBe(true);
  });
  it("rotates about all three right handed global axes before translating", () => {
    expect(transformCadPoint([0, 1, 0], { translationM: [2, 3, 4], rotationDegrees: [90, 0, 0] })).toEqual([2, 3, 5]);
    expect(transformCadPoint([1, 0, 0], { translationM: [0, 0, 0], rotationDegrees: [0, 90, 0] })).toEqual([0, 0, -1]);
    expect(() => transformCadPoint([0, 0, 0], { translationM: [NaN, 0, 0], rotationDegrees: [0, 0, 0] })).toThrow();
  });
});
