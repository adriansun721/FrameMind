import type { EngineeringReport } from "../domain/engineering-report";
import { createReportContent } from "./report-content";

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

/** Self-contained local print document: escaped text and inline same-source figures. */
export function buildReportPdfHtml(report: EngineeringReport): string {
  const body = createReportContent(report).map((block) => {
    switch (block.kind) {
      case "title": return `<h1>${escape(block.text)}</h1>`;
      case "heading": return `<h2${block.newPage ? ' class="new-page"' : ""}>${escape(block.text)}</h2>`;
      case "paragraph": return `<p>${escape(block.text)}</p>`;
      case "caption": return `<p class="caption">${escape(block.text)}</p>`;
      case "table": return `<table><thead><tr>${block.headers.map((value) => `<th>${escape(value)}</th>`).join("")}</tr></thead><tbody>${block.rows.map((row) => `<tr>${row.map((value) => `<td>${escape(value)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      case "image": return `<figure><img alt="${escape(block.description)}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(block.svg)}" style="height:${block.height / 600 * 170}mm" /></figure>`;
    }
  }).join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'" />
<title>${escape(report.projectName)} 工程计算书</title><style>
@page { size: A4; margin: 20mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 10.5pt/1.52 "Microsoft YaHei", sans-serif; color: #000; }
h1 { font-size: 17pt; margin: 0 0 12pt; }
h2 { font-size: 13pt; margin: 12pt 0 8pt; }
h1, h2, .caption { break-after: avoid; }
p { margin: 0 0 6.5pt; overflow-wrap: anywhere; white-space: pre-wrap; }
h1, h2 { overflow-wrap: anywhere; }
.new-page { break-before: page; }
.caption { margin: 8pt 0 5pt; }
table { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 0 0 8pt; font-size: 9pt; line-height: 1.45; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th, td { border: .5pt solid #aaa; padding: 4pt; text-align: left; vertical-align: top; overflow-wrap: anywhere; white-space: pre-wrap; }
th { background: #e8eef2; font-weight: bold; }
figure { margin: 0; break-inside: avoid; }
img { display: block; width: 100%; object-fit: contain; }
</style></head><body>${body}</body></html>`;
}
