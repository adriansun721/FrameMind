import { HeadingLevel, LineRuleType, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType } from "docx";

export const paragraph = (text: string) => new Paragraph({ children: [new TextRun(text)], keepLines: true, spacing: { after: 130 } });
export const tableSeparator = (trailing = false) => new Paragraph({ run: { size: trailing ? 1 : 2 }, spacing: { before: 0, after: 0, line: trailing ? 1 : 40, lineRule: LineRuleType.EXACT } });
export const tableCaption = (text: string) => new Paragraph({ text, keepNext: true, spacing: { before: 160, after: 100 } });
export const heading = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 160 }, keepNext: true });
export function table(headers: string[], rows: string[][]): Table {
  const width = Math.floor(9638 / headers.length);
  return new Table({
    width: { size: 9638, type: WidthType.DXA }, layout: TableLayoutType.FIXED, columnWidths: headers.map(() => width),
    rows: [headers, ...rows].map((row, index) => new TableRow({
      tableHeader: index === 0, cantSplit: true,
      children: row.map((value) => new TableCell({
        width: { size: width, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 80, right: 80 },
        shading: index === 0 ? { fill: "E8EEF2" } : undefined,
        children: [new Paragraph({ children: [new TextRun({ text: value, bold: index === 0, size: 18 })], spacing: { after: 0 } })],
      })),
    })),
  });
}
