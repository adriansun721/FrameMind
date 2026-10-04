# T2-06 Implementation Record

Date: 2026-10-04 (Asia/Taipei)

`src/workspace/task-scheduler.ts` adds a deterministic FIFO scheduler with one registered resource slot. It records `queued`, `running`, `waiting-input`, `waiting-confirmation`, `paused`, `failed`, `cancelled` and `completed` states; emits creation, status, phase, result and finish events; and binds every event to project ID, task ID, task kind and optional analysis ID. Independent submissions receive separate task identities. Explicit supplements append an operation to the active project task and keep the original identity. Ambiguous assignment is rejected with candidate descriptors.

The scheduler invokes `getInput` only at actual start. Its abort signal is connected to the underlying worker or AI request. A task cancellation removes queued work, aborts running work and prevents a late result from reaching a newer task. A supplement cancellation rejects only that operation and preserves a waiting owner; supplements validate project and task kind, and explicit completion rejects any still-queued supplements before terminalizing the owner. Waiting states release the resource while keeping the task as the project's active main task; same-project independent work remains queued until a supplement or cancellation resolves it.

`App` owns the scheduler instance and passes it to `AiConversationPanel`. Manual static analysis is now submitted through the shared scheduler, captures the latest selected project/source when it starts, and stores its execution checkpoint by scheduler task ID. Project open/new and unmount cancel old project tasks. The modeling toolbar and AI panel show queued task count. AI execution creates `startAiTask` only after its scheduler operation starts and reports AI phases through the same task event stream.

The existing project/session checkpoint checks remain the final publication guard. A result whose project, session or exact input checkpoint is no longer current becomes a cancelled/stale tool result and cannot attach to the current project.
