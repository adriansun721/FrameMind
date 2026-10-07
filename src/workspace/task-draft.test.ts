import { describe, expect, it } from "vitest";
import { captureAiSnapshot } from "./ai-tools";
import { MATERIAL_CATALOG, SECTION_CATALOG } from "../domain/resource-library";
import { addNode, addSupport, createProject, type FrameProject } from "../domain/project";
import { ProjectHistory } from "../domain/project-history";
import { buildTaskDraftPreview, proposeTask } from "./task-draft";
import { TaskDraftStageConfirmation, prepareTaskDraftConfirmation } from "./task-confirmation";
import { columns } from "./section-stage.fixture";
import { decodeProject, encodeProject } from "../domain/project-file";
import { executeAiTool } from "./ai-tools";
import { persistTaskState } from "./task-persistence";

it("does not embed prior task histories in the next agent engineering snapshot", () => {
  const project = columns();
  const snapshot = captureAiSnapshot({ ...project, taskState: persistTaskState(project.id, [], []) }, []);
  expect(snapshot.editProject.taskState).toBeUndefined();
  expect(snapshot.editProject.nodes).toEqual(project.nodes);
});

it("confirms advanced edits and conditions together once across project reopening", () => {
  const project = columns();
  const snapshot = captureAiSnapshot(project, []);
  const draft = proposeTask(snapshot, {
    edits: { source: "user", operations: [{ type: "set_node_mass", id: project.nodes[1].id, massKg: 125 }] },
    nodalLoads: [{ id: project.nodalLoads[0].id, nodeId: project.nodalLoads[0].nodeId, loadCaseId: "LC1", force: { x: 12, y: 0, z: 0 }, moment: project.nodalLoads[0].moment, source: "user" }],
    analysis: { requested: true, source: "user", sourceId: "LC1" },
  });
  expect(project.nodes[1].additionalMassKg).toBeUndefined();
  expect(buildTaskDraftPreview(snapshot, draft).changes).toEqual(expect.arrayContaining([expect.objectContaining({ label: `节点 ${project.nodes[1].id}`, source: "user" })]));
  const confirmation = prepareTaskDraftConfirmation(project, draft);
  const outcome = new TaskDraftStageConfirmation().confirm(project, confirmation);
  expect(outcome.result.status).toBe("applied");
  expect(outcome.project.revision).toBe(project.revision + 1);
  expect(outcome.project.nodes[1].additionalMassKg).toBe(125);
  expect(outcome.project.nodalLoads[0].force.x).toBe(12);
  expect(outcome.result.data).toMatchObject({ verification: { edits: { changes: [{ kind: "node", id: project.nodes[1].id }] } } });
  const reopened = decodeProject(encodeProject(outcome.project));
  expect(new TaskDraftStageConfirmation().confirm(reopened, confirmation).project).toBe(reopened);
});

it("refuses unknown advanced provenance, unsafe commands and underflow through the whole-task tool", () => {
  const project = columns();
  const call = (argumentsText: string) => ({ id: "advanced", type: "function", function: { name: "propose_task", arguments: argumentsText } });
  const input = { edits: { source: "unknown", operations: [{ type: "set_node_mass", id: project.nodes[1].id, massKg: 100 }] } };
  const missing = executeAiTool(captureAiSnapshot(project, []), call(JSON.stringify(input)));
  expect(missing.status).toBe("missing-input");
  expect(new TaskDraftStageConfirmation().confirm(project, prepareTaskDraftConfirmation(project, missing.taskDraft!)).result.status).toBe("failed");
  expect(executeAiTool(captureAiSnapshot(project, []), call('{"edits":{"source":"user","operations":[{"type":"set_node_mass","id":"node_0002","massKg":-1e-400}]}}')).status).toBe("failed");
  expect(executeAiTool(captureAiSnapshot(project, []), call('{"edits":{"source":"user","operations":[{"type":"execute_command","command":"git reset --hard"}]}}')).status).toBe("failed");
  expect(project.nodes[1].additionalMassKg).toBeUndefined();
});

it("keeps user and suggested values distinct within one advanced task", () => {
  const project = columns(), snapshot = captureAiSnapshot(project, []);
  const input = { edits: { source: "user", sources: ["user", "suggestion"], operations: [
    { type: "set_node_mass", id: project.nodes[1].id, massKg: 125 },
    { type: "update_member", id: project.members[0].id, changes: { additionalLineMassKgM: 10 } },
  ] } };
  const draft = proposeTask(snapshot, input);
  const preview = buildTaskDraftPreview(snapshot, draft);
  expect(preview.changes[0].source).toBe("mixed");
  expect(preview.changes[0].provenance).toMatchObject([
    { source: "user", values: { massKg: 125 } }, { source: "suggestion", values: { changes: { additionalLineMassKgM: 10 } } },
  ]);
  expect(() => proposeTask(snapshot, { edits: { ...input.edits, sources: ["user"] } })).toThrow("一一对应");
  expect(buildTaskDraftPreview(snapshot, proposeTask(snapshot, { edits: { ...input.edits, sources: ["user", "unknown"] } })).status).toBe("missing-input");
});

const frame = {
  parameters: {
    storeys: { value: 1, source: "user" }, xSpans: { value: [4], source: "user" }, ySpans: { value: [3], source: "user" },
    storeyHeights: { value: [3], source: "user" }, origin: { value: [0, 0, 0], source: "user" },
    material: { value: MATERIAL_CATALOG[0].catalogId, source: "suggestion" }, columnSection: { value: SECTION_CATALOG[0].catalogId, source: "suggestion" }, beamSection: { value: SECTION_CATALOG[1].catalogId, source: "suggestion" }, rotationDegrees: { value: 0, source: "suggestion" },
  },
};

it("confirms a new frame, draft-identity point mass and releases with its conditions in one transaction", () => {
  const project = createProject();
  const draft = proposeTask(captureAiSnapshot(project, []), { frame,
    edits: { source: "user", operations: [
      { type: "set_node_mass", id: "draft:node:0:0:0", massKg: 100 },
      { type: "update_member", id: "draft:member:1", changes: { endReleases: { start: { my: true, mz: false }, end: { my: false, mz: false } } } },
    ] }, supports: [], nodalLoads: [] });
  const preview = buildTaskDraftPreview(captureAiSnapshot(project, []), draft);
  expect(preview.status).toBe("awaiting-confirmation");
  const result = new TaskDraftStageConfirmation().confirm(project, prepareTaskDraftConfirmation(project, draft));
  expect(result.result.status, result.result.message).toBe("applied");
  expect(result.project.nodes[0].additionalMassKg).toBe(100);
  expect(result.project.members[0].endReleases?.start.my).toBe(true);
  expect(result.project.revision).toBe(1);
  expect(result.result.data).toMatchObject({ verification: { edits: { changes: [
    { kind: "node", id: result.project.nodes[0].id }, { kind: "member", id: result.project.members[0].id },
  ] } } });
});

it("resolves compact draft conditions and verifies resources edited in the same frame draft", () => {
  const project = createProject();
  const snapshot = captureAiSnapshot(project, []);
  const first = proposeTask(snapshot, { frame });
  const materialId = buildTaskDraftPreview(snapshot, first).frame!.materials[0].id;
  const draft = proposeTask(snapshot, {
    edits: { source: "user", operations: [{ type: "update_material", id: `draft:${materialId}`, properties: { name: "用户修订", elasticModulusGPa: 210, poissonRatio: 0.3, densityKgM3: 7850 } }] },
    supports: [{ nodeId: "draft:node:0:0:0", restraints: [true, true, true, true, true, true], source: "user" }], nodalLoads: [],
  }, first);
  const outcome = new TaskDraftStageConfirmation().confirm(project, prepareTaskDraftConfirmation(project, draft));
  expect(outcome.result.status, outcome.result.message).toBe("applied");
  expect(outcome.project.supports[0].nodeId).toBe(outcome.project.nodes[0].id);
  expect(outcome.project.materials[0].elasticModulusGPa).toBe(210);
});

it("reserves frame counters before previewing advanced creations and preserves their reviewed identities", () => {
  const project = createProject();
  const snapshot = captureAiSnapshot(project, []);
  const draft = proposeTask(snapshot, { frame, supports: [], nodalLoads: [], edits: { source: "catalog", operations: [
    { type: "create_material", properties: { catalogId: MATERIAL_CATALOG[1].catalogId, name: "Extra" } },
    { type: "create_node", position: { x: 10, y: 10, z: 10 } },
    { type: "split_member", memberIds: ["draft:member:1"], position: { x: 0, y: 0, z: 1.5 } },
  ] } });
  const preview = buildTaskDraftPreview(snapshot, draft);
  const outcome = new TaskDraftStageConfirmation().confirm(project, prepareTaskDraftConfirmation(project, draft));
  expect(outcome.result.status, outcome.result.message).toBe("applied");
  const material = preview.edits!.created.find((item) => item.kind === "material")!;
  const node = preview.edits!.created.find((item) => item.kind === "node")!;
  expect(outcome.project.materials.find((item) => item.id === material.id)?.name).toBe("Extra");
  expect(outcome.project.nodes.find((item) => item.id === node.id)?.position).toEqual({ x: 10, y: 10, z: 10 });
});

describe("T2-03 complete task drafts", () => {
  it("merges geometry, resources, conditions and analysis intent under one version", () => {
    const project = createProject("整体草案");
    const snapshot = captureAiSnapshot(project, []);
    const first = proposeTask(snapshot, { goal: "建立一层刚架并施加节点荷载", frame });
    expect(first.projectId).toBe(project.id);
    expect(first.version).toBe(1);
    expect(buildTaskDraftPreview(snapshot, first).missing.map((item) => item.category)).toEqual(expect.arrayContaining(["support", "load"]));
    const nodeRef = `draft:${first.frame!.id}:node:0:0:0`;
    const topRef = `draft:${first.frame!.id}:node:0:1:1`;
    const second = proposeTask(snapshot, { goal: first.goal, supports: [{ nodeId: nodeRef, restraints: [true, true, true, true, true, true], source: "user" }], nodalLoads: [{ nodeId: topRef, loadCaseId: "LC1", force: { x: 0, y: 0, z: -5 }, moment: { x: 0, y: 0, z: 0 }, source: "user" }], analysis: { requested: true, source: "user", sourceId: "LC1" } }, first);
    const preview = buildTaskDraftPreview(snapshot, second);
    expect(second.version).toBe(2);
    expect(preview.status).toBe("awaiting-confirmation");
    expect(preview.frame?.nodes).toHaveLength(8);
    expect(preview.conditions?.supports).toHaveLength(1);
    expect(preview.conditions?.nodalLoads).toHaveLength(1);
    expect(preview.changes.map((change) => change.category)).toEqual(expect.arrayContaining(["geometry", "resource", "support", "load", "analysis"]));
    expect(preview.conditions?.supports?.[0].nodeId).toBe(nodeRef.replace(/^draft:/, ""));
  });

  it("retains existing conditions and reports only a genuinely absent condition", () => {
    const project = createProject();
    const snapshot = captureAiSnapshot(project, []);
    const draft = proposeTask(snapshot, { goal: "检查当前模型" });
    const preview = buildTaskDraftPreview(snapshot, draft);
    expect(preview.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "support" }), expect.objectContaining({ category: "load" }),
    ]));
  });

  it("treats already applied support and load data as facts instead of proposed changes", () => {
    const withNode = addNode(createProject(), { x: 0, y: 0, z: 0 });
    const project = addSupport(withNode, withNode.nodes[0].id, [true, true, true, true, true, true]);
    const snapshot = captureAiSnapshot(project, []);
    const draft = proposeTask(snapshot, { goal: "核对已有边界条件" });
    const preview = buildTaskDraftPreview(snapshot, draft);
    expect(draft.conditions).toBeUndefined();
    expect(preview.changes).toEqual([]);
    expect(preview.missing.map((item) => item.category)).toContain("load");
  });

  it("does not ask for another load when an existing self-weight input is available", () => {
    const base = createProject();
    const project = { ...base, selfWeight: { ...base.selfWeight, enabled: true } };
    const preview = buildTaskDraftPreview(captureAiSnapshot(project, []), proposeTask(captureAiSnapshot(project, []), { goal: "复核已有自重" }));
    expect(preview.missing.map((item) => item.category)).not.toContain("load");
  });

  it("keeps explicit provenance for assumptions and blocks unknown values", () => {
    const project = createProject();
    const snapshot = captureAiSnapshot(project, []);
    const draft = proposeTask(snapshot, {
      conditions: {
        supports: [{ nodeId: "node_missing", restraints: [true, true, true, true, true, true], source: "assumption" }],
        nodalLoads: [{ nodeId: "node_missing", loadCaseId: "LC1", force: { x: 0, y: 0, z: 0 }, moment: { x: 0, y: 0, z: 0 }, source: "unknown" }],
        selfWeight: { enabled: false, loadCaseId: "LC1", gravity: { x: 0, y: 0, z: -9.81 }, source: "unknown" },
      },
      analysis: { requested: true, source: "unknown" },
    });
    const preview = buildTaskDraftPreview(snapshot, draft);
    expect(preview.changes.find((change) => change.label === "结构自重")?.source).toBe("unknown");
    expect(preview.changes.find((change) => change.category === "support")?.source).toBe("assumption");
    expect(preview.changes.find((change) => change.category === "load" && change.label.includes("新增荷载"))?.source).toBe("unknown");
    expect(preview.missing.some((item) => item.category === "analysis")).toBe(true);
  });

  it("applies the whole draft once, maps preview identities and keeps retries idempotent", () => {
    const project = createProject();
    const snapshot = captureAiSnapshot(project, []);
    const first = proposeTask(snapshot, { frame });
    const nodeRef = `draft:${first.frame!.id}:node:0:0:0`;
    const topRef = `draft:${first.frame!.id}:node:0:1:1`;
    const draft = proposeTask(snapshot, { supports: [{ nodeId: nodeRef, restraints: [true, true, true, true, true, true], source: "user" }], nodalLoads: [{ nodeId: topRef, loadCaseId: "LC1", force: { x: 1, y: 0, z: 0 }, moment: { x: 0, y: 0, z: 0 }, source: "user" }] }, first);
    const stage = new TaskDraftStageConfirmation();
    const confirmation = prepareTaskDraftConfirmation(project, draft);
    const applied = stage.confirm(project, confirmation);
    expect(applied.result.status).toBe("applied");
    expect(applied.project.nodes).toHaveLength(8);
    expect(applied.project.supports).toHaveLength(1);
    expect(applied.project.nodalLoads).toHaveLength(1);
    expect(applied.project.supports[0].nodeId).toBe(applied.project.nodes[0].id);
    expect(applied.project.nodalLoads[0].nodeId).toBe(applied.project.nodes[3].id);
    expect(applied.result.data).toMatchObject({
      verification: { status: "verified", objects: { nodes: expect.any(Array), members: expect.any(Array), supports: expect.any(Array), nodalLoads: expect.any(Array) } },
      analysis: { requested: false },
    });
    const retry = stage.confirm(applied.project, confirmation);
    expect(retry.project).toBe(applied.project);
    expect(retry.result.message).toContain("未重复应用");
    const revised = proposeTask(snapshot, { goal: "同一任务的补充说明" }, draft);
    const revisedConfirmation = prepareTaskDraftConfirmation(project, revised);
    const appliedRevision = stage.confirm(project, revisedConfirmation);
    expect(appliedRevision.result.status).toBe("applied");
    const oldVersion = stage.confirm(project, confirmation);
    expect(oldVersion.result.status).toBe("failed");
    expect(oldVersion.result.message).toContain("版本已过期");
  });

  it("returns a verified continuation intent and never reapplies an old confirmation after undo", () => {
    const project = createProject();
    const snapshot = captureAiSnapshot(project, []);
    const first = proposeTask(snapshot, { frame });
    const nodeRef = `draft:${first.frame!.id}:node:0:0:0`;
    const topRef = `draft:${first.frame!.id}:node:0:1:1`;
    const draft = proposeTask(snapshot, {
      supports: [{ nodeId: nodeRef, restraints: [true, true, true, true, true, true], source: "user" }],
      nodalLoads: [{ nodeId: topRef, loadCaseId: "LC1", force: { x: 0, y: 0, z: -5 }, moment: { x: 0, y: 0, z: 0 }, source: "user" }],
      analysis: { requested: true, source: "user", sourceId: "LC1" },
    }, first);
    const stage = new TaskDraftStageConfirmation();
    const confirmation = prepareTaskDraftConfirmation(project, draft);
    const applied = stage.confirm(project, confirmation);
    expect(applied.result.data).toMatchObject({ analysis: { requested: true, sourceId: "LC1" } });

    const history = new ProjectHistory();
    history.record(project, applied.project);
    const undone = history.undo(applied.project)!;
    expect(undone.nodes).toHaveLength(0);
    const replay = stage.confirm(undone, confirmation);
    expect(replay.project).toBe(undone);
    expect(replay.result.status).toBe("applied");
    expect(replay.result.message).toContain("未重复应用");
    expect(replay.result.data).toEqual(applied.result.data);
  });

  it("assigns distinct receipt identities to duplicate no-ID condition entries", () => {
    const project = createProject();
    const snapshot = captureAiSnapshot(project, []);
    const first = proposeTask(snapshot, { frame });
    const nodeRef = `draft:${first.frame!.id}:node:0:0:0`;
    const topRef = `draft:${first.frame!.id}:node:0:1:1`;
    const draft = proposeTask(snapshot, {
      supports: [{ nodeId: nodeRef, restraints: [true, true, true, true, true, true], source: "user" }],
      nodalLoads: [
        { nodeId: topRef, loadCaseId: "LC1", force: { x: 1, y: 0, z: 0 }, moment: { x: 0, y: 0, z: 0 }, source: "user" },
        { nodeId: topRef, loadCaseId: "LC1", force: { x: 1, y: 0, z: 0 }, moment: { x: 0, y: 0, z: 0 }, source: "user" },
      ],
    }, first);
    const outcome = new TaskDraftStageConfirmation().confirm(project, prepareTaskDraftConfirmation(project, draft));
    expect(outcome.result.status).toBe("applied");
    const ids = (outcome.result.data as { objects: { nodalLoads: string[] } }).objects.nodalLoads;
    expect(new Set(ids).size).toBe(2);
  });

  it("does not leave partial resources when a late geometry command fails", () => {
    const project: FrameProject = { ...createProject(), nextNodeNumber: Number.MAX_SAFE_INTEGER };
    const snapshot = captureAiSnapshot(project, []);
    const draft = proposeTask(snapshot, { frame, supports: [], nodalLoads: [] });
    const before = structuredClone(project);
    const outcome = new TaskDraftStageConfirmation().confirm(project, prepareTaskDraftConfirmation(project, draft));
    expect(outcome.result.status).toBe("failed");
    expect(outcome.project).toEqual(before);
  });

  it("rolls back geometry and resources when a later support command fails", () => {
    const project: FrameProject = { ...createProject(), nextSupportNumber: Number.MAX_SAFE_INTEGER };
    const snapshot = captureAiSnapshot(project, []);
    const first = proposeTask(snapshot, { frame });
    const nodeRef = `draft:${first.frame!.id}:node:0:0:0`;
    const draft = proposeTask(snapshot, {
      supports: [{ nodeId: nodeRef, restraints: [true, true, true, true, true, true], source: "user" }],
      nodalLoads: [],
    }, first);
    const before = structuredClone(project);
    const outcome = new TaskDraftStageConfirmation().confirm(project, prepareTaskDraftConfirmation(project, draft));
    expect(outcome.result.status).toBe("failed");
    expect(outcome.result.message).toContain("编号状态");
    expect(outcome.project).toEqual(before);
  });
});
