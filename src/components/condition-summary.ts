import { unitPresentation, type UnitPresetId } from "../domain/units";
import type { FrameProject, Vector3 } from "../domain/project";
import type { ConditionsProposal } from "../workspace/analysis-conditions";
import type { ConditionSource } from "../workspace/condition-input";

export interface ConditionSummaryGroup { objects: string[]; setting: string; suggested: boolean; }
export interface ConditionSummary { label: string; groups: ConditionSummaryGroup[]; }
export function vectorSummary(vector: Vector3, prefix: string, unit: string, local = false, preset?: UnitPresetId): string {
  const u = unitPresentation(preset);
  const components = (["x", "y", "z"] as const).filter((axis) => vector[axis] !== 0).map((axis) => `${prefix}${local ? axis : axis.toUpperCase()}=${u.quantity(vector[axis], unit)}`);
  return components.join(" · ") || `0 ${u.unit(unit)}`;
}
export function conditionSummaries(project: FrameProject, proposal: ConditionsProposal, preset?: UnitPresetId): ConditionSummary[] {
  const summarize = (v: Vector3, prefix: string, unit: string, local = false) => vectorSummary(v, prefix, unit, local, preset);
  const node = (id: string) => project.nodes.find((item) => item.id === id)?.label ?? id;
  const member = (id: string) => project.members.find((item) => item.id === id)?.label ?? id;
  const source = (id: string) => {
    const name = proposal.loadCases?.find((item) => item.ref === id || item.id === id)?.name
      ?? project.loadCases.find((item) => item.id === id)?.name;
    return name ? `${name} (${id})` : id;
  };
  const group = (label: string, entries: { object: string; setting: string; source: ConditionSource }[]): ConditionSummary => {
    const groups = new Map<string, ConditionSummaryGroup>();
    for (const entry of entries) {
      const key = JSON.stringify([entry.setting, entry.source]);
      const previous = groups.get(key);
      if (previous) previous.objects.push(entry.object);
      else groups.set(key, { objects: [entry.object], setting: entry.setting, suggested: !["user", "existing", "catalog"].includes(entry.source) });
    }
    return { label, groups: [...groups.values()] };
  };
  const operation = (id?: string) => id ? "修改" : "新增";
  const nodalVector = (force: Vector3, moment: Vector3) => [
    Object.values(force).some((value) => value !== 0) ? summarize(force, "F", "kN") : "",
    Object.values(moment).some((value) => value !== 0) ? summarize(moment, "M", "kN·m") : "",
  ].filter(Boolean).join(" · ") || "零荷载";
  return [
    group("支座", (proposal.supports ?? []).map((s) => ({ object: node(s.nodeId), source: s.source,
      setting: `${operation(s.id)} · ${s.restraints.every(Boolean) ? "固结" : s.restraints.every((value) => !value) ? "六自由度均自由" : `约束 ${["UX", "UY", "UZ", "RX", "RY", "RZ"].filter((_, i) => s.restraints[i]).join(" / ")}`}` }))),
    group("节点荷载", (proposal.nodalLoads ?? []).map((l) => ({ object: node(l.nodeId), source: l.source,
      setting: `${operation(l.id)} · 全局 · ${nodalVector(l.force, l.moment)} · ${source(l.loadCaseId)}` }))),
    group("均布荷载", (proposal.uniformLoads ?? []).map((l) => ({ object: member(l.memberId), source: l.source,
      setting: `${operation(l.id)} · ${l.coordinateSystem === "global" ? "全局 XYZ" : "局部 xyz"} · ${summarize(l.intensity, "q", "kN/m", l.coordinateSystem === "local")} · ${source(l.loadCaseId)}` }))),
    group("工况", (proposal.loadCases ?? []).map((c) => ({ object: c.name, source: c.source, setting: `${operation(c.id)} · ${c.description || "无说明"}` }))),
    group("组合", (proposal.loadCombinations ?? []).map((c) => ({ object: c.name, source: c.source,
      setting: `${operation(c.id)} · 用户自定义 · ${c.terms.map((t) => `${t.factor} × ${source(t.loadCaseId)}`).join(" + ")}` }))),
    ...(proposal.selfWeight ? [group("自重", [{ object: "全结构", source: proposal.selfWeight.source,
      setting: proposal.selfWeight.enabled ? `启用 · ${source(proposal.selfWeight.loadCaseId)} · 全局 ${summarize(proposal.selfWeight.gravity, "g", "m/s²")}` : "关闭" }])] : []),
  ].filter((summary) => summary.groups.length > 0);
}
