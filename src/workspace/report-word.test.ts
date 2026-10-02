import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { captureEngineeringReport } from "../domain/engineering-report";
import { reportFixture } from "../domain/engineering-report.fixture";
import { buildReportWord } from "./report-word";

const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4e0AAAAASUVORK5CYII="), (char) => char.charCodeAt(0));
async function wordXml(combination = false) {
  const project = reportFixture(combination);
  const report = captureEngineeringReport(project, project.analysisResults[0].id);
  const bytes = await buildReportWord(report, async () => png);
  const zip = await JSZip.loadAsync(bytes);
  return { zip, xml: await zip.file("word/document.xml")!.async("string"), report };
}
describe("editable report Word", () => {
  it("packs native paragraphs, tables, formulas, units and same-source figures", async () => {
    const { zip, xml, report } = await wordXml();
    for (const value of ["1 模型概况与来源", "2 理论假设与适用边界", "3 材料截面与模型参数", "4 支座与边界条件", "5 荷载自重与工况组合", "6 关键响应与完整结果", "K · u = F", "GPa", "kg/m³", "m⁴", "rad", "0.00002", "node_0002", report.result.id]) expect(xml).toContain(value);
    expect(xml).toContain('<w:pStyle w:val="Title"');
    expect(xml).toContain("w:tblHeader"); expect(xml).toContain("w:cantSplit");
    expect(xml).toContain("未启用"); expect(xml).toContain("不构成强度或稳定性结论");
    expect(Object.keys(zip.files).filter((path) => path.startsWith("word/media/") && path.endsWith(".png"))).toHaveLength(1); // identical injected PNGs are deduplicated
    expect((xml.match(/<w:drawing>/g) ?? []).length).toBe(2);
    expect(await zip.file("word/styles.xml")!.async("string")).toContain('w:eastAsia="Microsoft YaHei"');
  });

  it("includes source coefficients, raw loads and weighted combination values", async () => {
    const { xml } = await wordXml(true);
    for (const value of ["CB1", "恒载与反向横载", "LC2", "-0.5", "分项工况原始荷载", "本次组合加权等效荷载", "1.5", "-3", "4.62051", "314", "杆端局部内力"]) expect(xml).toContain(value);
  });

  it("propagates a figure failure instead of producing a successful report", async () => {
    const project = reportFixture(); const report = captureEngineeringReport(project, project.analysisResults[0].id);
    await expect(buildReportWord(report, async () => { throw new Error("图表失败"); })).rejects.toThrow("图表失败");
  });
});
