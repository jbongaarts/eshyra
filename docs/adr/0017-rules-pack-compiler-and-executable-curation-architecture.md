# ADR 0017: Rules-Pack Compiler and Executable Curation Architecture

- **Status:** Accepted
- **Date:** 2026-07-07
- **Bead:** eshyra-q5d2
- **Refines:** [ADR 0007](0007-rules-pack-ingestion-policy.md) (rules-pack
  ingestion policy and model-assistance boundary)
- **Relates to:** [ADR 0001](0001-product-model-deployment-content-strategy.md),
  [ADR 0005](0005-dnd-srd-pack-versions.md),
  [ADR 0006](0006-pathfinder-source-policy.md),
  [ADR 0013](0013-runtime-srd-pack-is-the-generated-pack.md)

## Context

ADR 0007 established the load-bearing rule for rules-pack ingestion: **the
authoritative bit of every rules record comes from licensed source material,
not from a model's training-data memory, and the generated pack must stay
reproducible and auditable.** That rule is correct and this ADR does not
weaken it.

ADR 0007 also framed the *goal* of ingestion as **reference completeness**
first — "every rules element that exists in the licensed source is reachable
by key for DM lookup, has accurate field values, and carries full provenance"
— and treated **mechanical automation** as "a separate, layered concern that
can grow at its own pace on top of complete reference data." That framing was
reasonable when written (2026-05-25): it kept the importer scoped and stopped
the pipeline from turning into an open-ended rules-engine project.

The project has since learned, through character-creation and combat
playtesting during the D&D 5e SRD thaw (epic `eshyra-o9bd`), that the
reference-first / automation-later split is too clean. The gameplay quality
Eshyra targets requires deterministic engine ownership for a much larger class
of rule behavior than the original framing assumed — and that ownership is not
purely downstream of the pack. It depends on the pack carrying a **richer
semantic representation and explicit engine dependencies** than "accurate
prose reachable by key" provides. Concretely:

- The execution-boundary classification of the 175 deterministic rule
  procedures
  (`docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-8-execution-boundary-classification.md`)
  found that many rules the DM model was expected to adjudicate from prose in
  fact need code-owned state machines, invariants, or derived-math primitives
  (concentration, spell slots, death saves, attunement, the action budget, and
  a shared derived-math surface) — and that the pack must expose the structured
  data and the engine-hook requirements those owners consume.
- The magic-item state-contract design
  (`docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-7-magic-item-state-contract-design.md`)
  showed that magic-item behavior only becomes playable when the pack carries a
  typed `data.mechanics` semantic layer that names its economies, operations,
  effects, and engine-hook subscriptions — not merely faithful description
  prose.
- The rule-disposition and coverage registers
  (`docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-8-1-rule-disposition-layer-design.md`)
  showed that "reachable and accurate" and "runtime-ready" are different
  correctness properties that must be tracked separately and fail closed
  independently.

The evolved reality is that the historical **importer** is now a
**source-grounded rules compiler and executable-curation system**. This ADR
records that decision and refines ADR 0007's goal statement to match it,
without rewriting ADR 0007's rationale as if the earlier reasoning never
existed.

## Decision

Rules-pack compilation produces **source-complete, source-faithful reference
data _and_ the structured semantic representation required by Eshyra's agreed
model/engine execution boundary.** Actual runtime state and engine execution
remain separate concerns, but the pack must carry sufficient semantics and
explicit engine dependencies to support them.

This refines — it does not repeal — ADR 0007 §1 ("Reference completeness vs.
mechanical automation completeness"). ADR 0007 §2–§4 (allowed / disallowed
model-assistance, source authority, audit-helper models) remain in force
verbatim.

### 1. Source authority is preserved (ADR 0007, unchanged)

- Authoritative pack content is produced by deterministic code running over
  licensed source material vendored in-repo.
- A model's training-data knowledge of a rules system is **not** an
  authoritative source and must not author or fill in pack content.
- Every generated record remains reproducible from the vendored source by
  re-running the compiler, and auditable against it.

### 2. The goal is refined: reference substrate **and** semantic substrate

The compiler's target is no longer "reference completeness first, mechanical
automation later, on a separate track." It is a pack that is simultaneously:

- **A reference substrate** — every source rules element reachable by key,
  field-accurate, fully provenanced (ADR 0007's original bar, still required);
  and
- **A semantic substrate** — carrying enough structured, source-grounded
  mechanics (typed effects, formulas, usage/recharge contracts, operation
  definitions, references, prerequisites) and **explicit engine-hook
  requirements** that the agreed deterministic owners can consume it without
  re-deriving meaning from prose or from model memory.

Reference completeness and semantic readiness are **distinct correctness
dimensions**, not sequential milestones. See the canonical guide
(`docs/rules-pack-compiler.md`) for the full set of dimensions
(reproducibility, source completeness, structural fidelity, semantic modeling,
runtime ownership/support, end-to-end playable validation) and how they are
used as evaluation lenses rather than a mandatory waterfall.

### 3. Curated semantic input is a legitimate compiler input; hand-curated output is not

The licensed primary corpus remains the one **authoritative source**. A curated
semantic specification is not a source — it is a **legitimate, source-grounded
compiler input** that carries source-derived decisions into the compiler. Keep
the three roles distinct throughout: the licensed source is *authoritative*;
source-grounded curated specifications are *legitimate compiler inputs*;
generated `records.json` is *output* and is never hand-edited.

The compiler admits a class of input ADR 0007 did not name explicitly:
**source-grounded curated semantic specifications** — explicit mechanical
decisions, encoded as deterministic compiler inputs (data tables, clause
registries, reviewed reconstruction specs). This is **executable curation**.

Curated semantic input is a legitimate compiler input **when all** of
the following hold:

- it is derived from the licensed source, not from model memory;
- it identifies or is mechanically tied to the relevant source region / record
  (locators, clause ids, table fingerprints, or equivalent grounding);
- source phrases, locators, clause ids, or equivalent grounding evidence are
  checked where practical;
- it is deterministic;
- it is schema-validated;
- references resolve;
- exhaustive memberships use parity / conservation checks where appropriate;
- source drift fails loudly rather than silently preserving stale semantics;
  and
- the generated artifact is still produced by the compiler round trip.

The distinction that must never blur:

> **Curated semantic _input_ is allowed. Hand-curated generated _output_ is
> not.**

Generated pack records under `packages/core/data/rules-packs/**/records.json`
remain outputs. They are changed only by changing compiler/curator inputs
(parsers, curated specifications, source manifest) and regenerating, under the
importer fix protocol. This is the executable-curation analogue of ADR 0007's
"no hand-authored records" rule, extended to cover semantics: a curated clause
registry is an input the compiler consumes and validates; it is not a licence
to edit the emitted JSON.

### 4. Implementation-technique hierarchy

Because the compiler now owns semantics, agents need a decision hierarchy for
*how* to turn a source rule into pack semantics. In order of preference:

1. **Structural parsing** when the source has repeated grammar (stat blocks,
   spell metadata, equipment rows, progression tables, regular usage
   annotations, consistent headings).
2. **Shared semantic grammars** for recurring mechanical language (recurring
   effect forms, usage/recharge phrasing, damage/healing/save/modifier
   structures).
3. **Declarative source-grounded curation** for irregular semantic families —
   especially where an engineer or agent must already read and classify each
   clause individually. A declarative curated specification is often clearer
   and more trustworthy than increasingly elaborate natural-language inference
   machinery that merely re-encodes decisions already made during review.
4. **Procedural record-name dispatch / one-off code** reserved for genuine
   exceptions. Acceptable where justified; it must not silently become the
   default semantic-modeling mechanism for entire corpora.

Preserve a visible distinction among **grammar**, **curated
data/specification**, and **exceptional procedural logic**. The goal is
trustworthy semantics — not maximizing the amount of English meaning inferred
automatically.

### 5. Pack semantics, live state, and engine services are separate layers

The compiler owns **pack-side mechanics** (immutable, source-derived): effects,
formulas, usage/recharge contracts, operation definitions, engine-hook
requirements, references, prerequisites.

It does **not** own **live state** (campaign/instance-mutable: current charges,
attunement, resource counters, current form, stored spells, depletion state,
ownership/inventory instance identity) or **engine services and hooks** (dice
grammar, action economy, concentration, spell slots, resource reset/recharge,
death/dying/temp-HP, rest processing, character-build resolution, deterministic
derived math, currency/assets/trade).

Rules records and items must **use shared engine services** rather than
privately reimplementing them. The current execution-boundary vocabulary and
the live-design docs are the source of truth for the family names and census;
this ADR deliberately does not fossilize a count.

### 6. The hybrid execution contract is preserved

The division of responsibility (the "Hybrid Contract" in
`packages/core/src/orchestrator/protocol.ts`) stands:

- **The model** interprets intent, handles ambiguity, narrates, and makes
  bounded adjudicative rulings.
- **The rules pack** supplies authoritative source-grounded reference material
  and structured game semantics.
- **Deterministic tools and engine services** perform arithmetic and own the
  state transitions that require reliable repeatability.

Model-adjudicated behavior can be a **deliberate terminal architecture** —
`model-adjudicated-supported` is a reviewed, evidence-backed green status, not
a synonym for "unimplemented" — when the required deterministic primitives
already exist and the remaining work is genuinely contextual judgment. The
non-negotiable requirement is **explicit ownership**: a procedure must not be
left to model arithmetic or accidental conversational state merely because
nobody classified it.

### 7. Terminology and the absence of a rename

- **rules-pack compiler** — the overall deterministic source-to-pack system.
- **executable curation** — explicit source-grounded semantic decisions encoded
  as deterministic compiler inputs.
- **importer** — retained where referring to existing paths, commands,
  historical work, and the structural-extraction components (`import:dnd5e-srd`,
  `packages/core/scripts/importers/`, existing beads).
- **curator** — where a system-specific compiler combines parsing and explicit
  semantic curation.

The conceptual architecture changes **without** a mass terminology rename. The
existing `importer` paths, commands, beads, and historical documents keep their
names during the D&D thaw. Renaming is churn, not architecture.

### 8. Audit-architecture restraint

The project now has substantial audit machinery (source inventory / coverage /
region ledger, deep audit, freeze manifest + thaw notes, rule-disposition and
coverage registers, magic-item clause registry, readiness reports). Before
introducing a new independent audit registry, disposition map, proof artifact,
or readiness census, ask:

1. What distinct failure class does this detect?
2. Can an existing invariant be strengthened instead?
3. Is the new artifact authoritative, or merely another view?
4. What prevents it from drifting from parallel artifacts?
5. Can one mechanism subsume another?

Do not remove useful existing machinery for theoretical cleanliness. The goal
is **deliberate consolidation** as the architecture stabilizes, not parallel
proof systems measuring the same invariant differently.

## Consequences

- ADR 0007's source-authority and provenance invariants keep applying to
  everything the compiler emits, including the new semantic layers.
- "Complete" now has two independently-tracked meanings — reference-complete and
  semantically/runtime-ready — and the readiness and re-freeze gates report and
  enforce them separately (`eshyra-o9bd.14` is the regeneration + full-audit +
  re-freeze gate; `eshyra-2zyy` re-enables normal thaw-note gating on the new
  frozen baseline afterward).
- Curated semantic specifications become first-class, reviewable compiler
  inputs with their own integrity checks (existence, reference resolution,
  census/parity, source-drift failure). They are held to the same
  reproducibility bar as parser code.
- The pack records engine dependencies (hooks) as data; the engine families
  that consume them (`eshyra-2n1t` engine epic and the `eshyra-o9bd.18.7.*`
  magic-item children) are implemented and owned **outside** importer/compiler
  beads.
- New rules systems (Pathfinder, `eshyra-0m9.8/.9`, deferred) inherit the
  compiler contracts and audit principles — **not** D&D-specific document
  heuristics. See the canonical guide's future-systems section.
- The canonical operating guide is `docs/rules-pack-compiler.md`; this ADR
  records the decision, the guide explains how to apply it, and the
  agent-facing files (`packages/core/scripts/importers/AGENTS.md`,
  `docs/importer-fix-protocol.md`, root `AGENTS.md`) point to both.

This ADR does **not** claim the rules compiler is the game engine. It claims
the pack must carry the semantics and explicit engine dependencies the engine
needs — the engine itself is a separate concern with separate ownership.

## Rejected alternatives

- **Rewrite ADR 0007 in place.** Rejected: the reference-first framing was a
  sound decision on its 2026-05-25 evidence; preserving the historical
  rationale and refining it in a new ADR keeps the decision history honest and
  auditable, consistent with how ADR 0016 extended ADR 0008.
- **Declare the pack "done" at reference completeness and push all semantics
  into the engine.** Rejected: playtesting showed the engine cannot own the
  behavior without a semantic substrate in the pack; "accurate prose reachable
  by key" is necessary but not sufficient for the agreed execution boundary.
- **Treat curated semantic specifications as equivalent to hand-authoring
  records.** Rejected: a source-grounded, deterministic, schema-validated,
  drift-failing curated input consumed by the compiler round trip satisfies
  ADR 0007's reproducibility and auditability requirements; a hand-edited
  `records.json` does not. The two are not the same act.
- **Rename "importer" to "compiler" across the tree now.** Rejected as pure
  churn during an active thaw: it would rewrite commands, beads, paths, and
  history for no correctness gain. Terminology is layered on top of stable
  paths.
- **Build a universal, cross-system rules-document compiler up front.**
  Rejected: the abstractions that are genuinely cross-system are not yet known;
  Pathfinder implementation pressure is the correct test. Make shared extension
  points explicit, then let the second system reveal the real framework (see
  the guide).
