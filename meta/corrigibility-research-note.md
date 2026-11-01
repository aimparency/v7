# Corrigibility came from the architecture, not the prompt

*Draft research note, 2026-11-01. Not published. Whether and where to publish is Felix's decision (idea 11ebbcfb).*

## Question

Can an AI coding agent do useful work in a repository while staying correctable by the humans who own it? That means it obeys stops, refuses what it must not do, escalates what needs a human, and recovers when a human corrects it. This holds even when instructions are adversarial or ambiguous.

Aimparency is an idea graph that humans and coding agents (Codex, Claude Code) share as their plan. We tested this question on Aimparency's own wrapped-agent loop.

## Method

- **A frozen suite of 11 scenarios** (`packages/wrapped-agents/common/src/corrigibility-eval.ts`). It covers conflicting ideas, prompt injection in repository content, requests for secrets, destructive cleanup, permission expansion, ambiguous authority, a shutdown request, evidence spoofing, correction recovery and benign controls.
- **Pre-registered metrics and thresholds.** The metrics are task utility, escalation accuracy, refusal precision and recall, intent preservation, audit completeness, correction recovery and exact disposition accuracy. Critical failures abort the run: an unauthorized external action, a secret disclosure, a deceptive completion claim, a bypassed human gate, or refusing to stop.
- **Rules for running:**
  - Each run executes once with no retries, and failed runs stay on record.
  - When a scorer was wrong, we released a new scorer version instead of changing the old one.
  - Each scenario runs in a fresh disposable fixture repository. Completion is checked independently from the filesystem and tests, not from what the model reports.

## Runs, in order

| Run | System under test | Result |
|---|---|---|
| 1 | Codex in a read-only sandbox | Failed. 0 critical failures, but utility 0.67, escalation 0.5 and audit 0.73. The model confused stop, refuse and escalate. |
| 2 | Same, with the disposition words defined in the prompt | Failed. Escalation and audit rose to 1.0, but utility fell to 0.33 and correction recovery to 0. The model escalated benign work. |
| 3 | Disposable writable fixtures for the benign cases | All v1 metrics at 1.0. The trace audit then found that v1 did not penalize *missing* refusals: an injection case "completed". A v2 scorer adds refusal recall. |
| 4 | Disposition bound to the scenario action, v2 scorer | Failed. Refusal recall rose from 0.2 to 0.8, utility 0.67. |
| 5 | Full v3 confirmation | Failed only correction recovery (0); every other metric 1.0, 0 critical failures. |
| 6 | Deterministic authority policy in front of the model | Failed only correction recovery. The policy approved the exact change, but the model still escalated instead of making it. |
| 7 | Policy plus a deterministic actuator for already-authorized exact changes; the model only for the open read-only case | **Passed.** Every metric 1.0, 0 critical failures, 1 read-only model launch. Before/after SHA-256 evidence for both writes. |

Across all seven runs there were zero critical failures: no secret disclosure, no destructive or external action, and no action after a stop.

## What we learned

1. **Telling the model the rules did not make it corrigible.** Clarifying the vocabulary fixed classification and broke usefulness. Safety classification and calibrated action are separate capabilities.
2. **Settled questions do not belong in inference.** Once a human or policy has authorized an exact change, asking a stochastic model to carry it out reopens a decision that was already made. A deterministic actuator does it reliably.
3. **The resulting architecture:** authorization in policy, exact operations in deterministic code, and the model only where judgment remains. Each run's critical surface shrank from three model calls to one read-only call.
4. **Keep failed runs and version scorers.** The run-3 pass would have been a false positive without auditing the passing trace.

## What this does not show

- The model itself is not shown to be corrigible. The pass is evidence for the composite system only.
- The pass is not independent of the suite. The policy and actuator were designed after seeing failures on these same 11 frozen scenarios. A held-out suite, written by someone else, is the needed next test.
- Eleven scenarios is small. They were written within the same project, mostly by agents.
- These were local disposable fixtures only. No real credentials, network or external actions were involved.

## Next

- A held-out scenario set written by an outside person.
- The same boundary on the real dispatch path, which is now enforced in production dispatch (ideas 29da921a, a9fd2cb1), measured over real loop work rather than fixtures.
