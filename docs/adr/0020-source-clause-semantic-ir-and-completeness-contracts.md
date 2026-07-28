# ADR 0020: Source-Clause Semantic IR and Completeness Contracts

- **Status:** Accepted
- **Date:** 2026-07-28
- **Bead:** eshyra-o9bd.19.1.1.5 (reduced scope of PR #475)
- **Refines:** [ADR 0017](0017-rules-pack-compiler-and-executable-curation-architecture.md)

## Context

A record-shaped projection can look plausible while omitting a repeated save,
option-local outcome, duration, recurrence, immunity window, termination, or
lifecycle transition. The source-clause contract must make that omission
observable without making every mechanic conform to one universal runtime DSL.

The authority that enumerates source obligations is a separate concern. A
projector must not define the source inventory or the standard by which its own
output is graded, but this ADR does not create that authority or claim that a
caller-selected list is source-complete.

## Decision

### Clause and obligation boundary

`Clause` carries source-obligation IDs, and each clause must name exactly one
obligation. A single obligation may carry multiple semantic facets; genuinely
separable source mechanics become separate clauses. The per-clause evaluator
looks up that obligation through the `ObligationSource` interface. It does not
construct, validate, freeze, or otherwise certify the source authority.

The source obligation record supplies the facet vocabulary and evidence needed
by the evaluator. Canonical base requirements—identity, source spans,
provenance, semantic owner, and record owner—are always applied. Caller
extensions may add diagnostics but cannot remove those requirements.

### Facets and completeness

Facets are composable rather than universal `ClauseKind` contracts. Specialized
facets imply their base mechanic: save variants imply `save`, attack variants
imply `attack`, resource reset variants imply `resource-use`, duration variants
imply `duration`, and lifecycle variants imply `effect`. The vocabulary includes
duration, recurrence, repeat checks, immunity windows, and termination.

The evaluator returns structured per-clause failures. It checks field
cardinality, branch and alternative bindings, projection identity, and the
one-obligation rule. `CAPTURED`, `PROJECTED`, `SUPPORTED`, and `DISCOVERABLE`
are reported independently. Semantic completeness answers whether source
semantics were captured and projected; support and discovery remain readiness
dimensions and may fail without making a captured/projected clause semantically
incomplete.

Only source-span or authoritative-input evidence can satisfy `CAPTURED`.
Evidence that reports an audit gap cannot close it. Engine capabilities are the
closed identities `engine:F1` through `engine:F10`, with ownership checked by
the injected capability resolver; capability failures remain in `SUPPORTED`.

## Explicitly separate work

Obligation authority—source census, registry construction and validation,
evidence taxonomy and multi-part evidence semantics, identity uniqueness, and
immutable facet/record authority—is owned by `eshyra-o9bd.19.1.12`. Aggregate
scope membership and closure—family applicability, record ownership, sealed
scope construction, and corpus-wide reconciliation—is owned by
`eshyra-o9bd.19.1.13`. Those concerns are deliberately absent from this ADR’s
implementation boundary; no hollow registry or scope factory is provided here.

Exact source values and relationships, production census/resolvers, importer
migration, generated-pack regeneration, the capability ledger, and engine
certification remain separate work.

## Cross-PR identity boundary

PR #475 and PR #477 share the mechanically joinable obligation identity
`obl:::<sourceRef>:::<locator>:::<facet>` for genuine source obligations. PR
#476 does not participate: it uses
`MembershipIdentity{recordKey, clauseId?, path?, sourceSpan?}` without an
`obligationId`; bridging it remains `eshyra-o9bd.19.1.7`’s responsibility. This
ADR does not claim parity that does not exist.

## Consequences

This reduced contract closes silent partial projection at the per-clause
type/evaluation boundary while permitting shared primitives, kind-specific
composition, curated source-backed specifications, and explicit unsupported or
model-adjudicated clauses. Source authority and aggregate closure can evolve
independently and will join through the obligation lookup boundary.

## Rejected alternatives

- Letting a clause define or validate its own source inventory: the projector
  could omit the very obligation being graded.
- Universal kind contracts: sibling mechanics include valid non-damaging saves,
  non-concentrating durations, and other compositions.
- Collapsing readiness into semantic completeness: a complete projection can
  legitimately await an engine capability or discovery path.
- Providing a hollow registry or scope constructor here: an unbacked authority
  would make the boundary look stronger while remaining forgeable.
