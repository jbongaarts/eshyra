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
Every row names a specific owning bead. Most are owned by the open family epics
`eshyra-o9bd.19.5.2` through `.11`; that is correct before decomposition runs,
since the implementation children deliberately do not exist yet. What a row may
never do is fall back to the engine epic root `eshyra-olc5`, which would mean no
family owns the primitive at all.

Four cross-family primitives had no exact owner when this bootstrap ledger was
first assembled and were recorded as `proposed-new-bead` with a title and parent
as data — the bootstrap task itself does not create beads. Those four beads were
subsequently created by the supervisor and the rows now point at them:

| Primitive | Bead |
| --- | --- |
| `spellbook-copy-cost-and-asset-ledger` | `eshyra-o9bd.19.5.5.3` |
| `containment-portal-and-card-pool-instance-state` | `eshyra-o9bd.19.5.6.3` |
| `planar-return-and-declared-window-clocks` | `eshyra-o9bd.19.5.8.3` |
| `retained-inventory-property-xp-asset-creation` | `eshyra-o9bd.19.5.11.3` |

Each is blocked by its family's decomposition task, so decomposition reconciles
against it rather than re-creating it. A later pass that discovers another
unowned primitive should record it as `proposed-new-bead` the same way.

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
