import { addAnalysisCase, selectAnalysisCase, updateNodalLoad, type FrameProject } from "../domain/project";
import { DEFAULT_SECOND_ORDER_SETTINGS, type SecondOrderSettings } from "../domain/second-order";
import { sectionCantilever } from "./section-fixtures";

export function secondOrderColumn(compressionKN = 500, lateralKN = .1, settings: Partial<SecondOrderSettings> = {}): FrameProject {
  let p = sectionCantilever({ shape: "rectangle", width: .1, height: .2 });
  p = updateNodalLoad(p, p.nodalLoads[0].id, p.nodes[1].id, { x: -compressionKN, y: lateralKN, z: 0 }, { x: 0, y: 0, z: 0 });
  return selectAnalysisCase(addAnalysisCase(p, { name: "梁柱二阶", method: "second-order", loadSourceId: "LC1", settings: { solver: "native-second-order", secondOrder: { ...DEFAULT_SECOND_ORDER_SETTINGS, ...settings } } }), "AC1");
}
