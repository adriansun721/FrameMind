import { describe, expect, it } from "vitest";
import { addNode, createProject } from "./project";

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
});
