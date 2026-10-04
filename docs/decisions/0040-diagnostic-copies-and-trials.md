# ADR-0040: Evidence-Based Diagnostic Copies and Trials

- Date: 2026-10-04
- Status: Accepted
- Scope: PLAN2.0 T2-07; US2-007—US2-010; AC2-08

## Decision

Diagnostic work starts from an immutable snapshot of the applied project. The copy receives an independent project identity and records the formal project ID, revision and snapshot key that produced it. Candidate engineering operations are applied through existing project validators and produce another copy revision. A trial can run the normal deterministic solver against that copy and records the input check, solver stage, diagnostics, target identities and result source.

Trials do not attach results to the formal project. A trial that solves is reported as numerically solved while engineering validity remains unvalidated. A failure keeps the actual stage and evidence; a singular pivot remains a clue rather than a uniquely asserted cause. Comparing trials requires the same diagnostic copy and compatible source/result identities.

The AI tools expose inspection, copy creation, bounded trial execution, reads, comparison and discard. If the formal project revision changes, the old copy is rejected. Applying a candidate to the formal model remains an existing proposal and confirmation operation.
