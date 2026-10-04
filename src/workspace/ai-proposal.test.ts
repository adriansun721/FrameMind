import { describe, expect, it } from "vitest";
import type { DeepSeekChatRequest, DeepSeekToolCall } from "../../electron/contracts";
import { addNode, createProject } from "../domain/project";
import { captureAnalysisInput } from "../domain/analysis";
import { captureAiSnapshot, executeAiTool } from "./ai-tools";
import { startAiTask } from "./ai-task";
import { buildFramePreview, editFrameParameter, type FrameProposal } from "./frame-proposal";

const complete = {
  storeys: { value: 2, source: "user" },
  xSpans: { value: [6], source: "user" }, ySpans: { value: [4], source: "user" },
  storeyHeights: { value: [3, 3], source: "user" }, origin: { value: [0, 0, 0], source: "suggestion" },
  material: { value: "en10025-s355jr", source: "suggestion" }, columnSection: { value: "arcelor-hea200", source: "suggestion" },
  beamSection: { value: "arcelor-ipe200", source: "suggestion" }, rotationDegrees: { value: 0, source: "suggestion" },
};
const call = (parameters: unknown, name = "propose_frame"): DeepSeekToolCall => ({ id: "proposal-call", type: "function", function: { name, arguments: JSON.stringify(name === "propose_frame" ? { parameters } : parameters) } });
const project = addNode(createProject("已应用项目"), { x: -2, y: -3, z: 0 });
const snapshot = captureAiSnapshot(project, []);

describe("AI proposal public tool and task boundaries", () => {
  it("keeps user provenance when suggestions repeat the same value and protects it from later suggestions", () => {
    const proposal = executeAiTool(snapshot, call(complete)).proposal!;
    const repeated = executeAiTool(snapshot, call({ xSpans: { value: [6], source: "suggestion" } }), proposal).proposal!;
    expect(repeated.parameters.xSpans).toEqual({ value: [6], source: "user" });
    const different = executeAiTool(snapshot, call({ xSpans: { value: [8], source: "suggestion" } }), repeated).proposal!;
    expect(different.parameters.xSpans).toEqual({ value: [6], source: "user", conflict: [8] });
  });

  it("completes local refusal without another network request that could invalidate it", async () => {
    const proposal = executeAiTool(snapshot, call(complete)).proposal!;
    let requests = 0;
    const task = startAiTask(snapshot, "拒绝方案", { proposal, isCurrent: () => true, getCurrentSnapshot: () => snapshot, transport: {
      cancelDeepSeekChat: async () => {}, chatDeepSeek: async () => {
        requests += 1;
        return requests === 1 ? { status: "success", message: "工具", assistant: { role: "assistant", content: null, tool_calls: [call({}, "discard_frame_proposal")] } }
          : { status: "network", message: "网络中断" };
      },
    } });
    expect(await task.promise).toMatchObject({ status: "completed", proposal: null });
    expect(requests).toBe(1);
  });

  it("completes an exploration-enabled proposal and retains the waiting card", async () => {
    let requests = 0;
    const task = startAiTask(snapshot, "建立两层刚架", { isCurrent: () => true, getCurrentSnapshot: () => snapshot, exploration: { mode: "normal" }, transport: {
      cancelDeepSeekChat: async () => {}, chatDeepSeek: async () => {
        requests += 1;
        return { status: "success", message: "工具", assistant: { role: "assistant", content: null, tool_calls: [call(complete)] } };
      },
    } });
    const result = await task.promise;
    expect(result).toMatchObject({ status: "awaiting-confirmation", proposal: expect.any(Object), exploration: { phase: "waiting-user", requests: 1 } });
    expect(requests).toBe(1);
  });

  it("shows incomplete parameter cards with sources and never fabricates partial geometry", () => {
    const result = executeAiTool(snapshot, call({ storeyHeights: { value: [3, 3], source: "suggestion" } }));
    expect(result.status).toBe("missing-input");
    expect(result.proposal!.parameters.storeyHeights).toEqual({ value: [3, 3], source: "suggestion" });
    expect(buildFramePreview(snapshot, result.proposal!)).toMatchObject({ nodes: [], members: [], issues: expect.arrayContaining(["尚缺 X 向跨长 (m)", "尚缺 钢材"]) });
  });

  it("creates an isolated two-storey batch with independently counted geometry and preserves analysis input", () => {
    const before = structuredClone(project);
    const analysisBefore = captureAnalysisInput(project);
    const result = executeAiTool(snapshot, call(complete));
    expect(result.status).toBe("awaiting-confirmation");
    const preview = buildFramePreview(snapshot, result.proposal!);
    // 4 grid corners at ground + two floors; 8 columns and 4 perimeter beams per floor.
    expect(preview.nodes).toHaveLength(12);
    expect(preview.members).toHaveLength(16);
    expect(preview.members.filter((member) => member.role === "column")).toHaveLength(8);
    expect(preview.nodes.map((node) => node.position)).toEqual(expect.arrayContaining([{ x: 6, y: 4, z: 6 }, { x: 0, y: 0, z: 0 }]));
    expect(preview.materials[0]).toMatchObject({ name: "S355JR", elasticModulusGPa: 210 });
    expect(preview.members.every((member) => preview.nodes.some((node) => node.id === member.startNodeId) && preview.nodes.some((node) => node.id === member.endNodeId))).toBe(true);
    expect(project).toEqual(before);
    expect(captureAnalysisInput(project)).toEqual(analysisBefore);
    expect(preview.nodes.some((node) => node.id === project.nodes[0].id)).toBe(false);
  });

  it("retains conflicting user values until a card edit or explicit natural-language correction resolves them", () => {
    const proposal = executeAiTool(snapshot, call(complete)).proposal!;
    const conflicting = executeAiTool(snapshot, call({ xSpans: { value: [8], source: "user" } }), proposal).proposal!;
    expect(conflicting.parameters.xSpans).toEqual({ value: [6], source: "user", conflict: [8] });
    const repeated = executeAiTool(snapshot, call({ xSpans: { value: [6], source: "user" } }), conflicting).proposal!;
    expect(repeated.parameters.xSpans).toEqual({ value: [6], source: "user", conflict: [8] });
    expect(buildFramePreview(snapshot, conflicting).nodes).toEqual([]);
    const edited = editFrameParameter(conflicting, "xSpans", "8");
    expect(buildFramePreview(snapshot, edited).nodes).toHaveLength(12);
    expect(edited.parameters.xSpans).toEqual({ value: [8], source: "user" });
    expect(edited.changes).toEqual([{ field: "xSpans", before: [6], after: [8] }]);
    const corrected = executeAiTool(snapshot, call({ storeyHeights: { value: [4, 4], source: "user", replace: true } }), edited).proposal!;
    expect(buildFramePreview(snapshot, corrected).nodes.at(-1)?.position).toEqual({ x: 8, y: 4, z: 8 });
    const suggested = executeAiTool(snapshot, call({ xSpans: { value: [10], source: "suggestion", replace: true } }), corrected).proposal!;
    expect(suggested.parameters.xSpans?.value).toEqual([8]);
    expect(suggested.parameters.xSpans?.conflict).toEqual([10]);
  });

  it("rejects unknown fields, invalid dimensions and scripts and explains missing resources and excessive previews", () => {
    for (const parameters of [{ code: { value: "eval()", source: "user" } }, { xSpans: { value: [0], source: "user" } },
      { origin: { value: [0, 0], source: "user" } }, { rotationDegrees: { value: 0 } }]) {
      expect(executeAiTool(snapshot, call(parameters)).status).toBe("failed");
    }
    expect(executeAiTool(snapshot, call({ script: "eval()" }, "execute_script")).status).toBe("failed");
    const missing = executeAiTool(snapshot, call({ ...complete, material: { value: "unknown", source: "user" } }));
    expect(missing).toMatchObject({ status: "missing-input", data: { issues: ["钢材资源不存在，请重新选择"] } });
    const large = executeAiTool(snapshot, call({ ...complete, xSpans: { value: Array(100).fill(1), source: "user" }, ySpans: { value: Array(100).fill(1), source: "user" } }));
    expect(large).toMatchObject({ status: "missing-input", data: { counts: { nodes: 0, members: 0 } } });
    const inconsistent = executeAiTool(snapshot, call({ ...complete, storeyHeights: { value: [3], source: "user" } }));
    expect(inconsistent).toMatchObject({ status: "missing-input", data: { issues: ["层数为 2，但提供了 1 个层高，请澄清"] } });
  });

  it("carries the current edited card into a natural-language task and lets a refusal discard it", async () => {
    const proposal = editFrameParameter(executeAiTool(snapshot, call(complete)).proposal!, "xSpans", "8");
    const requests: DeepSeekChatRequest[] = [];
    const result = await startAiTask(snapshot, "第二层改成4米", { proposal, isCurrent: () => true, getCurrentSnapshot: () => snapshot, transport: {
      cancelDeepSeekChat: async () => {}, chatDeepSeek: async (request) => {
        requests.push(request); return { status: "success", message: "工具", assistant: { role: "assistant", content: null,
          tool_calls: [call({ storeyHeights: { value: [3, 4], source: "user", replace: true } })] } };
      },
    } }).promise;
    expect(requests).toHaveLength(1);
    expect(requests[0].messages[0].content).toContain('"xSpans":{"value":[8],"source":"user"}');
    expect(result.proposal!.parameters.xSpans?.value).toEqual([8]);
    expect(result.proposal!.parameters.storeyHeights?.value).toEqual([3, 4]);
    const rejected = await startAiTask(snapshot, "不要这个方案", { proposal: result.proposal as FrameProposal, isCurrent: () => true, getCurrentSnapshot: () => snapshot, transport: {
      cancelDeepSeekChat: async () => {}, chatDeepSeek: async (request) => ({ status: "success", message: "工具", assistant: request.messages.some((message) => message.role === "tool")
        ? { role: "assistant", content: "已拒绝方案" } : { role: "assistant", content: null, tool_calls: [call({}, "discard_frame_proposal")] } }),
    } }).promise;
    expect(rejected).toMatchObject({ status: "completed", proposal: null });
    expect(project.nodes).toHaveLength(1);
  });
});
