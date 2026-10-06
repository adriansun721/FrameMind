import { describe, expect, it } from "vitest";
import { createAnalysisRequest } from "./analysis-service";
import { captureAnalysisInput } from "./analysis";
import { addAnalysisCase, selectAnalysisCase, updateAnalysisCase } from "./project";
import { sectionCantilever } from "../validation/section-fixtures";
import { DEFAULT_SECOND_ORDER_SETTINGS } from "./second-order";

describe("elastic second-order public analysis cases", () => {
  it("freezes identical base loads and explicit controls for the native second-order run", () => {
    const p = sectionCantilever({ shape: "rectangle", width: .1, height: .2 });
    const next = selectAnalysisCase(addAnalysisCase(p, { name: "二阶", method: "second-order", loadSourceId: "LC1", settings: { solver: "native-second-order", secondOrder: { ...DEFAULT_SECOND_ORDER_SETTINGS } } }), "AC1");
    const request = createAnalysisRequest(captureAnalysisInput(next));
    expect(request.input.solver?.implementation).toBe("framemind-native/7");
    expect(request.input.nodalLoads).toEqual(captureAnalysisInput(p).nodalLoads);
    expect(request.input.meshPlan?.policy.maxDivisions).toBe(16);
    expect(Object.isFrozen(request.input.analysisCase?.settings.secondOrder)).toBe(true);
    expect(() => updateAnalysisCase(next, "AC1", { ...next.analysisCases[0], settings: { solver: "native-second-order", secondOrder: { ...DEFAULT_SECOND_ORDER_SETTINGS, maxIterations: 0 } } })).toThrow(/二阶/);
  });
});
