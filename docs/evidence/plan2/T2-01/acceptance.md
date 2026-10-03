# T2-01 Acceptance Evidence

## 1. Existing model is not treated as empty

- Passed: `true`.
- Fixed scenario: an existing project is opened/edited, then the public AI task entry is invoked. `startAiTask` records a local `read_model(summary)` before the model response, and the public Electron test `e2e/t20-readonly-ai.spec.ts` passes.
- Regression proof: `src/workspace/ai-task.test.ts` test `reads an existing project before the model can answer from an empty assumption` passes.
- Limitation: this is a deterministic public-boundary transport replay; no live provider request was executed, and the limitation is recorded in `implementation.md`.

## 2. Task context and collection queries

- Passed: `true`.
- `src/workspace/ai-tools.test.ts` covers project/revision/selection reads and every supported model collection with bounded pages. `src/workspace/ai-task.test.ts` verifies the task begins with a real local read and passes the current goal/context into the task.
- `e2e/t20-ai-boundaries.spec.ts` mixed stable-identity node/member read passed during the focused run and the full Electron run.
- Result: nodes, members, materials, sections, supports, loads, load cases/combination context, and analysis/result context are available through the read boundaries without mutation tools.

## 3. Pagination, empty/stale/incomplete semantics and snapshot isolation

- Passed: `true`.
- `src/workspace/ai-tools.test.ts` test `returns bounded field/range pages, explicit empty-page semantics and a real state receipt` and malformed/unbounded-query tests pass.
- `src/workspace/ai-task.test.ts` tests `cancels a task when a reload changes the captured snapshot even if the caller flag remains true` and obsolete-context suppression pass.
- `src/workspace/ai-results.test.ts` covers absent objects, invalid fields/positions, and historical inputs after edits.

## 4. Receipts and distinct lifecycle states

- Passed: `true`.
- Tool results include context/object/input revision and real-state metadata; `AiTaskResult.lifecycle` records initiated request, response kind/state, and task state.
- The public UI exposes in-flight/paused status, ordinary text completion, task outcomes, and expandable tool input/output records. The focused T20 public Electron test passed.
- `src/workspace/ai-task.test.ts` covers ordinary text without tool evidence, tool-backed completion, cancellation, interruption, and retry identity.

## 5. Numeric explanations use real analysis identity and timeline

- Passed: `true`.
- `src/workspace/ai-results.test.ts` covers incomplete-analysis refusal, selected user-defined combination identity, actual result evidence, invalid/fabricated references, and historical coordinates after an edit.
- Result references preserve analysis identity, frozen input revision, object identity/position, source case/combination, component/unit, and current-versus-historical state.
- The test suite passed `41` files and `291` tests.
