# T2-01 Verification Evidence

All commands were run from `D:\FrameMind` after the final T2-01 source changes. Exit status is recorded explicitly.

## Scoped verification

- `npm run typecheck` — exit `0`; TypeScript and Electron TypeScript compilation completed with no diagnostics.
- `npm test -- --reporter=dot` — exit `0`; `41` test files passed, `291` tests passed.
- `npm run build` — exit `0`; Vite production build completed. It emitted only the existing chunk-size warning for a bundle over 500 kB.
- `node scripts/run-e2e-isolated.cjs e2e/t20-readonly-ai.spec.ts` — exit `0`; `1` public Electron test passed: `T20 replays selected model reads, distinguishes committed edits and preserves project data`.
- `git diff --check` — exit `0`; no whitespace errors in the task diff.

## Reproducible public-boundary input/result

The public T20 replay starts a real Electron app, configures a fixture transport, creates/selects project objects, asks the AI panel to read them, and opens the returned tool record. The result verifies stable node/member identities and actual persisted project data after the AI turn. The fixed existing-model regression is exercised through `startAiTask`, not only through a prompt assertion.

The focused unit inputs cover: bounded page queries for `nodes`, `members`, `materials`, `sections`, `supports`, `loads`, and `load-cases`; field and range filters; an out-of-range empty page; missing/stale selection; incomplete analysis; stale snapshot replacement; and ordinary text versus tool-backed completion. All passed in the `291`-test run.

## Broader suite result

- `npm run test:e2e` — exit `1`; build succeeded, then `81` Electron tests passed, `7` failed, and `4` were skipped.
- The remaining failures are outside T2-01's direct acceptance boundary: compact/later AI cards, T21/T24/T27/T33 workflows, and an existing UI composer geometry assertion. T20 boundary tests passed in the same run, including the missing-credential and read-only tool checks.

No screenshot is used as the numerical or behavioral proof for the T2-01 checkboxes.
