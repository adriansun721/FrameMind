# T2-03 Acceptance Evidence

Scope: deterministic verification of the complete task draft and concentrated parameter completion. This record does not claim live provider behavior, restart persistence or the broader T2-04/T2-11 acceptance surface.

## Draft and completion behavior

- Passed: geometry, resources, supports, nodal loads and analysis intent share one task identity and increment one draft version across partial updates.
- Passed: preview node identities can be referenced by supports and nodal loads, then map to formal node IDs only during confirmation.
- Passed: existing supports and enabled self weight are treated as retained facts; an existing load input avoids an unnecessary load question. Empty explicit arrays remain a user decision.
- Passed: uniform loads, self weight, load cases and user-defined combinations use the same load-stage validation path as the existing conditions workflow.
- Passed: source labels preserve existing, user, catalog, suggestion, assumption and unknown distinctions; unknown analysis or field sources remain missing until clarified.

## Review and confirmation surface

- Passed: the task card exposes goal, version/base revision, new and existing object counts, retained conditions, source labels, before/after values and engineering impacts.
- Passed: text revisions merge into the pending draft, while stale drafts disable revision and confirmation after the formal model changes.
- Passed: the whole task confirmation path applies resources, geometry and conditions through one project transaction, maps temporary references and returns a serializable receipt; a repeated confirmation is idempotent.
- Passed: a late allocation failure leaves the original project unchanged.

## Provider boundary

- Passed: explicit whole-task wording and mixed build/support/load wording expose `propose_task` and `discard_task_draft`.
- Passed: an active task-draft system context keeps `propose_task` available for short text revisions.

The tests are deterministic renderer/provider and domain-boundary tests. Real DeepSeek AI behavior, complete desktop replay, project save/reopen and automatic computation continuation remain follow-up evidence for T2-04, T2-09, T2-11 and T2-41.
