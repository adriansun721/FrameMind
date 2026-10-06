import { addAnalysisCase, addLoadCase, addNodalLoad, selectAnalysisCase, updateNodalLoad, type FrameProject } from "../domain/project";
import { DEFAULT_BUCKLING_SETTINGS, type BucklingSettings } from "../domain/buckling";
import { sectionCantilever } from "./section-fixtures";

export function bucklingColumn(fixedKN = 0, referenceKN = 10, settings: Partial<BucklingSettings> = {}): FrameProject {
  let p = sectionCantilever({ shape: "rectangle", width: .1, height: .2 });
  p = updateNodalLoad(p, p.nodalLoads[0].id, p.nodes[1].id, { x: -referenceKN, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  p = addLoadCase(p, "固定预荷载");
  p = addNodalLoad(p, p.nodes[1].id, { x: -fixedKN, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, "LC2");
  return selectAnalysisCase(addAnalysisCase(p, { name: "柱屈曲", method: "buckling", loadSourceId: "buckling", settings: { solver: "native-buckling", buckling: {
    ...structuredClone(DEFAULT_BUCKLING_SETTINGS), fixed: fixedKN ? [{ loadCaseId: "LC2", factor: 1 }] : [], ...settings,
  } } }), "AC1");
}
