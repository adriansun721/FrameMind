import type { FrameProject } from "./project";

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
    return previous;
  }

  redo(current: FrameProject): FrameProject | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    return next;
  }

  reset(): void {
    this.past = [];
    this.future = [];
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
}
