# T2-04 Acceptance Record

Date: 2026-10-04 (Asia/Taipei)

| Criterion | Evidence |
| --- | --- |
| Version-bound atomic confirmation | `TaskDraftStageConfirmation.confirm` checks project identity, base revision, draft version and completeness before applying one transaction. |
| Whole-task history and receipt | The application callback records one project transition; the result data contains task/version revisions, formal mappings, load references and affected object IDs. |
| Idempotent retry and undo safety | Focused tests repeat confirmation and retry the old confirmation after `ProjectHistory.undo`; no second model objects are created. |
| Read-back verification | The confirmation path compares formal nodes, members, resources, supports, nodal/uniform loads, self-weight, cases and combinations against the reviewed draft. |
| Calculation continuation | `AiConversationPanel` schedules `analyze` only after an applied task receipt and a requested analysis intent. |
| Failure isolation and reconfirmation | Existing late-command failure coverage keeps the original project unchanged; source-project identity makes changed drafts stale. |
