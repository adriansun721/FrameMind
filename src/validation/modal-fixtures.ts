import { addAnalysisCase, selectAnalysisCase } from "../domain/project";
import { DEFAULT_MODAL_SETTINGS, type ModalSettings } from "../domain/modal";
import { sectionCantilever } from "./section-fixtures";

export function modalCantilever(settings: ModalSettings = { ...DEFAULT_MODAL_SETTINGS }) {
  const p = sectionCantilever({ shape: "rectangle", width: .1, height: .2 });
  return selectAnalysisCase(addAnalysisCase(p, { name: "结构模态", method: "modal", loadSourceId: "structure", settings: { solver: "native-modal", modal: settings } }), "AC1");
}
