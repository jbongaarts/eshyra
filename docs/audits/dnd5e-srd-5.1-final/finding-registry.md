# Foundation 2 finding registry

## What this artifact is

This JSON registry preserves durable audit facts from four independent reviews:
68 canonical findings and 70 qualified aliases (`opus`, `sol`, `fable`, and
`indep`). It preserves the audit's conclusions so they remain reviewable during
the repair program. The JSON is the source of truth; this document is its
contract, not a second copy of the row data.

## What this artifact explicitly does not claim

The `explicitNonClaims` field mirrors these boundaries. This registry does not
claim executable exact membership, a derived or complete population for any
finding, zero-repeat/no-recurrence certification, closure-readiness, capability
evidence, or whether the current pack violates any row. Foundation 3
(`eshyra-o9bd.19.1.7` and `.19.1.8`) owns baseline/current membership and closure
evidence. Foundation 4 (`eshyra-o9bd.19.1.16`) owns capability evidence.

## Row contract

Each row has six independent field groups:

- `canonicalId`: the stable audit-finding label.
- `aliases`: qualified review labels; each alias resolves to one row.
- `invariant`: generalized invariant prose, not a typed executable contract.
- `status` and optional `statusReasoning`: the audit disposition. Reasoning is
  required for every status other than `accepted`.
- `provenance`: the row's audit alias and local `evidenceBasis` describing how
  the fact was evidenced. This vocabulary is not Foundation 1's clause-IR
  `EvidenceKind` identity.
- `scopeKind` and `owningBead`: a descriptive audited-thing category and the
  responsible repair bead. `scopeKind` is not a selector and confers no
  membership.

## Separability and ownership

Audit fact, provenance, aliases/status, and owner remain separate fields; none
is derived from another. Baseline affected membership, current violation
membership, and permanent closure evidence are deliberately absent, rather
than empty placeholders. They belong to Foundation 3 (`eshyra-o9bd.19.1.7`,
`.19.1.8`), while capability membership/evidence belongs to Foundation 4.

## Salvage and narrowing

The registry was mechanically transformed from PR #476 in row order. Its
canonical IDs, aliases, statuses/reasoning, audit provenance, scope labels,
invariant prose, and owners were salvaged verbatim. The category-error
`obligationId` was dropped because source-obligation identity belongs to
Foundation 1. The uniform typed `invariant` object was dropped: its dimensions
and structure were byte-identical across rows, while `title` carried the actual
row-specific prose and becomes `invariant` here. The redundant `regression`
object was dropped because it repeated `owningBead` and `bead` evidence.

The entire membership, violation, capability, and closure layer was dropped.
The reviewer decision forbids reserved-but-empty placeholders: even an empty
membership shape would pre-commit Foundation 2 to a Foundation 3 contract and
invite later unreviewed population.

`validateFindingRegistry` is the mechanical boundary. It enforces strict
top-level, row, and provenance shapes, exact canonical/alias inventories,
uniqueness, and field types. Its deny-list rejects membership, capability, and
closure fields with an error naming Foundation 3 / Foundation 4 as owners.
