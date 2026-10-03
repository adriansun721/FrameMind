import { useState } from "react";
import { Check, CircleAlert, Minus } from "lucide-react";
import type { AiProgress, AiTaskResult, AiToolRecord } from "../workspace/ai-task";
import { FRAME_FIELDS, type FrameProposal } from "../workspace/frame-proposal";
import type { ConditionsProposal } from "../workspace/analysis-conditions";
import type { SectionChangeProposal } from "../workspace/section-stage";

export interface StageResolution {
  status: "confirmed" | "cancelled" | "updated";
  draft?: FrameProposal | ConditionsProposal | SectionChangeProposal;
  resourceNames?: Record<string, string>;
  parameters?: string;
}
export interface TimelineTurn {
  id: string;
  origin: "chat" | "confirmation" | "analysis";
  progressEvents?: AiProgress[];
  result?: AiTaskResult;
  output?: Pick<AiTaskResult, "assistant" | "records">;
  stageResolutions?: Record<string, StageResolution>;
}
interface Step {
  id: string;
  label: string;
  state: "active" | "done" | "waiting" | "issue" | "cancelled";
  detail?: string;
  parameters?: string;
}

export const TOOL_LABELS: Record<string, string> = {
  read_model: "读取当前模型", read_selection: "读取选中对象", read_objects: "读取指定对象",
  propose_frame: "整理建模参数", discard_frame_proposal: "取消建模方案", confirm_frame_stage: "确认建模参数",
  propose_analysis_conditions: "整理支座和荷载条件", discard_analysis_conditions: "取消分析条件", confirm_analysis_conditions: "确认分析条件",
  run_analysis: "检查并计算已确认模型", request_analysis: "准备本地计算",
  read_results: "读取分析结果", read_result: "核对结果引用",
  propose_section_change: "整理柱截面参数", discard_section_change: "取消截面方案", confirm_section_change: "确认截面参数",
  read_comparison: "读取前后分析对比", read_comparison_result: "核对前后差值引用",
};

function toolLabel(record: Pick<AiToolRecord, "call">): string {
  if (record.call.function.name === "read_model") {
    try {
      const { collection } = JSON.parse(record.call.function.arguments);
      const collections: Record<string, string> = { supports: "检查支座条件", loads: "检查荷载条件", "load-cases": "检查工况和组合", nodes: "读取模型节点", members: "读取模型杆件", materials: "核对材料", sections: "核对截面" };
      if (collections[collection]) return collections[collection];
    } catch { /* Invalid arguments are reported by the tool result. */ }
  }
  return TOOL_LABELS[record.call.function.name] ?? "处理模型任务";
}

function stageParameters(draft: StageResolution["draft"], resourceNames: Record<string, string> = {}): string | undefined {
  if (!draft) return;
  if ("parameters" in draft) return Object.entries(FRAME_FIELDS).map(([key, label]) => {
    const parameter = draft.parameters[key as keyof typeof FRAME_FIELDS];
    const value = parameter?.value;
    return `${label}：${Array.isArray(value) ? value.join("、") : typeof value === "string" ? resourceNames[value] ?? value : value ?? "未填写"}`;
  }).join("\n");
  if ("memberIds" in draft) return `柱数量：${draft.memberIds.length}\n截面：${draft.section.name}\n面积：${draft.section.areaM2} m²\nIy：${draft.section.secondMomentYM4} m⁴\nIz：${draft.section.secondMomentZM4} m⁴\nJ：${draft.section.torsionalConstantM4} m⁴`;
  return `本次支座设置：${draft.supports?.length ?? 0} 项\n本次节点荷载设置：${draft.nodalLoads?.length ?? 0} 项\n本次均布荷载设置：${draft.uniformLoads?.length ?? 0} 项\n自重设置：${draft.selfWeight === undefined ? "保持原设置" : draft.selfWeight.enabled ? "启用" : "关闭"}\n本次工况设置：${draft.loadCases?.length ?? 0} 项\n本次组合设置：${draft.loadCombinations?.length ?? 0} 项`;
}

function timelineSteps(turns: readonly TimelineTurn[], paused: boolean): Step[] {
  const steps: Step[] = [];
  for (const turn of turns) {
    const records = turn.result?.records ?? turn.output?.records ?? [];
    const events = turn.progressEvents ?? [];
    const calls = new Map<string, { call: AiToolRecord["call"]; result?: AiToolRecord["result"] }>();
    for (const event of events) if (event.toolCall) calls.set(`${event.round}:${event.toolCall.id}`, { call: event.toolCall, result: event.toolResult });
    for (const record of records) calls.set(`${record.round}:${record.call.id}`, record);
    // Requests and tool results are the only sources of process steps; no predicted steps.
    if (turn.origin === "chat" && (!calls.size || events.length)) {
      const interrupted = turn.result?.status === "failed" || turn.result?.status === "cancelled";
      const processed = calls.size > 0 || events.some((event) => event.phase === "responding");
      const done = Boolean(processed || turn.output?.assistant || turn.result && !interrupted);
      steps.push({ id: `${turn.id}:thinking`, label: done ? "已整理请求" : interrupted ? "请求已中断" : "思考中", state: done ? "done" : interrupted ? "cancelled" : "active" });
    }
    for (const [id, record] of calls) {
      const status = record.result?.status;
      if (turn.origin === "confirmation" && status === "applied") continue;
      steps.push({ id: `${turn.id}:${id}`, label: toolLabel(record),
        state: status === "completed" || status === "applied" || status === "missing-input" || status === "awaiting-confirmation" ? "done" : status === "failed" ? "issue" : status === "cancelled" ? "cancelled" : turn.result ? "cancelled" : "active",
        detail: status === "failed" ? record.result?.message : undefined });
      if (status === "missing-input") steps.push({ id: `${turn.id}:${id}:missing`, label: "发现待补充参数", state: "issue", detail: record.result?.message });
    }
    const result = turn.result;
    const stage = result?.proposal ? { draft: result.proposal, label: "建模参数" }
      : result?.conditions ? { draft: result.conditions, label: "分析条件" }
        : result?.sectionChange ? { draft: result.sectionChange, label: "截面参数" } : undefined;
    const preparedStage = stage && result?.records.some((record) => [record.result.proposal?.id, record.result.conditions?.id, record.result.sectionChange?.id].includes(stage.draft.id));
    if (stage && preparedStage && (result?.status === "missing-input" || result?.status === "awaiting-confirmation")) {
      const resolution = turn.stageResolutions?.[stage.draft.id];
      steps.push({ id: `${turn.id}:stage`, label: resolution?.status === "confirmed" ? `${stage.label}已确认` : resolution?.status === "updated" ? `${stage.label}已更新` : resolution?.status === "cancelled" ? `${stage.label}已取消` : `等待填写并确认${stage.label}`,
        state: resolution?.status === "confirmed" || resolution?.status === "updated" ? "done" : resolution?.status === "cancelled" ? "cancelled" : "waiting",
        parameters: resolution?.status === "confirmed" ? resolution.parameters ?? stageParameters(resolution.draft ?? stage.draft, resolution.resourceNames) : undefined });
    }
    if (!result && turn.origin === "analysis") steps.push({ id: `${turn.id}:analysis`, label: "正在检查并计算已确认模型", state: "active" });
    if (!result && calls.size && events.at(-1)?.phase === "requesting") steps.push({ id: `${turn.id}:next`, label: "正在整理下一步", state: "active" });
    if (events.at(-1)?.phase === "responding" || turn.output?.assistant) {
      const interrupted = result?.status === "failed" || result?.status === "cancelled";
      steps.push({ id: `${turn.id}:reply`, label: interrupted ? "回复已中断" : result ? "回复已完成" : "正在输出回复", state: interrupted ? "cancelled" : result ? "done" : "active" });
    }
    if (result?.status === "failed" || result?.status === "cancelled") {
      for (const step of steps) if (step.state === "active") step.state = result.status === "failed" ? "issue" : "cancelled";
      steps.push({ id: `${turn.id}:interrupted`, label: result.status === "failed" ? "处理未完成" : "处理已取消", state: result.status === "failed" ? "issue" : "cancelled", detail: result.message });
    }
  }
  if (paused) for (const step of steps) if (step.state === "active") { step.state = "waiting"; step.label = "已暂停输出"; }
  return steps;
}

export function AiTaskTimeline({ turns, paused }: { turns: readonly TimelineTurn[]; paused: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const steps = timelineSteps(turns, paused);
  const settled = steps.every((step) => step.state !== "active" && step.state !== "waiting");
  return <section className="ai-task-timeline" aria-label="处理过程" aria-busy={steps.some((step) => step.state === "active")}>
    {settled && <button className="ai-process-toggle" type="button" aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}>{collapsed ? "展开处理过程" : "收起处理过程"}</button>}
    {(!collapsed || !settled) && <ol>{steps.map((step) => <li key={step.id} className={`ai-process-step ${step.state}`}>
      <span className="ai-process-dot" aria-hidden="true">{step.state === "done" ? <Check size={11} /> : step.state === "issue" ? <CircleAlert size={12} /> : step.state === "cancelled" ? <Minus size={11} /> : null}</span>
      <div>{step.parameters ? <details className="ai-confirmed-parameters"><summary>{step.label}</summary><p>{step.parameters}</p></details> : <span>{step.label}{step.state === "active" && <span className="ai-thinking-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>}</span>}
        {step.detail && <p className="ai-process-detail">{step.detail}</p>}</div>
    </li>)}</ol>}
  </section>;
}
