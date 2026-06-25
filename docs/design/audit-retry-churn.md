# Audit Retry Churn

The expensive retry path is a rejected primary-DM candidate followed by another
primary-DM candidate. Auditor tokens are useful to measure, but total accepted
turn cost is dominated by how often audit rejection forces another primary-DM
generation.

The runtime records retry churn in three layers:

- model usage records distinguish primary-DM model calls (`gameplay_turn`) from
  auditor calls (`turn_audit`) and carry candidate attempt/round metadata where
  available;
- per-candidate audit diagnostics record the audit action and structural retry
  cause;
- the terminal turn outcome aggregates auditor call count, primary-DM candidate
  count, primary-DM retry count, retry success, and tools rerun during an
  accepted retry.

Retry causes are intentionally coarse. They project structured auditor verdicts
and deterministic failed-tool evidence into cost buckets such as missing roll
visibility, missing state, missing world evidence, invalid target, disallowed
tool, and possible auditor over-rejection. They are diagnostics, not a second
auditor.

Presentation-only repair is safe only when the tool calls, state writes, and
model-declared roll visibility/category metadata are already valid. The engine
already owns deterministic rendering of the player-visible roll ledger from
successful roll tool results, so a wrong or incomplete hand-written `Rolls:`
section should not require regeneration. Missing or incorrect visibility
metadata is different: the visibility choice is model-owned reasoning and must
be audited. Until there is an explicit structured patch path for the auditor to
say "state/tool evidence is valid; replace only presentation from code-owned
data," the orchestrator keeps fail-closed behavior and retries the primary DM
for those cases.

