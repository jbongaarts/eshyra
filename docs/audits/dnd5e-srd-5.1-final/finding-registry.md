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
- `invariant` states the requirement positively and survives a successful
  repair.
- `violation` names the generated query for the current defect and records
  whether that defect is expected to become `empty` or remain `stable` after
  repair. A disappearing violation therefore does not erase the obligation.

`baselineMembership` is the audited, checked-in snapshot of exact identities.
It is evidence, not a copied total. `membershipDerivation` records how the
snapshot was generated from the committed corpus (record-kind, readiness-clause,
half-damage-branch, or artifact enumeration) and names the source authority.
`evaluateMembershipQuery` joins the durable expected identities to the current
pack and artifact files, returning expected, current, and missing identities
separately. Validation compares the complete sets, so losing one member fails
rather than merely remaining non-empty.

## Membership derivation and closure

Rows have one of two mechanically enforced membership statuses:

- `derived` means a named executable query is the authority for the baseline.
  Validation reruns that query against the committed pack and requires the
  complete identity set to match the stored snapshot. A single-record result
  is valid only when the query proves that it is the complete result.
- `underived` means the complete population still requires reconciliation to
  the prose of the four audit reviews. It carries a distinct
  `underivedReason` describing the interpretation still needed for that row and
  names `eshyra-o9bd.19.1.7`, which owns that derivation work. A reason may not
  be a canonical-ID template or be reused by another underived row.

`findingRegistryClosureReady()` is the fail-closed gate: it returns false
while any row is underived. `findingRegistryClosureBlockers()` returns the
offending canonical IDs. The gate becomes true only after every row is
classified as derived; underived snapshots therefore cannot masquerade as
closure evidence.

Record identities can include an exact clause ID or data path. Artifact
identities can include an exact artifact path and JSON path, which allows
findings outside `records.json`—such as manifest provenance—to remain
observable.

The validator rejects duplicate canonical IDs, duplicate aliases, malformed
obligation IDs, pack self-authority, generic selectors, malformed nested
identities, baseline/selector drift, partial current membership, templated
invariants, non-specific underived reasons, and forbidden hand-copied totals.
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
