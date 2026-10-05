import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addNode } from "../domain/project";
import { topologyFixture } from "../validation/topology-fixtures";
import { TopologyEditor } from "./TopologyEditor";
import { UnitPresetContext } from "./UnitPresentation";

afterEach(cleanup);
describe("T2-20 manual topology review", () => {
  it("previews in display units, applies only on confirmation and invalidates the review when inputs change", () => {
    const project = topologyFixture(true); const commit = vi.fn(); const close = vi.fn();
    const view = render(<UnitPresetContext.Provider value="mm-N"><TopologyEditor project={project} selectedMemberIds={new Set([project.members[0].id])} onCommit={commit} onClose={close} /></UnitPresetContext.Provider>);
    fireEvent.change(screen.getByLabelText("拓扑 X 坐标"), { target: { value: "-500" } });
    fireEvent.click(screen.getByText("预览影响"));
    expect(screen.getByLabelText("拓扑影响预览")).toHaveTextContent("member_0001 → member_0003");
    expect(commit).not.toHaveBeenCalled(); expect(project.nodes).toHaveLength(4);
    fireEvent.change(screen.getByLabelText("拓扑 X 坐标"), { target: { value: "-1000" } });
    expect(screen.getByText("确认拓扑变更")).toBeDisabled();
    fireEvent.click(screen.getByText("预览影响"));
    view.rerender(<UnitPresetContext.Provider value="mm-N"><TopologyEditor project={addNode(project, { x: 9, y: 9, z: 9 })} selectedMemberIds={new Set([project.members[0].id])} onCommit={commit} onClose={close} /></UnitPresetContext.Provider>);
    expect(screen.getByText("确认拓扑变更")).toBeDisabled();
    fireEvent.click(screen.getByText("预览影响")); fireEvent.click(screen.getByText("确认拓扑变更"));
    expect(commit).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0][0].nodes.at(-1).position).toEqual({ x: -1, y: 0, z: 0 });
    expect(commit.mock.calls[0][0].members).toHaveLength(3);
  });
  it("refuses endpoint splitting and can cancel a valid preview without changing the project", () => {
    const project = topologyFixture(); const commit = vi.fn(); const close = vi.fn();
    render(<TopologyEditor project={project} selectedMemberIds={new Set()} onCommit={commit} onClose={close} />);
    fireEvent.change(screen.getByLabelText("拓扑 X 坐标"), { target: { value: "-2" } });
    fireEvent.click(screen.getByText("预览影响"));
    expect(screen.getByRole("alert")).toHaveTextContent("不能使用端点");
    expect(screen.getByText("确认拓扑变更")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("拓扑 X 坐标"), { target: { value: "0" } });
    fireEvent.click(screen.getByText("预览影响"));
    expect(screen.getByText("确认拓扑变更")).toBeEnabled();
    fireEvent.click(screen.getByText("取消", { exact: true }));
    expect(close).toHaveBeenCalledOnce(); expect(commit).not.toHaveBeenCalled();
  });
});
