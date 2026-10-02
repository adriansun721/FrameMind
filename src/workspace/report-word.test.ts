import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { captureEngineeringReport, withSupplementalReportProcess } from "../domain/engineering-report";
import { createSupplementalAnalysisInput, solveFrame } from "../domain/analysis";
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
  it("exports exactly the selected process steps and splits matrices into readable editable bands", async () => {
    const project = reportFixture(true); const result = project.analysisResults[0];
    const report = captureEngineeringReport(project, result.id, { memberIds: ["member_0001"], steps: ["member-process", "assembly", "constraints"] });
    const zip = await JSZip.loadAsync(await buildReportWord(report, async () => png));
    const xml = await zip.file("word/document.xml")!.async("string");
    const appendix = xml.slice(xml.indexOf("附录 A 所选分析的计算过程"));
    for (const value of ["杆件过程 M1", "局部单元刚度 Kl", "列 0—5", "列 6—11", "500000", "0.00003", "所选杆件组装贡献", "约束处理与整体荷载", "本次运行实际快照", "按冻结输入重建", "印刷页", "PDF 页序", "阎军、杨春秋", "127", "136", "u_local = T · u_global", "Kff · uf = Ff"]) expect(appendix).toContain(value);
    expect(appendix).not.toContain("整体自由度映射表");
    expect(appendix).not.toContain("整体刚度矩阵 K ·");
    expect(appendix).not.toContain("约束后刚度矩阵 Kff ·");
    expect(appendix).toContain("w:tblHeader");
    const empty = await wordXml(); expect(empty.xml).not.toContain("附录 A");
  });
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

  it("exports missing notices and a separately identified supplemental appendix with unchanged body", async () => {
    const project = reportFixture(); const result = project.analysisResults[0];
    const legacy = { ...project, analysisResults: [{ ...result, process: undefined, input: { ...result.input, solver: undefined } }] };
    const report = captureEngineeringReport(legacy, result.id, { memberIds: ["member_0001"], steps: ["member-process", "dof-mapping", "assembled-stiffness", "reduced-stiffness"] });
    const missingZip = await JSZip.loadAsync(await buildReportWord(report, async () => png));
    const missingXml = await missingZip.file("word/document.xml")!.async("string");
    expect(missingXml).toContain("未采集整体过程快照"); expect(missingXml).not.toContain("局部单元刚度 Kl");
    const supplemental = solveFrame(createSupplementalAnalysisInput(report.result));
    const finalZip = await JSZip.loadAsync(await buildReportWord(withSupplementalReportProcess(report, supplemental), async () => png));
    const xml = await finalZip.file("word/document.xml")!.async("string");
    const [body, appendix] = xml.split("附录 A 所选分析的计算过程");
    expect(body).toContain(result.id); expect(body).not.toContain(supplemental.id);
    for (const value of ["补算过程分析", supplemental.id, result.id, "整体自由度映射表", "整体刚度矩阵 K ·", "约束后刚度矩阵 Kff ·", "列 6—11", "0.00002"]) expect(appendix).toContain(value);
    expect(appendix).not.toContain("缺少记录");
  });

  it("propagates a figure failure instead of producing a successful report", async () => {
    const project = reportFixture(); const report = captureEngineeringReport(project, project.analysisResults[0].id);
    await expect(buildReportWord(report, async () => { throw new Error("图表失败"); })).rejects.toThrow("图表失败");
  });
});
