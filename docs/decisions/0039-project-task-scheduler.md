# ADR-0039: Project Task Scheduler and Analysis Resource Ownership

- Date: 2026-10-04 (Asia/Taipei)
- Status: Accepted
- Scope: PLAN2.0.md T2-06; US2-020, US2-022, US2-023, US2-050; AC2-07 and the T2-06 portion of AC2-11

## Context

The workbench previously kept one local analysis reference and one AI request reference. Each caller decided independently whether a request could start. That made a second request either fail immediately or run outside the local analysis resource boundary. A queued request also captured its input before it had a chance to run, so a compatible manual edit could leave it using an obsolete model.

## Decision

`TaskScheduler` is the shared in-memory boundary for agent work, local analysis and future diagnostic work. It has one resource slot by default and FIFO ordering. Each descriptor carries a stable task ID, project ID, task kind, goal, queued/started revisions, status, phase and optional analysis ID. Events and results carry the same project/task ownership, so a late result can be rejected by the caller without changing a newer project state.

The scheduler keeps independent requests as separate queued tasks. A supplement explicitly submitted with `relation: "supplement"` attaches to the active or earliest queued task for the same project and same task kind, and increments its operation count; an explicit parent ID must satisfy the same project/kind identity check. `relation: "ambiguous"` is rejected with the visible active candidates so a caller cannot silently attach a clarification to the wrong task. Ordinary chat is reclassified as `conversation` from the AI result's explicit work kind after the AI response; it does not apply a model change or produce an analysis result.

The scheduler calls `getInput` only after a task obtains the resource slot. App local analysis uses that callback to capture the current project and requested load source. AI execution creates `startAiTask` only when the scheduler starts the operation. Waiting for input, waiting for confirmation and paused states remain non-terminal main-task states; same-project independent tasks stay visibly queued until the main task is resolved, while other projects can use a free resource. A later supplement resumes the original task. Cancellation aborts the underlying worker/request, rejects queued operations, and prevents late results from publishing. Cancelling an individual supplement rejects only that supplement and preserves a waiting owner; completing a waiting owner first rejects any unexecuted supplements so their Promises cannot remain pending.

Project open/new and component unmount cancel all tasks for the old project. The workbench shows queued task count and the AI panel exposes the same queue snapshot. Existing project/session checkpoints still guard result application after manual edits, load-source changes or project switches.

## Consequences and Limits

The queue and task state are session-local and intentionally not persisted. T2-09/T2-10 own migration, task persistence and crash recovery. The default resource strategy is one concurrent operation; a later analysis backend may choose a different registered limit without changing task ownership. Report-only supplemental reconstruction still has its own UI-local boundary and is not presented as a project engineering task.

Evidence is recorded in [T2-06 acceptance](../evidence/plan2/T2-06/acceptance.md) and [T2-06 verification](../evidence/plan2/T2-06/verification.md).
