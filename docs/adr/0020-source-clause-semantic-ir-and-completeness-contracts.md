# ADR 0020: Source-Clause Semantic IR and Completeness Contracts

- **Status:** Accepted
- **Date:** 2026-07-26
- **Bead:** eshyra-o9bd.19.1.1.4 (correction of PR #475)
- **Refines:** [ADR 0017](0017-rules-pack-compiler-and-executable-curation-architecture.md)

## Context

A record-shaped projection can look plausible while omitting a repeated save,
option-local outcome, duration, recurrence, immunity window, termination, or
lifecycle transition. The producer must not define the source inventory or the
standard by which its output is graded.

## Decision

### One obligation per clause

The source clause is the unit of one source obligation. `sourceObligationIds`
therefore contains exactly one ID at runtime. A single obligation may carry
many facets: for example, save, duration, repeat-check, and termination can all
come from one source sentence. Genuinely separable mechanics become separate
clauses, each with its own obligation and projection. This is the load-bearing
invariant: it prevents two obligations from sharing one atom family, makes
negative facets local to one obligation, and prevents option-local mechanics
from being hoisted into a broader clause.

### Canonical base and facet contracts

Every obligation is evaluated against unremovable canonical base requirements:
complete stable identity, exact non-empty source spans, provenance, semantic
ownership, and record ownership. Caller extensions are additive and cannot
replace or weaken these requirements.

Facet contracts are composable, not universal `ClauseKind` contracts. Specialized
facets are closed under their base mechanic: save variants imply `save`, attack
variants imply `attack`, resource reset variants imply `resource-use`, duration
variants imply `duration`, and lifecycle variants imply `effect`. The canonical
vocabulary includes `recurrence` and `immunity-window` alongside duration,
repeat-check, and termination. Field-count multiplicity remains meaningful
within one facet.

Alternatives form a symmetric complete exclusion partition. Every alternative
must bind to at least one projected atom identity. Every represented branch
must have a source span belonging to the clause, a non-empty outcome, and
projected atom bindings. Shell branches and empty option lists do not discharge
source semantics.

### Evidence-bound identity and capture

An obligation ID is `obl:::sourceRef:::locator:::facet`. Its source reference,
locator, and terminal facet must agree with origin-appropriate authoritative
evidence: source spans for `source-extraction`, authoritative inputs for
`curated-specification`, and source-located audit findings for
`audit-finding`. Repeated source occurrences use distinct stable locators;
synthetic locator divergence is rejected.

`CAPTURED` can be satisfied only by matching source-span or
authoritative-input evidence tied to that obligation. Audit findings and
known-missing-source-clause evidence identify a gap and can never close it.
`PROJECTED` is derived from the canonical evaluator. `SUPPORTED` and
`DISCOVERABLE` are independent readiness dimensions; none of the four may be
collapsed into another.

### Scope and closure authority

Source membership is the independently constructed `ObligationScope`, not the
set a projector emits. Scope construction validates applicability evidence,
membership, family, and record key, then returns an opaque branded,
deep-frozen value. Closure refuses raw structural lookalikes, accepts claims
only from clauses with the exact family and record owner, and reports
out-of-scope or wrong-record claims. Family applicability, obligation
membership, per-obligation completeness, and aggregate closure remain distinct.

### Capability identity

Engine capabilities are the closed identities `engine:F1` through `engine:F10`.
Each reference must name an owner under the `eshyra-olc5` capability family,
resolve through the injected capability resolver, and be implemented. The
required capability references and `readiness.supported` references must be
identical; either surface alone cannot self-attest support. The actual
capability ledger and engine implementations remain outside this ADR.

Validated registry records and scopes are deep-copied and deep-frozen so later
mutation cannot change an evaluation result.

## Cross-PR identity honesty

The current repositories share the spelling convention for `obl:::` IDs and
the evidence-kind vocabulary, but they do not yet share a mechanically
validated implementation. PR #476 currently has
`MembershipIdentity{recordKey, clauseId?, path?, sourceSpan?}` and no
`obligationId`; PR #477 currently accepts a broad `obl:::` string. The
obligation ID/evidence contract in this ADR is therefore not claimed as an
existing integration boundary. Validated adapters or parity tests are required
before #475, #476, and #477 can treat it as one.

## Consequences and scope

This ADR closes silent partial projection at the design/type-contract boundary
while permitting shared normalized primitives, kind-specific composition,
curated source-backed specifications, and explicit unsupported or
model-adjudicated clauses. It does not implement importer migration, source
census, generated pack regeneration, discovery indexing, the capability
ledger, or engine certification.

## Rejected alternatives

- Letting a clause carry its own obligations: the producer could omit the
  source inventory or weaken its grading standard.
- Allowing multiple obligations per clause: one projection could satisfy two
  source obligations through shared atoms and option-local mechanics could be
  hoisted.
- Universal kind contracts: sibling mechanics include non-damaging saves and
  non-concentrating durations.
- Audit evidence as capture: a finding describing a missing clause is not the
  missing source clause.
- Structural scopes and arbitrary capability strings: both permit forged
  authority and stale readiness.
