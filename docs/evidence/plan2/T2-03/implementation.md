# T2-03 Implementation Evidence

- Task: `T2-03` — 完整任务草案与集中补参.
- Scope: one unapplied task draft spanning geometry/resources, supports, nodal and member loads, self weight, cases/combinations and analysis intent.

## Technical decisions

1. `TaskDraft` owns one stable task identity, monotonically increasing content version, project identity and base revision. `propose_task` merges partial follow-up calls into that same draft and keeps omitted fields unchanged.
2. Preview identities use the existing frame proposal namespace (`draft:<frameId>:node:...` and `draft:<frameId>:member:...`). Supports, nodal loads and uniform loads can refer to those identities; confirmation maps them to formal domain identities without exposing temporary IDs to the applied project.
3. `buildTaskDraftPreview` reads the immutable AI snapshot, composes the existing model with the proposed frame for validation, and reports missing conditions, before/after values, source provenance and engineering impact. Existing supports, loads and enabled self weight satisfy the corresponding completeness check instead of being requested again.
4. Source provenance is shared across frame and load inputs: `existing`, `user`, `catalog`, `suggestion`, `assumption` and `unknown`. Unknown values remain blocked in the card; assumptions remain visible for explicit review.
5. `TaskDraftCard` shows the goal, revision, involved objects, retained conditions, source labels, changes and impacts. It accepts a text revision only while the reviewed project snapshot is current; a changed model disables revision and confirmation until a new draft is prepared.
6. The Electron provider exposes `propose_task` for explicit whole-task language and for active-draft revisions, including ordinary mixed requests such as building a frame with supports and loads. The unadvertised `propose_complete_task` alias was removed so the public contract has one task tool.

## Files

- Draft and preview: `src/workspace/task-draft.ts`.
- Confirmation boundary and identity mapping: `src/workspace/task-confirmation.ts`.
- AI tool/task integration: `src/workspace/ai-tools.ts`, `src/workspace/ai-task.ts`, `src/components/AiConversationPanel.tsx`, `src/components/TaskDraftCard.tsx`.
- Shared provenance and load schema: `src/workspace/condition-input.ts`, `src/workspace/frame-proposal.ts`, `src/workspace/load-stage.ts`, `electron/load-stage-schema.ts`, `electron/deepseek.ts`.
- Tests: `src/workspace/task-draft.test.ts`, `electron/deepseek-chat.test.ts`.
