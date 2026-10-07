import { reportNumber as n } from "../domain/engineering-report";
import { paragraph, table, tableCaption, type ReportBlock } from "./report-content-blocks";

/** Preserve every row, column and index in bands fitting the shared page width. */
export function reportMatrixTables(title: string, matrix: number[][], rows: number[], columns = rows): ReportBlock[] {
  if (!rows.length || !columns.length) return [tableCaption(`${title} · ${rows.length} × ${columns.length}`), paragraph("无自由自由度，不存在待求解的自由子系统矩阵条目。")];
  const content: ReportBlock[] = [];
  for (let offset = 0; offset < columns.length; offset += 6) {
    const band = columns.slice(offset, offset + 6);
    content.push(tableCaption(`${title} · ${matrix.length} × ${columns.length} · 列 ${band[0]}—${band.at(-1)}`),
      table(["行＼列", ...band.map(String)], matrix.map((row, i) => [String(rows[i]), ...row.slice(offset, offset + 6).map(n)])));
  }
  return content;
}
