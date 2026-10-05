import { ANALYSIS_DOF_ORDER, ANALYSIS_PROCESS_BASIS, sameInputValue, getMemberAnalysisRecord, getOverallAnalysisProcessRecord, type AnalysisProcessBasis, type AnalysisResult, type MemberAnalysisRecord, type OverallAnalysisProcessRecord } from "./analysis";

export const REPORT_APPENDIX_STEPS = {
  "member-process": "杆件过程（局部轴、位移荷载与单元矩阵）",
  "dof-mapping": "整体自由度映射",
  assembly: "所选杆件组装贡献",
  constraints: "整体约束处理与荷载向量",
  "assembled-stiffness": "整体刚度矩阵 K",
  "reduced-stiffness": "约束后刚度矩阵 Kff",
} as const;
export type ReportAppendixStep = keyof typeof REPORT_APPENDIX_STEPS;
export interface ReportAppendixSelection { memberIds: string[]; steps: ReportAppendixStep[] }
export interface ReportAppendix {
  selection: ReportAppendixSelection;
  members: MemberAnalysisRecord[];
  overall: OverallAnalysisProcessRecord | null;
  missing: string[];
  basis: AnalysisProcessBasis;
}

function requireProcessCorrespondence(result: AnalysisResult): void {
  const { input, process } = result;
  if (!process) return;
  // Rebuild coefficients for validation only, without solving or replacing the saved snapshot.
  const expected = getOverallAnalysisProcessRecord({ ...result, process: undefined });
  const numbersMatch = (actual: number[], reference: number[]) => actual.length === reference.length && actual.every((value, index) => Math.abs(value - reference[index]) <= 1e-9 * Math.max(1, Math.abs(reference[index])));
  const restraints = new Set(input.supports.flatMap((support) => support.restraints.flatMap((value, index) => value ? [input.nodes.findIndex((node) => node.id === support.nodeId) * 6 + index] : [])));
  const dofsMatch = process.dofs.every((dof, index) => dof.nodeId === input.nodes[Math.floor(index / 6)].id && dof.dof === ANALYSIS_DOF_ORDER[index % 6] && dof.globalIndex === index && dof.restrained === restraints.has(index));
  const constrained = process.dofs.filter((dof) => restraints.has(dof.globalIndex)).map((dof) => dof.globalIndex);
  const free = process.dofs.filter((dof) => !restraints.has(dof.globalIndex)).map((dof) => dof.globalIndex);
  const memberIds = new Set(process.members.map((member) => member.memberId));
  const membersMatch = process.members.length === input.members.length && memberIds.size === input.members.length && process.members.every((record) => {
    const member = input.members.find((item) => item.id === record.memberId);
    if (!member) return false;
    const indices = [member.startNodeId, member.endNodeId].flatMap((id) => ANALYSIS_DOF_ORDER.map((_, index) => input.nodes.findIndex((node) => node.id === id) * 6 + index));
    const coefficients = expected.members.find((item) => item.memberId === record.memberId)!;
    return indices.every((index, position) => record.globalDofIndices[position] === index && JSON.stringify(record.dofs[position]) === JSON.stringify(process.dofs[index])) && numbersMatch(record.globalStiffness.flat(), coefficients.globalStiffness.flat()) && numbersMatch(record.equivalentGlobalForces, coefficients.equivalentGlobalForces);
  });
  const matrixMatches = (matrix: number[][] | null, indices: number[]): boolean => {
    if (!matrix) return true; // Missing matrices remain missing; validation does not fill them.
    const positions = new Map(indices.map((index, position) => [index, position]));
    const assembled = indices.map(() => indices.map(() => 0));
    for (const member of expected.members) for (let row = 0; row < 12; row += 1) {
      const targetRow = positions.get(member.globalDofIndices[row]);
      if (targetRow === undefined) continue;
      for (let column = 0; column < 12; column += 1) {
        const targetColumn = positions.get(member.globalDofIndices[column]);
        if (targetColumn !== undefined) assembled[targetRow][targetColumn] += member.globalStiffness[row][column];
      }
    }
    return numbersMatch(matrix.flat(), assembled.flat());
  };
  if (!dofsMatch || !membersMatch || constrained.join(",") !== process.constrainedDofs.join(",") || free.join(",") !== process.freeDofs.join(",") || !sameInputValue(process.solver, input.solver) || !numbersMatch(process.loadVector, expected.loadVector) || !matrixMatches(process.assembledStiffness, expected.dofs.map((dof) => dof.globalIndex)) || !matrixMatches(process.reducedStiffness, expected.freeDofs)) throw new Error("过程快照的对象、编号、约束、求解配置或矩阵荷载数值与冻结输入不可对应");
}

/** Reads only the report's validated source; never silently solves a missing record. */
export function captureReportAppendix(result: AnalysisResult, selection: ReportAppendixSelection): ReportAppendix | undefined {
  const steps = [...new Set(selection.steps)]; const memberIds = [...new Set(selection.memberIds)];
  if (steps.some((step) => !Object.hasOwn(REPORT_APPENDIX_STEPS, step))) throw new Error("附录包含未知计算步骤");
  if (memberIds.some((id) => !result.input.members.some((member) => member.id === id))) throw new Error("附录杆件不属于所选分析的冻结输入");
  if (!steps.length) return undefined;
  const appendix: ReportAppendix = { selection: { steps, memberIds }, members: [], overall: null, missing: [], basis: structuredClone(ANALYSIS_PROCESS_BASIS) };
  if ((steps.includes("member-process") || steps.includes("assembly")) && !memberIds.length) appendix.missing.push("未选择杆件，杆件过程与组装贡献不包含对象记录。");
  if (steps.includes("member-process")) for (const id of memberIds) {
    try { appendix.members.push(getMemberAnalysisRecord(result, id)); }
    catch (error) { appendix.missing.push(`${result.input.members.find((member) => member.id === id)!.label} 杆件过程缺少记录：${error instanceof Error ? error.message : "无法重建"}`); }
  }
  if (steps.some((step) => step !== "member-process")) {
    if (!result.process) appendix.missing.push("所选分析未采集整体过程快照，整体步骤缺少记录。可基于冻结输入补算过程。");
    else {
      try { requireProcessCorrespondence(result); appendix.overall = getOverallAnalysisProcessRecord(result); }
      catch (error) { appendix.missing.push(`整体过程缺少记录：${error instanceof Error ? error.message : "无法读取"}`); }
    }
  }
  const overall = appendix.overall;
  if (overall) {
    if (steps.includes("assembled-stiffness") && !overall.assembledStiffness) appendix.missing.push(`整体刚度矩阵 K 未采集（${overall.dofs.length} 阶；采集上限 ${overall.matrixLimit} 阶），不展开或虚构矩阵。`);
    if (steps.includes("reduced-stiffness") && !overall.reducedStiffness) appendix.missing.push(`约束后刚度矩阵 Kff 未采集（${overall.freeDofs.length} 阶；采集上限 ${overall.matrixLimit} 阶），不展开或虚构矩阵。`);
  }
  return appendix;
}

export function freezeReportData<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeReportData);
    Object.freeze(value);
  }
  return value;
}
