# Acceptance 1 — Public existing-model regression

Passed: `true`.

The fixed existing-project scenario is exercised through `startAiTask` and the public Electron entry in `e2e/t20-readonly-ai.spec.ts`; the test passed with exit code `0`. The task records an internal `read_model(summary)` before the model answer, so the fix is execution-boundary behavior rather than prompt-only text. No live provider credential was used; that limitation is recorded in the implementation and verification evidence.
