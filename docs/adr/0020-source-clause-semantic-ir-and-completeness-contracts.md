# ADR 0020: Source-Clause Semantic IR and Completeness Contracts

- **Status:** Accepted
- **Date:** 2026-07-25
- **Bead:** eshyra-o9bd.19.1.1
- **Refines:** [ADR 0017](0017-rules-pack-compiler-and-executable-curation-architecture.md)
- **Guidance:** [The Rules-Pack Compiler and Executable Curation](../rules-pack-compiler.md)

## Context

[ADR 0017](0017-rules-pack-compiler-and-executable-curation-architecture.md)
establishes the rules-pack as both a source-faithful reference substrate and a
semantic substrate for the model/engine boundary. The existing record-shaped
view has no semantic unit smaller than a record, so a projector can recognize a
mechanic and emit a plausible-looking record without proving that the mechanic
was represented completely.

The semantic unit is therefore a source-backed **clause**, not a record. A
record remains a materialized view that groups clauses for the current consumer
surface. This preserves record lookup and presentation while making clause
identity, ownership, provenance, execution, and completeness independently
auditable.

The 2026-07-24 audit evidence demonstrates why atom presence is insufficient:

- alternative damage modes were stored as parallel damage without their
  mutually exclusive choice;
- recharge triggers were read as reset periods, losing the trigger semantics;
- partial saves were treated as complete saves;
- legendary actions lacked their budget or per-option cost;
- option mechanics were hoisted onto parent features instead of remaining
  option-local; and
- typed records omitted branching, timing, or termination.

These are contract failures, not merely missing fields. A clause can be
captured and partly projected while still lacking the semantics an engine or
model boundary requires.

## Decision

### 1. Clauses are the semantic unit

Every clause has a stable identity, exact source span or spans, source
provenance, semantic and record owners, a clause kind, predicates for trigger
and eligibility, activation/action-economy cost, targets and geometry,
checks/attacks/saves, mutually exclusive alternatives, outcome branches,
effects, timing, execution ownership, required capabilities, readiness, and
regression evidence. Records group these clauses as materialized views; no
consumer-facing record surface is removed by this representation.

### 2. Four dimensions are independent

The overloaded word “modeled” is retired as a gate. Clause readiness records
four separate dimensions:

1. **CAPTURED** — authoritative source text and provenance are present.
2. **PROJECTED** — structured semantic fields exist for the clause.
3. **SUPPORTED** — an engine capability or an explicitly supported model
   adjudication can execute the clause.
4. **DISCOVERABLE** — runtime lookup can find the canonical clause.

They are orthogonal. A clause can be CAPTURED and PROJECTED yet not SUPPORTED
or DISCOVERABLE. No gate may collapse these dimensions into one informal
verdict. Required engine capabilities use qualified values in the form
`engine:F1` through `engine:F10`; no unqualified engine-family label is valid.

### 3. The universal layer has a narrow scope

The universal layer contains only clause identity, semantic ownership,
completeness requirements, alternatives and branching, provenance, capability
requirements, and readiness state. It explicitly permits shared normalized
primitives, kind-specific composition on top of those primitives,
source-backed curated specifications, and explicit unsupported or adjudicated
clauses. It is not a universal rules DSL and does not require every D&D
mechanic to compile into one generic runtime language.

### 4. Silent partial projection is forbidden

When a projector recognizes that a deterministic clause exists but cannot
represent it completely, it MUST emit an explicit **INCOMPLETE** clause,
naming each failed contract requirement and why it failed. The appropriate
completeness/readiness gate must fail. It must never emit a superficially valid
partial record. Family-specific projectors and curated source-backed
specifications remain appropriate; the invariant forbids only silent partial
projection.

### 5. Completeness contracts are executable data

`packages/core/src/rules/clauseIr/contracts.ts` stores kind-specific contracts
as data and evaluates a clause against its contract with a pure function. The
contract vocabulary covers attacks, saves, checks, branches, action economy,
resources, durations, state transitions, geometry, choices, variants, entity
lifecycles, ledgers, and model adjudication. It also documents a clause schema
for each mechanics-bearing record family: rule, feature, spell, creature,
hazard, equipment, magic-item, ancestry, background, condition, action, feat,
class, subclass, and table.

The evaluator checks the clause kind's required fields and branches as well as
each readiness dimension. Therefore atom presence alone cannot produce
`complete`; the kind contract is the authority, and an explicit
`incomplete` result carries named reasons.

## Consequences

- Source coverage, semantic projection, engine support, and runtime lookup can
  be audited without conflating their failure modes.
- Partial projections fail closed and retain their source evidence for later
  parser, curated-specification, engine, or model-adjudication work.
- Shared primitives are available to sibling implementations, but this ADR
  does not build an importer migration, a universal mechanics interpreter, or
  an engine subsystem.
- Curated specifications remain compiler inputs only when they satisfy ADR
  0017's source-grounding, determinism, validation, reference-resolution,
  drift-failure, and regeneration requirements. Generated records remain
  compiler output and are never hand-edited.

## Rejected alternatives

- **Treat records as the semantic unit.** Rejected because record-level
  projection hides option-local and branch-local omissions.
- **Use one `modeled` or `ready` flag.** Rejected because capture,
  projection, support, and discoverability fail independently.
- **Infer completeness from populated atoms.** Rejected because the audit
  examples show that the same atoms mean different things under different
  clause kinds and can omit required branches, timing, or ownership.
- **Build a universal rules DSL now.** Rejected by the scope guard and ADR
  0017's implementation hierarchy; normalized primitives and kind-specific
  composition are sufficient for this contract.
