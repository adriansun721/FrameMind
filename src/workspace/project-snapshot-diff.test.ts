import { expect, it } from "vitest";
import { addNode, createProject } from "../domain/project";
import { diffProjectSnapshots } from "./project-snapshot-diff";

it("shows changed coordinates, deleted engineering objects and restored project fields before a whole rollback", () => {
  const target = addNode(createProject(), { x: 1, y: 2, z: 3 });
  const current = addNode({ ...target, name: "edited", nodes: target.nodes.map((n) => ({ ...n, position: { ...n.position, x: 9 } })) }, { x: 4, y: 5, z: 6 });
  const changes = diffProjectSnapshots(current, target);
  expect(changes).toContainEqual({ collection: "nodes", id: target.nodes[0].id, action: "update", field: "position.x", before: 9, after: 1 });
  expect(changes).toContainEqual({ collection: "nodes", id: current.nodes[1].id, action: "delete", field: "*", before: current.nodes[1], after: undefined });
  expect(changes).toContainEqual({ collection: "project", id: current.id, action: "update", field: "name", before: "edited", after: target.name });
  expect(diffProjectSnapshots(target, structuredClone(target))).toEqual([]);
});
