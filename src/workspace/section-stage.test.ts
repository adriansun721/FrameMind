import { expect, it } from "vitest";
import { solveFrame } from "../domain/analysis";
import { attachAnalysisResult } from "../domain/project";
import { columns, call } from "./section-stage.fixture";
import { captureAiSnapshot, executeAiTool } from "./ai-tools";
import { prepareSectionConfirmation, SectionStageConfirmation } from "./section-stage";
import { ProjectHistory } from "../domain/project-history";
import { updateNode } from "../domain/project";
import { decodeProject, encodeProject } from "../domain/project-file";


it("previews only the selected column and confirms one atomic section reassignment without changing shared resources", () => {
  const p = columns(); const selection = [{ kind: "member" as const, id: p.members[0].id }];
  const output = executeAiTool(captureAiSnapshot(p, selection), call("propose_section_change", { sectionId: p.sections[1].id, source: "user" }));
  expect(output.status).toBe("awaiting-confirmation");
  expect(p.members.map((m) => m.sectionId)).toEqual([p.sections[0].id, p.sections[0].id]);
  const confirmation = prepareSectionConfirmation(p, selection, output.sectionChange!);
  expect(confirmation.preview.members.map((m) => m.id)).toEqual([p.members[0].id]);
  const stage = new SectionStageConfirmation();
  const applied = stage.confirm(p, selection, confirmation);
  expect(applied.result.status).toBe("applied");
  expect(applied.project.revision).toBe(p.revision + 1);
  expect(applied.project.members.map((m) => m.sectionId)).toEqual([p.sections[1].id, p.sections[0].id]);
  expect(applied.project.sections).toEqual(p.sections);
  expect(applied.project.analysisResults).toEqual(p.analysisResults);
  expect(stage.confirm(applied.project, selection, confirmation).project).toBe(applied.project);
});

it("refuses absent, stale and expanded column references and stale confirmations", () => {
  const p = columns(); const refs = [{ kind: "member" as const, id: p.members[0].id }];
  const request = { sectionId: p.sections[1].id, source: "suggestion" };
  for (const selection of [[], [{ kind: "member" as const, id: "deleted" }]]) {
    expect(executeAiTool(captureAiSnapshot(p, selection), call("propose_section_change", request)).status).toBe("missing-input");
  }
  expect(executeAiTool(captureAiSnapshot(p, refs), call("propose_section_change", { ...request, memberIds: p.members.map((m) => m.id) })).status).toBe("missing-input");
  const proposal = executeAiTool(captureAiSnapshot(p, refs), call("propose_section_change", request)).sectionChange!;
  const confirmation = prepareSectionConfirmation(p, refs, proposal);
  const stage = new SectionStageConfirmation();
  expect(stage.confirm(p, [{ kind: "member", id: p.members[1].id }], confirmation).result.status).toBe("failed");
  const changed = updateNode(p, p.nodes[1].id, { x: 0, y: 0, z: 5 });
  expect(stage.confirm(changed, refs, confirmation).project).toBe(changed);
  expect(stage.confirm(changed, refs, confirmation).result.status).toBe("failed");
});

it("recomputes self weight from the new area and undo restores the edit while retaining both immutable results", () => {
  const p = columns(); const selection = [{ kind: "member" as const, id: p.members[0].id }];
  const proposal = executeAiTool(captureAiSnapshot(p, selection), call("propose_section_change", { sectionId: p.sections[1].id, source: "user" })).sectionChange!;
  const applied = new SectionStageConfirmation().confirm(p, selection, prepareSectionConfirmation(p, selection, proposal)).project;
  const after = solveFrame(applied); const computed = attachAnalysisResult(applied, after);
  // Independent cantilever PL³/(3EI): 5 kN, 4 m, E=200e6 kN/m², I doubles.
  expect(p.analysisResults[0].nodes[1].displacement.x).toBeCloseTo(0.005333333333333333, 12);
  expect(after.nodes[1].displacement.x).toBeCloseTo(0.0026666666666666666, 12);
  // Independent rho*A*L*g/1000: first column increases from 3.14 to 6.28 kN.
  expect(p.analysisResults[0].nodes[0].reaction.z).toBeCloseTo(3.14, 10);
  expect(after.nodes[0].reaction.z).toBeCloseTo(6.28, 10);
  expect(after.nodes[2].reaction.z).toBeCloseTo(3.14, 10);
  const history = new ProjectHistory(); history.record(p, applied);
  const undone = history.undo(computed)!;
  expect(undone.members).toEqual(p.members);
  expect(undone.analysisResults.map((r) => r.id)).toEqual([p.analysisResults[0].id, after.id]);
  expect(decodeProject(encodeProject(undone)).analysisResults).toHaveLength(2);
  expect(history.redo(undone)!.members).toEqual(applied.members);
});

it("adds a custom section only at confirmation and rolls back allocation failures", () => {
  const p = columns(); const selection = p.members.map((m) => ({ kind: "member" as const, id: m.id }));
  const input = { section: { name: "新自定义柱", areaM2: 0.03, secondMomentYM4: 0.0003, secondMomentZM4: 0.0003, torsionalConstantM4: 0.0003 }, source: "suggestion" };
  const proposal = executeAiTool(captureAiSnapshot(p, selection), call("propose_section_change", input)).sectionChange!;
  expect(p.sections).toHaveLength(2);
  const outcome = new SectionStageConfirmation().confirm(p, selection, prepareSectionConfirmation(p, selection, proposal));
  expect(outcome.result.status).toBe("applied"); expect(outcome.project.sections).toHaveLength(3);
  expect(outcome.project.members.every((m) => m.sectionId === outcome.project.sections[2].id)).toBe(true);
  expect(outcome.project.sections[2].provenance.kind).toBe("custom");
  const blocked = { ...p, nextSectionNumber: Number.MAX_SAFE_INTEGER };
  const failure = new SectionStageConfirmation().confirm(blocked, selection, prepareSectionConfirmation(blocked, selection, proposal));
  expect(failure.result.status).toBe("failed"); expect(failure.project).toBe(blocked);
  expect(executeAiTool(captureAiSnapshot(p, selection), call("propose_section_change", { ...input, section: { ...input.section, areaM2: -1 } })).status).toBe("missing-input");
});

