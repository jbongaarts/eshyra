# The Rules-Pack Compiler and Executable Curation

**Canonical architecture and operating guide.** This document explains how to
apply the decision recorded in
[ADR 0017](adr/0017-rules-pack-compiler-and-executable-curation-architecture.md),
which refines [ADR 0007](adr/0007-rules-pack-ingestion-policy.md). The ADR
records *what* was decided and *why*; this guide is *how to work within it*.

Read this before touching compiler / curator / importer code, and before
designing a rules-pack compiler for a new system. Agent-facing quick rules live
in `packages/core/scripts/importers/AGENTS.md`; regression-sensitive change
mechanics live in `docs/importer-fix-protocol.md`. This guide is the reasoning
those two point back to — do not duplicate it into them.

---

## 1. What the system actually is

The historical **importer** — "read a vendored PDF, emit `records.json`" — has
evolved into a **source-grounded rules compiler and executable-curation
system**. The name "importer" is kept on existing paths, commands, and beads
for continuity (see [Terminology](#11-terminology)); the *conceptual* model
below is what governs new work.

It is no longer `PDF -> parsed JSON`. It is closer to:

```
licensed source
  -> deterministic source extraction            (extract.ts: PDF -> PageText[])
  -> source regions / structural inventory       (sections.ts + source-inventory /
                                                   coverage / region-ledger gates)
  -> structural parsers + source-grounded         (parse*.ts + curated specs:
     curated specifications                        document-table specs, class-
                                                   progression specs, magic-item
                                                   clause registry)
  -> semantic projections                         (mechanicsProjections.ts,
                                                   magicItemPassiveEffects.ts,
                                                   typed data.mechanics)
  -> validated generated rules pack               (emit.ts -> validateRulesPack ->
                                                   manifest.json + records.json)
  -> independent audit / readiness checks         (srdAudit.ts, deep audit,
                                                   rule-disposition + coverage
                                                   registers, magic-item clause
                                                   readiness, freeze manifest)
  -> runtime reference use + explicit engine hooks (lookup_rules tool +
                                                   engine families F1–F10)
```

Two things changed from the ADR 0007 mental model:

1. The pipeline has a **semantic-projection stage** and a **curated-specification
   stage**, not just extraction and structural parsing.
2. The output is judged against **two product-level bars** — reference and
   semantic/runtime — that are tracked and gated **separately**.

The current concrete implementation lives under
`packages/core/scripts/importers/dnd5e-srd-5.1/` (see its `README.md` for the
per-kind parser detail). Treat that README as the *component* reference and this
document as the *architecture* reference.

---

## 2. Two product stages, several correctness dimensions

Record the history accurately: the product goal did not lurch six times. There
were **two** major product-level stages, and *within* them we now distinguish
several **correctness dimensions** that are lenses for evaluating an artifact —
not a mandatory universal waterfall.

### 2.1 Initial stage

Build a **complete, accurate, source-grounded reference pack** with deterministic
structured data where clearly useful, while expecting the DM model to adjudicate
much of the remaining game from authoritative prose. This is ADR 0007's original
bar and it remains necessary.

### 2.2 Post-playtest stage

Character-creation and combat playtesting (the `eshyra-o9bd` thaw) showed the
desired gameplay quality requires **deterministic engine ownership for a much
larger class of rule behavior** than the initial stage assumed. That in turn
requires a **richer semantic rules representation** in the pack: the engine
cannot own concentration, spell slots, death saves, attunement, or magic-item
economies without the pack naming the relevant effects, formulas, usage
contracts, and engine-hook dependencies as structured data.

### 2.3 The correctness dimensions (evaluation lenses)

Use these to reason about *artifact quality* — not as sequential milestones and
not as separate historical goals:

| Dimension | The question it answers |
|---|---|
| **Reproducibility** | Does re-running the compiler over the pinned source reproduce the pack byte-for-byte? |
| **Source completeness** | Is every source rules element accounted for — reachable, child-of a record, or a reasoned ignore? (The inventory / coverage / region-ledger gates.) |
| **Structural fidelity** | Are stat blocks, tables, and rows reconstructed faithfully, with source typos preserved and no cross-entry bleed? |
| **Semantic modeling** | Does the pack carry the typed mechanics (effects, economies, operations, formulas) the execution boundary needs? |
| **Runtime ownership / support** | Is each rule's behavior explicitly owned — code-enforced, model-adjudicated-supported, or an engine hook — rather than left unclassified? |
| **End-to-end playable validation** | Does the rule actually work in a played turn over the real tool/engine surface? |

An artifact can be strong on one dimension and weak on another (a
reference-complete pack with no semantic layer; a semantically-rich record whose
engine hook has not landed). The readiness registers exist precisely to keep
those independent.

---

## 3. Curated semantic input vs. hand-curated output

This is the single most important distinction in the evolved model, and the one
most easily misread.

> **Curated semantic _input_ is allowed. Hand-curated generated _output_ is not.**

Generated pack records under
`packages/core/data/rules-packs/**/records.json` are **outputs**. They are never
hand-edited. They change only when a compiler input changes (a parser, a curated
specification, or the source manifest) and the pack is regenerated, under
`docs/importer-fix-protocol.md`. This is ADR 0007's "no hand-authored records,"
unchanged.

What ADR 0017 adds: a **source-grounded curated semantic specification** is a
legitimate *compiler input* — an "executable curation." It is not itself an
authoritative source; the licensed primary corpus remains the authoritative
source, and the curated spec is a source-grounded input that carries decisions
derived from it into the compiler. Examples already in the tree:

- the document-wide table specs (`SRD_5_1_DOCUMENT_TABLE_SPECS`,
  `classProgressionTables.ts`) — each pins an anchor, an exact column-header
  fingerprint, a row rule, and an exact expected row count;
- the reviewed clause registry for magic items (`MAGIC_ITEM_CLAUSES`, designed in
  the 18.7.7 state-contract doc) — transcribed once, mechanically, from a
  reviewed semantic source;
- the rule-disposition and engine-procedure coverage registers
  (`RULE_DISPOSITIONS`, `ENGINE_PROCEDURE_COVERAGE`).

A curated semantic specification may be treated as a legitimate compiler input
**only when all of these hold** (ADR 0017 §3):

- [ ] derived from the licensed source, not from model memory;
- [ ] identifies or is mechanically tied to the relevant source region / record
      (locator, clause id, table fingerprint, or equivalent);
- [ ] source phrases / locators / clause ids / grounding evidence checked where
      practical;
- [ ] deterministic;
- [ ] schema-validated;
- [ ] references resolve;
- [ ] exhaustive memberships use parity / conservation checks where appropriate
      (e.g. "every source item appears in the registry, no stale/unknown keys,
      pinned census asserted");
- [ ] source drift fails loudly rather than silently preserving stale semantics;
- [ ] the generated artifact is still produced by the compiler round trip.

A curated spec that meets this bar is as reproducible and auditable as parser
code. A hand-edited `records.json` is neither. **They are not the same act** —
do not use "curation is allowed now" to justify editing emitted JSON.

---

## 4. Choosing the implementation technique

When a source rule must become pack semantics, pick the *cheapest technique that
is still trustworthy*, preferring earlier options:

### 4.1 Structural parsing — when repeated source grammar exists

Use it for stat blocks, repeated spell metadata, regular equipment rows,
progression tables, regular usage annotations, and consistent heading structures.
This is the bulk of `parse*.ts`. A repeated grammar deserves a parser, not
hand-curated data per record.

### 4.2 Shared semantic grammars — for recurring mechanical language

Use them for recurring effect forms, repeated usage / recharge phrasing, common
damage / healing / save / modifier structures — genuinely repeated *semantics*,
not just repeated typography. The creature `mechanicsProjections` grammar and the
magic-item `effects` vocabulary are examples: reviewed grammars that match many
records and **fail closed** (prose outside the reviewed shape contributes no
projection).

Prefer an existing shared grammar over a new one when it fits. Extending a proven
grammar is cheaper and safer than a parallel one.

### 4.3 Declarative source-grounded curation — for irregular semantic families

Use it when the semantics are irregular and an engineer or agent **already has to
read and classify each clause individually** before any extraction logic could be
written. In that situation a declarative curated specification (a reviewed
registry of clauses with stable ids, each bound to its representation and its
engine hooks) is usually **clearer and more trustworthy** than building
ever-more-elaborate natural-language inference machinery that merely re-encodes
decisions a human already made during review.

The magic-item clause registry is the archetype: 240 items with irregular
economies, state machines, curses, and containment semantics that do not share a
parseable grammar. Curating the clauses is honest; forcing them through a generic
prose inferencer would hide the human judgment inside brittle heuristics.

### 4.4 Procedural record-name dispatch / one-off code — for genuine exceptions

Acceptable where justified (a single item with a bespoke `custom` state shape;
one table whose columns are irrecoverably interleaved). It must **not** silently
become the default semantic-modeling mechanism for an entire large corpus. If you
find yourself writing per-record `if (key === …)` branches across dozens of
records, you wanted 4.2 or 4.3.

### 4.5 Keep the layers visible

Wherever possible, preserve a visible distinction among **grammar**, **curated
data / specification**, and **exceptional procedural logic**. A reviewer should
be able to see which decisions were made by a rule, which by a curated table, and
which by a one-off. **The goal is trustworthy semantics, not maximizing the
amount of English meaning inferred automatically.**

---

## 5. Three separated layers: pack semantics, live state, engine services

The compiler owns exactly one of these three layers. Keep them separate; this is
the same separation the magic-item state contract enforces item-by-item.

### 5.1 Pack-side mechanics — compiler-owned, immutable, source-derived

Effects, formulas, usage / recharge contracts, operation definitions, engine-hook
requirements, references, prerequisites. This is *what a rule or item can do* —
never play-state. Regenerated only through the compiler.

### 5.2 Live state — campaign / instance-mutable, NOT compiler-owned

Current charges, attunement, resource counters, current form, stored spells,
depletion state, ownership and inventory instance identity. This lives in the
per-campaign SQLite store, keyed per instance (the magic-item contract's
"stateful ⇒ singleton row, state keyed by inventory row id" invariant). The
compiler never emits live state and pack records never carry it.

### 5.3 Engine services and hooks — shared, deterministic, NOT compiler-owned

Dice grammar; action economy; concentration; spell slots; resource reset and
recharge; death / dying / temp HP; rest processing; character-build resolution;
deterministic formulas and derived math; currency / assets / trade.

**Rules records and items must _use_ these shared services rather than privately
reimplementing them.** A magic item subscribes to the dawn/rest reset bus; it
does not carry its own recharge loop. A rule that needs vs-DC resolution names
the derived-math hook; it does not embed a bespoke comparator.

The current execution-boundary vocabulary and family names are defined in the
live design docs, not here — do not fossilize a census or a family list in this
guide. As of writing, the engine families are catalogued as **F1–F10** (dice
grammar, action-economy budget, concentration/active-effect lifecycle,
spell-slot economy, usage/recharge/resource/attunement state, death/dying/HP
buffer, rest engine, character-build gaps, derived-math primitives, currency /
trade surface) plus design-blocked **D1/D2**, in
`docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-8-execution-boundary-classification.md`
and the engine epic `eshyra-2n1t`. **Use those docs as the source of truth; if
the names or counts have changed by the time you read this, they win.**

---

## 6. The hybrid execution contract

The intended division of responsibility (the "Hybrid Contract" in
`packages/core/src/orchestrator/protocol.ts`):

- **The model** interprets intent, handles ambiguity, narrates, and makes bounded
  adjudicative rulings.
- **The rules pack** supplies authoritative source-grounded reference material and
  structured game semantics.
- **Deterministic tools and engine services** perform arithmetic and own the state
  transitions that require reliable repeatability. ("All dice and math go through
  the `roll` tool. Never invent a die result.")

Not every source procedure needs a dedicated subsystem. **Model-adjudicated
behavior can be a deliberate terminal architecture** when the required
deterministic primitives already exist and the remaining work is genuinely
contextual judgment. That status has a name — `model-adjudicated-supported` — and
it is a **reviewed, evidence-backed green** disposition, not a synonym for
"unimplemented." In a text-first, grid-less game, the *contextual* half of most
situational rules is correctly a terminal ruling; building geometry engines for
that half would contradict the product architecture.

But "situational" rarely means "wholly model-adjudicated" — ownership is
clause-level, not rule-level. Take **cover**: the model adjudicates the
*context* — geometry, fictional positioning, terrain interpretation, line of
sight, and whether the circumstances qualify for half or three-quarters cover;
the *deterministic consequences that follow that ruling* — the ±2 / ±5 AC and
Dex-save modifier composition into vs-AC/DC resolution — are owned by the
derived-math engine primitive (`cover` is a clause-level engine gap in the final
execution-boundary classification, not a fully terminal ruling). The same shape
holds for hiding, terrain, and most "situational" rules: **contextual
determination is model-adjudicated; the numerical modifiers, dice
transformations, state transitions, and resource changes that follow are owned
by deterministic tools/engine primitives.** This is exactly the clause-level
hybrid ownership the decision procedure (§10) formalizes — one rule can
simultaneously carry pack representation, a model-adjudicated context clause, and
a deterministic engine dependency.

The non-negotiable requirement is **explicit ownership**. A procedure must not be
left to model arithmetic or accidental conversational state merely because nobody
classified it. Every deterministic rule is either code-enforced, an actionable
engine gap, a design-blocked decision, or a reviewed model-adjudicated ruling —
by classification, not by omission. This ADR does **not** claim the compiler is
the engine: the pack carries the semantics and the hook requirements; the engine
owns execution.

---

## 7. Guidance for the current D&D SRD thaw / re-audit

The `eshyra-o9bd` thaw is closing the pack's semantic gaps to reach the agreed
**complete / accurate / playable** bar, then re-freezing. Operating rules for
agents working during it:

- **The goal is the agreed bar, not indefinite semantic enrichment.** Reach
  complete/accurate/playable, re-freeze, stop.
- **Follow the importer fix protocol** (`docs/importer-fix-protocol.md`) for any
  regression-sensitive change: identify the failure class, add coverage first,
  fix the parser/spec, regenerate, explain every generated diff.
- **Preserve deterministic regeneration.** The committed pack must match compiler
  output exactly (`npm run verify:dnd5e-srd-pack` exit 0).
- **Do not hand-edit generated records.** (§3.)
- **Convert discovered failure classes into broader invariants or audits** where
  that is proportionate and genuinely prevents recurrence — not a bespoke check
  per record.
- **Prefer existing shared semantic grammars** when they fit (§4.2).
- **Do not force irregular source mechanics into heroic generic parsing** merely
  to avoid explicit curation. A declarative curated spec is legitimate (§4.3).
- **Source-grounded declarative semantic specifications are valid compiler
  inputs** when they satisfy the §3 checklist.
- **Keep representation separate from engine implementation.** A compiler bead may
  *identify* an engine dependency and record or emit a hook / ownership marker —
  it should **not** casually build an unrelated engine subsystem inside an
  importer bead. Engine families live under the engine epic (`eshyra-2n1t`), not
  under importer beads.
- **Avoid speculative cross-system abstraction during the thaw.** Do not
  generalize D&D-specific parsing code solely because Pathfinder may exist later
  (§8).
- **Before adding another audit artifact, registry, or disposition layer**,
  determine whether an existing mechanism can be strengthened, consolidated, or
  made authoritative instead (§9). Audit machinery is subordinate to the product
  goal; avoid parallel proof systems that measure the same invariant differently
  without necessity.
- **Finish the current semantic closure honestly, re-freeze** (`eshyra-o9bd.14`
  is the regeneration + full-audit + re-freeze gate — re-freeze only when all
  re-freeze-bar items are green; `eshyra-2zyy` then re-enables normal thaw-note
  gating on the new frozen baseline),
  **then move the center of gravity toward consuming the rules system in
  gameplay.**

### 7.1 After re-freeze

Routine D&D compiler changes should generally be driven by one of:

- a demonstrated runtime need;
- a new audit finding;
- a source / version change; or
- a proven structural or semantic defect.

Do **not** turn post-freeze enrichment into an unbounded search for fields that
might someday be useful. The frozen pack is the durable product; the compiler is
the disposable means (per the standing importer-is-a-one-time-artifact
principle).

---

## 8. Guidance for Pathfinder and future systems

Future rules-pack compiler / curator work must **not** repeat the D&D journey
mechanically. Pathfinder (`eshyra-0m9.8/.9`, ADR 0006) is deferred until campaign
validation; when it resumes, apply these principles.

### 8.1 Establish source and license policy first

Before any records: authoritative corpus, license posture, source versions,
included and excluded material, vendoring / pinning strategy. For Pathfinder this
already exists in ADR 0006 (ORC-only Remaster corpus). Do not write parsers
before this is settled.

### 8.2 Inventory the source early

Do not wait until most record parsers are written to ask what structures exist in
the corpus. Establish early visibility into structural regions, table-like
content, stat blocks, prose sections, and **unexplained / unowned regions**. The
D&D pipeline's inventory / coverage / region-ledger gates are the pattern: fail
closed on anything unaccounted.

### 8.3 Establish an extraction IR or equivalent structural boundary

Do not couple every semantic parser directly to raw-source extraction quirks
where a stable source-region / intermediate representation is practical. The D&D
compiler's IR is `PageText[]` plus section slices; a different source format
needs a different IR. **A Pathfinder source built from HTML or structured text
must not imitate PDF-layout reconstruction** merely to look like D&D. The IR is
whatever gives semantic parsers a stable structural boundary for that format.

### 8.4 Reuse contracts, not document heuristics

Likely genuinely-reusable concepts (framework-level):

- source identity and pinning;
- provenance;
- pack schemas;
- reference integrity;
- generated-output verification;
- source-coverage obligations;
- semantic-projection contracts;
- runtime-readiness dispositions;
- engine-hook ownership.

**Not** reusable (D&D-specific): typography rules, heading names, two-column
table reconstruction, PDF prose quirks. These are not framework abstractions
merely because they already exist.

### 8.5 Let the second system test the abstraction

Do **not** build a universal rules-document compiler in advance. Make the shared
extension points above explicit, then let Pathfinder implementation pressure
reveal which abstractions are truly cross-system. Premature generalization from a
sample size of one is how you get a "framework" shaped exactly like D&D.

### 8.6 Define the quality model before the first freeze

For any new system, explicitly define what is required for source completeness,
structural fidelity, semantic readiness, runtime support, and playable
validation **before** freezing. Do not freeze an artifact while still implicitly
assuming those all mean the same thing — that assumption is exactly what the D&D
thaw had to unwind.

---

## 9. Audit-architecture restraint

The project now has substantial audit machinery: source inventory / coverage /
region ledger, the independent deep audit, the freeze manifest + thaw-note gate,
the rule-disposition and engine-procedure coverage registers, the magic-item
clause registry and readiness buckets, and the gameplay-readiness report.

Before introducing a **new** independent audit registry, disposition map, proof
artifact, or readiness census, ask:

1. What distinct failure class does this detect?
2. Can an existing invariant be strengthened instead?
3. Is the new artifact authoritative, or merely another view of something already
   proven?
4. What prevents it from drifting from parallel artifacts?
5. Can one mechanism subsume another?

Do not remove useful existing machinery for theoretical cleanliness. The goal is
**deliberate consolidation** as the architecture stabilizes — not a proliferation
of parallel proof systems measuring the same invariant differently.

---

## 10. The decision procedure

**When you encounter a source rule that needs to become usable Eshyra
semantics**, decide among six outcomes — and attach the required evidence:

| Outcome | Choose when | Required evidence |
|---|---|---|
| **Write a structural parser** | The source has repeated *typographic/structural* grammar across many records — stat blocks, rows, tables, headings (§4.1). | The grammar; representative records; fail-closed behavior on non-matching prose; regeneration diff explained. |
| **Use a shared semantic grammar** | Recurring mechanical *language* appears across multiple records and can be bounded by a reviewed fail-closed grammar — recurring effect/usage/damage/save forms (§4.2). | Corpus / membership review where practical; representative positive cases; meaningful near-miss negatives; fail-closed behavior for unmatched prose; source grounding; generated-diff review. Prefer extending a proven grammar over a parallel one. |
| **Add a declarative curated specification** | The semantics are genuinely irregular and each clause already requires individual classification before any extraction logic could be written (§4.3). | The §3 curated-input checklist: source grounding + locator/clause id, determinism, schema validation, resolving references, parity/conservation for exhaustive sets, loud source-drift failure, round-trip regeneration. |
| **Write an exceptional procedural projection** | A genuine one-off no rule or spec can cover cleanly (§4.4). | Why it is a true exception, not a hidden default; the single record/table it applies to; a note so a reviewer sees the seam. |
| **Leave it for model adjudication** | The remaining work is contextual judgment and the required deterministic primitives already exist (§6). | A reviewed `model-adjudicated-supported` disposition: the tool primitives relied on (checked against the registered tool surface) and the context requirement (what must be retrievable/structured at play time). Never left implicit. |
| **Identify an engine dependency** | Correct behavior needs a deterministic owner that does not yet exist — a state machine, invariant, dice-grammar extension, derived-math primitive, or reset hook (§5.3). | The pack-side representation *plus* an explicit engine-hook binding (which family / owner). The clause stays `engine-pending` until the owner lands; bead closure alone never upgrades it — new runtime evidence in a reviewed diff does. |

More than one outcome can apply to a single rule at **clause granularity** — do
not force one answer for a whole rule. A clause can be **pack-represented and
engine-pending at the same time** (e.g. Robe of the Archmagi's spell-save-DC
bonus is a pack `effects` entry *and* waits on the derived-math application
hook). And a single rule can span all three of pack representation,
model-adjudicated context, and a deterministic engine dependency — **cover** is
the canonical case (§6): the qualify-for-cover determination is
model-adjudicated context, the ±2 / ±5 AC and Dex-save modifier composition is a
derived-math engine dependency, and the cover degrees are structured reference
data. Represent each clause where its data lives, mark the model-adjudicated
clauses as such, and record every engine hook each clause needs.

If applying this procedure uncovers a genuine implementation contradiction that
needs code, **create or update a concrete bead** rather than broadening the
current change — especially during the thaw, where scope control is load-bearing.

---

## 11. Terminology

Use these terms deliberately:

- **rules-pack compiler** — the overall deterministic source-to-pack system.
- **executable curation** — explicit source-grounded semantic decisions encoded
  as deterministic compiler inputs.
- **importer** — existing paths, commands, historical work, and the
  structural-extraction components (`import:dnd5e-srd`,
  `packages/core/scripts/importers/`, existing beads).
- **curator** — a system-specific compiler that combines parsing and explicit
  semantic curation.

**There is no mass rename during the thaw.** The conceptual architecture changes
without churn-renaming every directory, command, bead, or historical document.
Terminology sits on top of stable paths.

---

## 12. Related documents

- [ADR 0017](adr/0017-rules-pack-compiler-and-executable-curation-architecture.md)
  — the decision this guide applies.
- [ADR 0007](adr/0007-rules-pack-ingestion-policy.md) — source-authority and
  model-assistance boundary (still in force; §1 goal refined by 0017).
- [ADR 0005](adr/0005-dnd-srd-pack-versions.md),
  [ADR 0006](adr/0006-pathfinder-source-policy.md) — per-system source/license
  policy.
- [ADR 0013](adr/0013-runtime-srd-pack-is-the-generated-pack.md) — the generated
  pack (not the in-code placeholder) is the runtime pack.
- `docs/importer-fix-protocol.md` — mechanics for regression-sensitive compiler
  changes.
- `packages/core/scripts/importers/AGENTS.md` — the concise agent quick-rules.
- `packages/core/scripts/importers/dnd5e-srd-5.1/README.md` — the D&D component
  reference (per-kind parsers, regeneration).
- `docs/audits/dnd5e-srd-5.1-final/` — the freeze audit, execution-boundary
  classification, magic-item state contract, rule-disposition design, and thaw
  notes that this architecture generalizes.
