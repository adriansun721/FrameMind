# ADR-0038: Stable Task Targets and Manual Edit Coordination

- Date: 2026-10-04 (Asia/Taipei)
- Status: Accepted
- Scope: PLAN2.0.md T2-05; US2-019 through US2-021; AC2-05, AC2-06 and the T2-05 portion of AC2-11

## Context

The previous task boundary treated a new selection, viewed analysis or project object reference as invalidation. This interrupted browsing and discarded usable plans after compatible manual edits. Draft confirmations must still prevent an older reviewed operation from overwriting newer engineering data.

## Decision

Capture stable selected object IDs, analysis/comparison IDs and the requested calculation source when the user sends the instruction. Selection, camera movement, panel changes and result browsing do not change those bindings. The message can locate the submitted selection; the draft can locate its actual operation targets. Once a draft identifies its targets, deleting an unrelated submitted selection does not pause that draft.

On an engineering change, reread the latest formal model and coordinate each pending draft against its original base. Existing condition entries use a field-by-field three-way merge. Partial node/member edits retain their explicitly requested fields, including consecutive operations on the same object. Unchanged fields preserve manual values; competing changes to the same parameter pause the action. Deleting or copying an edited object, losing a target or resource, invalidating a column target, and expanding a cascade deletion require a new review of intent. Domain preview validation remains authoritative.

Compatible coordination updates the draft version and base, rebuilds the preview and requires confirmation of the resulting content. The previous confirmation fails its base/version checks. A conflict is shown with actual object/parameter changes and blocks confirmation. An explicit rereview against the current engineering state prepares a new preview; it does not apply the operation. Unsaved condition/section card edits retain their old base until preview update, where coordination runs again.

The active AI task discards pending responses prepared against an old engineering state and continues with a fresh local read. It completes skipped tool-call messages before requesting replanning. The result carries the draft's actual base project so publication cannot associate old content with a newer base. Refresh also marks retained numerical references historical while preserving their frozen inputs. Completed conversation citations recheck validity against the live project.

Only opening/creating a project changes the application session. Project/session and task generation checks isolate late network output and local-analysis continuations. A requested analysis uses its bound source rather than the source currently being browsed; a deleted source requires clarification.

## Superseded Rules

This decision replaces the selection/analysis browsing invalidation and all-project-reference invalidation clauses in [ADR-0028](0028-t27-ai-interruption-and-recovery.md) and [ADR-0036](0036-ai-conversation-home-and-pause.md). Their cancellation, independent retry identities, local confirmation, frozen results and session-only history rules still apply. Opening the same project again starts a new session and isolates the previous request.

## Consequences and Limits

Coordination is conservative where an edited delete/copy target or a changed cascade makes intent unclear. Users review the new differences and confirm again. This task does not add task queues, persistent conversations, crash recovery or cross-restart continuation; T2-06 and T2-09/T2-10 own those capabilities. Provider reliability and live AI acceptance remain in T2-11/T2-41. Evidence is recorded in [T2-05 verification](../evidence/plan2/T2-05/verification.md).
