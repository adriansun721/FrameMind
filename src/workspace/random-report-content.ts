import { reportNumber as n, type EngineeringReport } from "../domain/engineering-report";
import { randomSources, randomSpectra } from "../domain/random-response";
import { unitPresentation } from "../domain/units";
import { readRecordedProcess } from "../domain/result-inspection";
import { createRandomPsdFigure } from "./report-figures";
import { heading, image, paragraph, table, tableCaption, type ReportBlock } from "./report-content-blocks";

export const RANDOM_REPORT_SUMMARY_POINTS = 32;
function recordedRows(value: unknown, path = ""): string[][] {
  if (value === null || value === undefined) return [[path, "未记录"]];
  if (typeof value === "object") return Object.entries(value).flatMap(([key, child]) => recordedRows(child, path ? `${path}.${key}` : key));
  return [[path, typeof value === "number" ? n(value) : String(value)]];
}
/** A prefix and suffix, never an interpolated or resampled substitute for the saved table. */
export function randomReportPointIndexes(total: number, full = false): number[] {
  if (full || total <= RANDOM_REPORT_SUMMARY_POINTS) return Array.from({ length: total }, (_, i) => i);
  return [...Array.from({ length: 16 }, (_, i) => i), ...Array.from({ length: 16 }, (_, i) => total - 16 + i)];
}

export function randomReportTheory(): ReportBlock[] {
  return [paragraph("模态叠加频响 H(f)，ω = 2πf；单源 Sresponse = |H|² Sinput，同源空间作用先在复频响中相加；异源独立，响应自谱相加。RMS = √∫ Sresponse(f) df，采用保存频点的梯形积分。"),
    paragraph("整体一致平动基底以 −M r a 输入，输出为相对基底的平移响应；外力输出为固定全局参考的平移响应。仅支持所选工程节点的一个全局平移分量，不包含绝对加速度、转角、内力或峰值。"),
    paragraph("零均值平稳随机响应，RMS 是统计均方根。本报告不推导峰值、安全或规范合格结论。")];
}

export function randomReportContent(report: EngineeringReport): ReportBlock[] {
  const { result } = report, record = result.random!, basis = result.input.randomBasis!;
  const settings = result.input.analysisCase!.settings.random!, modal = basis.modal.modal!;
  const u = unitPresentation(report.displayUnitPreset);
  const full = Boolean(report.appendix?.selection.steps.includes("random-tables"));
  const frame = record.referenceFrame === "relative-to-base" ? "相对基底" : "固定全局参考";
  const scalarSettings = Object.entries(settings).filter(([, v]) => typeof v !== "object");
  const blocks: ReportBlock[] = [heading("5 随机激励与复现设置"),
    paragraph("所有作用方向按全局 XYZ。同源共享一个随机过程，空间作用系数含符号；不同源相互独立，不含互谱或任意相关性。输入为单边 Hz 谱，线性插值，有效频段外为零。"),
    table(["源 ID / 输入谱 ID", "激励类型 / 工程对象 ID", "全局方向 XYZ", "有符号系数 / 单位"], randomSources(settings).flatMap((s) => s.actions.map((a) => [
      `${s.sourceId} / ${s.psdSpectrumId}`,
      a.kind === "node" ? `节点力 / ${a.nodeId}` : a.kind === "member-uniform" ? `整杆均布力 / ${a.memberId}` : "整体一致平动基底 / 所有适用支承",
      [a.direction.x, a.direction.y, a.direction.z].map(n).join(", "),
      a.kind === "member-uniform" ? u.quantity(a.scalePerM, "1/m", 7) : `${n(a.scale)} / 无量纲`,
    ]))),
    paragraph(`完整频段 ${settings.bandHz.map(n).join(" — ")} Hz；初始频点 ${settings.frequencyPoints}；最终频点 ${record.points.length}；频点预算 ${settings.maxFrequencyPoints}；最大加密 ${settings.maxRefinements}；积分 trapezoidal（梯形）；响应 PSD 绝对容差 ${u.quantity(settings.absolutePsdTolerance, "m²/Hz", 7)}；方差绝对容差 ${u.number(settings.absoluteVarianceTolerance, "m²", 7)} ${u.unit("m²")}；RMS 绝对容差 ${u.quantity(settings.absoluteRmsTolerance, "m", 7)}。`),
    table(["冻结设置字段", "值（内部规范单位 m、Hz、m²/Hz；方差 m²）"], scalarSettings.map(([k, v]) => [k, String(v)])),
    heading("冻结模态基础、质量与阻尼"),
    paragraph(`模态分析 ${basis.modal.id}；输入修订 R${basis.modal.projectRevision}；模态时间 ${basis.modal.createdAt}；求解器 ${basis.modal.input.solver?.implementation}；实际采用 ${record.modeCount} 阶；模态网格 ${modal.selectedDivisions} 单元/杆；网格收敛 ${modal.convergence.status}。`),
    paragraph(`结构质量 ${u.quantity(modal.structuralMassKg ?? modal.sources.reduce((s, v) => s + v.massKg, 0), "kg", 7)}；附加质量 ${u.quantity(modal.additionalMassKg ?? 0, "kg", 7)}；总质量 ${u.quantity(modal.totalMassKg, "kg", 7)}。质量不重复作为静力自重输入。振型按单位广义质量归一化，幅值不是确定性位移。`),
    table(["工程杆件 ID", "材料 / 截面 ID", `ρ (${u.unit("kg/m³")})`, `质量 (${u.unit("kg")})`], modal.sources.map((s) => [s.memberId, `${s.materialId} / ${s.sectionId}`, u.number(s.densityKgM3, "kg/m³", 7), u.number(s.massKg, "kg", 7)])),
    table(["附加质量来源", "工程对象 ID", `质量 (${u.unit("kg")})`, `线质量 (${u.unit("kg/m")})`], (modal.additionalSources ?? []).map((s) => [s.kind, s.kind === "point" ? s.nodeId : s.memberId, u.number(s.massKg, "kg", 7), s.kind === "line" ? u.number(s.massPerLengthKgM, "kg/m", 7) : "不适用"])),
    table(["模态设置字段", "内部规范值"], Object.entries(basis.modal.input.analysisCase!.settings.modal!).map(([k, v]) => [k, String(v)])),
    paragraph(`阻尼绑定 ${basis.damping.analysisId}；${basis.damping.createdAt}；统一阻尼比 ${n(basis.damping.uniform.ratio)}；来源 ${basis.damping.uniform.source}；依据 ${basis.damping.uniform.basis}。覆盖频率 ${n(basis.damping.truncation.upperFrequencyHz)} Hz；增阶步长 ${basis.damping.truncation.modeIncrement}；模态预算 ${basis.damping.truncation.maxModeCount}。`),
    table(["阶次 / 是否采用", "频率 (Hz)", "阻尼比 / 覆盖", "来源 / 依据"], modal.modes.map((m) => {
      const override = basis.damping.overrides.find((o) => o.modeNumber === m.number), d = override?.value ?? basis.damping.uniform;
      return [`${m.number} / ${m.number <= record.modeCount ? "采用" : "未采用"}`, n(m.frequencyHz), `${n(d.ratio)} / ${override ? "逐模态" : "统一"}`, `${d.source} / ${d.basis}`];
    })),
    heading("6 响应 PSD、RMS 与收敛"),
    paragraph(`工程节点 ${result.input.nodes.find((v) => v.id === record.response.nodeId)!.label} / ${record.response.nodeId}；平移分量 ${record.response.component.toUpperCase()}；坐标系 ${record.coordinateSystem}；参考系 ${frame}；单边 PSD，Hz。`),
    table(["RMS 统计均方根", "方差", "PSD 单位", "参考系"], [[u.quantity(record.rms, "m", 7), `${u.number(record.variance, "m²", 7)} ${u.unit("m²")}`, u.unit("m²/Hz"), frame]]),
    image(createRandomPsdFigure(report), "所选节点平移分量响应 PSD，所有保存频点", 300),
    paragraph(`PSD 图使用全部 ${record.points.length} 个保存频点，无抽样或重新求解。RMS 使用整个保存频段，不以正文截取表积分。`),
    table(["频点数", `方差 (${u.unit("m²")})`, `RMS (${u.unit("m")})`, "PSD / 方差 / RMS 误差比"], record.convergence.runs.map((r) => [String(r.points), u.number(r.variance, "m²", 7), u.number(r.rms, "m", 7), [r.curveError, r.varianceError, r.rmsError].map((v) => v === undefined ? "基线" : n(v)).join(" / ")])),
    paragraph(`模态截断 ${record.convergence.modal.status}；对比 ${record.convergence.modal.lowerModeCount} → ${record.convergence.modal.upperModeCount} 阶；PSD 误差比 ${n(record.convergence.modal.curveError)}；RMS 误差比 ${n(record.convergence.modal.rmsError)}；相对容差 ${n(settings.relativeTolerance)}。`),
    heading("7 频点表与完整数据入口"),
    paragraph(`正文数值保留七位有效数字。${full ? "已选择完整频点附录，表内列出全部输入谱和响应频点。" : "正文表最多列 32 点：前 16 与后 16 点，索引从 1 开始；不足 32 点全部列出，中间省略不代表零。可选完整频点附录。"} 工程计算书窗口的“导出随机数据 ZIP”提供 manifest.json、analysis.json（完整冻结输入、模态基础和结果）、response.csv、rms.csv、input-N.csv 与 process.json；CSV 保留完整数值精度及内部／显示单位两列。`),
  ];
  blocks.push(tableCaption(`响应 PSD：${full ? "完整" : "摘要"} ${record.points.length} 点`), table(["原表索引", "频率 (Hz)", `PSD (${u.unit("m²/Hz")})`], randomReportPointIndexes(record.points.length, full).map((i) => [String(i + 1), n(record.points[i].frequencyHz), u.number(record.points[i].density, "m²/Hz", 7)])));
  randomSpectra(basis).forEach(({ sourceId, spectrum: s }, i) => {
    blocks.push(tableCaption(`输入 ${i + 1}：${sourceId} / ${s.id} / ${s.name}`),
      paragraph(`激励 ${s.quantity}；冻结谱单位 ${s.densityUnit}；${s.sidedness}；${s.frequencyUnit}；${s.interpolation} 插值；${s.outsideBand} 频段外；有效频段 ${s.band.map(n).join(" — ")} Hz；总计 ${s.points.length} 点；ZIP input-${i + 1}.csv。`),
      table(["原表索引", "频率 (Hz)", `密度 (${u.unit(s.densityUnit)})`], randomReportPointIndexes(s.points.length, full).map((j) => [String(j + 1), n(s.points[j].frequency), u.number(s.points[j].density, s.densityUnit, 7)])));
  });
  blocks.push(tableCaption("详细原运行记录的可用性与来源"), table(["记录", "来源分析 ID", "可用性 / 条数"], (["stages", "mesh", "coordinates", "stiffness", "mass"] as const).map((section) => {
    const r = readRecordedProcess(result, section, 0, 0);
    return [section, r.sourceAnalysisId, r.available ? `已保存 / ${r.total}` : `缺少记录 / ${r.message}`];
  })));
  blocks.push(paragraph("详细矩阵、坐标、网格和模态形态由数据包中冻结模态基础与 process.json 核查。矩阵行列按 coordinates 从零编号，通过 mesh 定位工程杆件与沿杆位置。K 行为力/力矩、列为位移/转角，单位 kN/m、kN/rad、kN·m/m、kN·m/rad；M 为对应单位乘 s²。矩阵和单位广义质量振型保留内部混合单位，不套用显示长度转换。未保存的矩阵或运行阶段明确记为缺少记录；不会补算、补零或借用当前模型。"));
  if (report.appendix?.recorded?.length) {
    blocks.push(heading("附录 A 原运行设置与阶段", true));
    for (const r of report.appendix.recorded) {
      blocks.push(paragraph(`${r.section}；来源分析 ${r.sourceAnalysisId}；${r.available ? "已记录" : "缺少记录"}；${r.message}`));
      if (r.available) blocks.push(table(["原记录字段", "内部规范值"], recordedRows(r.items)));
    }
  }
  return blocks;
}
