import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "../domain/project";
import { captureAiSnapshot } from "../workspace/ai-tools";
import { proposeFrame } from "../workspace/frame-proposal";
import { FrameProposalCard } from "./FrameProposalCard";
import { UnitPresetContext } from "./UnitPresentation";

afterEach(cleanup);
const snapshot = captureAiSnapshot(createProject(), []);
const initial = proposeFrame({ parameters: {
  storeys: { value: 2, source: "user" }, xSpans: { value: [6], source: "user" }, ySpans: { value: [4], source: "user" },
  storeyHeights: { value: [3, 3], source: "user" }, origin: { value: [0, 0, 0], source: "suggestion" },
  material: { value: "en10025-s355jr", source: "suggestion" }, columnSection: { value: "arcelor-hea200", source: "suggestion" },
  beamSection: { value: "arcelor-ipe200", source: "suggestion" }, rotationDegrees: { value: 0, source: "suggestion" },
} });

describe("proposal editing", () => {
  it("labels mm drafts correctly, preserves storey counts and converts edited spans to canonical metres", () => {
    const changed = vi.fn();
    render(<UnitPresetContext.Provider value="mm-N"><FrameProposalCard snapshot={snapshot} proposal={initial} busy={false} current baseRevision={0}
      onChange={changed} onDirty={() => {}} onReject={() => {}} onConfirm={() => {}} /></UnitPresetContext.Provider>);
    const card = screen.getByRole("region", { name: "建模参数卡片" });
    expect(card).toHaveTextContent("2 层");
    expect(card).toHaveTextContent("6000 mm");
    fireEvent.click(within(card).getByRole("button", { name: "编辑" }));
    const editor = screen.getByRole("dialog");
    expect(within(editor).getByLabelText("X 向跨长 (mm)")).toHaveValue("6000");
    expect(within(editor).queryByLabelText("X 向跨长 (m)")).toBeNull();
    fireEvent.change(within(editor).getByLabelText("X 向跨长 (mm)"), { target: { value: "8000" } });
    fireEvent.click(within(editor).getByRole("button", { name: "更新预览" }));
    expect(changed.mock.calls[0][0].parameters.xSpans.value).toEqual([8]);
  });
  it("keeps edits local until preview update, cancels without losing the proposal, and confirms the updated proposal", async () => {
    const confirmed = vi.fn();
    const changed = vi.fn();
    function Workbench() {
      const [proposal, setProposal] = useState(initial);
      return <FrameProposalCard key={proposal.version} snapshot={snapshot} proposal={proposal} busy={false} current baseRevision={0}
        onChange={(next) => { changed(next); setProposal(next); }} onDirty={() => {}} onReject={() => {}} onConfirm={() => confirmed(proposal)} />;
    }
    render(<Workbench />);
    const card = screen.getByRole("region", { name: "建模参数卡片" });
    expect(within(card).queryByRole("textbox")).toBeNull();
    expect(within(card).getAllByRole("button").map((button) => button.textContent)).toEqual(["详情", "编辑", "确认建模"]);
    fireEvent.click(within(card).getByRole("button", { name: "编辑" }));
    let editor = screen.getByRole("dialog");
    fireEvent.change(within(editor).getByLabelText("X 向跨长 (m)"), { target: { value: "8" } });
    expect(changed).not.toHaveBeenCalled();
    expect(within(card).getByRole("button", { name: "确认建模" })).toBeDisabled();
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(card).getByRole("button", { name: "编辑" })).toHaveFocus();
    fireEvent.click(within(card).getByRole("button", { name: "编辑" }));
    editor = screen.getByRole("dialog");
    expect(within(editor).getByLabelText("X 向跨长 (m)")).toHaveValue("6");
    fireEvent.change(within(editor).getByLabelText("X 向跨长 (m)"), { target: { value: "8" } });
    fireEvent.click(within(editor).getByRole("button", { name: "更新预览" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(within(screen.getByRole("region", { name: "建模参数卡片" })).getByRole("button", { name: "编辑" })).toHaveFocus());
    fireEvent.click(within(screen.getByRole("region", { name: "建模参数卡片" })).getByRole("button", { name: "确认建模" }));
    expect(confirmed.mock.calls[0][0].parameters).toMatchObject({ xSpans: { value: [8], source: "user" }, storeyHeights: { value: [3, 3] } });
  });

  it("keeps details read-only and displays conflicts directly on the compact card", async () => {
    const conflicting = proposeFrame({ parameters: { xSpans: { value: [8], source: "user" } } }, initial);
    render(<FrameProposalCard snapshot={snapshot} proposal={conflicting} busy={false} current baseRevision={0}
      onChange={() => {}} onDirty={() => {}} onReject={() => {}} onConfirm={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("待澄清");
    expect(screen.getByRole("button", { name: "确认建模" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "详情" }));
    expect(within(screen.getByRole("dialog")).queryByRole("textbox")).toBeNull();
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "拒绝方案" })).toBeNull();
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "重新生成预览" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "详情" })).toHaveFocus());
  });
});
