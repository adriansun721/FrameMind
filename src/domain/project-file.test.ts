import { describe, expect, it } from "vitest";
import { addNode, createProject } from "./project";
import { decodeProject, encodeProject } from "./project-file";

describe("FrameMind project file", () => {
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
      "项目版本 99 暂不受支持（当前支持版本 1）",
    );
  });

  it("rejects malformed node data instead of silently repairing it", () => {
    const malformed = JSON.stringify({
      ...createProject("Malformed"),
      nodes: [{ id: "node_0001", label: "N1", position: { x: "1", y: 0, z: 0 } }],
    });

    expect(() => decodeProject(malformed)).toThrow("节点 node_0001 的坐标无效");
  });

  it("rejects a next-node counter that would reuse an existing identity", () => {
    const project = addNode(createProject("Conflicting counter"), { x: 0, y: 0, z: 0 });
    const malformed = JSON.stringify({ ...project, nextNodeNumber: 1 });

    expect(() => decodeProject(malformed)).toThrow("下一节点编号与已有节点冲突");
  });
});
