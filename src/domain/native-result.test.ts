import { describe, expect, it } from "vitest";
import samples from "../../docs/evidence/plan2/T2-13/wire-samples.json";
import { decodeAnalysisResult } from "./project-file";
import { decodeProject, encodeProject } from "./project-file";
import { attachAnalysisResult, updateNode } from "./project";
import { isAnalysisResultCurrent } from "./analysis";

describe("native result persistence contract", () => {
  it("retains the actual native process and stations", () => {
    const saved = decodeAnalysisResult(samples[0].result);
    expect(saved.process!.freeDofs).toEqual([6, 7, 8, 9, 10, 11]);
    expect(saved.members[0].nativeResponses).toHaveLength(17);
  });

  it("keeps native results current across save and makes changed geometry stale", () => {
    const source = decodeProject(JSON.stringify(samples[0].project));
    const result = decodeAnalysisResult(samples[0].result);
    const saved = decodeProject(encodeProject(attachAnalysisResult(source, result)));
    expect(isAnalysisResultCurrent(saved, result)).toBe(true);
    const moved = updateNode(saved, saved.nodes[1].id, { ...saved.nodes[1].position, x: 99 });
    expect(isAnalysisResultCurrent(moved, result)).toBe(false);
    const unknownSolver = structuredClone(result);
    unknownSolver.input.solver!.implementation = "unvalidated-solver";
    expect(isAnalysisResultCurrent(saved, unknownSolver)).toBe(false);
  });

  it("rejects partial, inconsistent and incorrectly mapped native process records", () => {
    for (const edit of [
      (r: ReturnType<typeof decodeAnalysisResult>) => { r.process = undefined; },
      (r: ReturnType<typeof decodeAnalysisResult>) => { r.service = undefined; },
      (r: ReturnType<typeof decodeAnalysisResult>) => { r.process!.freeDofs = []; r.process!.reducedStiffness = []; },
      (r: ReturnType<typeof decodeAnalysisResult>) => { r.process!.freeDofs[0] = 0; },
      (r: ReturnType<typeof decodeAnalysisResult>) => { r.process!.dofs[0].nodeId = r.input.nodes[1].id; },
      (r: ReturnType<typeof decodeAnalysisResult>) => { r.process!.members[0].globalDofIndices.reverse(); },
      (r: ReturnType<typeof decodeAnalysisResult>) => { r.process!.members[0].dofs[0].dof = "uy"; },
      (r: ReturnType<typeof decodeAnalysisResult>) => { r.process!.members = []; },
      (r: ReturnType<typeof decodeAnalysisResult>) => { r.process!.solver.implementation = "framemind-frame/3"; },
      (r: ReturnType<typeof decodeAnalysisResult>) => { r.members[0].nativeResponses = undefined; },
    ]) {
      const result = structuredClone(decodeAnalysisResult(samples[0].result));
      edit(result);
      expect(() => decodeAnalysisResult(result)).toThrow();
    }
  });
});
