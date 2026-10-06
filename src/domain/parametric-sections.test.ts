import { expect, it } from "vitest";
import { addSection, createProject, updateSection, addMember } from "./project";
import { decodeProject, encodeProject } from "./project-file";
import { captureAiSnapshot, executeAiTool } from "../workspace/ai-tools";
import { ModelEditConfirmation, prepareModelEditConfirmation } from "../workspace/model-edits";
import { applyProjectEdits } from "./project-operations";
import { sectionCantilever, SECTION_REFERENCES } from "../validation/section-fixtures";
import { ProjectHistory } from "./project-history";
import { coordinateModelEdits } from "../workspace/draft-coordination";
import { proposeModelEdits } from "../workspace/model-edits";
import { persistTaskState, type ConversationHistory } from "../workspace/task-persistence";
import { decodeSharedResourceLibrary } from "./shared-resource-library";

it.each(SECTION_REFERENCES)("checks independent A/Iy/Iz/J and source for $geometry.shape", ({ geometry, expected }) => {
  const section = addSection(createProject("reference"), { name: geometry.shape, geometry }).sections[0];
  [section.areaM2, section.secondMomentYM4, section.secondMomentZM4, section.torsionalConstantM4].forEach((v, i) => {
    expect(Math.abs(v / expected[i] - 1)).toBeLessThan(1e-12);
  });
  expect(section.parameterBasis?.url).toMatch(/Sci_p385/);
});

it("previews all shared references, copies and assigns atomically, then restores through undo/reopen", () => {
  let p = sectionCantilever();
  const { id: _id, label: _label, ...memberProperties } = p.members[0];
  p = addMember(p, { ...memberProperties, rotationDegrees: 90 });
  const original = structuredClone(p);
  const properties = { name: "new dimensions", geometry: { shape: "rectangle" as const, width: .3, height: .4 } };
  const draft = proposeModelEdits(p, { operations: [{ type: "update_section", id: p.sections[0].id, properties }] });
  expect(draft.preview.affectedMemberIds).toEqual(p.members.map((m) => m.id));
  expect(p).toEqual(original);
  const incompatible = addMember(p, { ...memberProperties, rotationDegrees: 45 });
  expect(coordinateModelEdits(p, incompatible, draft).conflicts.length).toBeGreaterThan(0);
  const updated = new ModelEditConfirmation().confirm(p, prepareModelEditConfirmation(p, draft));
  expect(updated.result.status).toBe("applied");
  expect(updated.project.sections).toEqual(applyProjectEdits(p, draft.operations).project.sections);
  const copied = applyProjectEdits(updated.project, [{ type: "duplicate_section", id: p.sections[0].id },
    { type: "assign_section", id: "section_0002" as typeof p.sections[0]["id"], memberIds: [p.members[0].id], rotationDegrees: 25 }]);
  expect(copied.project.sections[1].geometry).toEqual(properties.geometry);
  expect(copied.project.members[1].sectionId).toBe(p.sections[0].id);
  expect(copied.project.members[0]).toMatchObject({ sectionId: "section_0002", rotationDegrees: 25 });
  const history = new ProjectHistory(); history.record(p, copied.project);
  const undone = history.undo(copied.project)!;
  expect(undone.sections).toEqual(p.sections);
  expect(decodeProject(encodeProject(history.redo(undone)!)).sections).toEqual(copied.project.sections);
});

it("rejects illegal geometry and mismatched stored properties without changing shared resources", () => {
  const p = sectionCantilever(); const before = structuredClone(p);
  const invalid = [
    { shape: "rectangular-tube", width: .2, height: .4, thickness: .1 },
    { shape: "rectangular-tube", width: .2, height: .4, thickness: .03 },
    { shape: "circular-tube", diameter: .2, thickness: -.01 },
    { shape: "i-section", width: .2, height: .4, flangeThickness: .2, webThickness: .01 },
    { shape: "circle", diameter: Infinity }, { shape: "circle", diameter: 0 },
    { shape: "circle", diameter: 1e150 }, { shape: "circle", diameter: 1e-150 },
    { shape: "polygon", width: .2 }, { shape: "rectangle", width: .2, height: .4, radius: 0 },
  ];
  for (const geometry of invalid) expect(() => updateSection(p, p.sections[0].id, { name: "bad", geometry } as Parameters<typeof updateSection>[2])).toThrow();
  expect(() => decodeProject(JSON.stringify({ ...p, sections: [{ ...p.sections[0], areaM2: 1 }] }))).toThrow(/不一致/);
  expect(p).toEqual(before);
});

it("preserves pending dimension drafts and shared-library geometry", () => {
  const p = sectionCantilever(SECTION_REFERENCES[2].geometry);
  const draft = proposeModelEdits(p, { operations: [
    { type: "create_section", properties: { name: "pending", geometry: SECTION_REFERENCES[4].geometry } },
    { type: "assign_section", id: "section_0002", memberIds: [p.members[0].id], rotationDegrees: 30 },
  ] });
  const history: ConversationHistory = { id: "dimensions", updatedAt: 1, turns: [], sectionSelection: [],
    calculationRequested: false, requestPrompt: "Create section", proposalSource: p, conditionsSource: p, sectionSource: p, modelEditsSource: p, taskDraftSource: p, modelEdits: draft };
  const reopened = decodeProject(encodeProject({ ...p, taskState: persistTaskState(p.id, [history], []) }));
  const pending = reopened.taskState!.conversations[0].modelEdits!;
  expect(pending.operations).toEqual(draft.operations);
  expect(reopened.sections).toEqual(p.sections);
  expect(new ModelEditConfirmation().confirm(reopened, prepareModelEditConfirmation(reopened, pending)).result.status).toBe("applied");
  const library = decodeSharedResourceLibrary(JSON.stringify({ version: 1, materials: [], sections: [{ ...p.sections[0], libraryId: "tube" }] }));
  expect(library.sections[0].geometry).toEqual(p.sections[0].geometry);
});

it("previews and confirms dimension input with explicit tool units", () => {
  const p = createProject("AI dimensions");
  const result = executeAiTool(captureAiSnapshot(p, []), { id: "section", type: "function", function: {
    name: "propose_model_edits", arguments: JSON.stringify({ inputUnits: { length: "mm" }, operations: [
      { type: "create_section", properties: { name: "圆", geometry: { shape: "circle", diameter: 200 } } },
    ] }),
  } });
  expect(result.status).toBe("awaiting-confirmation");
  expect(p.sections).toEqual([]);
  const applied = new ModelEditConfirmation().confirm(p, prepareModelEditConfirmation(p, result.modelEdits!));
  expect(applied.result.status).toBe("applied");
  expect(applied.project.sections[0].areaM2).toBeCloseTo(.031415926535897934, 14);
  expect(applied.project.sections[0].geometry).toEqual({ shape: "circle", diameter: .2 });
  expect(decodeProject(encodeProject(applied.project)).sections).toEqual(applied.project.sections);
});

it("creates a rectangular section from dimensions and retains geometry on reopen", () => {
  const p = addSection(createProject("dimensions"), {
    name: "200 × 400", geometry: { shape: "rectangle", width: .2, height: .4 },
  });
  expect(p.sections[0].areaM2).toBeCloseTo(.08, 14);
  expect(p.sections[0].secondMomentYM4).toBeCloseTo(.0010666666666666667, 14);
  expect(p.sections[0].secondMomentZM4).toBeCloseTo(.0002666666666666667, 14);
  expect(p.sections[0].torsionalConstantM4).toBeCloseTo(.0007324166666666668, 14);
  expect(p.sections[0].geometry).toEqual({ shape: "rectangle", width: .2, height: .4 });
  expect(decodeProject(encodeProject(p)).sections).toEqual(p.sections);
});
