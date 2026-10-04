# T2-07 Acceptance Record

Date: 2026-10-04 (Asia/Taipei)

| PLAN2.0 criterion | Evidence |
| --- | --- |
| Complete input, geometry, topology, connection and solver evidence | `checkDiagnosticCopy` reuses `checkAnalysisInput`; `runDiagnosticTrial` preserves `AnalysisFailure.stage`, diagnostics and stable targets. `inspect_diagnostics` covers both pre-check and solver stages in one isolated run. |
| Independent diagnostic identity and source | A copy has its own project identity and a source containing formal project ID, revision and snapshot key. Results use the copy project ID and are never attached to formal history. |
| Read, trial and comparison isolation | `readDiagnosticCopy` returns bounded copy collections; candidate operations use existing project validators; `compareDiagnosticTrials` delegates compatible numerical comparison and reports incompatibility rather than inventing deltas. |
| Automatic checks versus engineering changes | Tool input and source freshness are checked automatically. Support/load/member/geometry candidates stay in the copy; formal application still requires existing drafts and confirmation. |
| Evidence summary and success distinction | Every trial records evidence, proven facts, hypotheses, attempted methods, impact and remaining questions. Successful solves explicitly retain `numerically-solved-not-engineering-validated`. |

This is deterministic implementation evidence. Live provider reliability, exploration budgets and cross-restart persistence remain owned by T2-08 through T2-11.
