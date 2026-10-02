import { expect, it } from "vitest";
import { solveFrame } from "../domain/analysis";
import { addLoadCase, addLoadCombination, addMaterial, addMember, addNode, addNodalLoad, addSection, addSupport, attachAnalysisResult, createProject, selectLoadCase, selectLoadCombination, updateNode } from "../domain/project";
import { captureAiSnapshot, executeAiTool } from "./ai-tools";
import { startAiTask } from "./ai-task";
import type { DeepSeekChatRequest } from "../../electron/contracts";

function cantilever() {
  let p = addNode(createProject(), { x: 0, y: 0, z: 0 });
  p = addNode(p, { x: 4, y: 0, z: 0 });
  p = addMaterial(p, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  p = addSection(p, { name: "Section", areaM2: 0.01, secondMomentYM4: 0.0002, secondMomentZM4: 0.0001, torsionalConstantM4: 0.0001 });
  p = addMember(p, { startNodeId: p.nodes[0].id, endNodeId: p.nodes[1].id, materialId: p.materials[0].id, sectionId: p.sections[0].id, rotationDegrees: 0 });
  p = addSupport(p, p.nodes[0].id, [true, true, true, true, true, true]);
  return addNodalLoad(p, p.nodes[1].id, { x: 0, y: -5, z: 0 }, { x: 0, y: 0, z: 0 });
}
const call = (name: string, input: unknown) => ({ id: "citation_1", type: "function", function: { name, arguments: JSON.stringify(input) } });

it("references the actual cantilever displacement with frozen position, component, units and analysis input", () => {
  const p = cantilever();
  const result = solveFrame(p);
  const snapshot = captureAiSnapshot(attachAnalysisResult(p, result), []);
  const output = executeAiTool(snapshot, call("read_result", { kind: "node", id: p.nodes[1].id, quantity: "displacement", component: "y" }));
  expect(output.status).toBe("completed");
  expect(output.reference).toMatchObject({ token: "[[result:citation_1]]", analysisId: result.id, inputRevision: result.projectRevision,
    source: { id: "LC1", kind: "case" }, object: { kind: "node", id: p.nodes[1].id, label: "N2", position: { x: 4, y: 0, z: 0 } },
    quantity: "displacement", component: "y", unit: "m", current: true });
  // Independent PL³/(3EI): P=-5 kN, L=4 m, E=200e6 kN/m², Iz=0.0001 m⁴.
  expect(output.reference?.value).toBeCloseTo(-0.005333333333333333, 12);
});

it("uses the selected user-defined combination and never borrows another case's success", () => {
  let p = addLoadCase(cantilever(), "空工况");
  p = addLoadCombination(p, "用户组合", [{ loadCaseId: "LC1", factor: -0.5 }, { loadCaseId: "LC2", factor: 0 }]);
  p = selectLoadCombination(p, "CB1");
  const result = solveFrame(p); p = attachAnalysisResult(p, result);
  const reference = executeAiTool(captureAiSnapshot(p, []), call("read_result", { kind: "node", id: p.nodes[1].id, quantity: "displacement", component: "y" })).reference;
  expect(reference).toMatchObject({ source: { id: "CB1", kind: "combination", terms: [{ loadCaseId: "LC1", factor: -0.5 }, { loadCaseId: "LC2", factor: 0 }] }, current: true });
  expect(reference?.value).toBeCloseTo(0.0026666666666666666, 12);
  expect(executeAiTool(captureAiSnapshot(p, []), call("read_results", { collection: "summary" })).data).toMatchObject({
    frozenConditions: { supports: [{ nodeId: p.nodes[0].id, restraints: [true, true, true, true, true, true] }],
      nodalLoads: [{ nodeId: p.nodes[1].id, force: { x: expect.closeTo(0, 12), y: 2.5, z: expect.closeTo(0, 12) } }], limit: 50 },
  });
  expect(executeAiTool(captureAiSnapshot(p, []), call("read_results", { collection: "summary" })).data).toMatchObject({
    frozenConditions: { originalCombinationLoads: { nodalLoads: [{ loadCaseId: "LC1", force: { x: 0, y: -5, z: 0 } }] } },
  });
  p = selectLoadCase(p, "LC2");
  expect(executeAiTool(captureAiSnapshot(p, []), call("read_results", { collection: "summary" })).status).toBe("missing-input");
});

it("replays real result evidence and rejects fabricated or absent reference tokens", async () => {
  const p = cantilever(); const snapshot = captureAiSnapshot(attachAnalysisResult(p, solveFrame(p)), []);
  for (const [reply, status] of [["计算事实：[[result:citation_1]]。原因推断：与悬臂端横向荷载有关。", "completed"],
    ["计算事实：[[result:forged]]", "failed"], ["位移为123米", "failed"]] as const) {
    const requests: DeepSeekChatRequest[] = [];
    const task = startAiTask(snapshot, "解释关键位移", { isCurrent: () => true, transport: {
      cancelDeepSeekChat: async () => {},
      chatDeepSeek: async (request) => {
        requests.push(structuredClone(request));
        return { status: "success", message: "回放", assistant: requests.length === 1 ? { role: "assistant", content: null,
          tool_calls: [call("read_result", { kind: "node", id: p.nodes[1].id, quantity: "displacement", component: "y" }) as { id: string; type: "function"; function: { name: string; arguments: string } }] }
          : { role: "assistant", content: reply } };
      },
    } });
    const output = await task.promise;
    expect(output.status).toBe(status);
    const evidence = requests[1].messages.find((message) => message.role === "tool");
    expect(JSON.parse(evidence!.content!)).toMatchObject({ reference: { value: expect.closeTo(-0.005333333333333333, 12), analysisId: snapshot.analysis!.id } });
    if (status === "failed") expect(output.assistant).toBeUndefined();
  }
});

it("keeps historical numbers tied to old coordinates after an applied edit", () => {
  const p = cantilever(); const result = solveFrame(p);
  const edited = updateNode(attachAnalysisResult(p, result), p.nodes[1].id, { x: 8, y: 0, z: 0 });
  const snapshot = captureAiSnapshot(edited, []);
  const output = executeAiTool(snapshot, call("read_result", { kind: "node", id: p.nodes[1].id, quantity: "displacement", component: "y" }));
  expect(output.reference).toMatchObject({ current: false, analysisId: result.id, object: { position: { x: 4, y: 0, z: 0 } } });
  expect(output.reference?.value).toBeCloseTo(-0.005333333333333333, 12);
  const summary = executeAiTool(snapshot, call("read_results", { collection: "summary" }));
  expect(summary.message).toContain("历史");
  expect(summary.data).toMatchObject({ displacementExtrema: expect.arrayContaining([expect.objectContaining({ nodeId: p.nodes[1].id, component: "y", value: expect.closeTo(-0.005333333333333333, 12) })]) });
});

it("distinguishes positive-face section actions from member end forces", () => {
  const p = cantilever(); const snapshot = captureAiSnapshot(attachAnalysisResult(p, solveFrame(p)), []);
  const output = executeAiTool(snapshot, call("read_result", { kind: "member", id: p.members[0].id, quantity: "sectionForces", component: "Mz", position: 2 }));
  expect(output.reference).toMatchObject({ quantity: "sectionForces", component: "Mz", position: 2, unit: "kN·m", coordinateSystem: "local xyz" });
  expect(output.reference?.value).toBeCloseTo(-10, 10);
  const end = executeAiTool(snapshot, call("read_result", { kind: "member", id: p.members[0].id, quantity: "startEndForces", component: "Mz" }));
  expect(end.reference?.value).toBeCloseTo(20, 10);
});

it("rejects wrong analysis IDs, invalid components, positions, fields and nonexistent objects", () => {
  const p = cantilever(); const snapshot = captureAiSnapshot(attachAnalysisResult(p, solveFrame(p)), []);
  for (const input of [
    { kind: "node", id: p.nodes[1].id, quantity: "displacement", component: "y", analysisId: "another-run" },
    { kind: "node", id: "missing", quantity: "displacement", component: "y" },
    { kind: "node", id: p.nodes[1].id, quantity: "displacement", component: "N" },
    { kind: "member", id: p.members[0].id, quantity: "sectionForces", component: "Mz", position: 5 },
    { kind: "member", id: p.members[0].id, quantity: "sectionForces", component: "Mz", position: -1 },
    { kind: "node", id: p.nodes[1].id, quantity: "displacement", component: "y", value: 123 },
    { kind: "node", id: p.nodes[1].id, quantity: ["displacement"], component: "y" },
  ]) {
    const output = executeAiTool(snapshot, call("read_result", input));
    expect(output.status).toBe("failed"); expect(output.reference).toBeUndefined();
  }
  expect(executeAiTool(snapshot, call("read_results", { collection: "nodes", limit: 101 })).status).toBe("failed");
  expect(executeAiTool(snapshot, call("read_results", { collection: ["nodes"] })).status).toBe("failed");
  expect(executeAiTool(snapshot, call("read_results", { collection: "nodes", limit: null })).status).toBe("failed");
  expect(executeAiTool(snapshot, call("read_results", { collection: "nodes", offset: 1, limit: 1 })).data).toMatchObject({ total: 2, items: [{ nodeId: p.nodes[1].id }] });
  expect(executeAiTool(captureAiSnapshot(p, []), call("read_results", { collection: "summary" })).status).toBe("missing-input");
});
