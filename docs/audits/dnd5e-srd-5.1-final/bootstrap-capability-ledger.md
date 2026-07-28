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
is represented by a row-owned `evidence` array and checked against the
versioned `primitiveRoster` exactly in both directions. Evidence is a closed,
discriminated union: `readiness-artifact`, `code`, `bead`, `audit-finding`, and
`known-missing-source-clause`. Evidence items use a distinct, registry-wide
`ev:::...:::...:::...` identity. Only genuine source-negative obligations use
the shared four-segment `obl:::sourceRef:::locator:::semanticFacet` identity,
and the source and locator must match that item's authoritative anchor. The
facet vocabulary is duplicated from the clause-IR contract and parity-tested;
empty or non-canonical segments are invalid. No one `sourceSpan` field is
overloaded across evidence types.

Readiness artifacts use a registered query ID and an exact structured hook
selector: `engineHooks[].engine` and the hook's `name`/`id`/legacy `hook` value
must equal the selector. There is no substring matching. The evaluator emits
`{recordKey, clauseId, path, sourceSpan: {source, locator}, hook}` identities
and fails when a required baseline is empty. An explicitly reviewed absent
selector returns an absence result rather than silently passing an empty query.

The other resolvers are independent: code checks the named module and symbol
in `@eshyra/core`; bead evidence checks through `bd` and skips only when the
binary is absent; audit evidence resolves a fully qualified known finding
alias against the committed `auditFindingSubjects` and reviewed
`auditFindingPrimitiveRelations` tables and requires a unique, row-specific
relevance statement; and known-missing-source evidence resolves a real SRD
record/source/locator anchor plus recorded source terms, then evaluates a
closed predicate across every structured projection surface in every pack
record. Predicates see exact schema/path keys, so sibling fields and
projections owned by a different record are evaluated together rather than
being hidden behind the source anchor. A recognized, partial, or
applicable-but-unrecognized shape returns `evidence-underived`. The walker
emits the root `data` node, scalar nodes, and primitive array-item nodes, so a
predicate cannot make a listed path disappear merely because its value is not
an object. Every emitted path is classified for each shape as a match,
explicitly registered irrelevant metadata/provenance, or unclassified. Only a
complete scan with no match or unclassified node can prove absence; an
unregistered schema-valid field is therefore `evidence-underived`, not
silently irrelevant. The regression matrix is generated from the twelve
`ProjectionShape` values and covers scalar, primitive-array, split-sibling,
cross-record, and schema-valid unregistered-key representations. Underived
results block the exported fail-closed closure predicate. It never searches
for invented sentinel strings, uses substring aliases, or treats inability to
recognize a structure as evidence of absence.

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

Snapshot provenance: commit `4384f25`. The validator requires exact equality
with `bootstrap-capability-roster-v1`, at least two rows per family, unique
primitives, unique family/primitive pairs, registry-wide evidence and source
obligation identities, one unambiguous owner for every readiness or projection
query ID, no same-row query duplicates across either query kind, matching
owner/bead evidence, semantically resolved audit relevance, and evidence for
every source named by a row. Five unsupported audit citations are deliberately
dropped: spellbook copying, short-rest Hit Dice recovery, derived attack/AC/
proficiency modifiers, canonical currency mutation, and downtime procedures.
The current pack contains partial projected shapes for all twelve
source-negative primitives; those rows remain inventory-visible but resolve as
`evidence-underived` until a clause-complete absence proof exists. Consumers
should execute every row's evidence array against the current corpus and pass
the resolutions to `evaluateBootstrapLedgerClosure`; its blockers name the
exact row/evidence identities that prevent closure. This ledger is a bootstrap
inventory, not a claim that the current pack is clause-complete.
