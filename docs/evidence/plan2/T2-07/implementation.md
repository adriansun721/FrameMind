# T2-07 Implementation Record

Date: 2026-10-04 (Asia/Taipei)

`src/workspace/diagnostic-trial.ts` defines an isolated diagnostic copy with its own identity, source project/revision and trial history. Candidate operations reuse the project domain validators for supports, nodal and uniform loads, self weight, node positions and member properties. Each operation returns a new copy; it never calls `attachAnalysisResult` on the formal project.

`runDiagnosticTrial` first checks input, topology and restraint evidence, then runs the existing deterministic solver only against the copy. Failures retain the solver stage, structured diagnostics and locatable targets. Successful numerical results are marked `numerically-solved-not-engineering-validated`, so numerical completion is not presented as engineering correctness. Trial summaries have separate evidence, proven causes, hypotheses, attempted methods, impact and remaining items fields.

The AI boundary exposes `inspect_diagnostics`, `create_diagnostic_copy`, `run_diagnostic_trial`, `read_diagnostic`, `compare_diagnostic_trials` and `discard_diagnostic_copy`. The copy source revision is checked before every read or trial; a changed formal model requires a new copy. Formal changes remain on the existing proposal and confirmation paths.
