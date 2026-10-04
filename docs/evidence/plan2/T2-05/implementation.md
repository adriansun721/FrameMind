# T2-05 Implementation Record

Date: 2026-10-04 (Asia/Taipei)

`startAiTask` binds the submitted selection, analysis/comparison identities and calculation source. Its live boundary checks project/session identity instead of browser selection. Engineering changes trigger a local reread and replanning; pending text/tools based on the old state are discarded. Skipped tool calls receive cancellation messages before the next provider request. The returned `draftBaseProject` preserves the base that produced the draft across publication callbacks.

`draft-coordination.ts` coordinates full tasks, base edits, section changes, conditions and frame previews. It merges unchanged draft fields with compatible manual edits, detects competing edits and deleted targets, checks cascade changes and retains explicit components in consecutive edits. `engineeringDraftTargets` is shared by task execution and the panel so an unrelated selected object's deletion does not block an explicit draft target.

`AiConversationPanel` adopts compatible coordination into a new version and preview. Actual conflicts disable confirmation and show affected object/parameter values. Rereview creates a new confirmation basis; confirmation remains a separate user action. Unsaved condition/section edits are coordinated at preview update using their original base, preserving a simultaneous compatible manual change. Message and draft target controls locate stable formal IDs.

`App` starts a new session only for project open/create, uses the confirmed target selection for section changes, and runs requested analysis on its bound source. Late replies and local continuation callbacks cannot publish into a newer session/task. Frozen analysis inputs are retained; task refresh and completed conversation reference rendering expose historical validity after engineering edits.

The implementation reuses existing project operations, domain previews, confirmation version checks, analysis execution and result freezing. The rule change is recorded in [ADR-0038](../../../decisions/0038-stable-task-targets-and-manual-edit-coordination.md). Existing desktop assertions that expected browsing cancellation or unconditional draft invalidation now assert the T2-05 behavior. T22/T25 regression artifacts go to `test-results` rather than overwriting earlier tracked evidence.
