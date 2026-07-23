# External-value run record

Copy `external-value-run-record.template.json` when a real external-value run
starts and validate the completed record against
`external-value-run-record.schema.json`.

The record is deliberately stricter than an internal activity log:

- use a named real organization rather than a mock beneficiary;
- link authoritative evidence instead of copying secrets into the record;
- distinguish granted authority from technical capability;
- record failures, recovery, human time, model cost, integration cost, and
  revenue;
- keep the external outcome `pending` until acceptance, use, merge, payment, or
  rejection has evidence from outside Aimparency;
- calculate `netValue` as revenue minus model, integration, priced human time,
  and other costs;
- preserve rejection and negative economics rather than rewriting the run as a
  success.

An agent-produced artifact and self-assessment do not complete the record.
External evidence is the terminal test.
