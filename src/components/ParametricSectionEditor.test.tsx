import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createProject } from "../domain/project";
import { sectionCantilever } from "../validation/section-fixtures";
import { UnitPresetContext } from "./UnitPresentation";
import { ParametricSectionEditor } from "./ParametricSectionEditor";
import { SectionEditImpact } from "./SectionEditImpact";
import { proposeModelEdits } from "../workspace/model-edits";
afterEach(cleanup);

it("keeps current section properties when converting an edited geometric section to property input", () => {
  const project = sectionCantilever();
  const commit = vi.fn();
  render(<ParametricSectionEditor project={project} initialSectionId={project.sections[0].id}
    onCommit={commit} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("宽度 b（局部 y）"), { target: { value: ".4" } });
  fireEvent.change(screen.getByLabelText("截面形状"), { target: { value: "properties" } });
  expect((screen.getByLabelText("面积 A") as HTMLInputElement).valueAsNumber).toBeCloseTo(.16, 14);
  expect((screen.getByLabelText("惯性矩 Iy") as HTMLInputElement).valueAsNumber).toBeCloseTo(.002133333333333334, 14);
  fireEvent.click(screen.getByText("预览截面影响"));
  fireEvent.click(screen.getByText("确认截面变更"));
  expect(commit.mock.calls[0][0].sections[0].areaM2).toBeCloseTo(.16, 14);
  expect(commit.mock.calls[0][0].sections[0].geometry).toBeUndefined();
});

it("previews section axes from the final geometry of an atomic node and section draft", () => {
  const project = sectionCantilever();
  const draft = proposeModelEdits(project, { operations: [
    { type: "update_node", id: project.nodes[1].id, position: { x: 0, y: 0, z: 3 } },
    { type: "assign_section", id: project.sections[0].id, memberIds: [project.members[0].id] },
  ] });
  render(<SectionEditImpact project={project} receipt={draft.preview} />);
  expect(screen.getByLabelText("截面影响预览")).toHaveTextContent("x = (0.0000, 0.0000, 1.0000)");
  expect(screen.getByLabelText("截面影响预览")).toHaveTextContent("参考轴 global-y");
});

it("requires a reviewed dimension draft and shows physical dimensions in display units", () => {
  const commit = vi.fn();
  render(<UnitPresetContext.Provider value="mm-N"><ParametricSectionEditor project={createProject("dimensions")}
    onCommit={commit} onClose={() => {}} /></UnitPresetContext.Provider>);
  fireEvent.change(screen.getByLabelText("截面名称"), { target: { value: "矩形" } });
  fireEvent.change(screen.getByLabelText("宽度 b（局部 y）"), { target: { value: "200" } });
  fireEvent.change(screen.getByLabelText("高度 h（局部 z）"), { target: { value: "400" } });
  fireEvent.click(screen.getByText("预览截面影响"));
  expect(commit).not.toHaveBeenCalled();
  expect(screen.getByLabelText("截面影响预览")).toHaveTextContent("80000 mm²");
  expect(screen.getByRole("img", { name: /截面几何/ })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("高度 h（局部 z）"), { target: { value: "300" } });
  expect(screen.getByText("确认截面变更")).toBeDisabled();
  fireEvent.click(screen.getByText("预览截面影响"));
  fireEvent.click(screen.getByText("确认截面变更"));
  expect(commit.mock.calls[0][0].sections[0].geometry).toEqual({ shape: "rectangle", width: .2, height: .3 });
});

it("blocks a stale shared-resource confirmation and never commits invalid wall thickness", () => {
  const p = sectionCantilever(); const commit = vi.fn();
  const props = { project: p, initialSectionId: p.sections[0].id, onCommit: commit, onClose: () => {} };
  const view = render(<ParametricSectionEditor {...props} />);
  fireEvent.change(screen.getByLabelText("宽度 b（局部 y）"), { target: { value: ".3" } });
  fireEvent.click(screen.getByText("预览截面影响"));
  expect(screen.getByLabelText("截面影响预览")).toHaveTextContent("member_0001");
  view.rerender(<ParametricSectionEditor {...props} project={{ ...p, revision: p.revision + 1 }} />);
  expect(screen.getByText("确认截面变更")).toBeDisabled(); expect(commit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("截面形状"), { target: { value: "rectangular-tube" } });
  fireEvent.change(screen.getByLabelText("壁厚 t"), { target: { value: ".1" } });
  fireEvent.click(screen.getByText("预览截面影响"));
  expect(screen.getByRole("alert")).toHaveTextContent("壁厚");
  expect(screen.getByText("确认截面变更")).toBeDisabled();
});
