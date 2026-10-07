import { unitPresentation } from "../domain/units";
import { reportNumber as n, reportSourceLabel, type EngineeringReport } from "../domain/engineering-report";
import { REPORT_APPENDIX_STEPS } from "../domain/report-appendix";
import { heading, paragraph, table, tableCaption, type ReportBlock } from "./report-content-blocks";
import { stabilityReportAppendix } from "./stability-report-appendix";
import { reportMatrixTables } from "./report-matrix-content";

type Content = ReportBlock[];

export function reportAppendixContent(report: EngineeringReport): Content {
  if (report.appendix?.recorded) return stabilityReportAppendix(report);
  const u = unitPresentation(report.displayUnitPreset);
  const mixed = (v: number, i: number, force = false) => u.number(v, force ? i % 6 < 3 ? "kN" : "kN·m" : i % 6 < 3 ? "m" : "rad", 7);
  const matrixTables = (title: string, matrix: number[][], indices: number[]) => {
    const converted = title.includes("矩阵 T") ? matrix : matrix.map((row, i) => row.map((v, j) => u.stiffness(v, indices[i], indices[j])));
    return reportMatrixTables(title, converted, indices);
  };
  const appendix = report.appendix;
  if (!appendix) return [];
  const { selection, overall, basis } = appendix;
  const { result } = report; const { input } = result;
  const mappings = input.meshPlan?.levels.find((l) => l.divisions === result.discretization?.selectedDivisions);
  const originalId = (id: string) => mappings?.elements.find((e) => e.elementId === id)?.memberId ?? id;
  const memberLabel = (id: string) => input.members.find((member) => member.id === originalId(id))?.label ?? id;
  const nodeLabel = (id: string) => input.nodes.find((node) => node.id === id)?.label ?? `内部节点 ${id}`;
  const content: Content = [
    heading("附录 A 所选分析的计算过程", true),
    paragraph(`正文来源分析 ${result.id}；输入修订 R${result.projectRevision}；${reportSourceLabel(result)}。`),
    paragraph(`所选步骤：${selection.steps.map((step) => REPORT_APPENDIX_STEPS[step]).join("；")}。所选杆件：${selection.memberIds.map((id) => `${memberLabel(id)} · ${id}`).join("；") || "无"}。`),
    paragraph("杆件过程与组装贡献仅输出所选杆件；整体编号、约束及整体矩阵作用于全部模型。索引从 0 起，单元位置 0—5 为起点、6—11 为终点，顺序 ux、uy、uz、rx、ry、rz。未保存完整消元轨迹。"),
    paragraph(`矩阵按最多六个数值列分块，块名和行列索引共同定位原条目。刚度项按行的力/力矩及列的位移/转角取单位：${u.unit("kN")}/${u.unit("m")}，${u.unit("kN")}/${u.unit("rad")}，${u.unit("kN·m")}/${u.unit("m")}，${u.unit("kN·m")}/${u.unit("rad")}。T 为方向余弦转换，数值无量纲。`),
    ...appendix.missing.map((message) => paragraph(`缺少记录：${message}`)),
  ];
  const origin = (record: { origin: string; analysisId: string; sourceAnalysisId: string }) => paragraph(record.origin === "supplemental-reconstruction"
    ? `补算过程分析 ${record.analysisId}；来源分析 ${record.sourceAnalysisId}。本段为基于冻结输入补算的过程，不冒充原运行记录；正文仍保留原结果。`
    : record.origin === "captured-from-run" ? `本次运行实际快照 · 分析 ${record.analysisId}` : `按冻结输入重建 · 分析 ${record.analysisId}；位移与杆端力来自该分析的已保存结果。`);
  if (selection.steps.includes("member-process")) for (const record of appendix.members) {
    content.push(heading(`杆件过程 ${memberLabel(record.memberId)} · ${record.memberId}`), origin(record),
      paragraph(`求解器 ${record.solver.implementation}；算法 ${record.solver.algorithm}；约束 ${record.solver.constraints}；主元阈值 ${n(record.solver.relativePivotTolerance)}。`),
      paragraph(`杆长 ${u.quantity(record.geometry.length, "m", 7)}；局部轴按全局 XYZ：x (${Object.values(record.geometry.localX).map(n).join(", ")})，y (${Object.values(record.geometry.localY).map(n).join(", ")})，z (${Object.values(record.geometry.localZ).map(n).join(", ")})。`),
      tableCaption("单元自由度映射"), table(["单元位置", "节点 / ID", "自由度", "整体索引"], record.dofs.map((dof, index) => [String(index), `${nodeLabel(dof.nodeId)} / ${dof.nodeId}`, dof.dof, String(dof.globalIndex)])),
      paragraph(record.releaseRecovery ? "u_beam = H T u_node + Krr^-1 fr; K_condensed = H^T K_original H; f_condensed = H^T f_original. 梁端转角由释放恢复计算，与节点支座转角独立。" : "u_local = T u_global; K_global = T^T K_local T; f_local = K_local u_local - F_local."),
      tableCaption("单元位移与等效荷载"), table(["位置 / 自由度", `整体 u (${u.unit("m")}/${u.unit("rad")})`, `局部 u (${u.unit("m")}/${u.unit("rad")})`, `局部 F (${u.unit("kN")}/${u.unit("kN·m")})`, `整体 F (${u.unit("kN")}/${u.unit("kN·m")})`], record.dofs.map((dof, index) => [`${index} / ${dof.dof}`, mixed(record.globalDisplacement[index], index), mixed(record.localDisplacement[index], index), mixed(record.equivalentLocalForces[index], index, true), mixed(record.equivalentGlobalForces[index], index, true)])),
      tableCaption(`局部均布力 xyz (${u.unit("kN/m")})`), table(["来源", "qx", "qy", "qz"], [["显式荷载", ...Object.values(record.uniformIntensity).map((v) => u.number(v, "kN/m", 7))], ["自重", ...Object.values(record.selfWeightIntensity).map((v) => u.number(v, "kN/m", 7))], ["合计", ...Object.values(record.totalIntensity).map((v) => u.number(v, "kN/m", 7))]]),
      tableCaption("局部端部作用分量"), table(["端点", `N (${u.unit("kN")})`, `Vy (${u.unit("kN")})`, `Vz (${u.unit("kN")})`, `T (${u.unit("kN·m")})`, `My (${u.unit("kN·m")})`, `Mz (${u.unit("kN·m")})`], [["起点", ...record.localEndForces.start.map((v, i) => mixed(v, i, true))], ["终点", ...record.localEndForces.end.map((v, i) => mixed(v, i, true))]]),
      ...(record.releaseRecovery ? matrixTables("释放前原始刚度 K_original", record.releaseRecovery.originalLocalStiffness, record.dofs.map((_, index) => index)) : []),
      ...matrixTables("局部单元刚度 Kl", record.localStiffness, record.dofs.map((_, index) => index)),
      ...matrixTables("坐标转换矩阵 T", record.transformation, record.dofs.map((_, index) => index)),
      ...matrixTables("整体单元刚度 Kg", record.globalStiffness, record.dofs.map((_, index) => index)));
  }
  if (overall) {
    content.push(heading("整体过程来源"), origin(overall), paragraph(`求解器 ${overall.solver.implementation}；${overall.solver.algorithm}；${overall.solver.constraints}；主元阈值 ${n(overall.solver.relativePivotTolerance)}。`));
    if (overall.releaseGaugeDofs?.length) content.push(paragraph(`完全脱开转动的参考索引 [${overall.releaseGaugeDofs.join(", ")}]；节点该方向转角不可确定，取参考值 0，不是额外支座。梁端转角见实际杆件恢复记录。`));
    if (selection.steps.includes("dof-mapping")) content.push(tableCaption("整体自由度映射表"), table(["整体索引", "节点 / ID", "自由度", "状态"], overall.dofs.map((dof) => [String(dof.globalIndex), `${nodeLabel(dof.nodeId)} / ${dof.nodeId}`, dof.dof, dof.restrained ? "约束" : overall.releaseGaugeDofs?.includes(dof.globalIndex) ? "脱开转动" : "自由"])));
    if (selection.steps.includes("assembly")) {
      content.push(heading("所选杆件组装贡献"), paragraph("K = Σ kᵢ；将单元行列对号到整体索引后相加。以下只列所选贡献，不能当作完整 K。"));
      for (const member of overall.members.filter((member) => selection.memberIds.includes(originalId(member.memberId)))) content.push(
        tableCaption(`${memberLabel(member.memberId)} · ${member.memberId} 对号与等效荷载`),
        table(["单元位置", "节点 / 自由度", "整体索引", `等效 F (${u.unit("kN")}/${u.unit("kN·m")})`], member.dofs.map((dof, index) => [String(index), `${dof.nodeId}.${dof.dof}`, String(member.globalDofIndices[index]), mixed(member.equivalentGlobalForces[index], index, true)])),
        ...matrixTables(`${memberLabel(member.memberId)} 单元整体刚度贡献`, member.globalStiffness, member.globalDofIndices));
    }
    if (selection.steps.includes("constraints")) content.push(heading("约束处理与整体荷载"),
      paragraph("K · u = F；零位移约束 u_c = 0；消去约束行列得到 Kff · uf = Ff；R = K · u − F。"),
      paragraph(`约束索引 [${overall.constrainedDofs.join(", ")}]；自由索引 [${overall.freeDofs.join(", ")}]。`),
      table(["整体索引", "节点 / 自由度", "状态", `F (${u.unit("kN")}/${u.unit("kN·m")})`, "Ff 位置"], overall.dofs.map((dof) => [String(dof.globalIndex), `${dof.nodeId}.${dof.dof}`, dof.restrained ? "约束 / u=0" : overall.releaseGaugeDofs?.includes(dof.globalIndex) ? "脱开转动 / 参考值 0" : "自由", mixed(overall.loadVector[dof.globalIndex], dof.globalIndex, true), dof.restrained || overall.releaseGaugeDofs?.includes(dof.globalIndex) ? "已消去" : String(overall.freeDofs.indexOf(dof.globalIndex))])));
    if (selection.steps.includes("assembled-stiffness") && overall.assembledStiffness) content.push(...matrixTables("整体刚度矩阵 K", overall.assembledStiffness, overall.dofs.map((dof) => dof.globalIndex)));
    if (selection.steps.includes("reduced-stiffness") && overall.reducedStiffness) content.push(...matrixTables("约束后刚度矩阵 Kff", overall.reducedStiffness, overall.freeDofs));
  }
  content.push(heading("教材依据与实现约定"), paragraph(`《${basis.title}》（${basis.authors}，${basis.publisher}，${basis.year}）扫描版。印刷页与 PDF 页序分别记录，沿用 T17/T18 的核查依据。`),
    table(["章节 / 主题", "核查关系", "印刷页", "PDF 页序"], basis.references.map((reference) => [`${reference.section} / ${reference.topic}`, reference.formula, String(reference.printedPage), reference.pdfPage === null ? "未记录" : String(reference.pdfPage)])),
    ...basis.differences.flatMap((difference) => [tableCaption(difference.topic), paragraph(`实现：${difference.implementation} 教材：${difference.textbook} 原因：${difference.reason} 验证：${difference.validation}`)]));
  return content;
}
