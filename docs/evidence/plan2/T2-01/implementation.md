# T2-01 Implementation Evidence

- Task: `T2-01` — 基于真实状态回答工程问题.
- Attempt: `T2-01-20261003T162855448Z-ddfd3b60`.
- Baseline: `ca98414db2013de4b2be9819ee6d889897b470a6`.
- Scope: only the T2-01 implementation, focused tests, and this evidence directory. `PLAN2.0.md` and `PRD2.0.md` were not edited.

## Technical decisions

1. `startAiTask` performs an internal `read_model(summary)` through the same public task boundary before accepting a model-generated answer. This fixes the existing-model/empty-agent case at execution time rather than relying on prompt wording.
2. `AiSnapshot` carries project identity, model revision, selection, goal, analysis identity/completion state, comparison identity, and a stable `snapshotKey`. The task can be cancelled when the caller reports stale state or when a newly captured snapshot no longer matches.
3. Model and result readers use bounded page size, explicit `empty`/`hasMore` metadata, field projection, exact/range query validation, stable identities, and receipts containing object identity, input revision, analysis identity, completion/current/expired state, and timestamps.
4. `AiTaskOptions` requires a fresh-snapshot provider at the task boundary; callers cannot silently omit snapshot validation. `captureAiSnapshot` rejects analysis results belonging to another project.
5. `AiTaskResult.lifecycle` distinguishes request initiation, no/text/tool response receipt, and task completion/failure/cancellation. The UI separately renders in-flight/paused status, ordinary text completion, task outcomes, stale history, and expandable tool input/output records. Internal round-zero state bootstrap records remain in task evidence but are not duplicated in the public tool-record list.
6. Numeric result explanations are rejected unless the referenced analysis is complete and the reference token is tied to the actual analysis identity and frozen input; historical references retain object coordinates and the original timeline.

## Files

- Implementation: `electron/deepseek.ts`, `src/workspace/ai-tools.ts`, `src/workspace/ai-results.ts`, `src/workspace/ai-task.ts`, `src/components/AiConversationPanel.tsx`, `src/components/AiTaskTimeline.tsx`.
- Tests: `src/workspace/ai-tools.test.ts`, `src/workspace/ai-results.test.ts`, `src/workspace/ai-task.test.ts`.

## Requirement coverage

- PLAN T2-01 delivery behavior (PLAN2.0.md:121-133): current formal model reads, no-model/no-selection/empty-query semantics, versioned receipts, task lifecycle, and result provenance are implemented.
- PLAN user stories: US2-001, US2-003, US2-005, and US2-006 are covered by the same boundaries and tests.
- PRD2.0 agent direction (PRD2.0.md:35): the agent reads real state and does not invent numeric results or use mutation tools in this task.

## Limitation

No live DeepSeek provider request was made in this attempt. The public Electron test uses a deterministic transport fixture and the unit tests use deterministic transports; no credential value is present in source, evidence, or ordinary logs. Broad legacy Electron coverage still has seven unrelated/later-task failures (81 passed, 7 failed, 4 skipped); the T2-01 public boundary test passes.
