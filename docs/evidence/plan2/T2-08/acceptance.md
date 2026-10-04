# T2-08 Acceptance

- [x] Normal mode has a 4-minute active budget; deep mode has a 12-minute active budget and is user-selected. The result exposes mode, configured budget, elapsed active time and waiting time.
- [x] Rounds, provider calls, candidates, analyses, single-analysis duration and resource limits are recorded. Waiting for confirmation or input does not consume active time, and no completion time is promised for an individual solve.
- [x] Repeated evidence, repeated failures and resource exhaustion have explicit stop reasons. Existing diagnostic, trial, draft and tool records remain available with a next-step message.
- [x] Pause interrupts the current request, stops further work and marks the shared task paused; cancel marks the task cancelled. Late success cannot publish a result after either interruption.
- [x] Resume uses the existing task messages and counters. Budget extension and deep mode are explicit user actions; retries and supplements do not add budget automatically.

Real provider latency, solver cancellation under load and full-agent reliability remain covered by the later T2-11/T2-41 integration milestones.
