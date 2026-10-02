import { getAnalysisSourceId, type FrameProject } from "./project";

/** In-memory edit history. Project files intentionally do not contain this state. */
export class ProjectHistory {
  private past: FrameProject[] = [];
  private future: FrameProject[] = [];

  record(before: FrameProject, after: FrameProject): void {
    if (before === after || before.revision === after.revision) return;
    this.past.push(before);
    this.future = [];
  }

  undo(current: FrameProject): FrameProject | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(current);
    return preserveResults(previous, current);
  }

  redo(current: FrameProject): FrameProject | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    return preserveResults(next, current);
  }

  reset(): void {
    this.past = [];
    this.future = [];
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
}

/** Undo changes model input, while completed analyses remain available for provenance checks. */
function preserveResults(restored: FrameProject, current: FrameProject): FrameProject {
  const known = new Set(restored.analysisResults.map((result) => result.id));
  const extra = current.analysisResults.filter((result) => !known.has(result.id)
    && (result.input.combination ? restored.loadCombinations.some((item) => item.id === getAnalysisSourceId(result.input))
      && result.input.combination.definition.terms.every((term) => restored.loadCases.some((item) => item.id === term.loadCaseId))
      : restored.loadCases.some((item) => item.id === getAnalysisSourceId(result.input))));
  if (!extra.length) return restored;
  if (current.revision >= Number.MAX_SAFE_INTEGER) throw new Error("项目编号状态无法安全递增");
  return { ...restored, revision: current.revision + 1, updatedAt: new Date().toISOString(), analysisResults: [...restored.analysisResults, ...extra] };
}
