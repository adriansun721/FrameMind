import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { freeGeometryFixtures } from "../validation/free-geometry-fixtures";
import { applyProjectEdits } from "../domain/project-operations";
import { prepareDrawnMemberEdits } from "../domain/work-plane";
import { useWorkPlaneDrawing, WorkPlaneDrawingPanel } from "./WorkPlaneDrawing";
import { UnitPresetContext } from "./UnitPresentation";

function Harness({ preset = "m-kN" }: { preset?: "m-kN" | "mm-N" }) {
  const [project, setProject] = useState(freeGeometryFixtures()[0].project);
  const drawing = useWorkPlaneDrawing(project.nodes, (input) => {
    const updated = applyProjectEdits(project, prepareDrawnMemberEdits(project, input)).project;
    setProject(updated); return updated.nodes.find((node) => node.id === updated.members.at(-1)!.endNodeId)!;
  });
  return <UnitPresetContext.Provider value={preset}><WorkPlaneDrawingPanel drawing={drawing} nodes={project.nodes} materials={project.materials} sections={project.sections} onExit={() => drawing.reset()} onAlign={() => {}} /><output aria-label="正式对象数量">{project.nodes.length}/{project.members.length}</output></UnitPresetContext.Provider>;
}
const change = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name, { exact: true }), { target: { value } });
afterEach(cleanup);

describe("work-plane drawing interaction", () => {
  it("keeps edits as a preview across unit changes, commits once, and continues from the endpoint", () => {
    const view = render(<Harness />);
    change("工作平面位置", "3.5"); change("绘杆 X 坐标", "-120.125"); change("绘杆 Y 坐标", "-51.25");
    expect(screen.getByLabelText("绘杆状态")).toHaveTextContent("捕捉 N2");
    fireEvent.click(screen.getByRole("button", { name: "设为起点" }));
    change("绘杆 X 坐标", "-100.5"); change("绘杆 Y 坐标", "-20.25");
    expect(screen.getByLabelText("正式对象数量")).toHaveTextContent("2/1");
    view.rerender(<Harness preset="mm-N" />);
    expect(screen.getByLabelText("绘杆 X 坐标")).toHaveValue(-100500);
    fireEvent.click(screen.getByRole("button", { name: "提交当前段" }));
    expect(screen.getByLabelText("正式对象数量")).toHaveTextContent("3/2");
    expect(screen.getByLabelText("绘杆状态")).toHaveTextContent("起点 N3");
    change("绘杆 Y 坐标", "-15000");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByLabelText("正式对象数量")).toHaveTextContent("3/2");
    expect(screen.getByLabelText("绘杆状态")).toHaveTextContent("设置起点");
    expect(screen.getByRole("button", { name: "设为起点" })).toBeDisabled();
  });

  it("rejects zero length and invalid numbers while retaining the uncommitted segment", () => {
    render(<Harness />);
    change("绘杆 X 坐标", "2"); fireEvent.click(screen.getByRole("button", { name: "设为起点" }));
    fireEvent.click(screen.getByRole("button", { name: "提交当前段" }));
    expect(screen.getByRole("alert")).toHaveTextContent("同一位置");
    expect(screen.getByLabelText("正式对象数量")).toHaveTextContent("2/1");
    change("绘杆 X 坐标", ""); expect(screen.getByRole("button", { name: "提交当前段" })).toBeDisabled();
    change("工作平面", "XZ");
    expect(screen.getByLabelText("绘杆 Y 坐标")).toBeDisabled();
    expect(screen.getByLabelText("绘杆 Z 坐标")).toBeEnabled();
    expect(screen.getByLabelText("绘杆状态")).toHaveTextContent("设置起点");
  });
});
