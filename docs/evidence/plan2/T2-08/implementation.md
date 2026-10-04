# T2-08 Implementation Record

Date: 2026-10-04 (Asia/Taipei)

`src/workspace/exploration-budget.ts` introduces a clock-injectable exploration controller. Normal mode uses a 240,000 ms active budget and deep mode uses 720,000 ms; both expose the actual budget and timing basis. The controller records rounds, provider calls, candidates, analyses, single-analysis duration, resource limits, evidence count, no-progress rounds and repeated failures. Pause and waiting-for-user intervals are excluded from active time. Budget extension is an explicit operation and preserves all counters.

`src/workspace/ai-task.ts` checks the controller before model requests and after tool outcomes. Diagnostic trials count as candidates, analysis requests count as analyses, and stable repeated outcomes stop with retained records and actionable next steps. `AiTaskResult.exploration` and progress callbacks carry the public accounting. Cancellation marks the budget cancelled; late transport responses remain suppressed by the existing request/context guards.

`AiConversationPanel` exposes a normal/deep segmented control, reports active seconds and counts, and mirrors pause/resume into the shared scheduler task state. Existing diagnostic copies, trial evidence, drafts and task records remain available after a stop.
