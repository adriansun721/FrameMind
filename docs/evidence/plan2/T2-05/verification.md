# T2-05 Verification Record

Date: 2026-10-04 (Asia/Taipei). Platform: local Windows, Electron 44.5.1. Network replies were deterministic fixtures, not live AI requests.

| Check | Result |
| --- | --- |
| `npm run build` (includes renderer/main type checks) | Passed. Existing large-bundle warning remains. |
| Focused `ai-task.test.ts` and `draft-coordination.test.ts` | 2 files, 28 tests passed. |
| `npm test -- --testTimeout=15000` | 44 files, 322 tests passed. |
| New T2-05 Electron replay | All 7 scenarios passed. |
| Related T07, T2-02, T20, T21, T22, T23, T25, T26 and T27 Electron replay | All 11 selected regressions passed; combined desktop run: 18 passed in 1.1 minutes. |
| Deep/light theme screenshots and canvas pixels | Inspected 1440x900 dark and 1080x760 light. No horizontal document overflow. Sampled canvas color counts: 515 and 495, both above the nonblank threshold of 12. Conflict screenshot inspected separately. |
| Independent Standards and Spec reviews | Findings fixed and original reproductions rechecked; zero remaining concrete findings on either axis. |

Desktop command:

```powershell
node scripts/run-e2e-isolated.cjs e2e/plan2-t2-05-coordination.spec.ts e2e/t07-synchronized-editing.spec.ts e2e/t20-basic-edit-tools.spec.ts e2e/t20-ai-boundaries.spec.ts e2e/t21-frame-proposal.spec.ts e2e/t22-stage-confirmation.spec.ts e2e/t23-analysis-conditions.spec.ts e2e/t25-result-references.spec.ts e2e/t26-section-comparison.spec.ts e2e/t27-ai-recovery.spec.ts -g 'T2-05|T07|T2-02|T20 keeps browsing|T21 retains current|T22 refreshes compatible|T23 reports model-check|T25 reads real|T26 keeps a pending|T26 preserves submitted|T27 keeps an unconfirmed'
```

The public task regression for deleting unrelated selection N1 while a draft targets N2 failed with `missing-input` before the fix, then passed with `completed`, two requests and no formal support mutation. Other review regressions cover consecutive component edits and retained historical citations. The dirty-condition desktop scenario initially timed out on an incorrect tree label, then on the save button covered by the open drawer. The corrected scenario selects `L1 / N2` by the actual button label and submits the manual FY field with Enter, preserving the dirty card until preview update. It passed individually and in the final combined run.

Artifacts: [dark targets](targets-dark-1440.png), [light targets](targets-light-1080.png), [component conflict](component-conflict.png), and [saved target/readback/canvas evidence](stable-targets.json).

Limits: the full Electron suite was not run; this record covers the selected 18 scenarios. No live provider, crash injection, persistent task queue, cross-restart task recovery or clean Windows installation was tested. Task/session history remains in memory. Later PLAN2.0 tasks retain responsibility for those results.
