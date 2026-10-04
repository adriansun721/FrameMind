# T2-06 Acceptance Record

Date: 2026-10-04 (Asia/Taipei)

| PLAN2.0 criterion | Evidence |
| --- | --- |
| One main task, independent queue and supplements | `task-scheduler.test.ts` verifies separate independent IDs, FIFO execution, one resource slot and a supplement that keeps the original owner ID while increasing operation/supplement counts. Ambiguous assignment exposes active candidates instead of guessing. |
| Latest input at actual start | A queued analysis changes the revision after enqueue; its `getInput` is called only when it starts and observes the newer revision. |
| Explicit lifecycle states | Scheduler tests cover queued/running, waiting-input, waiting-confirmation, paused, failed, cancelled and completed transitions. Waiting states remain non-terminal and can accept a later supplement; cancelling a supplement preserves the waiting owner. AI missing-input and awaiting-confirmation results map to the corresponding scheduler states, and `AiTaskResult.workKind` explicitly separates ordinary conversation from engineering work. |
| Shared resource and ownership | Manual analysis and AI tasks receive the same App scheduler instance. Phase, result and finish events retain project/task ownership; analysis IDs are bound before result publication. |
| Cancellation, project switch and late output isolation | Abort signals cancel the analysis worker/AI request. App project open/new and unmount cancel all old project tasks; explicit project/task cancellation rejects queued operations, supplement cancellation preserves the waiting owner, and cross-project/cross-kind supplements are rejected. Existing exact project/session checkpoints reject stale results. The analysis task regression and T2-05 coordination replay remain green. |

This is deterministic implementation evidence. It does not claim cross-restart persistence, crash recovery, live-provider reliability or diagnostic-copy behavior; those remain T2-07, T2-09/T2-10 and T2-11/T2-41 responsibilities.
