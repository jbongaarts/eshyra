# Evidence categories, trust models, and exact claims

- **Status:** Accepted design contract
- **Bead:** `eshyra-o9bd.19.1.16`
- **Governing authority:** [ADR 0020](../adr/0020-rules-pack-as-rule-awareness-infrastructure-with-bounded-deterministic-capabilities.md), especially §§3, 5, and 6; [Design Authorization and Pull Request Review Policy](../design-and-pr-review-policy.md)
- **Related implementation:** `packages/core/src/discovery/traceProjection.ts`, `packages/core/src/discovery/measurements.ts`, and their integrity tests

## Purpose

Eshyra makes several different kinds of correctness claim.  They have different
owners, failure modes, and legitimate evidence.  This contract prevents a
convenient artifact from being promoted into proof of something it does not
measure.

An **evidence category** is the class of claim an observation may support, not
the storage format containing it.  A JSON record, test, schema validator,
trace, registry row, source locator, or green command can contain evidence for
more than one category, but each claim is evaluated under the trust model for
its own category.  There is no repository-wide proof standard and no universal
"green" status.

Every load-bearing claim records, in the durable artifact or the review that
relies on it:

1. the exact property and subject it claims;
2. the bounded population, input, or execution occurrence it covers;
3. its category and owner;
4. the evidence producer and applicable trust model; and
5. explicit non-claims and any unresolved/indeterminate cases.

Changing a claim's subject, population, producer, or trust model creates a new
claim.  A copied label, hash, status field, or summary does not carry a claim
forward by itself.

## Terms and common result discipline

- **Subject** is the identified thing the claim concerns: a source span, pack
  field, candidate, procedure invocation, finding, or state transition.
- **Population** is the finite set over which a claim quantifies.  A bounded
  probe, an exact record list, or a query with a retained denominator can be a
  population.  "The pack," "all mechanics," and unenumerated open-schema
  fields are not bounded populations.
- **Independent evidence** is produced by a boundary that does not merely
  repeat, validate, or summarize the producer whose assertion is being tested.
  It need not be a separate process, but it must have an independently justified
  input/authority and be able to distinguish the relevant bad state.
- **Producer-owned observation** is an event or decision recorded by the
  component that actually made it.  It is a legitimate primitive for claims
  about that component's observed behavior; a downstream projection must copy
  it rather than recreate it.
- **Indeterminate** means the property could not be evaluated for the stated
  subject: for example, input is malformed, an identifier is unrecognized, a
  dependency did not run, or the denominator is unavailable.  Indeterminate is
  neither satisfied nor evidence of absence.

For a closed predicate, the only affirmative result is a qualifying positive
observation.  `unrecognized`, `unbound`, `unknown`, `missing`, `empty`,
`not-comparable`, `failed-to-run`, and `not-invoked` retain their own meanings;
none may be coerced to `satisfied`.  An empty result may establish that a
query ran and returned no rows, but it cannot establish why, semantic support,
or absence outside a separately bounded population.

## Categories and trust boundaries

| Category | Exact claim it can support | Owner | Trust boundary / qualifying evidence | Explicit non-claims |
|---|---|---|---|---|
| **Source fidelity** | A specified emitted value, source-derived assertion, or bounded source population faithfully corresponds to identified licensed source material and provenance. | Rules-pack compiler and source audit. | Canonical source identity and locator plus an independently justified source-to-output comparison.  The source and bounded population are authoritative inputs, not values derived from the emitted record under review. | It does not prove that the value is discovered at runtime, interpreted correctly, executable, or persisted correctly.  Record presence and a provenance-shaped field alone do not prove fidelity or omission-free coverage. |
| **Discovery telemetry** | During one identified run, a discovery producer emitted the recorded signals, candidates, traversals, retention/packet decisions, and runtime observations. | Runtime discovery and turn-trace producer. | **Internal diagnostic trust model:** trust the admitted producer-owned observation for what that producer did, with the trace's identity, stage outcome, and decision accounting preserved.  Projections and measurements derive from those canonical facts rather than inventing a second observation. | It does not prove the producer should have found every relevant rule, that the source is faithful, that the DM read or understood the packet, that a capability executed, or that state changed correctly.  A trace is not an independent audit of its own producer. |
| **Adjudication support** | Identified source-backed material, ambiguity, campaign ruling, and disclosed capability boundary were made available to the adjudicator for a bounded situation. | Discovery/context assembly and campaign-rule read seam. | A source-fidelity-qualified subject joined to execution-path evidence that the packet/context actually carried it, including retention/exclusion and stage outcomes. | It does not prove a model selected, understood, or correctly applied the material; it does not prove an outcome, capability execution, or global discovery completeness.  Retrieval or candidate presence alone is insufficient. |
| **Deterministic capability execution** | A named capability revision performed its declared bounded operation for an admitted input and produced the observed result according to its contract. | Capability/engine owner. | Positive invocation and behavior evidence at the real execution boundary, with declared operation, inputs, exclusions, identity/revision, and residual DM interpretation.  Tests must discriminate an invalid/missing/unrecognized input or excluded operation from a valid execution. | It does not prove the complete semantics of a record, all variants of a procedure, discovery, source fidelity, or state durability unless those are separately tested.  A capability registration, hook, symbol, schema-valid contract, or preflight status is not execution evidence. |
| **Finding evidence** | A particular defect class is reproducible under stated conditions, or a repair distinguishes that bad state from the required good state across the declared scope. | Finding owner and regression-test/audit owner. | Reproduction plus a discriminating permanent regression predicate; scope membership and the generalized invariant are explicit.  A finding may combine source, discovery, capability, adjudication, and state evidence without collapsing their trust models. | A registry row, issue status, label, candidate list, or passing synthetic example does not prove the defect is fixed, exhaustive, or irrelevant elsewhere.  Retiring a superseded claim does not retire an underlying defect. |
| **State integrity** | An identified operation performed the required authorized state transition atomically and with the claimed persistence, attribution, scope, replay/rollback, or migration property. | State tools, engine, persistence, and migration owners. | Execution evidence through the real state boundary plus observation of the resulting durable state and the relevant recovery/replay behavior.  Where authorization or visibility is claimed, the evidence varies the real actor/scope boundary. | It does not prove source fidelity, rule discovery, model interpretation, or semantic completeness of the input record.  A type, migration file, transaction helper, in-memory object, or code symbol is not proof that a runtime write occurred or persisted correctly. |

The categories intentionally overlap in a feature's evidence packet, but not in
what a single observation proves.  For example, a trace can establish that a
capability invocation was observed by discovery telemetry; the capability owner
still needs capability-execution evidence for the operation's behavior, and the
state owner still needs state-integrity evidence for any write it caused.

## Trust models are selected by responsibility

### Internal diagnostic telemetry

Discovery measurements may use producer-owned observations as primitives.  This
is appropriate because the diagnostic claim is deliberately narrow: *the
producer made this decision/event in this run*.  The trace must preserve the
producer's stage outcome and decision reasons.  A consumer must not infer a
drop from omitted packet content, re-run a producer to manufacture an event,
or replace `failed-to-run` with an empty successful result.

The model admits producer ownership; it does not make a discovery producer an
authority for source fidelity, semantic implementation, capability behavior,
or state integrity.  If a metric requires any of those claims, its evidence
packet adds the independently appropriate category rather than upgrading the
telemetry record.

### Independent source, capability, and state claims

Source fidelity requires an authoritative source anchor outside the output
being assessed.  Capability and state claims require evidence from actual
admission/execution and, where claimed, durable observation.  A component may
produce useful diagnostics about itself, but it cannot establish that it did
not omit semantics merely because its own schema, registry, or generated
output accepts what it produced.

Independence is proportional to the claim, not performative separation.  A
direct test of a real runtime boundary can be sufficient when it supplies an
adversarial control that distinguishes the broken behavior.  Conversely, a
separate file, hash, process, or repeated computation is not independent if it
uses the same unchecked assumption or producer-authored membership.

## Explicitly insufficient substitutes

The following may be useful inputs or diagnostics, but by themselves establish
only their literal property:

| Observation | It establishes | It does not establish |
|---|---|---|
| A source/record/candidate is present | Presence at that surface | Faithful semantics, discovery in a run, support, execution, or state correctness |
| A record has an owner, candidate, disposition, or capability binding | That the label/binding exists | The owner implemented the required semantics or the capability ran |
| A schema accepts data or a type compiles | Conformance to that checked shape | Source completeness, semantic truth, operation coverage, or runtime behavior |
| A code symbol, registry entry, hook, or tool exists | Existence/resolution of that symbol | Invocation, input admission, correct behavior, or persistence |
| A packet preflight says available/blocked | What the preflight producer concluded | Runtime invocation, outcome, or state effect |
| A test passes on a synthetic fixture | The asserted fixture behavior | The untested real producer path, source population, or generalized defect class |

No review may bridge one of these gaps with wording such as "therefore
implemented," "therefore complete," or "therefore safe" without adding the
category-specific qualifying evidence.

## Bounded positive absence

Absence is positively provable only when all of the following are recorded:

1. the exact property being sought;
2. an independently justified, finite population and its denominator;
3. a total, fail-closed enumerator for that property over every member;
4. the source/authority and revision of the population; and
5. a result showing zero matching members and no indeterminate members.

This permits claims such as "none of these 33 independently anchored
obligations lacks a matching projected atom" when all 33 obligations and the
matching procedure are explicit.  It does not permit "this record has no
unimplemented mechanics" over `RulesRecord.data` or any other open/unbounded
schema.  An empty lookup, empty registry bucket, absent binding, unknown field,
or unrecognized value is never a denominator.

## Required failure behavior

Evidence producers and evaluators must preserve unresolved input rather than
laundering it into satisfaction:

1. Validate closed discriminants and required identifiers before deriving a
   result.
2. Return or record a distinct failure/indeterminate disposition when input is
   malformed, missing, unresolved, unbound, unrecognized, or when the producer
   did not run.
3. Require a positive qualifying observation for satisfaction.
4. Preserve `query-ran-and-returned-empty` as a diagnostic fact only when that
   is what occurred; do not reinterpret it as semantic absence or successful
   support.
5. Make reports and gates fail closed whenever their own bounded claim cannot
   be evaluated.  A report may say `not-comparable` or `not-discriminable`; it
   may not silently omit the case from its denominator.

This is the operational form of ADR 0020's rule that unbound, unclassified,
and unrecognized are not safety properties.  It applies equally to a source
audit, discovery trace, capability gate, finding report, and state check,
while leaving each category free to use the trust model appropriate to its own
claim.

## Review checklist

For each new or materially changed evidence artifact, reviewers ask:

1. Which row in the category table is this claim making?
2. What exact subject and bounded population does it cover?
3. Who owns the claimed behavior, and who produced the evidence?
4. Is producer-owned observation sufficient for this narrow diagnostic claim,
   or does the claim require independent source, execution, or state evidence?
5. What bad state can the evidence distinguish, and is that control exercised?
6. Which non-claims remain, especially discovery, interpretation, execution,
   persistence, and absence?
7. What happens to malformed, unrecognized, empty, or unresolved input?

If any answer is unavailable, the result is indeterminate until the artifact is
narrowed or qualifying evidence is added.  It is not a green result.
