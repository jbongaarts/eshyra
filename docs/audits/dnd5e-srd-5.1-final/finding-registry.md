# Durable finding registry

`finding-registry.json` is the single source of truth for the 68 audited
rows and 70 qualified aliases. This document describes the contract; it does
not repeat row data that could drift from the JSON.

## One row, two questions

Every row separates the durable obligation from the current defect:

- `obligation` identifies what must remain true. Its `obligationId` uses the
  shared cross-PR identity `obl:::<sourceRef>::<locator>::<facet>`, and its
  `authority` is an audit identity, source locator, authoritative input, code
  boundary, or bead—not the pack being repaired.
- `target` says exactly what the obligation is about. Its selector is a finite
  set of structured identities, never a substring, regular expression, prefix,
  or thematic record-kind search.
- `invariant` is a typed semantic-preservation contract: it names the
  dimensions (branches, alternatives, timing, lifecycle, and termination) to
  preserve and links them to the row's audit authority. It survives a
  successful repair without relying on generated prose.
- `violation` names the generated query for the current defect and records
  whether that defect is expected to become `empty` or remain `stable` after
  repair. A disappearing violation therefore does not erase the obligation.

`baselineMembership` is the audited, checked-in snapshot of exact identities.
It is evidence, not a copied total. `membershipDerivation` records the
candidate pack/artifact join and names the independent source authority. A pack
query is never sufficient to make a row derived: the current corpus can only
show which independently recorded identities are present.
`evaluateMembershipQuery` joins the durable expected identities to the current
pack and artifact files, returning expected, current, and missing identities
separately. Validation compares the complete sets, so losing one member fails
rather than merely remaining non-empty.

## Membership derivation and closure

Rows have one of two mechanically enforced membership statuses:

- `derived` means an independently authoritative, named executable query
  defines the complete baseline and the current corpus joins to it exactly.
- `underived` means the complete population still requires reconciliation to
  the source or prose of the four audit reviews. All 68 rows are currently in
  this honest state; each carries a structured `underivedReason` with a closed
  blocking cause and a resolvable `blockedBy` bead or artifact reference, and
  names `eshyra-o9bd.19.1.7`, which owns that derivation work. There is no prose
  normalizer or sentence blacklist: structured values either resolve or they
  do not.

`findingRegistryClosureReady()` is the fail-closed gate: it reruns the full
membership validation chain and returns false while any row is underived or a
derived row fails its executable generator, snapshot, or current-join checks.
`findingRegistryClosureBlockers()` returns the exact offending canonical IDs.
The gate becomes true only for a registry whose every row genuinely validates;
an all-derived status mutation cannot masquerade as closure evidence.

Record identities can include an exact clause ID or data path. Artifact
identities can include an exact artifact path and JSON path, which allows
findings outside `records.json`—such as manifest provenance—to remain
observable.

Capability memberships add the bootstrap ledger's qualified identity fields to
the exact record/clause locus: `capabilityId` (`engine:F1` through `engine:F10`),
the canonical primitive, an exact `hookSelector` when the pack supplies one, and
the owning family epic. The committed hook relation is multi-valued: a compound
hook emits one qualified membership for every applicable primitive, preserving
cross-primitive siblings rather than selecting a representative. Unknown,
near-match, and indeterminate hooks fail closed. Ownership is checked against
the ten historical family-epic bead IDs; it is not inferred from an ID prefix.
The capability identity types and canonical primitive roster are intentionally
duplicated locally until the bootstrap capability-ledger PR lands; the
integration follow-up can replace this small duplicate at the serialized
boundary without changing the identity spellings.

The validator rejects duplicate canonical IDs, omitted or unexpected canonical
rows/aliases, malformed
obligation IDs, pack self-authority, generic selectors, malformed nested
identities, baseline/selector drift, invalid structured invariants or
underived reasons, unresolved blockers, and forbidden hand-copied totals.
Empty current violation membership is governed by the typed
`violation.expectedAfterRepair` contract; there is no free-form
`zeroMemberPolicy` escape hatch.

## Coverage classes

The migrated rows include real examples of all ten required classes: a clause
missing from the current projection; a clause on the wrong owner; a wrong field
value; a missing branch or alternative; unsupported output whose authority is
outside the pack; provenance/locator defects; engine capability gaps; a defect
whose violation can become empty after repair; narrowed/ambiguous boundaries
whose exact target must not regress; and a cross-kind relationship spanning
multiple record families. The tests exercise these classes through their
typed evidence, target, baseline, and violation fields rather than through
copied row counts.

`indep:011` remains accepted: the source-defined language universe includes
the standard catalog, a campaign-common extension, and GM-approved
exotic/secret extensions. `sol:CAP-002` remains narrowed with its typed
condition no-regression obligation. `indep:001` and `sol:CAP-001` remain
separate rows because their gate and corpus defects can recur independently.

## Cross-PR identity boundary

PR #475 is implementing the same `obligationId` and closed `EvidenceKind`
union in clause IR. This branch intentionally duplicates only those small
types locally because the #475 branch is unfinished and cannot be imported.
The integration follow-up is to replace the temporary duplicate with the
shared clause-IR type once #475 lands, preserving the serialized identity and
the six evidence-kind spellings. No generated rules pack is regenerated here.
