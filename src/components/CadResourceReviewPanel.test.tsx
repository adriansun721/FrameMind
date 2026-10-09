import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CadResourceReviewPanel } from "./CadResourceReviewPanel";
import { buildCadResourceReview, buildCadAiVerificationInput, createCadResourceDraft } from "../workspace/cad-resources";
import type { CadCenterline } from "../workspace/cad-geometry";
import type { CadTopologyPreview } from "../workspace/cad-topology";

const lines: CadCenterline[] = [1, 2].map((instanceId) => ({ id: `line-${instanceId}`, instanceId, solidId: 1, sourceEntityIds: [1], start: [0, 0, 0], end: [2, 0, 0], direction: [1, 0, 0], lengthM: 2, endSections: [ [[0, 0, 0], [0, .2, 0], [0, 0, .1]], [[2, 0, 0], [2, .2, 0], [2, 0, .1]] ], boundingBox: { min: [0, 0, 0], max: [2, .2, .1] }, method: "fixture" }));
const topology: CadTopologyPreview = { toleranceM: .0005, nodes: [{ id: "a", position: { x: 0, y: 0, z: 0 }, sourceEntityIds: [1], endpointCount: 1, mergedFrom: [] }, { id: "b", position: { x: 2, y: 0, z: 0 }, sourceEntityIds: [1], endpointCount: 1, mergedFrom: [] }], members: lines.map((line) => ({ id: `m-${line.id}`, parentId: line.id, instanceId: line.instanceId, sourceEntityIds: [1], startNodeId: "a", endNodeId: "b", range: [0, 1], classification: "candidate" })), contacts: [], issues: [], boundingBox: null, sourceMemberCount: 2, instanceCount: 2, ignoredCount: 0 };
function Harness({ sourceLines = lines }: { sourceLines?: CadCenterline[] }) {
  const [draft, setDraft] = useState(createCadResourceDraft), [open, setOpen] = useState(true);
  const review = buildCadResourceReview({ topology, centerlines: sourceLines, ...draft });
  const key = JSON.stringify(buildCadAiVerificationInput(review));
  return <><button onClick={() => setOpen((value) => !value)}>切换预览</button>{open && <CadResourceReviewPanel draft={draft} review={review} inputKey={key} onChange={setDraft} />}<output data-testid="draft">{JSON.stringify(draft)}</output></>;
}
function fillLine(id: number) {
  for (const [label, value] of [["A（m²）", ".01"], ["Iy（m⁴）", ".0001"], ["Iz（m⁴）", ".0002"], ["J（m⁴）", ".00005"]]) fireEvent.change(screen.getByLabelText(`line-${id} ${label}`), { target: { value } });
  fireEvent.change(screen.getByLabelText(`line-${id} 独立参考`), { target: { value: "independent-section-reference" } });
  fireEvent.click(screen.getByLabelText(`确认 line-${id} 人工参数、局部轴与参考`));
}
function confirmResources() {
  fillLine(1); fillLine(2);
  for (const [label, value] of [["导入材料名称", "S355JR"], ["导入材料弹性模量", "210"], ["导入材料泊松比", ".3"], ["导入材料密度", "7850"]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByLabelText("确认材料来源与参数"));
  fireEvent.click(screen.getByLabelText(/我明确确认/));
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("CAD resource workflow", () => {
  it("preserves the identified local rotation when correcting only a section property", () => {
    const angle = Math.PI / 4, rotate = (y: number, z: number) => [y * Math.cos(angle) - z * Math.sin(angle), y * Math.sin(angle) + z * Math.cos(angle)];
    const rectangle = { ...lines[0], endSections: [0, 2].map((x) => [[-.1, -.05], [.1, -.05], [.1, .05], [-.1, .05]].map(([y, z]) => { const [ry, rz] = rotate(y, z); return [x, ry, rz] as [number, number, number]; })) };
    render(<Harness sourceLines={[rectangle]} />);
    expect(screen.getByLabelText("line-1 求解局部转角")).toHaveValue(45);
    fireEvent.change(screen.getByLabelText("line-1 A（m²）"), { target: { value: ".021" } });
    fireEvent.change(screen.getByLabelText("line-1 独立参考"), { target: { value: "measured-correction" } });
    fireEvent.click(screen.getByLabelText("确认 line-1 人工参数、局部轴与参考"));
    const draft = JSON.parse(screen.getByTestId("draft").textContent!);
    expect(draft.manualSections["line-1"].rotationDegrees).toBeCloseTo(45);
    expect(draft.correctionHistory[0]).toMatchObject({ originalRotationDegrees: 45, rotationDegrees: 45 });
  });
  it("lets repeated instances be confirmed independently and retains an append-only correction history after reopening", () => {
    render(<Harness />); confirmResources();
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("资源已核验");
    fireEvent.click(screen.getByText("切换预览")); fireEvent.click(screen.getByText("切换预览"));
    expect(screen.getByLabelText("line-2 A（m²）")).toHaveValue(.01);
    expect(screen.getByLabelText("确认 line-2 人工参数、局部轴与参考")).toBeChecked();
    fireEvent.change(screen.getByLabelText("line-2 A（m²）"), { target: { value: ".012" } });
    expect(screen.getByLabelText("确认 line-2 人工参数、局部轴与参考")).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("确认 line-2 人工参数、局部轴与参考"));
    const draft = JSON.parse(screen.getByTestId("draft").textContent!);
    expect(draft.correctionHistory).toHaveLength(3);
    expect(draft.correctionHistory[2].original.areaM2).toBe(.01);
    expect(draft.correctionHistory[2].replacement.areaM2).toBe(.012);
  });
  it("discards an in-flight old acceptance and an existing acceptance when material inputs change", async () => {
    let finish!: (response: { status: string; message: string; assistant: { content: string } }) => void;
    let content = "";
    Object.defineProperty(window, "frameMind", { configurable: true, value: { chatDeepSeek: vi.fn((request) => { content = request.messages[1].content; return new Promise((resolve) => { finish = resolve; }); }), cancelDeepSeekChat: vi.fn(async () => undefined) } });
    render(<Harness />); confirmResources();
    fireEvent.click(screen.getByRole("button", { name: "生成 AI 只读核验摘要" }));
    fireEvent.click(screen.getByRole("button", { name: "在线 AI 只读核验" }));
    const request = JSON.parse(content), response = { status: "success", message: "ok", assistant: { content: JSON.stringify({ decision: "accept", findings: request.checks.map((check: { code: string; evidence: string[] }) => ({ checkCode: check.code, decision: "accept", evidence: check.evidence, message: "证据核对" })) }) } };
    fireEvent.change(screen.getByLabelText("导入材料弹性模量"), { target: { value: "200" } });
    await act(async () => finish(response));
    await waitFor(() => expect(screen.getAllByRole("status")[0]).toHaveTextContent("not-requested"));
    expect(screen.getByLabelText("确认材料来源与参数")).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("确认材料来源与参数"));
    fireEvent.click(screen.getByRole("button", { name: "在线 AI 只读核验" }));
    const latest = JSON.parse(content);
    await act(async () => finish({ ...response, assistant: { content: JSON.stringify({ decision: "accept", findings: latest.checks.map((check: { code: string; evidence: string[] }) => ({ checkCode: check.code, decision: "accept", evidence: check.evidence, message: "证据核对" })) }) } }));
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("accepted");
    fireEvent.change(screen.getByLabelText("导入材料密度"), { target: { value: "7800" } });
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("not-requested");
  });
  it("cancels on closing and keeps a new request isolated from an old response after reopening", async () => {
    const pending: Array<{ finish: (response: { status: string; message: string }) => void }> = [];
    const cancelDeepSeekChat = vi.fn(async () => undefined);
    Object.defineProperty(window, "frameMind", { configurable: true, value: { chatDeepSeek: vi.fn(() => new Promise((finish) => { pending.push({ finish }); })), cancelDeepSeekChat } });
    render(<Harness />); confirmResources();
    fireEvent.click(screen.getByRole("button", { name: "生成 AI 只读核验摘要" }));
    fireEvent.click(screen.getByRole("button", { name: "在线 AI 只读核验" }));
    await act(async () => { fireEvent.click(screen.getByText("切换预览")); });
    fireEvent.click(screen.getByText("切换预览"));
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("cancelled");
    expect(cancelDeepSeekChat).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "生成 AI 只读核验摘要" }));
    fireEvent.click(screen.getByRole("button", { name: "在线 AI 只读核验" }));
    await act(async () => { pending[0].finish({ status: "network", message: "old failure" }); });
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("pending");
    await act(async () => { pending[1].finish({ status: "network", message: "new failure" }); });
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("failed · online · new failure");
  });
});
