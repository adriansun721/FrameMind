import { AlignmentType, Document, Footer, HeadingLevel, ImageRun, PageNumber, Packer, Paragraph, TextRun } from "docx";
import { reportSourceLabel, type EngineeringReport } from "../domain/engineering-report";
import { reportSvgToPng } from "./report-figures";
import { createReportContent } from "./report-content";
import { heading, paragraph, table, tableCaption, tableSeparator } from "./report-word-layout";
import JSZip from "jszip";
import { reportTableXml } from "./report-word-tables";

/** Both formats consume identical captured content; only their layout differs. */
export async function buildReportWord(report: EngineeringReport, renderPng = reportSvgToPng): Promise<Uint8Array> {
  const source = reportSourceLabel(report.result);
  const result = report.result;
  const children = [];
  const serializedTables: { marker: string; xml: string }[] = [];
  const large = report.result.input.members.length > 50;
  const blocks = createReportContent(report);
  const contentText = JSON.stringify(blocks);
  let markerPrefix: string;
  do { markerPrefix = `FRAMEMIND_${crypto.randomUUID()}_TABLE_`; } while (contentText.includes(markerPrefix));
  for (const [index, block] of blocks.entries()) {
    // Word merges adjacent tables, including their repeated header definitions.
    if (block.kind === "table" && blocks[index - 1]?.kind === "table") children.push(tableSeparator());
    switch (block.kind) {
      case "title": children.push(new Paragraph({ text: block.text, heading: HeadingLevel.TITLE })); break;
      case "heading": children.push(block.newPage ? new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_1, pageBreakBefore: true, keepNext: true }) : heading(block.text)); break;
      case "paragraph": children.push(paragraph(block.text)); break;
      case "caption": children.push(tableCaption(block.text)); break;
      case "table":
        if (large) {
          const marker = `${markerPrefix}${serializedTables.length}_END`;
          serializedTables.push({ marker, xml: reportTableXml(block.headers, block.rows) });
          children.push(new Paragraph(marker));
        } else children.push(table(block.headers, block.rows));
        break;
      case "image": children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: "png", data: await renderPng(block.svg), transformation: { width: 600, height: block.height }, altText: { title: block.description, description: block.description, name: block.description } })] })); break;
    }
  }
  // Define Word's required paragraph after a final table without a full-height blank line.
  if (blocks.at(-1)?.kind === "table") children.push(tableSeparator(true));
  const doc = new Document({
    creator: "FrameMind", title: `${report.projectName} 工程计算书`, description: `${source} · ${result.id}`,
    styles: { default: { document: { run: { font: { ascii: "Microsoft YaHei", hAnsi: "Microsoft YaHei", eastAsia: "Microsoft YaHei", cs: "Microsoft YaHei" }, size: 21, color: "000000" }, paragraph: { spacing: { line: 320 } } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { size: 34, bold: true, color: "000000" }, paragraph: { spacing: { after: 240 }, keepNext: true } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { size: 26, bold: true, color: "000000" }, paragraph: { keepNext: true } },
      ],
    },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "FrameMind  ", size: 18 }), new TextRun({ children: [PageNumber.CURRENT], size: 18 })] })] }) }, children }],
  });
  const bytes = new Uint8Array(await Packer.toArrayBuffer(doc));
  if (!large) return bytes;
  const zip = await JSZip.loadAsync(bytes);
  let xml = await zip.file("word/document.xml")!.async("string");
  for (const item of serializedTables) {
    const marker = xml.indexOf(item.marker);
    const start = xml.lastIndexOf("<w:p>", marker);
    const end = xml.indexOf("</w:p>", marker);
    if (marker < 0 || start < 0 || end < marker || xml.indexOf(item.marker, marker + item.marker.length) >= 0) throw new Error("计算书表格打包失败");
    xml = xml.slice(0, start) + item.xml + xml.slice(end + "</w:p>".length);
  }
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export function reportBytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
