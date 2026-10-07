import { join } from "node:path";

/** Allows a full acceptance run to retain fresh evidence without overwriting earlier tasks. */
export function numericalEvidenceDirectory(task) {
  return join(process.env.FRAMEMIND_NUMERICAL_EVIDENCE_ROOT || "docs/evidence/plan2", task);
}
