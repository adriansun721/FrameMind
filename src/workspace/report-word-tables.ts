const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");

/** Same editable table layout, serialized directly instead of thousands of OOXML objects. */
export function reportTableXml(headers: string[], rows: string[][]): string {
  const width = Math.floor(9638 / headers.length);
  const borders = ["top", "left", "bottom", "right", "insideH", "insideV"].map((side) => `<w:${side} w:val="single" w:sz="4" w:color="auto"/>`).join("");
  const grid = headers.map(() => `<w:gridCol w:w="${width}"/>`).join("");
  const rowXml = (row: string[], header: boolean) => `<w:tr><w:trPr>${header ? '<w:tblHeader w:val="true"/>' : ""}<w:cantSplit/></w:trPr>${row.map((value) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${header ? '<w:shd w:fill="E8EEF2" w:val="clear"/>' : ""}<w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr>${header ? "<w:b/>" : ""}<w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${escape(value)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rowXml(headers, true)}${rows.map((row) => rowXml(row, false)).join("")}</w:tbl>`;
}
