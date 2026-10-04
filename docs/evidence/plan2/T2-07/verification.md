# T2-07 Verification Record

The following checks passed on 2026-10-04:

- `npx vitest run src/workspace/diagnostic-trial.test.ts src/workspace/ai-tools.test.ts electron/deepseek-chat.test.ts`: 46 tests passed.
- `npm run typecheck`: renderer and Electron TypeScript checks passed.

The focused tests cover a missing-restraint model, an isolated support candidate, a successful candidate solve, source revision invalidation, copy reads, numerical comparison and formal-project non-mutation. The AI tool test also verifies that a diagnostic trial does not create a formal support or analysis result.
