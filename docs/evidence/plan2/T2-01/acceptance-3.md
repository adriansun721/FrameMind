# Acceptance 3 — Pagination and snapshot semantics

Passed: `true`.

The tests cover bounded pages, explicit empty pages, invalid/missing objects, malformed or unbounded queries, stale selections, incomplete analyses, foreign-project analyses, and task cancellation after a changed current snapshot. `getCurrentSnapshot` is required at the task boundary and compared with the stable snapshot fingerprint.
