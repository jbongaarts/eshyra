# ADR 0020: Rules pack as rule-awareness infrastructure with bounded deterministic capabilities

- **Status:** Accepted
- **Date:** 2026-07-29
- **Bead:** none created for this record. The follow-up reassessment and
  disposition work belongs to the existing SRD/engine program
  (`eshyra-o9bd.19`, `eshyra-olc5`) and must be filed there.
- **Narrows:** [ADR 0017](0017-rules-pack-compiler-and-executable-curation-architecture.md)
  §2 (the pack as a semantic substrate sufficient for deterministic ownership)
  and, through it, [ADR 0007](0007-rules-pack-ingestion-policy.md) §1
  (completeness framing). ADR 0007 §2–§4 (source authority and the
  model-assistance boundary) remain in force verbatim.
- **Requires follow-up review of:**
  [ADR 0019](0019-typed-boundary-for-semi-structured-source-strings.md)
  (disposition vocabulary and the one-disposition-per-candidate convention)
- **Relates to:** [ADR 0001](0001-product-model-deployment-content-strategy.md),
  [ADR 0009](0009-class-subclass-feature-record-kinds.md),
  [ADR 0010](0010-api-native-vs-agent-harness-adapter-seam.md),
  [ADR 0012](0012-rules-pack-campaign-template-adventure-module-campaign-instance.md),
  [ADR 0013](0013-runtime-srd-pack-is-the-generated-pack.md),
  [ADR 0014](0014-campaign-overlay-canon.md),
  [ADR 0015](0015-migration-first-sqlite-schema-management.md),
  [ADR 0018](0018-single-class-engine-boundary.md)

## Context

Two bodies of evidence now point in opposite directions, and the architecture
has to accommodate both.

**Playtest evidence: model-only mechanics and state handling are not
sufficient.** The character-creation and combat playtests behind
`eshyra-o9bd` — and the mechanics-audit gate that had to be built to police
them (`packages/core/src/orchestrator/turnAuditor.ts`) — showed that a model
left to assert dice results, arithmetic, resource balances, and state changes
in prose produces unrepeatable, unauditable play. That is why the Hybrid
Contract (`packages/core/src/orchestrator/protocol.ts`) routes all dice, math,
and canon writes through deterministic tools, and why ADR 0017 concluded the
pack must carry structured semantics rather than prose alone. None of that is
in doubt.

**Review evidence: globally complete semantic discovery, classification,
execution, and proof have not converged.** ADR 0017 §2 set the target as a pack
carrying "enough structured, source-grounded mechanics … that the agreed
deterministic owners can consume it without re-deriving meaning from prose."
The program-level decision of 2026-07-25 (recorded in `eshyra-o9bd.19` /
`eshyra-olc5`, not in an ADR) hardened that into a global closure claim: the
pack would not re-freeze until a reference engine proved *every* direct-input
deterministic clause executable, with zero engine-pending deterministic clauses
remaining. Pursuing that claim produced three PRs (#475, #476, #477) that were
closed unmerged as design-invalidated on 2026-07-27. The handoff analysis
(`eshyra-o9bd.19.7`) found one shared root cause — unsettled concepts
generalized across the corpus before their trust boundaries were proven — and
several recurring defects that are symptoms of the closure framing itself:

- three independent, mutually incompatible inventions of "obligation identity",
  "evidence", "membership", "capability identity", and "ready";
- artifacts used as evidence about themselves (a pack under repair defining its
  own membership);
- evaluation paths that returned an empty failure list when a lookup did not
  resolve, so "nothing recognized" read as "nothing wrong";
- no sound way to establish *absence* of mechanics — `RulesRecord.data` is typed
  `unknown` and kind validators do not reject unregistered fields, so there is
  no closed schema to enumerate against. The only defensible position reached
  was that unclassified structured material must stay *underived*, never
  "absent".

The last point is the crux. A global executability claim needs a global
negative claim ("this record has no unimplemented mechanics") that the corpus
cannot support. The claim was unprovable, and chasing it repeatedly produced
machinery that looked green because it recognized nothing.

Meanwhile the actual gameplay failure mode observed in play is neither of the
things the closure program measured. It is the DM **not knowing that a rule
applies** — not consulting cover, not recalling a prerequisite, not noticing an
exception, not surfacing a prior campaign ruling. That is a discovery failure,
and no amount of deterministic execution of the rules that *were* found fixes
it.

This ADR records the resulting North Star.

## Vocabulary: five concerns that must not be conflated

The rest of this ADR depends on keeping these apart. They are separate
properties with separate evidence and separate failure modes.

| Concern | Question it answers | Owner |
|---|---|---|
| **Source fidelity** | Does the pack faithfully and reproducibly represent the licensed source, with provenance? | Rules-pack compiler (ADR 0007, ADR 0017) |
| **Discovery** | At play time, did the potentially governing material reach the DM's context? | Runtime discovery (new; see §5) |
| **Interpretation** | What does the rule mean, does it apply, how does it interact? | Primary DM model (§2) |
| **Deterministic execution** | Which named operations are computed by code rather than judged? | Bounded capabilities (§3) |
| **State integrity** | Is the resulting state atomic, attributable, persisted, replayable, reversible, and correctly scoped? | Engine, tools, persistence (ADR 0012, ADR 0014, ADR 0015) |

A record can be source-faithful and undiscoverable. It can be discovered and
misinterpreted. It can be interpreted correctly and written to state
incorrectly. Progress on one is not evidence about another.

## Decision

### 1. The rules pack is primarily rule-awareness infrastructure

The rules pack is, first and foremost, a **provenance-backed rule-awareness and
discovery system** serving the primary DM model and the runtime auditor.

Its central responsibility is to help Eshyra surface the material that may
govern a situation:

- authoritative source passages;
- source-backed clauses and procedures;
- exceptions, prerequisites, modifiers, lifecycle rules, and related
  procedures;
- explicitly available deterministic capabilities;
- relevant campaign rulings and known ambiguities.

The pack must help the DM **know that a rule may matter**, and place the
relevant material in context **before** adjudication.

The pack as a whole makes **no claim of globally complete deterministic
execution of the rules source.** That claim is withdrawn.

Source fidelity, reproducibility, and provenance (ADR 0007 §2–§4, ADR 0013)
are unchanged and become *more* load-bearing under this decision: a discovery
system whose retrieved passages are not faithful to the source is worse than no
discovery system, because it launders invented rules through an authoritative
channel.

### 2. The primary DM model is the default semantic authority

The primary DM model remains the **default interpreter and adjudicator** of
rule meaning, applicability, interaction, and of ambiguous or open-ended
situations.

Model adjudication is an **intentional architectural boundary**, not a
temporary fallback for deterministic work that has not landed yet. This
inverts the working default that the closure program operated under, where an
unimplemented deterministic owner was a gap to be closed and model adjudication
required a per-procedure exception review.

Adjudicated outcomes are not exempt from the rest of the architecture. Every
adjudicated outcome that changes the game must still pass through the
deterministic state-integrity boundaries that apply to it, and must remain
attributable, auditable, and reversible on Eshyra's existing terms: dice and
arithmetic through tools, canon writes through state tools, evidence retained
for the turn auditor, and campaign state under the persistence and checkpoint
guarantees of ADR 0015 and ADR 0012.

### 3. Deterministic execution is a set of positive, bounded commitments

Deterministic execution remains valuable and required. It is required for:

- random-number generation;
- arithmetic;
- atomic state mutation;
- resource accounting;
- stable identity and ownership;
- persistence, replay, rollback, and migration integrity;
- visibility and authorization boundaries;
- explicitly selected, bounded mechanical procedures.

A **deterministic capability** is a *positive, narrow* commitment. A capability
must declare:

- what operation it performs;
- its required inputs;
- its exclusions — what it explicitly does not do;
- its revision or identity;
- what interpretation remains with the DM.

Two asymmetries are load-bearing and must not be blurred.

**A deterministic operation does not imply a complete record.** The existence
of a capability that executes part of a source record must never be read as a
claim that every semantic clause in that record is implemented.

**Absence of a capability binding is a statement about Eshyra, not about the
rules.** It means only that *no deterministic capability has been positively
selected for that operation*. It must never be treated as evidence that:

- the record contains no mechanics;
- the rule is irrelevant;
- the rule is unsupported in every sense;
- the rule can safely be ignored;
- the pack is mechanically complete.

"Unbound", "unclassified", and "not recognized" are not safety properties.
Recognizing nothing is not evidence of absence. Any gate, report, or predicate
that reads an unbound or unrecognized item as satisfied is a defect, not a
green.

### 4. The semantic and discovery structure is many-to-many

Exclusive and hierarchical ownership models are explicitly rejected. Clauses,
discovery paths, neighborhoods, scenarios, and capabilities do not partition
each other.

- A source-backed clause may have **multiple discovery paths**.
- Several discovery paths may surface the **same** clause in the same gameplay
  situation.
- A discovery path may surface **many** clauses.
- A clause may participate in **multiple** conceptual or procedural
  neighborhoods.
- Neighborhoods are **dynamic projections of relationships**, not canonical
  containers that own clauses.
- A gameplay scenario may activate many signals, paths, neighborhoods, clauses,
  capabilities, and adjudication boundaries at once.
- A scenario is **evidence about composition**, not a unit of rules
  completeness.
- A capability may implement only **part of one clause**, or contribute to
  **several** clauses.
- One clause may simultaneously require deterministic execution, model
  interpretation, state-kernel guarantees, and campaign adjudication.

The architecture preserves **one stable identity for authoritative source
material** while allowing overlapping relationships, retrieval reasons,
capability bindings, and scenario expectations to attach to it.

This can be described conceptually as a graph. **That is a description, not a
technology decision.** This ADR does not mandate — or endorse — a graph
database, a generalized graph platform, or a repository-wide relationship
schema. Overlapping relationships are expressible in the pack structures that
already exist.

### 5. Rule discovery is an explicit runtime concern

Discovery must become an explicit runtime responsibility. It must not rest on
the DM model remembering the rules source, or on the model independently
deciding every lookup it ought to perform. Today's surface is a single
model-initiated `lookup_rules` call plus an auditor that notices, after the
fact, that a required lookup was missing — that is detection, not discovery.

The intended conceptual flow:

1. derive known facts and candidate discovery signals from player intent and
   current campaign state;
2. retrieve potentially relevant source-backed material through **multiple
   overlapping paths**;
3. expand candidates through relevant relationships;
4. merge duplicate source material while **preserving every meaningful
   retrieval reason**;
5. present a curated context packet carrying provenance, relevance reasons,
   related rules, capability availability *and limits*, known ambiguity, and
   applicable campaign rulings;
6. let the DM adjudicate, invoke a bounded capability, or combine both;
7. preserve retrieval, adjudication, capability-use, and resulting-state
   evidence for audit and later improvement.

This is a **responsibility boundary**, not an implementation. It commits to no
particular retrieval model, ranker, embedding system, event schema, or
context-packing algorithm. Whatever is built must sit behind Eshyra's
provider-neutral tool and adapter seam (ADR 0010): discovery is core behavior,
not harness behavior, and must not depend on a specific provider's agent loop.

### 6. No replacement global closure claim

Withdrawing global deterministic closure must not be replaced with an equally
unprovable promise that every relevant rule will always be discovered.

The intended direction is **measurable and improving rule awareness**, supported
by overlapping, falsifiable evidence:

- source-backed retrieval probes;
- historical playtest failures;
- held-out scenarios;
- expected discovery paths;
- expected candidate clauses;
- relationship-expansion expectations;
- context-retention expectations;
- runtime telemetry and post-ruling missed-rule analysis.

None of these establishes universal discovery completeness, and none may be
reported as if it did. They bound and measure a rate of awareness failure; they
do not prove its absence.

### 7. Existing defects and commitments are not erased

This architectural change does **not** erase, close, or invalidate the existing
defect corpus. Findings from the SRD audits remain open obligations until each
receives an **explicit disposition**.

Dispositions are **potentially multi-label**. A single defect may continue to
impose several obligations at once, across:

- source fidelity;
- provenance;
- rule discoverability;
- relationship modeling;
- adjudication support;
- state-kernel integrity;
- retained deterministic-capability correctness;
- retirement or narrowing of an obsolete global readiness claim.

A finding may legitimately be reshaped, split across responsibilities,
reclassified as model-adjudicated, retained as a deterministic requirement, or
**retired because the global claim that generated it has been withdrawn**.
Retirement carries two conditions: it must name the architectural
responsibility that replaces the old claim, and it must not conceal an
underlying source, discovery, or state-integrity defect. "The claim is gone"
retires the claim, never the defect.

Deterministic-executability decisions are made at the **procedure or operation
level**. Record kind is not a decision unit: a `spell`, `magic-item`, or `rule`
record does not become deterministic or adjudicated wholesale because of its
kind (consistent with the clause-granular decision procedure in
`docs/rules-pack-compiler.md` §10 and ADR 0009's record-kind boundary, which is
about structure, not executability).

## Prior assumptions this decision changes

1. **That the pack could be made deterministically complete enough to own the
   mechanics.** ADR 0017 §2 is narrowed: the pack must carry the semantics its
   *positively selected* capabilities consume, not the semantics a
   hypothetically complete deterministic owner set would consume.
2. **That model adjudication is a reviewed per-procedure exception.** It is now
   the default. ADR 0017 §6 already allowed `model-adjudicated-supported` as a
   terminal green; §2 above makes it the baseline rather than an earned status.
3. **That "no recognized mechanics" is a meaningful classification.** It is not.
   §3 forbids reading it as satisfaction.
4. **That re-freeze can be gated on zero engine-pending deterministic clauses.**
   The 2026-07-25 program decision recorded in `eshyra-o9bd.19` / `eshyra-olc5`
   rests on a global negative claim the corpus cannot support and must be
   reassessed.
5. **That discovery is adequately covered by model-initiated lookup plus a
   post-hoc auditor.** §5 makes discovery a first-class runtime concern.
6. **That completeness units (scenario, path, neighborhood, record kind) can
   partition the rules universe.** §4 rejects this.

**No ADR is superseded in whole by this decision.** ADR 0017 §2 is narrowed and
ADR 0007 §1 is narrowed further through it; ADR 0019 requires follow-up review,
because its "exactly one disposition per candidate" rule is a per-field
bookkeeping convention and must not be generalized into exclusive ownership at
clause, procedure, or capability level (§4). Every other ADR listed below stands
as written.

What does **not** change: source authority and the ban on model-authored pack
content (ADR 0007 §2–§4); no hand-edited generated records (ADR 0017 §3); the
generated pack is the runtime pack (ADR 0013); the layered content/state model
(ADR 0012); campaign overlay canon and truth status (ADR 0014); migration-first
schema and the state-integrity guarantees built on it (ADR 0015); the
single-class engine boundary (ADR 0018); the provider-neutral adapter seam
(ADR 0010).

## Consequences

- **Existing global readiness, obligation-closure, negative-classification, and
  pack-wide executability machinery must be reassessed, not assumed
  authoritative.** In scope for that reassessment at minimum:
  `GAMEPLAY_READINESS_DISPOSITIONS`, `RULE_DISPOSITIONS`, and
  `ENGINE_PROCEDURE_COVERAGE`
  (`packages/core/scripts/create-dnd5e-srd-audit-bundle/`);
  `packages/core/src/rules/srdPlayabilityAudit.ts`,
  `srdChoiceProseAudit.ts`, `srdEquipmentResolutionAudit.ts`;
  `packages/core/src/state/itemExecutionReadiness.ts`; the ADR 0019
  disposition census under `docs/inventories/`; the engine capability families
  `engine:F1`–`engine:F10`; and the re-freeze bar in
  `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` and its thaw-note
  gate. Reassessment means each artifact is confirmed, narrowed, repurposed, or
  retired **with reasons** — not deleted for tidiness and not grandfathered in.
- **Source fidelity and provenance remain foundational even for prose the DM
  interprets entirely.** Discovery increases the cost of an unfaithful passage,
  because the passage is now placed into context as authority.
- **Existing deterministic state-integrity responsibilities are not weakened.**
  Dice, arithmetic, atomic mutation, resource accounting, identity/ownership,
  persistence, replay, rollback, migration, and visibility boundaries keep
  every guarantee they have today.
- **Discovery, adjudication, deterministic capability use, and runtime audit
  must be designed together.** The turn auditor's question changes shape: not
  only "did the model assert a mechanical outcome without the owning tool?" but
  also "was the governing material in context, and was a declared capability
  limit respected?" Designing discovery without the audit surface would produce
  another artifact that cannot fail.
- **Migration must permit overlap.** Any migration of pack structures must
  allow a clause to hold multiple memberships, discovery paths, relationships,
  capability bindings, and scenario expectations simultaneously. A migration
  that forces exclusivity to simplify bookkeeping contradicts §4.
- **The transition proceeds through bounded campaigns that may legitimately
  overlap** in clauses and scenarios. Overlap between campaigns is expected and
  is not duplication to be designed away.
- **No campaign may treat one scenario, one discovery path, one neighborhood, or
  one record kind as a partition of the rules universe.** A campaign's evidence
  bounds what it demonstrated; it never bounds the universe.
- **Initial work reuses existing pack structures where practical.** Do not open
  by building a universal ontology, a graph database, or a repository-wide
  replacement schema. Prove the boundary on a small number of concrete
  source-to-play examples first — this is the direct lesson of the 2026-07-27
  invalidation.
- **Existing deterministic capabilities are neither removed nor retained by
  default.** Each requires an explicit bounded disposition under §3, stating its
  operation, inputs, exclusions, identity, and residual interpretation.
  "It already exists" and "it is not needed under the new framing" are both
  insufficient.
- **Review governance applies.** Material changes to pack authority, capability
  contracts, state ownership, or acceptance boundaries remain subject to the
  repository review protocol in `AGENTS.md` (PR-only to `main`,
  `npm run verify:worktree` before commit, quality gates from the worktree that
  holds the change) and to the effective-profile rules governing commit, push,
  and sync authority. This ADR grants no new authority to change those
  boundaries unilaterally.
- **Audit-architecture restraint still applies** (ADR 0017 §8): this decision is
  not a licence to add a parallel proof system for discovery alongside the
  existing readiness machinery. Prefer strengthening or repurposing what
  exists.

## Non-goals

This ADR does not, and no work under it may claim to:

- prove complete formal semantics for the entire rules source;
- prove universal retrieval completeness;
- assign each clause to exactly one neighborhood or discovery path;
- assign each record wholly to either deterministic execution or model
  adjudication;
- specify the final pack schema;
- select a vector database, graph database, ranking algorithm, or model;
- reclassify every existing defect (§7 sets the disposition rules; the
  dispositions themselves are separate work);
- declare the existing global readiness machinery valid or invalid without
  subsequent analysis;
- implement the runtime discovery pipeline.

It is also not a rename. "Importer", "compiler", and "curator" keep their
current meanings and paths (ADR 0017 §7).

## Alternatives considered

1. **Continue pursuing globally complete deterministic rules execution.**
   Rejected. The claim requires a global negative — that no unimplemented
   mechanics remain in a record — and the corpus cannot support it:
   `RulesRecord.data` is `unknown`, kind validators do not reject unregistered
   fields, and there is no closed schema to enumerate against. Three
   independent attempts (#475/#476/#477) converged on incompatible identity,
   evidence, and membership models and on gates that passed by recognizing
   nothing. Continuing spends the project's remaining SRD budget on proof
   machinery rather than on the failure players actually experience.
2. **Revert to model-only rules interpretation without deterministic support.**
   Rejected on playtest evidence. Models improvise dice, arithmetic, resource
   balances, and state changes; the turn auditor exists because prose-asserted
   mechanics were observed and had to be blocked. Removing deterministic
   ownership would reintroduce unrepeatable, unauditable play and forfeit
   replay, rollback, and checkpoint guarantees.
3. **Retain the current pack primarily as a mechanically executable rules
   representation.** Rejected. It keeps the executable representation as the
   organizing goal, so every clause is still measured against an executability
   bar, and the same unprovable negative claim returns through the readiness
   reports. It also leaves the observed discovery failure unaddressed: a rule
   the DM never consults is not helped by being executable.
4. **Bounded determinism plus explicit model adjudication, but without making
   discovery the pack's primary responsibility.** Rejected as the closest
   near-miss. It fixes the false-completeness problem and honestly bounds
   determinism, but leaves discovery implicit — the model must still remember
   the source and decide what to look up, with the auditor catching failures
   after the fact. The dominant remaining defect class is "the DM did not know
   the rule applied", which this alternative does not touch.
5. **Selected: provenance-backed rule awareness, explicit model adjudication,
   deterministic state integrity, and positively bounded mechanical
   capabilities.**

The selected approach is the only one that absorbs both bodies of evidence.
It keeps everything the playtests proved necessary — deterministic dice, math,
mutation, accounting, identity, persistence, and replay — because those are
positively selected commitments that stand on their own and need no global
claim. It abandons only what the reviews showed does not converge: pack-wide
semantic classification, universal executability, and negative-completeness
proof. And it redirects the pack's primary investment at the failure mode that
neither prior framing addressed, with evidence that is falsifiable (a probe can
fail, a held-out scenario can miss) rather than closural (a corpus-wide proof
that cannot be completed).

## Open questions

Left open deliberately. Resolving these without evidence is the failure mode
this ADR is reacting to.

- What situation representation supplies discovery signals?
- Which signals should initially be explicit versus model-derived?
- How should source fragments and source-backed clauses be identified, given
  that a universal obligation identity was not proven?
- Which relationship vocabulary is initially necessary?
- How should multiple retrieval reasons affect ranking?
- How should context be deduplicated without losing retrieval evidence?
- How are capability boundaries represented when a capability covers only part
  of a clause?
- How should campaign rulings and known ambiguities be retrieved and scoped
  (extending, or distinguished from, `RulesAmbiguity` and ADR 0014 overlay
  canon)?
- How should missed-rule evidence feed future pack improvements?
- Which existing deterministic claims remain product-essential?
- Which existing global readiness artifacts should be retired, narrowed, or
  repurposed?
- How should discovery quality be evaluated without claiming global
  completeness?
