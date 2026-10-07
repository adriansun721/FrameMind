import { reportNumber as n, reportSourceLabel, type EngineeringReport } from "../domain/engineering-report";
import { REPORT_APPENDIX_STEPS } from "../domain/report-appendix";
import type { MeshLevel } from "../domain/analysis-mesh";
import { heading, paragraph, table, tableCaption, type ReportBlock } from "./report-content-blocks";
import { reportMatrixTables } from "./report-matrix-content";

function matrixBlocks(label: string, matrix: number[][]): ReportBlock[] {
  return reportMatrixTables(label, matrix, matrix.map((_, i) => i), (matrix[0] ?? []).map((_, i) => i));
}

function valueRows(value: unknown, path = ""): string[][] {
  if (value === null || value === undefined) return [[path, "未记录"]];
  if (typeof value === "object") return Object.entries(value).flatMap(([key, child]) => valueRows(child, path ? `${path}.${key}` : key));
  return [[path, typeof value === "number" ? n(value) : String(value)]];
}

export function stabilityReportAppendix(report: EngineeringReport): ReportBlock[] {
  const { result, appendix } = report;
  if (!appendix?.recorded) return [];
  const blocks: ReportBlock[] = [heading("附录 A 所选分析的实际记录", true),
    paragraph(`原运行分析 ${result.id}；输入修订 R${result.projectRevision}；${reportSourceLabel(result)}。`),
    paragraph(`所选分量：${appendix.selection.steps.map((s) => REPORT_APPENDIX_STEPS[s]).join("；")}。全部记录保持内部规范单位 m、rad、kN、kN·m、kg、s。矩阵与混合自由度向量不套用显示单位转换。`),
    paragraph("只读取已保存记录，未补算或重建。矩阵按最多六列分块，行列索引从零开始并对应计算坐标；内部对象须通过细分映射回到工程杆件与沿杆区间。缺少记录不表示零矩阵。"),
    paragraph("K 和 G 的行按力／力矩、列按位移／转角取单位 kN/m、kN/rad、kN·m/m、kN·m/rad；M 的对应单位为上述单位乘 s²。归一化特征向量与形态系数不作长度或角度单位转换。"),
    ...appendix.missing.map((m) => paragraph(`缺少记录：${m}`))];
  for (const record of appendix.recorded) {
    blocks.push(heading(`${record.section} 原运行记录`), paragraph(`来源分析 ${record.sourceAnalysisId}；来源 ${record.origin}；记录数 ${record.total}；矩阵采集上限 ${record.matrixLimit ?? "不适用"}。`));
    if (!record.available) continue;
    if (record.section === "stiffness" || record.section === "mass" || record.section === "geometric") {
      if (record.section === "geometric" && result.buckling) {
        const eigen = result.buckling.eigenproblem;
        if (eigen.fixedGeometric) blocks.push(...matrixBlocks("Gfixed 固定预荷载", eigen.fixedGeometric));
        else blocks.push(paragraph("缺少记录：Gfixed 未保存。"));
        if (eigen.referenceGeometric) blocks.push(...matrixBlocks("Greference 参考荷载", eigen.referenceGeometric));
        else blocks.push(paragraph("缺少记录：Greference 未保存。"));
      } else blocks.push(...matrixBlocks(record.section === "mass" ? "M" : record.section === "geometric" ? "G[Nlinear]" : "K", record.items as number[][]));
    } else if (record.section === "mesh") {
      blocks.push(table(["计算单元 ID", "工程杆件 ID", "起节点 ID", "终节点 ID", "起位置 (m)", "终位置 (m)"], (record.items as MeshLevel["elements"]).map((e) => [e.elementId, e.memberId, e.startNodeId, e.endNodeId, n(e.start), n(e.end)])));
    } else if (record.section === "coordinates") {
      // The indexed coordinate table below also locates the saved vectors.
    } else if (record.section === "iterations" && result.secondOrder) {
      const calc = result.secondOrder.runs.find((r) => r.divisions === result.secondOrder!.selectedDivisions)!.calculation;
      blocks.push(table(["步", "因子 α", "校正次数", "原残差", "残差", "增量"], calc.iterations.map((r) => [String(r.step), n(r.factor), String(r.iteration), n(r.residualBefore), n(r.residual), n(r.increment)])));
      for (const r of calc.iterations) blocks.push(tableCaption(`步 ${r.step} 校正 ${r.iteration} 实际向量`), table(["坐标索引", "累计 u (m/rad)", "校正 Δu (m/rad)"], r.displacement.map((v, i) => [String(i), n(v), n(r.correction[i])])));
      blocks.push(tableCaption("最终方程向量"), table(["坐标索引", "u (m/rad)", "F (kN/kN·m)"], calc.vector.map((v, i) => [String(i), n(v), n(calc.force[i])])));
    } else blocks.push(table(["实际记录字段", "值 内部规范单位"], valueRows(record.items)));
  }
  const eigen = result.modal ?? result.buckling;
  const second = result.secondOrder?.runs.find((r) => r.divisions === result.secondOrder!.selectedDivisions)?.calculation;
  const explicitCoordinates = appendix.selection.steps.includes("analysis-coordinates");
  const indexedRecords = appendix.recorded.some((r) => r.available && ["stiffness", "mass", "geometric", "iterations"].includes(r.section));
  if (explicitCoordinates || indexedRecords) {
    const coordinates = eigen?.eigenproblem.coordinates ?? second!.coordinates;
    const divisions = eigen?.selectedDivisions ?? result.secondOrder!.selectedDivisions;
    const level = result.input.meshPlan!.levels.find((l) => l.divisions === divisions)!;
    const engineeringObject = (id: string) => {
      const node = result.input.nodes.find((n) => n.id === id);
      if (node) return `${node.label} / ${node.id}`;
      const internal = level.nodes.find((n) => n.nodeId === id);
      if (internal) return `${internal.memberId} @ ${n(internal.position)} m`;
      const element = level.elements.find((e) => e.elementId === id);
      return element ? `${element.memberId} @ ${n(element.start)}—${n(element.end)} m` : id;
    };
    blocks.push(paragraph("坐标顺序为实际消元后顺序，ux/uy/uz 对应 m 与 kN，rx/ry/rz 对应 rad 与 kN·m；释放坐标仍按记录标识解释。"),
      table(["索引", "种类", "实际对象 ID", "工程对象 / 位置", "自由度"], coordinates.map((c, i) => [String(i), c.kind, c.id, engineeringObject(c.id), c.dof])));
    if (!explicitCoordinates) blocks.push(paragraph("已随所选矩阵或校正向量附上坐标映射，保证行列索引可定位原工程对象。"));
    if (eigen && explicitCoordinates) blocks.push(...matrixBlocks("φ 各列对应各阶归一化特征向量", coordinates.map((_, i) => eigen.eigenproblem.vectors.map((v) => v[i]))));
    const nullRotations = eigen?.eigenproblem.releaseNullRotations ?? second?.releaseNullRotations ?? [];
    if (nullRotations.length) blocks.push(table(["节点 ID", "不可确定转动方向 XYZ", "参考自由度"], nullRotations.map((r) => [r.nodeId, Object.values(r.direction).map(n).join(", "), String(r.gaugeDof)])));
  }
  if (appendix.selection.steps.includes("analysis-prestress") && result.buckling) blocks.push(heading("固定与参考预应力 轴力拉正压负"),
    table(["工程杆件 / 计算单元", "沿杆区间 (m)", "固定起点 (kN)", "固定终点 (kN)", "参考起点 (kN)", "参考终点 (kN)"], result.buckling.prestress.map((p) => [`${p.memberId} / ${p.elementId}`, `${n(p.start)}—${n(p.end)}`, n(p.fixedAxialStartKN), n(p.fixedAxialEndKN), n(p.referenceAxialStartKN), n(p.referenceAxialEndKN)])));
  if (appendix.selection.steps.includes("analysis-shapes") && eigen) for (const mode of eigen.modes) {
    blocks.push(heading(`第 ${mode.number} 阶完整归一化形态`), paragraph("以下为原记录归一化系数，不是物理位移；节点全局 XYZ，沿杆位置为 m。脱开方向的节点转角是坐标参考值。"),
      table(["工程节点 ID", "φx", "φy", "φz", "φrx", "φry", "φrz"], mode.nodes.map((v) => [v.nodeId, ...Object.values(v.translation).map(n), ...Object.values(v.rotation).map(n)])),
      table(["工程杆件 ID", "位置 (m)", "φx", "φy", "φz"], mode.members.flatMap((m) => m.samples.map((s) => [m.memberId, n(s.position), ...Object.values(s.translation).map(n)]))));
  }
  return blocks;
}
