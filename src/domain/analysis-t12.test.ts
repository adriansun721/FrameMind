import { expect, it } from "vitest";
import { captureAnalysisInput, getActiveAnalysisResult, getLoadCaseResult, getMemberSectionForces, isAnalysisResultCurrent, solveFrame } from "./analysis";
import { addLoadCase, addLoadCombination, addMaterial, addMember, addNodalLoad, addNode, addSection, addSupport, addUniformLoad, attachAnalysisResult, createProject, deleteLoadCase, deleteLoadCombination, selectLoadCase, selectLoadCombination, updateLoadCombination, updateNodalLoad, updateNode, updateSelfWeight } from "./project";
import { decodeProject, encodeProject } from "./project-file";

function cantilever() {
  let p = createProject("T12 reference");
  p = addNode(p, { x: 0, y: 0, z: 0 }); p = addNode(p, { x: 4, y: 0, z: 0 });
  p = addMaterial(p, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  p = addSection(p, { name: "Reference", areaM2: 0.01, secondMomentYM4: 0.0002, secondMomentZM4: 0.0001, torsionalConstantM4: 0.00015 });
  p = addMember(p, { startNodeId: p.nodes[0].id, endNodeId: p.nodes[1].id, materialId: p.materials[0].id, sectionId: p.sections[0].id, rotationDegrees: 0 });
  p = addSupport(p, p.nodes[0].id, [true, true, true, true, true, true]);
  p = addLoadCase(p, "Wind");
  p = addNodalLoad(p, p.nodes[1].id, { x: 10, y: 12, z: 14 }, { x: 2, y: 3, z: 4 }, "LC1");
  p = addNodalLoad(p, p.nodes[1].id, { x: -4, y: 6, z: -8 }, { x: -1, y: 2, z: -3 }, "LC2");
  p = addUniformLoad(p, { kind: "uniform", memberId: p.members[0].id, coordinateSystem: "global", loadCaseId: "LC2", intensity: { x: 1, y: -3, z: 2 } });
  return updateSelfWeight(p, { enabled: true, loadCaseId: "LC2", gravity: { x: 0, y: 0, z: -9.81 } });
}

function close(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((n, i) => expect(Math.abs(n - expected[i])).toBeLessThanOrEqual(1e-9 + 1e-9 * Math.abs(expected[i])));
}
const xyz = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z];

it("solves a user combination with negative coefficients against independent six-component cantilever references", () => {
  let p = addLoadCombination(cantilever(), "User response", [{ loadCaseId: "LC1", factor: 1.5 }, { loadCaseId: "LC2", factor: -0.5 }]);
  p = selectLoadCombination(p, p.loadCombinations[0].id);
  const result = solveFrame(captureAnalysisInput(p));
  close(xyz(result.nodes[1].displacement), [0.000032, 0.0214, 0.0121413673333333]);
  close(xyz(result.nodes[1].rotation), [0.00121333333333333, -0.00448601133333333, 0.0083]);
  close(xyz(result.nodes[0].reaction), [-15, -21, -22.54017]);
  close(xyz(result.nodes[0].reactionMoment), [-3.5, 91.58034, -79.5]);
  close(result.members[0].localEndForces.start, [-15, -21, -22.54017, -3.5, 91.58034, -79.5]);
  close(result.members[0].localEndForces.end, [17, 15, 25, 3.5, 3.5, 7.5]);
  close(getMemberSectionForces(result, p.members[0].id, 2).forces, [16, 18, 23.770085, 3.5, -45.270085, 40.5]);
  expect(result.input.combination?.definition.name).toBe("User response");
  expect(result.input.combination?.cases[1].nodalLoads[0].force.x).toBe(-4);
});

it("saves and reopens original inputs and coefficients, with independent case and combination result validity", () => {
  let p = addLoadCombination(cantilever(), "User", [{ loadCaseId: "LC1", factor: 1.5 }, { loadCaseId: "LC2", factor: -0.5 }]);
  p = attachAnalysisResult(p, solveFrame(p));
  p = selectLoadCombination(p, "CB1"); p = attachAnalysisResult(p, solveFrame(p));
  p = decodeProject(encodeProject(p));
  const result = getActiveAnalysisResult(p)!;
  expect(result.input.combination?.cases[1].selfWeight.enabled).toBe(true);
  expect(isAnalysisResultCurrent(p, result)).toBe(true);
  expect(getLoadCaseResult(p)).not.toBe(result);
  expect(p.activeLoadCombinationId).toBe("CB1");
  const changed = updateNodalLoad(p, p.nodalLoads[1].id, p.nodes[1].id, { x: 20, y: 6, z: -8 }, p.nodalLoads[1].moment, "LC2");
  expect(isAnalysisResultCurrent(changed, result)).toBe(false);
  expect(isAnalysisResultCurrent(changed, getLoadCaseResult(p)!)).toBe(true);
  const moved = updateNode(p, p.nodes[1].id, { x: 5, y: 0, z: 0 });
  expect(moved.analysisResults.every((r) => !isAnalysisResultCurrent(moved, r))).toBe(true);
  expect(isAnalysisResultCurrent(updateLoadCombination(p, "CB1", "Changed", [{ loadCaseId: "LC1", factor: 2 }]), result)).toBe(false);
  expect(selectLoadCase(p, "LC1").activeLoadCombinationId).toBeUndefined();
});

it("accepts zero coefficients and all-zero response, rejects invalid definitions and cleans references explicitly", () => {
  let p = addLoadCombination(cantilever(), "Zero", [{ loadCaseId: "LC1", factor: 0 }, { loadCaseId: "LC2", factor: 0 }]);
  p = selectLoadCombination(p, "CB1");
  const result = solveFrame(p);
  for (const node of result.nodes) close([...xyz(node.displacement), ...xyz(node.rotation), ...xyz(node.reaction), ...xyz(node.reactionMoment)], Array(12).fill(0));
  close(getMemberSectionForces(result, p.members[0].id, 2).forces, Array(6).fill(0));
  const firstOnly = solveFrame(selectLoadCombination(updateLoadCombination(p, "CB1", "One", [{ loadCaseId: "LC1", factor: 1 }, { loadCaseId: "LC2", factor: 0 }]), "CB1"));
  close(xyz(firstOnly.nodes[1].displacement), [0.00002, 0.0144, 0.00686666666666667]);
  expect(() => addLoadCombination(p, "Bad", [])).toThrow(/至少/);
  expect(() => addLoadCombination(p, "Bad", [{ loadCaseId: "LC9", factor: 0 }])).toThrow(/工况/);
  expect(() => addLoadCombination(p, "Bad", [{ loadCaseId: "LC1", factor: NaN }])).toThrow(/有限/);
  expect(() => addLoadCombination(p, "Bad", [{ loadCaseId: "LC1", factor: 1 }, { loadCaseId: "LC1", factor: 2 }])).toThrow(/重复/);
  p = attachAnalysisResult(p, result);
  expect(() => deleteLoadCase(p, "LC2")).toThrow(/1 个组合/);
  const deleted = deleteLoadCase(p, "LC2", true);
  expect(deleted.loadCombinations).toEqual([]); expect(deleted.analysisResults).toEqual([]); expect(deleted.activeLoadCombinationId).toBeUndefined();
  expect(decodeProject(encodeProject(deleted)).loadCombinations).toEqual([]);
  const revised = updateLoadCombination(p, "CB1", "Only LC1", [{ loadCaseId: "LC1", factor: 1 }]);
  const removedHistoricSource = deleteLoadCase(revised, "LC2", true);
  expect(removedHistoricSource.loadCombinations).toHaveLength(1);
  expect(removedHistoricSource.analysisResults).toEqual([]);
  expect(removedHistoricSource.latestAnalysis).toBeUndefined();
  expect(decodeProject(encodeProject(removedHistoricSource)).loadCombinations).toHaveLength(1);
  const without = deleteLoadCombination(p, "CB1");
  expect(without.analysisResults).toEqual([]); expect(addLoadCombination(without, "Next", [{ loadCaseId: "LC1", factor: -1 }]).loadCombinations[0].id).toBe("CB2");
});

it("rejects corrupted combination sources, weighted loads, nonfinite products and mixed structural bases", () => {
  let p = addLoadCombination(cantilever(), "User", [{ loadCaseId: "LC1", factor: 1 }, { loadCaseId: "LC2", factor: -1 }]);
  p = selectLoadCombination(p, "CB1"); p = attachAnalysisResult(p, solveFrame(p));
  const saved = JSON.parse(encodeProject(p));
  saved.analysisResults[0].input.combination.cases[1].nodes = saved.nodes;
  expect(() => decodeProject(JSON.stringify(saved))).toThrow(/同一结构/);
  delete saved.analysisResults[0].input.combination.cases[1].nodes;
  saved.analysisResults[0].input.nodalLoads[0].force.x = 999;
  expect(() => decodeProject(JSON.stringify(saved))).toThrow(/依据不一致/);
  const bad = structuredClone(p.latestAnalysis!.input);
  bad.combination!.cases[0].nodalLoads[0].loadCaseId = "LC9";
  expect(() => solveFrame(bad)).toThrow(/来源不一致/);
  expect(() => solveFrame(selectLoadCombination(updateLoadCombination(p, "CB1", "Overflow", [{ loadCaseId: "LC1", factor: Number.MAX_VALUE }]), "CB1"))).toThrow(/有限/);
  const legacy = JSON.parse(encodeProject(cantilever()));
  delete legacy.loadCombinations; delete legacy.nextLoadCombinationNumber;
  expect(decodeProject(JSON.stringify(legacy)).loadCombinations).toEqual([]);
});
