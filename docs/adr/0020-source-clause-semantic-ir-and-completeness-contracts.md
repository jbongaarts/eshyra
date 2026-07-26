# ADR 0020: Source-Clause Semantic IR and the Obligation Boundary

- **Status:** Accepted
- **Date:** 2026-07-26
- **Bead:** eshyra-o9bd.19.1.1.3 (correction of PR #475)
- **Refines:** [ADR 0017](0017-rules-pack-compiler-and-executable-curation-architecture.md)
- **Guidance:** [The Rules-Pack Compiler and Executable Curation](../rules-pack-compiler.md)

## Context

The rules-pack is both a source-faithful reference substrate and a semantic
substrate for the model/engine boundary. A record-shaped projection can still
look plausible while omitting a repeated save, option-local alternative,
duration, termination, or lifecycle transition. A projector-selected kind is
not an authority for what its source clause contains.

The correction to PR #475 establishes an authority boundary. Source-derived
obligations are registered independently of projected clauses. A clause may
reference obligation IDs, but it cannot carry the requirements used to grade
those obligations. This is the protection against omission, kind narrowing,
and weakened requirement lists.

## Decision

### Clause and obligation identity

The semantic unit is a source-backed clause; a record remains a materialized
view grouping clauses. A clause retains identity, exact source spans,
provenance, semantic and record ownership, normalized semantic fields,
execution ownership, capability references, readiness evidence, and regression
evidence. Its `sourceObligationIds` field is IDs only.

The independent registry contains `SourceObligationRecord` values with:

- `obligationId`, using the shared identity
  `obl:::${sourceRef}:::${locator}:::${facet}`;
- a closed non-projector origin: `source-extraction`,
  `curated-specification`, or `audit-finding`;
- resolvable evidence appropriate to that origin; and
- one or more canonical `requiredFacets`.

The shared cross-PR evidence union is also fixed here: `source-span`,
`authoritative-input`, `audit-finding`, `code`, `bead`, and
`known-missing-source-clause`. PR #475 owns source-span and authoritative-input
semantics in depth. PRs #476 and #477 duplicate these small types locally and
align to the identity; they do not import across branches. The integration
boundary is the shared identity/evidence contract, not a shared implementation
file.

Registry construction validates origin, evidence shape, duplicate IDs,
unknown facets, and contradictory facet selections. An absent registry ID
fails closed.

### Facets own canonical requirements

Requirements are derived inside the evaluator from registry facets. They are
not supplied as a contract by an ordinary caller. The facet vocabulary is
composable and includes, among others:

- save with damage, save without damage, and save with alternate outcomes;
- attack with one damage mode and attack with conditional/mutually exclusive
  alternatives;
- resource use with reset and without reset;
- duration with concentration and without concentration; and
- effect with lifecycle state and without lifecycle state.

These facets replace false universal kind assumptions. A save does not
universally deal damage; an attack does not universally use exactly one attack
mode; a duration does not universally have concentration, termination, or
success/failure branches. Each source obligation names the exact facets the
source demands. Canonical requirements enforce cardinality and cross-field
relationships. When multiple obligations demand the same atom family, the
evaluator enforces aggregate multiplicity so one projected atom cannot
discharge two source obligations. Extensions are additive
`additionalRequirements`; no extension can remove or replace a canonical
requirement. Unknown or contradictory selection fails closed.

### Applicability, membership, completeness, and closure

Four concepts remain distinct:

1. **Family applicability** says which record family and record key are in
   scope. The family list is only an applicability vocabulary.
2. **Source-derived obligation membership** is the independently enumerated
   set of registry IDs in an `ObligationScope`.
3. **Per-obligation completeness** evaluates the projected clause against the
   registry record's canonical facets.
4. **Aggregate family closure** evaluates the scope against the clauses. Each
   expected obligation is `satisfied`, `claimed-incomplete`, or `UNCLAIMED`.

`evaluateObligationClosure` takes the registry, clauses, and an independently
constructed scope. An applicable family array never establishes closure.
Unclaimed obligations make source omission visible even when every emitted
clause looks locally complete.

### Evidence-backed readiness

Readiness has four independent dimensions:

1. **CAPTURED** requires inspectable source-span or authoritative-input
   evidence that resolves and is tied to the registry obligation.
2. **PROJECTED** is derived from canonical semantic evaluation; it is not a
   caller-settable boolean.
3. **SUPPORTED** requires a capability identity and owning bead, resolved by an
   injected `CapabilityResolver`; unresolved, unowned, or unimplemented
   capabilities fail.
4. **DISCOVERABLE** requires an injected resolver/index/path reference that
   resolves to the clause.

The evaluator consumes resolver interfaces and test doubles; this correction
does not build the engine capability registry or discovery index. Semantic
completeness is captured plus projected. Supported and discoverable remain
readiness results and never turn a captured/projected clause into a semantic
omission. The evaluator result is authoritative and the IR carries no mutable
disposition that can contradict it.

## Consequences

Silent partial projection fails closed while retaining source evidence for
parser, curated-specification, engine, or model-adjudication work. Shared
normalized primitives and kind-specific composition remain allowed; this ADR
does not create a universal rules DSL, importer migration, generated pack, or
engine subsystem. Generated records remain compiler output and are never
hand-edited.

The registry and resolver implementations here are contract/type scope. The
authoritative capability ledger, production source census, family projectors,
discovery index, and engine conformance implementations remain deferred to the
owning beads and integrate through the identity/evidence boundary above.

## Rejected alternatives

- Letting a clause carry its own obligations: rejected because the producer
  could omit or weaken the standard used to grade its output.
- Passing a caller-selected contract: rejected because an empty or laxer
  contract certifies partial output.
- Universal contracts by `ClauseKind`: rejected because valid sibling mechanics
  differ, including non-damaging saves and non-concentrating durations.
- Family required-kind arrays as closure: rejected because applicability does
  not enumerate source membership.
- Four readiness booleans or a single disposition: rejected because evidence,
  semantic projection, engine support, and lookup discoverability fail
  independently.
