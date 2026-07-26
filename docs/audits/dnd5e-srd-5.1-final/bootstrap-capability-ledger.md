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
is represented by structured, stable query IDs in `packEvidence`. The validator
executes their registered evaluator against the committed `records.json`, which
emits `{recordKey, clauseId, path, sourceSpan}` identities. A query cannot
silently target another engine family. The source-negative rows also state
explicitly when the reproducible second input is unavailable and name the
follow-up that will supply it; their projected-side query is not presented as
a source comparison.

Rows are at primitive granularity. A family such as `engine:F5` therefore has
separate rows for instance spend, recharge scheduling, attunement/curse
constraints, and containment/card-pool state. `capabilityId` is the qualified
family routing key; `primitive` is the actual implementation requirement.
Every owned row names a specific owning bead. A genuinely unowned future row
may use `owningBead: null` with `ownershipStatus: proposed-new-bead`, a proposed
title, and a parent. Most current rows are owned by the open family epics
`eshyra-o9bd.19.5.2` through `.11`; that is correct before decomposition runs,
since the implementation children deliberately do not exist yet. An owned row
may never fall back to the engine epic root `eshyra-olc5`, which would mean no
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

The exact non-pack-discovery set is pinned to these seven primitives:

1. `legendary-action-allowance-and-option-cost`
2. `owned-entity-and-repeat-trigger-lifecycle`
3. `containment-portal-and-card-pool-instance-state`
4. `suffocation-and-ongoing-damage-state`
5. `planar-return-and-declared-window-clocks`
6. `point-origin-area-geometry-and-targeting`
7. `damage-rider-and-half-damage-branch-resolution`

They are discovered from source/audit/code evidence without a corresponding
complete projected readiness hook. Retained asset creation is deliberately not
in this set because its row also lists `readiness-artifacts`. The
legendary-action row is the worked example: the source and audit require a
per-round budget and per-option costs, while the current projected mechanics
cannot reveal that missing source clause by themselves.

Snapshot provenance: commit `4384f25`. No fixed total or arbitrary per-family
upper bound is part of the validator contract. Consumers should execute the
registered queries in `packEvidence` against the current corpus. The validator
requires at least two rows per family, unique primitives, and unique
family/primitive pairs. This ledger is a bootstrap inventory, not a claim that
the current pack is clause-complete.
