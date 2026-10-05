import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addNode } from "../domain/project";
import { nodeMergeFixture } from "../validation/node-merge-fixtures";
import { NodeMergeEditor } from "./NodeMergeEditor";
import { UnitPresetContext } from "./UnitPresentation";

afterEach(cleanup);
describe("T2-21 manual merge review", () => {
  it("keeps conflicts unresolved until explicit choices and invalidates a review after engineering edits", () => {
    const project = nodeMergeFixture(true); const commit = vi.fn(); const close = vi.fn();
    const view = render(<UnitPresetContext.Provider value="mm-N"><NodeMergeEditor project={project} onCommit={commit} onClose={close} /></UnitPresetContext.Provider>);
    fireEvent.click(screen.getByText("检查近重合"));
    expect(screen.getByLabelText("近重合检查结果")).toHaveTextContent("0.00025 mm");
    fireEvent.click(screen.getByRole("button", { name: /node_0002 \/ node_0003/ }));
    fireEvent.click(screen.getByText("检查合并影响"));
    expect(screen.getByLabelText("节点合并影响")).toHaveTextContent("member_0003");
    fireEvent.click(screen.getByText("预览成组合并"));
    expect(screen.getByRole("alert")).toHaveTextContent("请选择保留的支座"); expect(commit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("保留支座"), { target: { value: "support_0002" } });
    for (const id of ["load_0001", "load_0002", "member_0001"]) fireEvent.change(screen.getByLabelText(`处理 ${id}`), { target: { value: "keep" } });
    for (const id of ["member_0002", "member_0003"]) fireEvent.change(screen.getByLabelText(`处理 ${id}`), { target: { value: "remove" } });
    fireEvent.click(screen.getByLabelText("接受合并几何变化"));
    fireEvent.click(screen.getByText("预览成组合并")); expect(screen.getByRole("alert")).toHaveTextContent("随杆移除");
    for (const id of ["uniform_load_0001", "uniform_load_0002"]) fireEvent.click(screen.getByLabelText(`移除 ${id}`));
    fireEvent.click(screen.getByText("预览成组合并")); expect(screen.getByText("确认节点合并")).toBeEnabled();
    expect(screen.getByLabelText("成组合并预览")).toHaveTextContent("明确保留：支座 support_0002");
    expect(project.nodes).toHaveLength(3); expect(project.members).toHaveLength(3);
    const latest = addNode(project, { x: 99, y: 0, z: 0 });
    view.rerender(<UnitPresetContext.Provider value="mm-N"><NodeMergeEditor project={latest} onCommit={commit} onClose={close} /></UnitPresetContext.Provider>);
    expect(screen.getByText("确认节点合并")).toBeDisabled();
    fireEvent.click(screen.getByText("检查合并影响")); expect(screen.getByLabelText("保留支座")).toHaveValue("");
    fireEvent.click(screen.getByText("取消", { exact: true })); expect(close).toHaveBeenCalledOnce(); expect(commit).not.toHaveBeenCalled();
  });
  it("applies only a confirmed resolved proposal and clears preview when choices change", () => {
    const project = nodeMergeFixture(); const commit = vi.fn();
    render(<NodeMergeEditor project={project} onCommit={commit} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("检查近重合")); fireEvent.click(screen.getByRole("button", { name: /node_0002 \/ node_0003/ }));
    fireEvent.click(screen.getByText("检查合并影响"));
    for (const id of ["load_0001", "load_0002"]) fireEvent.change(screen.getByLabelText(`处理 ${id}`), { target: { value: "keep" } });
    fireEvent.click(screen.getByLabelText("接受合并几何变化")); fireEvent.click(screen.getByText("预览成组合并"));
    fireEvent.change(screen.getByLabelText("处理 load_0002"), { target: { value: "remove" } }); expect(screen.getByText("确认节点合并")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("处理 load_0002"), { target: { value: "keep" } }); fireEvent.click(screen.getByText("预览成组合并"));
    fireEvent.click(screen.getByText("确认节点合并")); expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0][0].nodes).toHaveLength(2); expect(commit.mock.calls[0][0].nodalLoads.every((l: { nodeId: string }) => l.nodeId === "node_0002")).toBe(true);
  });
});
