import { describe, expect, it } from "vitest";
import { CANONICAL_UNITS, convertQuantity, UNIT_PRESETS, unitPresentation } from "./units";
import { addMaterial, addMember, addNode, addNodalLoad, addSection, addSupport, attachAnalysisResult, createProject, type FrameProject } from "./project";
import { decodeProject, encodeProject } from "./project-file";
import { isAnalysisResultCurrent, solveFrame } from "./analysis";
import { captureEngineeringReport } from "./engineering-report";
import { createReportContent } from "../workspace/report-content";
import { captureAiSnapshot, executeAiTool } from "../workspace/ai-tools";

export function axialUnitProject(): FrameProject {
  let p = createProject("单位等价轴向算例");
  p = addNode(p, { x: 0, y: 0, z: 0 }); p = addNode(p, { x: 2, y: 0, z: 0 });
  p = addMaterial(p, { name: "Steel", elasticModulusGPa: 200, poissonRatio: 0.3, densityKgM3: 7850 });
  p = addSection(p, { name: "Box", areaM2: .01, secondMomentYM4: .0001, secondMomentZM4: .0001, torsionalConstantM4: .0001 });
  p = addMember(p, { startNodeId: p.nodes[0].id, endNodeId: p.nodes[1].id, materialId: p.materials[0].id, sectionId: p.sections[0].id, rotationDegrees: 0 });
  p = addSupport(p, p.nodes[0].id, [true, true, true, true, true, true]);
  p = addNodalLoad(p, p.nodes[1].id, { x: 8, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  return attachAnalysisResult(p, solveFrame(p));
}
const call = (name: string, args: unknown) => ({ id: "units", type: "function", function: { name, arguments: JSON.stringify(args) } });

describe("T2-17 unit contract through project, tool and report boundaries", () => {
  it("converts engineering dimensions from worked literals and rejects absent/incompatible units", () => {
    expect(convertQuantity(200000, "modulus", "MPa", "GPa")).toBe(200);
    expect(convertQuantity(10000, "area", "mm²", "m²")).toBe(.01);
    expect(convertQuantity(100000000, "inertia", "mm⁴", "m⁴")).toBeCloseTo(.0001, 16);
    expect(convertQuantity(7.85e-6, "density", "kg/mm³", "kg/m³")).toBeCloseTo(7850, 10);
    expect(convertQuantity(2500000, "moment", "N·mm", "kN·m")).toBe(2.5);
    expect(convertQuantity(4, "distributedForce", "N/mm", "kN/m")).toBe(4);
    expect(convertQuantity(Math.PI, "orientation", "rad", "°")).toBe(180);
    expect(convertQuantity(180, "rotation", "°", "rad")).toBe(Math.PI);
    expect(convertQuantity(2 * Math.PI, "frequency", "rad/s", "Hz")).toBe(1);
    expect(convertQuantity(1, "forcePSD", "kN²/Hz", "N²/Hz")).toBe(1e6);
    expect(() => convertQuantity(5, "length", "", "m")).toThrow("明确");
    expect(() => convertQuantity(5, "force", "mm", "kN")).toThrow("明确");
    expect(() => convertQuantity(Number.MAX_VALUE, "length", "m", "mm")).toThrow("范围");
  });

  it("switches all presets repeatedly without changing physics, revision, identities or frozen results", () => {
    const original = axialUnitProject(); let p = original;
    const input = JSON.stringify(original.latestAnalysis!.input);
    for (let i = 0; i < 100; i++) for (const preset of Object.keys(UNIT_PRESETS) as (keyof typeof UNIT_PRESETS)[]) {
      p = decodeProject(encodeProject({ ...p, displayUnitPreset: preset }));
      expect(p.revision).toBe(original.revision);
      expect(p.nodes).toEqual(original.nodes);
      expect(JSON.stringify(p.latestAnalysis!.input)).toBe(input);
      expect(isAnalysisResultCurrent(p, p.latestAnalysis!)).toBe(true);
    }
    const tip = original.latestAnalysis!.nodes[1];
    expect(tip.displacement.x).toBeCloseTo(8e-6, 13); // FL/EA, independently worked in canonical units.
    expect(unitPresentation("mm-N").quantity(tip.displacement.x, "m")).toBe("0.008 mm");
    expect(unitPresentation("mm-N").quantity(original.latestAnalysis!.nodes[0].reaction.x, "kN")).toBe("-8000 N");
    expect(decodeProject(encodeProject(original)).displayUnitPreset).toBeUndefined();
    expect(() => decodeProject(JSON.stringify({ ...original, displayUnitPreset: "unknown" }))).toThrow("预设");
  });

  it("accepts explicitly mixed tool input and keeps confirmation payloads canonical", () => {
    const p = axialUnitProject(); const snapshot = captureAiSnapshot(p, []);
    const edit = executeAiTool(snapshot, call("propose_model_edits", { inputUnits: { length: "mm", orientation: "rad" }, operations: [
      { type: "create_node", position: { x: 2000, y: -12.5, z: .001 } },
      { type: "update_member", id: p.members[0].id, changes: { rotationDegrees: Math.PI / 2 } },
    ] }));
    expect(edit.status).toBe("awaiting-confirmation");
    expect(edit.modelEdits?.operations).toMatchObject([
      { position: { x: 2, y: -.0125, z: .000001 } }, { changes: { rotationDegrees: 90 } },
    ]);
    const conditions = executeAiTool(snapshot, call("propose_analysis_conditions", { inputUnits: { force: "N", moment: "N·mm", distributedForce: "N/mm", acceleration: "mm/s²" },
      nodalLoads: [{ nodeId: p.nodes[1].id, loadCaseId: "LC1", force: { x: 8000, y: 0, z: 0 }, moment: { x: 0, y: 2500000, z: 0 }, source: "user" }],
    }));
    expect(conditions.conditions?.nodalLoads?.[0]).toMatchObject({ force: { x: 8 }, moment: { y: 2.5 } });
    expect(executeAiTool(snapshot, call("create_node", { inputUnits: { length: "N" }, position: { x: 5, y: 0, z: 0 } })).status).toBe("failed");
    expect(executeAiTool(snapshot, call("convert_quantity", { value: 5, dimension: "length", toUnit: "m" })).status).toBe("failed");
    const ref = executeAiTool(snapshot, call("read_result", { kind: "node", id: p.nodes[1].id, quantity: "displacement", component: "x", outputUnitPreset: "mm-N" }));
    expect(ref.reference?.unit).toBe("m");
    expect(ref.data).toMatchObject({ displayUnitPreset: "mm-N", value: .008, unit: "mm", object: { position: { x: 2000 } } });
    const filtered = executeAiTool(snapshot, call("read_results", { collection: "nodes", inputUnits: { length: "mm" }, outputUnitPreset: "mm-N", fields: ["nodeId", "displacement.x"], query: { field: "displacement.x", min: .007, max: .009 } }));
    expect(filtered.data).toMatchObject({ total: 1, items: [{ "displacement.x": .008 }] });
  });

  it("converts report body, figures and mixed-dimension process appendix from frozen data", () => {
    const p = axialUnitProject(); const original = JSON.stringify(p.latestAnalysis);
    const report = captureEngineeringReport({ ...p, displayUnitPreset: "mm-N" }, p.latestAnalysis!.id, { memberIds: [p.members[0].id], steps: ["member-process", "assembly", "constraints", "assembled-stiffness", "reduced-stiffness"] });
    const blocks = createReportContent(report); const text = JSON.stringify(blocks);
    expect(text).toContain("E (MPa)"); expect(text).toContain('"200000"');
    expect(text).toContain("A (mm²)"); expect(text).toContain('"10000"');
    expect(text).toContain("FX (N)"); expect(text).toContain('"8000"');
    expect(text).toContain("MX (N·mm)"); expect(text).toContain("0.008 mm");
    expect(text).toContain("N/mm"); expect(text).toContain("N·mm/rad");
    expect(JSON.stringify(p.latestAnalysis)).toBe(original);
  });

  it("retains large coordinates, tiny spacing and nonzero responses across round trips", () => {
    const values = [1e9 + .125, -1e6 - .0125, 1e-9, 1e-18, -1e-18, 0];
    for (const value of values) {
      const mm = convertQuantity(value, "length", "m", "mm");
      const m = convertQuantity(mm, "length", "mm", "m");
      expect(Math.abs(m - value)).toBeLessThanOrEqual(Math.abs(value) * 4 * Number.EPSILON);
      if (value !== 0) expect(unitPresentation("mm-N").number(value, CANONICAL_UNITS.length)).not.toBe("0");
    }
  });
});
