# T2-02 Implementation Evidence

- Task: `T2-02` — 手动与工具共享基础编辑操作.
- Scope: shared node/member edit commands, reviewed AI edit drafts, confirmation, receipts, history and public desktop boundary.

## Technical decisions

1. `applyProjectEdits` is the shared command boundary. It accepts the same immutable `FrameProject` used by the manual workbench and applies public domain commands through `applyProjectTransaction`, so a successful batch increments the project revision once and a failed operation leaves the caller's project unchanged.
2. `ProjectEditOperation` deliberately covers only this task's node/member basics: create, partial update, duplicate and delete. Existing domain rules remain authoritative for finite coordinates, zero-length members, resource references and node deletion cascades.
3. `propose_model_edits` and the singular/plural basic-edit tools build a `ModelEditProposal` containing the exact base project revision, operations, object diff, allocated identities and affected members. The proposal is frozen at confirmation preparation and never mutates the snapshot.
4. `ModelEditConfirmation` checks project identity, object identity, revision and exact preview content before applying. It keeps an in-session idempotency map, returns a serializable receipt, and delegates history recording to the existing `activateProject`/`ProjectHistory` path.
5. The Electron provider advertises basic-edit tools only for edit-intent prompts. Read-only provider requests retain the existing tool contract; the public renderer tool boundary remains available for deterministic replay and task tests.

## Files

- Shared operations: `src/domain/project-operations.ts`.
- Draft and confirmation boundary: `src/workspace/model-edits.ts`.
- Confirmation returns a post-apply readback containing the applied project revision and each changed object's current formal value, so the UI receipt is based on the committed snapshot.
- AI tool and task integration: `src/workspace/ai-tools.ts`, `src/workspace/ai-task.ts`, `src/components/AiConversationPanel.tsx`, `src/components/AiTaskTimeline.tsx`.
- Manual entry migration: `src/App.tsx`.
- Provider schemas: `electron/model-edit-schema.ts`, `electron/deepseek.ts`.
- Tests: `src/workspace/model-edits.test.ts`, `e2e/t20-basic-edit-tools.spec.ts`.
