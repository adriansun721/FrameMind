import { describe, expect, it } from "vitest";
import { addNode, createProject } from "../domain/project";
import { proposeConditions } from "../workspace/analysis-conditions";
import { conditionSummaries } from "./condition-summary";

describe("condition summary", () => {
  it("groups equal loads but keeps directions, load cases and suggestions distinct", () => {
    let project = createProject();
    project = addNode(project, { x: 0, y: 0, z: 0 });
    project = addNode(project, { x: 0, y: 0, z: 3 });
    const load = { loadCaseId: "LC1", force: { x: 0, y: -2, z: -10 }, moment: { x: 0, y: 0, z: -3 }, source: "user" };
    const proposal = proposeConditions({ supports: [], nodalLoads: [
      { ...load, nodeId: project.nodes[0].id }, { ...load, nodeId: project.nodes[1].id },
      { ...load, nodeId: project.nodes[1].id, source: "suggestion" },
    ] });
    const summary = conditionSummaries(project, proposal);
    expect(summary).toHaveLength(1);
    expect(summary[0].groups).toHaveLength(2);
    expect(summary[0].groups[0].objects).toEqual(["N1", "N2"]);
    expect(summary[0].groups[0].setting).toContain("全局 · FY=-2 kN · FZ=-10 kN · MZ=-3 kN·m");
    expect(summary[0].groups[0].setting).not.toContain("FX=");
    expect(summary[0].groups[1].suggested).toBe(true);
  });
  it("keeps loads in different cases distinct even when their names match", () => {
    let project = addNode(createProject(), { x: 0, y: 0, z: 0 });
    project = { ...project, loadCases: [{ id: "LC1", name: "同名", description: "" }, { id: "LC2", name: "同名", description: "" }] };
    const proposal = proposeConditions({ supports: [], nodalLoads: ["LC1", "LC2"].map((loadCaseId) => ({
      nodeId: project.nodes[0].id, loadCaseId, force: { x: 1, y: 0, z: 0 }, moment: { x: 0, y: 0, z: 0 }, source: "user",
    })) });
    const groups = conditionSummaries(project, proposal)[0].groups;
    expect(groups).toHaveLength(2);
    expect(groups[0].setting).toContain("同名 (LC1)");
    expect(groups[1].setting).toContain("同名 (LC2)");
  });
});
