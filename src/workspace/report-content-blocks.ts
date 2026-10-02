export type ReportBlock =
  | { kind: "title" | "paragraph" | "caption"; text: string }
  | { kind: "heading"; text: string; newPage: boolean }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "image"; svg: string; description: string; height: number };

export const title = (text: string): ReportBlock => ({ kind: "title", text });
export const paragraph = (text: string): ReportBlock => ({ kind: "paragraph", text });
export const heading = (text: string, newPage = false): ReportBlock => ({ kind: "heading", text, newPage });
export const tableCaption = (text: string): ReportBlock => ({ kind: "caption", text });
export const table = (headers: string[], rows: string[][]): ReportBlock => ({ kind: "table", headers, rows });
export const image = (svg: string, description: string, height = 330): ReportBlock => ({ kind: "image", svg, description, height });
