import type { AnalysisResult } from "../domain/analysis";
import { reportNumber as n, type EngineeringReport } from "../domain/engineering-report";
import { resultMeaning } from "../domain/result-inspection";
import { unitPresentation } from "../domain/units";
import { heading, image, paragraph, table, tableCaption, type ReportBlock } from "./report-content-blocks";

export function stabilityReportTheory(result: AnalysisResult): ReportBlock[] {
  const equation = result.modal ? "K φ = ω² M φ；f = ω / (2π)；φᵀ M φ = 1。一致 Euler–Bernoulli 质量矩阵包含扭转惯性。"
    : result.buckling ? "(K + Gfixed + λ Greference) φ = 0；固定预荷载不变，λ 只乘参考荷载。几何刚度来自轴力 Hermite 插值与固定方向荷载。"
      : result.secondOrder ? "(K + α G[Nlinear]) u = α F；同条件线性轴力构造几何刚度，分步加载并记录校正残差与增量。"
        : "整体方程 K · u = F；约束处理消除受限自由度，求解 Kff · uf = Ff；反力 R = K · u − F。";
  return [paragraph(equation + " 局部转换 ul = T · ug，Kg = Tᵀ · Kl · T；G = E / [2(1 + ν)]。"),
    paragraph(result.modal || result.buckling || result.secondOrder ? resultMeaning(result) : "分析不包含几何非线性、材料非线性、屈曲、动力响应、截面强度或规范符合性验算。用户定义组合系数为输入值。"),
    paragraph("本报告记录分析结果，不给出结构安全、极限承载力或规范合格结论。")];
}

export function stabilityReportSummary(report: EngineeringReport, figures: Record<string, string>): ReportBlock[] {
  const { result } = report, { input } = result;
  const u = unitPresentation(report.displayUnitPreset);
  const blocks: ReportBlock[] = [];
  const modal = result.modal, buckling = result.buckling, second = result.secondOrder;
  if (!modal && !buckling && !second) return blocks;
  blocks.push(heading("分析方法对应的输入与结果摘要"));
  if (second) {
    const settings = input.analysisCase!.settings.secondOrder!;
    const selected = second.runs.find((r) => r.divisions === second.selectedDivisions)!;
    const iterations = selected.calculation.iterations;
    const last = iterations.at(-1)!;
    blocks.push(paragraph(`二阶状态 ${second.status}；选定每杆 ${second.selectedDivisions} 单元；加载步数 ${settings.loadSteps}；每步最多 ${settings.maxIterations} 次校正；残差容差 ${n(settings.residualTolerance)}；增量容差 ${n(settings.incrementTolerance)}；网格容差 ${n(settings.meshTolerance)}。`),
      paragraph(`实际校正记录 ${iterations.length} 条；最终加载因子 ${n(last.factor)}；最终残差 ${n(last.residual)}；最终增量 ${n(last.increment)}。`),
      table(["每杆单元", "位移误差比", "反力误差比", "内力误差比"], second.runs.map((r) => [String(r.divisions), ...(["displacement", "reaction", "sectionForce"] as const).map((k) => r.error ? n(r.error[k]) : "基线")])),
      paragraph(`同次运行线性基准 ${selected.calculation.linearRun.id}；基准为实际内部细分输入，不是当前编辑模型。`),
      table(["工程节点与 ID", "分量", `线性位移 (${u.unit("m")})`, `二阶位移 (${u.unit("m")})`], result.nodes.flatMap((node) => {
        const baseline = selected.calculation.linearRun.nodes.find((v) => v.nodeId === node.nodeId)!;
        return (["x", "y", "z"] as const).map((axis) => [`${input.nodes.find((v) => v.id === node.nodeId)!.label} / ${node.nodeId}`, axis, u.number(baseline.displacement[axis], "m", 7), u.number(node.displacement[axis], "m", 7)]);
      })));
  }
  const eigen = modal ?? buckling;
  if (!eigen) return blocks;
  const settings = modal ? input.analysisCase!.settings.modal! : input.analysisCase!.settings.buckling!;
  blocks.push(paragraph(`请求阶数 ${settings.modeCount}；每杆单元预算 ${settings.maxDivisions}；方程预算 ${settings.maxEquations}；${modal ? "频率" : "因子"}容差 ${n("frequencyTolerance" in settings ? settings.frequencyTolerance : settings.factorTolerance)}。`),
    paragraph(`收敛状态 ${eigen.convergence.status}；停止原因 ${eigen.convergence.reason}；选定每杆 ${eigen.selectedDivisions} 单元。工程节点／杆件 ${eigen.counts.engineeringNodes}/${eigen.counts.engineeringMembers}；计算节点／单元 ${eigen.counts.calculationNodes}/${eigen.counts.calculationElements}；方程 ${eigen.counts.equations}；释放坐标 ${eigen.counts.releaseCoordinates}。`));
  if (eigen.convergence.status !== "converged") blocks.push(paragraph("预算内未满足收敛要求，结果未收敛，仅供核查。"));
  if (modal) {
    blocks.push(heading("质量来源"),
      paragraph(`总质量 ${u.quantity(modal.totalMassKg, "kg", 7)}；结构质量 ${u.quantity(modal.structuralMassKg ?? modal.sources.reduce((s, v) => s + v.massKg, 0), "kg", 7)}；附加质量 ${u.quantity(modal.additionalMassKg ?? 0, "kg", 7)}。质量与静力自重分开，质量不自动作为荷载；附加质量只含各向同性平移惯性。`),
      table(["工程杆件 ID", "材料 / 截面 ID", `ρ (${u.unit("kg/m³")})`, `L (${u.unit("m")})`, `质量 (${u.unit("kg")})`], modal.sources.map((s) => [s.memberId, `${s.materialId} / ${s.sectionId}`, u.number(s.densityKgM3, "kg/m³", 7), u.number(s.lengthM, "m", 7), u.number(s.massKg, "kg", 7)])),
      table(["附加来源 / 对象 ID", `线质量 (${u.unit("kg/m")})`, `质量 (${u.unit("kg")})`], (modal.additionalSources ?? []).map((s) => [s.kind === "point" ? `点质量 / ${s.nodeId}` : `线质量 / ${s.memberId}`, s.kind === "line" ? u.number(s.massPerLengthKgM, "kg/m", 7) : "不适用", u.number(s.massKg, "kg", 7)])),
      paragraph(`单位广义质量归一化 φᵀ M φ = 1；质量矩阵内部单位 ${modal.massUnit}，转动坐标对应混合单位。正交误差 ${n(modal.orthogonalityError)}；零能模态 ${modal.zeroEnergyModes}；零特征值阈值 ${n(modal.zeroEigenvalueTolerance)}。`),
      table(["阶次", "频率 (Hz)", "ω² (s⁻²)", "类型", "残差", "广义质量"], modal.modes.map((m) => [String(m.number), n(m.frequencyHz), n(m.eigenvalue), m.kind, n(m.residual), n(m.massNorm)])),
      table(["每杆单元", "方程", "频率 (Hz)", "误差比"], modal.convergence.runs.map((r) => [String(r.divisions), String(r.equations), r.frequenciesHz.map(n).join(", "), r.error === undefined ? "基线 / 阶数不足" : n(r.error)])));
  } else if (buckling) blocks.push(paragraph("屈曲形态按计算向量欧氏范数归一化，不是真实位移。固定和参考预应力分别保存；只报告正屈曲因子。"),
    table(["阶次", "屈曲因子 λ (无量纲)", "残差"], buckling.modes.map((m) => [String(m.number), n(m.factor), n(m.residual)])),
    table(["每杆单元", "方程", "屈曲因子", "误差比"], buckling.convergence.runs.map((r) => [String(r.divisions), String(r.equations), r.factors.map(n).join(", "), r.error === undefined ? "基线 / 阶数不足" : n(r.error)])));
  if (eigen.eigenproblem.releaseNullRotations.length) blocks.push(paragraph("存在完全脱开转动方向，节点相关转角是坐标参考值，不能解释为物理振型转角。"),
    table(["工程节点 ID", "脱开方向 XYZ", "参考自由度"], eigen.eigenproblem.releaseNullRotations.map((v) => [v.nodeId, Object.values(v.direction).map(n).join(", "), String(v.gaugeDof)])));
  blocks.push(heading("6 特征形态摘要"), paragraph("形态图采用原记录沿杆样本，虚线为冻结分析线。每阶单独缩放至模型跨度的 12%，幅值、单位换算和正负号不代表受载实际位移；频率和因子属于整阶，不属于单根杆件。完整分量与样本可选入附录。"));
  for (const mode of eigen.modes) {
    blocks.push(tableCaption(`${modal ? "振型" : "屈曲形态"} 第 ${mode.number} 阶`), image(figures[`shape-${mode.number}`], `第 ${mode.number} 阶归一化形态`, 300));
  }
  return blocks;
}
