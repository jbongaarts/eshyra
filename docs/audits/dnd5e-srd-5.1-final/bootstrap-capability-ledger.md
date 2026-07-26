# Bootstrap capability ledger — NON-AUTHORITATIVE

This is the bootstrap ledger for `eshyra-o9bd.19.5.1`. It is explicitly
**NON-AUTHORITATIVE**. The authoritative clause-complete ledger is
`eshyra-o9bd.19.5.12`; this artifact exists to make early engine gaps visible
and owned before the corpus is complete.

The JSON is assembled from five sources: `record.data.executionReadiness` in
the committed pack; the 2026-07-06 execution-boundary, engine-coverage,
rule-classification, and magic-item inventories; current code and open/closed
beads; accepted findings in the 2026-07-24 audit repair plan; and source
clauses named by those findings that the current projection omits. Membership
is represented by generated queries over `record.key`, never hand-copied hook
counts.

Rows are at primitive granularity. A family such as `engine:F5` therefore has
separate rows for instance spend, recharge scheduling, attunement/curse
constraints, and containment/card-pool state. `capabilityId` is the qualified
family routing key; `primitive` is the actual implementation requirement.
Ownership intentionally varies: existing open family epics are `owned`,
while cross-family gaps without an exact existing owner are
`proposed-new-bead` records. Proposed rows name a title and parent as data;
this bootstrap task does not create beads.

The non-pack-discovery proof is not a single family row. Several rows are
discovered from source/audit/code evidence without a corresponding complete
projected hook, including the legendary-action allowance and option-cost
budget, repeat-trigger/entity lifecycle, suffocation/ongoing-damage state,
point-origin geometry, damage-rider/half-damage branches, and retained asset
creation. The legendary-action row is the worked example: the source and audit
require a per-round budget and per-option costs, while the current projected
mechanics cannot reveal that missing source clause by themselves.

Snapshot provenance: commit `4384f25`. Counts from that snapshot are not
stored here; consumers should execute the queries in `packEvidence` against
the current corpus. This ledger is a bootstrap inventory, not a claim that
the current pack is clause-complete.
