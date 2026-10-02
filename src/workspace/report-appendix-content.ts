import { reportNumber as n, reportSourceLabel, type EngineeringReport } from "../domain/engineering-report";
import { REPORT_APPENDIX_STEPS } from "../domain/report-appendix";
import { heading, paragraph, table, tableCaption, type ReportBlock } from "./report-content-blocks";

type Content = ReportBlock[];
function matrixTables(title: string, matrix: number[][], indices: number[]): Content {
  if (!indices.length) return [tableCaption(`${title} · 0 × 0`), paragraph("无自由自由度，不存在待求解的自由子系统矩阵条目。")];
  const content: Content = [];
  // At most six numeric columns per page-width table; no values are omitted.
  for (let offset = 0; offset < indices.length; offset += 6) {
    const columns = indices.slice(offset, offset + 6);
    content.push(tableCaption(`${title} · ${matrix.length} × ${matrix.length} · 列 ${columns[0]}—${columns.at(-1)}`),
      table(["行＼列", ...columns.map(String)], matrix.map((row, index) => [String(indices[index]), ...row.slice(offset, offset + 6).map(n)])));
  }
  return content;
}

export function reportAppendixContent(report: EngineeringReport): Content {
  const appendix = report.appendix;
  if (!appendix) return [];
  const { selection, overall, basis } = appendix;
  const { result } = report; const { input } = result;
  const memberLabel = (id: string) => input.members.find((member) => member.id === id)!.label;
  const nodeLabel = (id: string) => input.nodes.find((node) => node.id === id)!.label;
  const content: Content = [
    heading("附录 A 所选分析的计算过程", true),
    paragraph(`正文来源分析 ${result.id}；输入修订 R${result.projectRevision}；${reportSourceLabel(result)}。`),
    paragraph(`所选步骤：${selection.steps.map((step) => REPORT_APPENDIX_STEPS[step]).join("；")}。所选杆件：${selection.memberIds.map((id) => `${memberLabel(id)} · ${id}`).join("；") || "无"}。`),
    paragraph("杆件过程与组装贡献仅输出所选杆件；整体编号、约束及整体矩阵作用于全部模型。索引从 0 起，单元位置 0—5 为起点、6—11 为终点，顺序 ux、uy、uz、rx、ry、rz。未保存完整消元轨迹。"),
    paragraph("矩阵按最多六个数值列分块，块名和行列索引共同定位原条目。刚度项按行的力/力矩及列的位移/转角取单位：平移行/平移列 kN/m，平移行/转动列 kN/rad，转动行/平移列 kN·m/m，转动行/转动列 kN·m/rad。T 为方向余弦转换，数值无量纲。"),
    ...appendix.missing.map((message) => paragraph(`缺少记录：${message}`)),
  ];
  const origin = (record: { origin: string; analysisId: string; sourceAnalysisId: string }) => paragraph(record.origin === "supplemental-reconstruction"
    ? `补算过程分析 ${record.analysisId}；来源分析 ${record.sourceAnalysisId}。本段为基于冻结输入补算的过程，不冒充原运行记录；正文仍保留原结果。`
    : record.origin === "captured-from-run" ? `本次运行实际快照 · 分析 ${record.analysisId}` : `按冻结输入重建 · 分析 ${record.analysisId}；位移与杆端力来自该分析的已保存结果。`);
  if (selection.steps.includes("member-process")) for (const record of appendix.members) {
    content.push(heading(`杆件过程 ${memberLabel(record.memberId)} · ${record.memberId}`), origin(record),
      paragraph(`求解器 ${record.solver.implementation}；算法 ${record.solver.algorithm}；约束 ${record.solver.constraints}；主元阈值 ${n(record.solver.relativePivotTolerance)}。`),
      paragraph(`杆长 ${n(record.geometry.length)} m；局部轴按全局 XYZ：x (${Object.values(record.geometry.localX).map(n).join(", ")})，y (${Object.values(record.geometry.localY).map(n).join(", ")})，z (${Object.values(record.geometry.localZ).map(n).join(", ")})。`),
      tableCaption("单元自由度映射"), table(["单元位置", "节点 / ID", "自由度", "整体索引"], record.dofs.map((dof, index) => [String(index), `${nodeLabel(dof.nodeId)} / ${dof.nodeId}`, dof.dof, String(dof.globalIndex)])),
      paragraph("u_local = T · u_global；K_global = Tᵀ · K_local · T；f_local = Kl · u_local − F_equivalent_local。"),
      tableCaption("单元位移与等效荷载"), table(["位置 / 自由度", "整体 u (m/rad)", "局部 u (m/rad)", "局部 F (kN/kN·m)", "整体 F (kN/kN·m)"], record.dofs.map((dof, index) => [`${index} / ${dof.dof}`, n(record.globalDisplacement[index]), n(record.localDisplacement[index]), n(record.equivalentLocalForces[index]), n(record.equivalentGlobalForces[index])])),
      tableCaption("局部均布力 xyz (kN/m)"), table(["来源", "qx", "qy", "qz"], [["显式荷载", ...Object.values(record.uniformIntensity).map(n)], ["自重", ...Object.values(record.selfWeightIntensity).map(n)], ["合计", ...Object.values(record.totalIntensity).map(n)]]),
      tableCaption("局部端部作用分量"), table(["端点", "N (kN)", "Vy (kN)", "Vz (kN)", "T (kN·m)", "My (kN·m)", "Mz (kN·m)"], [["起点", ...record.localEndForces.start.map(n)], ["终点", ...record.localEndForces.end.map(n)]]),
      ...matrixTables("局部单元刚度 Kl", record.localStiffness, record.dofs.map((_, index) => index)),
      ...matrixTables("坐标转换矩阵 T", record.transformation, record.dofs.map((_, index) => index)),
      ...matrixTables("整体单元刚度 Kg", record.globalStiffness, record.dofs.map((_, index) => index)));
  }
  if (overall) {
    content.push(heading("整体过程来源"), origin(overall), paragraph(`求解器 ${overall.solver.implementation}；${overall.solver.algorithm}；${overall.solver.constraints}；主元阈值 ${n(overall.solver.relativePivotTolerance)}。`));
    if (selection.steps.includes("dof-mapping")) content.push(tableCaption("整体自由度映射表"), table(["整体索引", "节点 / ID", "自由度", "状态"], overall.dofs.map((dof) => [String(dof.globalIndex), `${nodeLabel(dof.nodeId)} / ${dof.nodeId}`, dof.dof, dof.restrained ? "约束" : "自由"])));
    if (selection.steps.includes("assembly")) {
      content.push(heading("所选杆件组装贡献"), paragraph("K = Σ kᵢ；将单元行列对号到整体索引后相加。以下只列所选贡献，不能当作完整 K。"));
      for (const member of overall.members.filter((member) => selection.memberIds.includes(member.memberId))) content.push(
        tableCaption(`${memberLabel(member.memberId)} · ${member.memberId} 对号与等效荷载`),
        table(["单元位置", "节点 / 自由度", "整体索引", "等效 F (kN/kN·m)"], member.dofs.map((dof, index) => [String(index), `${dof.nodeId}.${dof.dof}`, String(member.globalDofIndices[index]), n(member.equivalentGlobalForces[index])])),
        ...matrixTables(`${memberLabel(member.memberId)} 单元整体刚度贡献`, member.globalStiffness, member.globalDofIndices));
    }
    if (selection.steps.includes("constraints")) content.push(heading("约束处理与整体荷载"),
      paragraph("K · u = F；零位移约束 u_c = 0；消去约束行列得到 Kff · uf = Ff；R = K · u − F。"),
      paragraph(`约束索引 [${overall.constrainedDofs.join(", ")}]；自由索引 [${overall.freeDofs.join(", ")}]。`),
      table(["整体索引", "节点 / 自由度", "状态", "F (kN/kN·m)", "Ff 位置"], overall.dofs.map((dof) => [String(dof.globalIndex), `${dof.nodeId}.${dof.dof}`, dof.restrained ? "约束 / u=0" : "自由", n(overall.loadVector[dof.globalIndex]), dof.restrained ? "已消去" : String(overall.freeDofs.indexOf(dof.globalIndex))])));
    if (selection.steps.includes("assembled-stiffness") && overall.assembledStiffness) content.push(...matrixTables("整体刚度矩阵 K", overall.assembledStiffness, overall.dofs.map((dof) => dof.globalIndex)));
    if (selection.steps.includes("reduced-stiffness") && overall.reducedStiffness) content.push(...matrixTables("约束后刚度矩阵 Kff", overall.reducedStiffness, overall.freeDofs));
  }
  content.push(heading("教材依据与实现约定"), paragraph(`《${basis.title}》（${basis.authors}，${basis.publisher}，${basis.year}）扫描版。印刷页与 PDF 页序分别记录，沿用 T17/T18 的核查依据。`),
    table(["章节 / 主题", "核查关系", "印刷页", "PDF 页序"], basis.references.map((reference) => [`${reference.section} / ${reference.topic}`, reference.formula, String(reference.printedPage), reference.pdfPage === null ? "未记录" : String(reference.pdfPage)])),
    ...basis.differences.flatMap((difference) => [tableCaption(difference.topic), paragraph(`实现：${difference.implementation} 教材：${difference.textbook} 原因：${difference.reason} 验证：${difference.validation}`)]));
  return content;
}
