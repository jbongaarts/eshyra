# Integrated transition design: first diagnostic corpus and minimal rule-discovery experiment

- **Date:** 2026-07-30
- **Bead:** `eshyra-o9bd.19.8` (child of `eshyra-o9bd.19`)
- **Repository state designed against:** `main` @ `f4b3461`
  ("Merge PR #484 …"), which is `origin/main` at the time of writing.
  Generated pack: `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`,
  **1,813 records**.
- **Governing decision:** [ADR 0020](../../adr/0020-rules-pack-as-rule-awareness-infrastructure-with-bounded-deterministic-capabilities.md).
- **Reconciles:** `2026-07-29-current-state-claim-and-defect-map.md`
  (`eshyra-ar72`) and `2026-07-29-existing-discovery-substrate-map.md`
  (`eshyra-jued`). Both are **reviewed evidence, not architecture authority.**

**Evidence conventions.** Every load-bearing statement is tagged:

| Tag | Meaning |
|---|---|
| **[VERIFIED]** | Re-derived in this session against `f4b3461` by reading the exact cited symbol, running the cited query, or invoking the cited code. |
| **[MAP]** | Carried from one of the two merged evidence maps without independent re-derivation. Attributed to `ar72` or `jued`. |
| **[DESIGN]** | A decision this document makes. Falsifiable, bounded, and owned. |
| **[OPEN]** | Deliberately unresolved here, with the owner or the evidence it waits on named. |

---

## 1. Purpose and authority

### 1.1 What this document is

This is the integrated transition design required after ADR 0020's acceptance.
It does four things and nothing else:

1. reconciles the two merged evidence maps into one set of facts the successor
   work can build on;
2. records the **dispositions** ADR 0020's Consequences section demands for the
   existing readiness, coverage, audit, capability, census, and freeze
   artifacts;
3. defines Eshyra's **first diagnostic corpus** — twelve bounded probes with
   verified identities — and the **minimal rule-discovery experiment** that
   consumes it;
4. hands off a successor work breakdown against **existing** owning beads.

### 1.2 What this document is not

- It is **not** an implementation, and this PR contains no production code, no
  generated pack change, no schema change, no fixture data, and no new tool.
- It is **not** a second campaign-ruling architecture. Campaign rules and
  ambiguity rulings remain owned by `eshyra-jhpt` (§8).
- It is **not** a finding disposition. The 2026-07-24 finding corpus is
  dispositioned only after it becomes enumerable repository data
  (`eshyra-o9bd.19.1.15`; §5.7, §9.6). Nothing here closes, retires, narrows,
  or downgrades a finding.
- It is **not** a universal clause ontology, relationship vocabulary, ranker,
  storage decision, or completeness claim of any kind (§3.2).

### 1.3 Authority order

1. **ADR 0020** controls. Where the maps, the beads, or an older ADR read
   more broadly, ADR 0020 narrows them.
2. **ADR 0007 §2–§4** (source authority; the ban on model-authored pack
   content), **ADR 0013** (the generated pack is the runtime pack),
   **ADR 0012** (content/state layering), **ADR 0014** (overlay canon),
   **ADR 0015** (migration-first schema and state guarantees), **ADR 0018**
   (single-class engine boundary and its §6 reporting obligation), **ADR 0010**
   (provider-neutral adapter seam) stand as written. ADR 0017 §2 is narrowed by
   ADR 0020; ADR 0017 §3 (no hand-edited generated records) and §8 (audit
   restraint) are unchanged and constrain this design directly.
3. **ADR 0019** requires follow-up review under ADR 0020; §5.6 records the
   bounded disposition this design needs from it and leaves the ADR-level
   review to its own successor.
4. **`AGENTS.md`** governs workflow, the importer fix protocol, and the
   PR-only-to-`main` rule.
5. The two evidence maps are **evidence**. Where they disagree with code read
   at `f4b3461`, the code wins; §2.4 records the one place where a re-derivation
   was needed.

### 1.4 Authorities read for this design

ADR 0020 in full; ADRs 0007, 0010, 0012 (content/state layering), 0013, 0014,
0015, 0017, 0018, 0019; both merged evidence maps in full; `AGENTS.md`;
`eshyra-o9bd.19.7` (the DESIGN_INVALIDATED handoff) and `eshyra-o9bd.19.1.14`
(Foundation 1) in full including notes; `eshyra-o9bd.19` and `eshyra-olc5`
epics; `eshyra-jhpt` and all nine children `.1`–`.9` in full;
`eshyra-o9bd.19.1.15`, `.19.1.6`, `.19.2.1`, `.19.2.4`, `.19.5.1`, `eshyra-olc5.2`,
`eshyra-o9bd.14`, `eshyra-2zyy`, `eshyra-ar72`, `eshyra-jued`,
`eshyra-o9bd.19.1.17`. Implementation read directly at `f4b3461`:
`packages/core/src/orchestrator/{toolLookupRules.ts,contextAssembler.ts,orchestrator.ts,turnAuditor.ts,toolUseItem.ts,spellUpcast.ts}`;
`packages/core/src/rules/{types.ts,stack.ts,conditionRelations.ts,srdAudit.ts,srdPlayabilityAudit.ts,srdChoiceProseAudit.ts,srdEquipmentResolutionAudit.ts}`;
`packages/core/src/state/{itemExecutionReadiness.ts,itemState.ts,campaignRecordLookup.ts,encounterCombatants.ts,activeEffects.ts}`;
`packages/core/src/character/rulesPackResolver.ts`;
`packages/core/src/adventure/references.ts`;
`packages/core/src/memory/turnTrace.ts`;
`packages/core/scripts/create-dnd5e-srd-audit-bundle/{cli.ts,ruleDispositions.ts}`;
`packages/core/scripts/importers/dnd5e-srd-5.1/emit.ts`;
`packages/cli/src/{playTypes.ts,playTurnLoop.ts,adventures.ts}`;
the generated pack and the
`packages/core/data/adventure-modules/eshyra_hollow-beneath-emberfall/adventure-module.json`
module.

### 1.5 Owning bead, and the exact bead account for this work

`eshyra-o9bd.19.1.14` (Foundation 1) was inspected first, as required. It is
IN_PROGRESS and its scope is the **pre-ADR-0020 obligation-discharge proof** —
source-obligation identity produced independently of the projector, discharged
by exact projected atoms, on five real procedures. It is a source-fidelity and
capability-evidence foundation, not a discovery design, and its own explicit
non-goals forbid it absorbing corpus-wide work. It therefore does **not** cover
this task. `eshyra-ar72` and `eshyra-jued` are CLOSED and scoped to their
respective maps. No open bead named the integrated transition design, so one
owning bead was created — `eshyra-o9bd.19.8`, a sibling of the two map beads
under `eshyra-o9bd.19`.

**Five beads were created by this work, and no others.** **[VERIFIED]**

| Bead | Role |
|---|---|
| `eshyra-o9bd.19.8` | owns this design document |
| `eshyra-l3e5` | B1 — `lookup_rules` rejects the addressable `stat-block` kind (§9.1) |
| `eshyra-seoh` | B2 — normal CLI play never passes the adventure-module resolver (§9.2) |
| `eshyra-6vpw` | B3 — deterministic pack consumers use a base-only campaign lookup with a silent bundled-D&D fallback (§9.3) |
| `eshyra-uiax` | B5 — magic-item readiness silently skips a clause with an unrecognized scope kind (§9.5) |

The four defect beads are **verified, reproducible defects with no prior
owner**, filed so that each blocker in §9 has a live owner and a required next
state, as the standing constraint on findings requires. B4 (Starting Wealth)
needed no new bead: `eshyra-o9bd.19.2.1` already owns it and has already
recorded the decision (§5.10).

**No speculative successor bead was created.** The §14 work items that would
need a new owner — W7 (fixture corpus), W8 (offline harness), W9 (shadow
integration), W10 (packet intervention), W11 (`jhpt` interface consumption),
W13 (capability-contract normalization), W15 (held-out/live evaluation), and
the proposed disposition child inside W14 — are recommendations contingent on
review of this design, and are deliberately left unfiled. W12 and the remainder
of W14 rest on **existing** beads (`eshyra-jhpt.1`–`.9`; `eshyra-o9bd.14` and
`eshyra-2zyy`). No existing bead was closed, retired, or reclassified.

### 1.6 Process note

This is an explicit architecture-transition deliverable. The profile-based
contract-authorization protocol described in `eshyra-o9bd.19.1.17` is **not
present on `main`** — no protocol document, workflow, or `review:preflight`
script exists at `f4b3461` **[VERIFIED]** — so this document follows the
ordinary `AGENTS.md` workflow that both merged evidence maps followed:
worktree, `npm run verify:worktree`, feature branch, PR to `main`. Nothing here
claims or requires a review-authorization checkpoint as a prerequisite.

---

## 2. Evidence reconciled from both maps

The maps were produced independently and deliberately did not read each other
(`ar72` §10.8; `jued` §2 "the parallel current-state claim report was neither
read nor awaited"). They overlap at exactly one seam — `lookup_rules` and
per-turn context assembly — and are otherwise complementary.

### 2.1 Agreements, re-verified here

| Fact | `ar72` | `jued` | Re-derived at `f4b3461` |
|---|---|---|---|
| The generated pack is the runtime pack, 1,813 records | §1.2, §1 header | §5 census | **[VERIFIED]** `jq length` = 1813 |
| Per-turn context contains **no** rules-pack material | §3.1, §8.2 | §1, §6 | **[VERIFIED]** `contextAssembler.ts` imports `bundledSrdPack.js` only for the `DND5E_SRD_PACK_ID` comparison at `:412`; `assembleContext` (`:532`) and `renderContextMessage` (`:951`) inject no record |
| `lookup_rules` is exact, model-initiated, non-expanding | §3.1 | §4, §5 | **[VERIFIED]** `toolLookupRules.ts` requires `kind` plus exactly one of `name`/`ref`; returns `record: result.record` unchanged; no traversal |
| The turn auditor is post-hoc detection, not discovery | §3.1 | §8 | **[VERIFIED]** `orchestrator.ts:663` audits a produced candidate; `turnAuditor.ts:328` `boundedAuditJson` truncates its evidence |
| No campaign-ruling store, resolver, or ruling-to-capability path exists | §3.1, §9.10 | §7 | **[VERIFIED]** grep across `packages/core/src`: the only production readers of `data.mechanics.ambiguities` are pack validation (`rules/rulesAmbiguities.ts`, `rules/validate.ts:276-299`, `rules/magicItemMechanics.ts:411,2258`) and the magic-item transition path at `state/itemState.ts:1428` |
| One live runtime capability gate exists and fails closed | §4.7 | §5, §7 | **[VERIFIED]** `itemExecutionReadiness.ts:assertMagicItemOperationReady`, called at `itemState.ts:1888` |
| Record kinds, scenarios, and discovery paths are not partitions | §1.11, §11 | §12.4 | ADR 0020 §4 |

### 2.2 Complements: the two defect sets are disjoint

`ar72` enumerates nine claim/pack/source defects (D-1 … D-9). `jued` enumerates
three runtime-path defects. **No entry appears in both lists**, and the union is
what §9 turns into the pre-experiment blocker set:

| Source | Defect | Dimension |
|---|---|---|
| `ar72` D-1 | `table:starting-wealth-by-class` is compiler-authored yet carries SRD provenance and the CC-BY block | source fidelity |
| `ar72` D-2 | every readiness `finding` and coverage-ownership pointer names a CLOSED bead | capability accounting |
| `ar72` D-3 | 197 records fall into no readiness bucket | capability accounting |
| `ar72` D-4 | clause-incomplete typed projections read as fully modeled | source fidelity, adjudication support |
| `ar72` D-5 | the zero-engine-pending re-freeze bar infers completeness from an open schema | capability accounting |
| `ar72` D-6 | the freeze gate is off in three independent ways | source fidelity |
| `ar72` D-7 | the 2026-07-24 finding corpus is not repository data | all five, indirectly |
| `ar72` D-8 | ADR 0019 residual families: owners closed, residuals unconverted | source fidelity, adjudication |
| `ar72` D-9 | latent fail-opens (four predicates) | capability accounting |
| `jued` 1 | `lookup_rules` omits the addressable `stat-block` kind | discovery |
| `jued` 2 | normal CLI play passes no adventure-module resolver | discovery, state integrity |
| `jued` 3 | legacy `lookupCampaignRecord` / `campaignBasePack` ignore add-ons and fall back to bundled D&D | discovery, capability, state integrity |

All three `jued` defects were independently re-derived here:
`toolLookupRules.ts` enum (`:76-93`) omits `stat-block` while
`adventure/references.ts:134-141` accepts encounter refs to `creature` **or**
`stat-block` **[VERIFIED]**; `packages/cli/src/playTypes.ts:35` `PlayDeps` has no
resolver and `playTurnLoop.ts:96-107` constructs `RunTurnDeps` without one, while
`encounterCombatants.ts:638-642` throws
`start_encounter requires an active adventure module resolver` **[VERIFIED]**;
`campaignRecordLookup.ts:85-98` selects a bundled base by `packId` alone and
falls back to `getBundledDnd5eSrdPack()`, and `encounterCombatants.ts:527-533`
repeats the pattern, while `resolveStrictCampaignRulesStack` (`:69-76`) resolves
system, pack, version **and** ordered add-ons **[VERIFIED]**. Live callers of the
legacy path: `state/actionEconomy.ts:297,374,445`,
`state/activeEffects.ts:1824,2560,2583,4031`, `state/attunement.ts:538`,
`state/usageCounters.ts:785` **[VERIFIED]**.

### 2.3 Numeric divergences reconciled by re-derivation

`ar72` §4.8 reports **794 `engine-pending` clauses**; `jued` §5 reports
**795 readiness clauses carrying non-empty `engineHooks`**. Both are correct and
they are not the same predicate. Re-derived over the committed pack:

```text
records with executionReadiness : 240   (all magic-item)
clauses                         : 1016
  engine-pending                : 794   (all 794 also carry missingHooks)
  green                         : 218
  adjudicated-by-design         :   3
  design-blocked                :   1
clauses with non-empty engineHooks : 795
```

The 795th is `magic-item:candle-of-invocation/c1-burn-time`, which is **green**
while still declaring an `F5: duration-budget accounting` hook; the single
`design-blocked` clause
(`magic-item:orb-of-dragonkind/DB:Orb of Dragonkind:artifact-random-properties`)
declares no hooks at all. **[VERIFIED]** The reconciliation matters beyond
bookkeeping: *a green clause may still declare an engine hook*, so "green" is
not interchangeable with "hook-free", and neither count may be reported as a
capability inventory (§5.5).

### 2.4 The one seam where the maps overlap

Both describe the `lookup_rules` / context-assembly boundary. They do not
conflict. `ar72` §4.12 draws a distinction `jued` does not state explicitly and
that this design adopts: a **field-specific reader** (production code that reads
a named field and computes from it) is not the same as the **generic
whole-record consumer** (`lookupRulesTool` returning `record: result.record`
unchanged). No production code reads `mechanics.saves`, `mechanics.damage`,
`mechanics.area`, or `data.mechanics.ambiguities` as fields — yet every one of
them reaches the DM whenever the model looks the containing record up.
**[VERIFIED]** Consequence adopted throughout this document: **the typed
spell/creature/hazard projections are discovery and adjudication-support
surface today, not execution surface**, and their defects are correspondingly
adjudication-support and fidelity defects — which ADR 0020 §1 makes *more*
serious, not less, because discovery places them into context as authority.

### 2.5 What neither map establishes

- No live-model behavior was observed by either map, and none is assumed here.
  Every claim about what the DM "receives" is a claim about a code path.
- The exact membership of the clause-incompleteness family (`ar72` D-4) is
  deliberately unestablished; `eshyra-o9bd.19.1.6`/`.19.1.15` require a
  generated membership query and `eshyra-o9bd.19.7` names count-pinning as a
  recurring failure idiom. This design never asserts that membership.
- No real third-party add-on corpus exists to census, so add-on behavior is
  known from `rules/stack.ts` and its tests only (`jued` §11). Probe P11 (§10.11)
  is therefore explicitly synthetic.

---

## 3. Decisions and non-goals

### 3.1 Decisions

**[DESIGN]** Each decision is falsifiable and is exercised by at least one probe
in §10.

| # | Decision | Exercised by |
|---|---|---|
| **D1** | Pilot source identity is a **diagnostic-fixture identity**: canonical `RulesRecord.key` plus `provenance.sourceRef` plus `provenance.locator`, narrowed where needed by a test-local selector (JSON pointer, existing ambiguity ID, existing operation ID, or a narrowly described source-text predicate). It asserts nothing about universal clause decomposition. | all probes |
| **D2** | Discovery emits **route classes**, not a relationship ontology. Nine initial classes (§6.2), all diagnostic labels, open to revision by probe evidence. | P1–P12 |
| **D3** | Candidates are deduplicated **by canonical record key**, and every route and traversal reason survives the merge. | P1, P5, P9 |
| **D4** | Candidates are ranked into **three experimental bands** (must-consider / related / exploratory). A must-consider candidate may never be silently dropped; overflow is explicit and **fails the diagnostic probe**. | P4, P5, P9 |
| **D5** | The context packet carries **source prose plus disclosed projection limits**. A typed projection is never presented as complete because it exists, and never converts into deterministic readiness. | P3, P4, P8 |
| **D6** | Campaign rules and ambiguity rulings are **retrieved from the `eshyra-jhpt` runtime through a narrow read interface** (§8). Discovery owns no rule store, schema, lifecycle, or resolver. | P7, P10 |
| **D7** | Deterministic capability presence is reported as a **positive, bounded contract with declared exclusions**, joined to the discovered record at packet-build time — never inferred from the presence of typed fields. | P4, P7, P8 |
| **D8** | The experiment proceeds **offline first** (stage harness), then **shadow**, then **intervention**, then **held-out/live**. No stage may be skipped, and shadow evidence is not a valid baseline until the applicable blockers in §9 are repaired. | §12 |
| **D9** | Measurements stay **independent per probe and per stage** (§13). No composite score, coverage percentage, or universal pass/fail is produced. | §13 |
| **D10** | Every existing artifact in ADR 0020's reassessment list receives an explicit disposition **with reasons and a named next state** (§5). None is deleted for tidiness; none is grandfathered. | §5 |
| **D11** | The re-freeze bar is **replaced**, not deleted: a nine-condition truthfulness bar (§5.9) that requires no global deterministic closure and no universal discovery completeness. | §5.9 |
| **D12** | Discovery instrumentation **extends the existing accepted-turn trace seam**. No competing readiness store, finding registry, or proof database is created (ADR 0017 §8; ADR 0020 Consequences "audit-architecture restraint"). | §12.2 |

### 3.2 Non-goals

This design does not, and no work under it may claim to:

- define a universal clause, obligation, or semantic-node identity;
- define a closed or universal relationship vocabulary;
- select a graph database, vector database, embedding model, ranker, or
  retrieval technology;
- claim a corpus-wide capability inventory;
- claim universal retrieval completeness, or that any probe set bounds the
  rules universe;
- implement production discovery, a campaign-rule subsystem, or fixture data in
  this PR;
- reclassify, close, or retire any existing finding;
- treat a scenario, route, neighborhood, or record kind as a partition of the
  corpus.

**Standing asymmetries** carried verbatim from ADR 0020 §3 and restated because
every §10 probe depends on them: a deterministic operation does not imply a
complete record; absence of a capability binding is a statement about Eshyra,
not about the rules; "unbound", "unclassified", and "not recognized" are not
safety properties. Additionally: **discovery success does not prove correct
adjudication, deterministic capability, or state integrity**, and **capability
success does not prove record or clause completeness**.

---

## 4. Ownership boundaries

**[DESIGN]** Five ADR 0020 concerns, mapped onto real owners. The right-hand
column is the prohibition that keeps the boundary from eroding.

| Concern | Owner (bead / code) | May not |
|---|---|---|
| **Source fidelity** | rules-pack compiler; `eshyra-o9bd.19.2.*` (source authority, locators, taxonomy), `eshyra-o9bd.19.1.14` (obligation identity and discharge) | be satisfied by a discovery improvement; a faithful passage is a precondition for discovery, not an output of it |
| **Discovery** | this transition program under `eshyra-o9bd.19` (§14 W7 diagnostic fixture corpus, W8 offline stage harness, W9 shadow trace integration, W10 context-packet intervention, W15 held-out/live evaluation); pack-side discoverability under `eshyra-o9bd.19.2.4` | own campaign rules, own capability contracts, or assert clause completeness |
| **Interpretation / adjudication** | primary DM model (ADR 0020 §2); auditor policy under the existing auditor owner | be replaced by deterministic classification; be inferred from packet contents ("present" ≠ "used") |
| **Deterministic execution** | `eshyra-olc5` (engine families) and the specific capability modules; `itemExecutionReadiness.ts` is the first real contract | be claimed for an operation that has not been positively selected; be inferred from typed-field presence |
| **State integrity** | existing state kernel (ADR 0012/0014/0015/0018): `mutateStateBatch`, migrations, checkpoints, `characterBuild.ts` | be weakened by any transition work; ADR 0020 leaves all of it intact |
| **Campaign rules and ambiguity rulings** | **`eshyra-jhpt`** and its nine children | be duplicated by discovery in any form — schema, table, tool, resolver, lifecycle, or house-rule subsystem (§8.4) |
| **Findings and their dispositions** | `eshyra-o9bd.19.1.15` (truthful audit-fact registry), successors `.19.1.7`/`.19.1.8` | be re-implemented by a discovery-owned finding store; be dispositioned in bulk before the registry exists |
| **Re-freeze policy** | `eshyra-o9bd.14` (regenerate + re-freeze), `eshyra-2zyy` (thaw-note gate) | proceed on the withdrawn zero-engine-pending bar (§5.9) |

Two boundaries deserve explicit statement because both maps show them eroding
in practice:

- **Discovery ↔ campaign rules.** The moment discovery needs "the active ruling
  for this ambiguity", the cheap move is a discovery-local table. That is
  forbidden: §8 defines a **read interface** onto `eshyra-jhpt`, and the
  experiment consumes a stub of that interface until `jhpt` lands.
- **Discovery ↔ capability.** The moment a packet needs "can the engine do
  this?", the cheap move is to read typed fields and infer. That is forbidden:
  the packet consumes a **capability preflight** result (§7.2), which for magic
  items today means the exact contract in `itemExecutionReadiness.ts`, and
  otherwise means "no capability positively selected" — which is a statement
  about Eshyra, never about the rules.

---

## 5. Existing-artifact dispositions

ADR 0020's Consequences require each named artifact to be **confirmed, narrowed,
repurposed, or retired with reasons**. Each disposition below states the verb,
the reason, the scope it keeps, its required next state, and its owner. None of
these dispositions closes a finding.

### 5.1 `srdPlayabilityAudit`, `srdChoiceProseAudit`, `srdEquipmentResolutionAudit` — **retain as bounded regression guards**

**Disposition:** retain, unchanged in scope, with an in-band scope statement.
**[DESIGN]**

- `packages/core/src/rules/srdPlayabilityAudit.ts` (`auditSrdPlayability`, `:764`)
  guards seven enumerated historical defect classes. **[VERIFIED]**
- `packages/core/src/rules/srdChoiceProseAudit.ts` (`auditSrdChoiceProse`, `:323`)
  guards choice-announcing prose across five scanned kinds. **[VERIFIED]**
- `packages/core/src/rules/srdEquipmentResolutionAudit.ts`
  (`assertEquipmentResolution`, `:322`) fails closed on an unknown proficiency
  phrase or a zero-candidate equipment filter — one of the few artifacts in the
  corpus that fails on *unrecognized* input rather than returning empty.
  **[VERIFIED]**

**Reason:** each is a positive list of known defect classes, honest in-band
about its scope, and each is the only regression guard its class has. ADR 0017
§8 and ADR 0020's audit-restraint consequence both direct the transition to
strengthen what exists rather than replace it.

**Required next state:** each module's header must state, in-band, that a green
result is scoped to its enumerated categories and is **not** evidence of global
source, discovery, adjudication, or capability completeness. No scope widening
is authorized by this document. Owner: **§14 W14 — artifact dispositions and
re-freeze policy** (proposed disposition child under `eshyra-o9bd.19`),
coordinated with **§14 W6 — durable finding registry**
(`eshyra-o9bd.19.1.15`) so the guards and the finding registry do not restate
each other.

### 5.2 `GAMEPLAY_READINESS_DISPOSITIONS` — **narrow to a non-exhaustive historical and diagnostic-signal report**

**Disposition:** narrow. Keep the membership registries; withdraw the partition
and closure claims. **[DESIGN]**

Evidence: `packages/core/scripts/create-dnd5e-srd-audit-bundle/cli.ts:1256`
(registry), `:1934` (`assertGameplayReadinessDispositions`). **[VERIFIED]**
`ar72` §4.1 establishes: 197 records match no bucket (109 `equipment`,
87 `table`, 1 `stat-block`); all five `finding` entries (410 records) name
CLOSED beads; `hasMechanicsProjection` (`cli.ts:964`) accepts `mechanics: {}`.
**[MAP: ar72]**

After narrowing it must no longer claim, in code, doc-comment, or report text,
that:

- its buckets partition the corpus;
- an unrecognized record is satisfied;
- a closed bead pointer proves the obligation resolved;
- zero bucket findings proves pack readiness.

**Preserved exactly:** `ACCEPTED_PROSE_RECORD_KEYS` (`cli.ts:1236`),
`ACCEPTED_METADATA_ONLY_SPELLS` (`:1212`), and
`CREATURE_ENTRY_REVIEWED_DISPOSITIONS` (`:1194`) — key-pinned membership
registries that remain load-bearing regression evidence and must not be
discarded with the bucket mechanism.

**Required next state:** (a) the report is labelled non-exhaustive in-band and
in its emitted output; (b) the 197 bucket-less records are recorded as a stated
scope gap rather than an implied green; (c) `hasMechanicsProjection`'s
empty-object acceptance is corrected or replaced by
`hasSubstantiveMechanicsProjection` (`cli.ts:920`); (d) each `finding` pointer
becomes a durable finding-registry reference rather than a bead-shaped string,
sequenced **after** `eshyra-o9bd.19.1.15`. Owner: **§14 W14 — artifact
dispositions and re-freeze policy**, dependent on **§14 W6 — durable finding
registry** (`eshyra-o9bd.19.1.15`).

### 5.3 `RULE_DISPOSITIONS` — **retain as an exact classification of `rule:*` records, and only that**

**Disposition:** retain in scope. **[DESIGN]**

Evidence: `packages/core/scripts/create-dnd5e-srd-audit-bundle/ruleDispositions.ts:80`
(registry), `:3177` (`assertRuleDispositions`). **[VERIFIED]** It classifies all
335 `rule:*` records exactly once and enforces duplicate/owner/table-evidence
integrity; it makes no claim about any other kind. **[MAP: ar72 §4.2]**

It must **not** be generalized into corpus-wide semantic ownership, discovery
completeness, capability completeness, or exclusive clause ownership. Read as a
corpus classification it is a category error, and under ADR 0020 §4 exclusive
ownership models are rejected outright.

**Required next state:** an in-band scope statement plus replacement of the
count-pinned `EXPECTED_SEMANTIC_CENSUS` (`:2935`) with identity-pinned
assertions, so that an equal-size reclassification cannot pass. Owner:
**§14 W14 — artifact dispositions and re-freeze policy**.

### 5.4 `ENGINE_PROCEDURE_COVERAGE` — **split three conflated responsibilities**

**Disposition:** repurpose by splitting. **[DESIGN]**

Evidence: `ruleDispositions.ts:1669` (registry), `:3010`
(`validateRuleRegistries`), `:3261` (`buildRuleDispositionReport`); the entry
type `RuleProcedureCoverage` carries `status`, `runtimeOwner`, `evidence`,
`primitives`, `contextRequirement`, `dependencyNote`, `missing`, `designOwner`,
`externalClauses`. **[VERIFIED]** Census: implemented 39,
model-adjudicated-supported 108, partial 16, unimplemented 2, design-blocked 10,
plus 7 `externalClauses` rows. **[MAP: ar72 §4.3]**

The registry currently answers three different questions in one row shape. Split
them:

1. **Adjudication-context inventory** — for a model-adjudicated procedure, what
   must be *retrievable at play time*. Today this is the free-text
   `contextRequirement` that no gate reads; under ADR 0020 §5 it becomes the
   natural input to discovery expectations, and it is the single most reusable
   asset in the registry. Worked example verified at `f4b3461`: `rule:cover` is
   `model-adjudicated-supported` with `primitives: ['lookup_rules',
   'resolve_check']` and `contextRequirement` "degree-of-cover selection is the
   classic ruling; the ±2/±5 AC and Dex-save bonuses ride resolve_check declared
   modifiers"; `rule:opportunity-attacks` is `model-adjudicated-supported` with
   `primitives: ['lookup_rules', 'roll', 'spend_turn_resource']` and
   `contextRequirement` "trigger/exclusion ruling; the reaction spend is
   code-owned (F2 turn budget)". **[VERIFIED]** These are exactly probes P1 and
   P2's must-include expectations.
2. **Positive deterministic-capability bindings** — the `implemented` rows with
   `runtimeOwner` + `evidence`, restated in the ADR 0020 §3 five-field shape
   (operation, inputs, exclusions, revision/identity, residual interpretation).
   `rule:concentration` is `implemented` with five runtime owners and
   `activeEffects.test.ts` as evidence. **[VERIFIED]**
3. **Unresolved, deferred, or design-blocked work** — `partial`,
   `unimplemented`, `design-blocked`, and `externalClauses` rows.
   `rule:short-rest` and `rule:long-rest` are `unimplemented` with exact
   `missing` text naming F7. **[VERIFIED]**

**ADR 0018 reporting obligations are preserved.** The ten `design-blocked` rows
pointing at `eshyra-2n1t.1`/`.2` were resolved *into ADR 0018*, whose §6
requires the multiclass procedures to keep being reported as deliberately
deferred. The pointer is stale; the disposition is not. **[MAP: ar72 §4.3]**

**Closed-bead pointers may not remain the only durable identity for an
unresolved obligation.** Every `designOwner` and `externalClauses.bead`
currently names a closed bead **[MAP: ar72 §6.1 D-2]**. After the split, each
unresolved row must carry a durable finding-registry identity from **§14 W6 —
durable finding registry** (`eshyra-o9bd.19.1.15`), with the bead pointer
retained as history. Owner: **§14 W14 — artifact dispositions and re-freeze
policy**, dependent on W6.

### 5.5 `itemExecutionReadiness` and `engine:F1`–`engine:F10` — **retain the contract; correct the fail-open; narrow the families**

**Disposition (contract):** retain as the first real bounded runtime capability
contract, conditional on repair. **[DESIGN]**

`assertMagicItemOperationReady` (`packages/core/src/state/itemExecutionReadiness.ts`),
called from `itemState.ts:1888`, requires a positive
`derived-magic-item-clauses-v1` contract, enumerates blockers, and throws before
any state mutation. It is the only artifact in ADR 0020's reassessment list that
changes runtime behavior, and the only capability in the repository with an
explicit revision identity. **[VERIFIED]**

**Required repair before it serves as pilot evidence:** `inSelectedScope`
(`:19-31`) returns `false` for any `scope` whose `kind` is neither `'parent'`
nor a matching `'variant'`, and `:76-77` then skips that clause entirely — so a
clause with a malformed or unrecognized scope **cannot block**. No such clause
exists in the committed pack, so it is latent; ADR 0020 §3 makes it a defect
regardless ("any gate … that reads an unbound or unrecognized item as satisfied
is a defect, not a green"). **[VERIFIED by reading the code]** It must fail
closed on an unrecognized scope kind. This is blocker **B5** (§9.5).

**Magic-item readiness is not proof of** full magic-item semantics, capability
coverage for other record kinds, or corpus-wide engine completeness. The same
record can carry a green clause and an engine-pending clause simultaneously —
`magic-item:ammunition-1-2-or-3` does exactly that (§10.8), and that coexistence
is the pilot evidence for ADR 0020 §3's first asymmetry.

**Disposition (`engine:F1`–`engine:F10`):** narrow to what it is. **[DESIGN]**
It is the **generated magic-item capability backlog** — 240 records, all
`magic-item`, 1,016 clauses, 795 carrying engine hooks — and not a corpus-wide
engine inventory. No other record kind carries `executionReadiness`.
**[VERIFIED]** `eshyra-olc5` decomposes ten child epics from it; those epics
must be **reassessed against that bounded scope**, not deleted: the underlying
magic-item obligations remain real, and 221 of 240 items carry at least one
engine-pending or design-blocked clause **[MAP: ar72 §4.8]**. Owner:
`eshyra-olc5`, under **§14 W14 — artifact dispositions and re-freeze policy**
for the narrowing itself and **§14 W13 — capability-contract normalization**
for the contract shape, with the taxonomy-collision warning in
`eshyra-o9bd.19.5` preserved: the CLOSED epic `eshyra-2n1t`'s F1–F10 and the
`fable:F1..F8` findings are unrelated namespaces.

### 5.6 The ADR 0019 census — **retain within scope as a generated field-level census**

**Disposition:** retain in scope. **[DESIGN]**

Generator `packages/core/scripts/inventory-semi-structured-boundary.ts`;
artifacts `docs/inventories/o9bd-18-8-8-semi-structured-boundary.{json,md}`;
currency enforced by `--check` and
`packages/core/test/semiStructuredBoundaryInventory.test.ts`. **[MAP: ar72 §4.9]**
It is the strongest-built artifact in the reassessment list and the only
field-level census of what the pack does and does not type.

Its **one-disposition-per-candidate convention is a per-field bookkeeping rule**
and must not be used as exclusive clause, procedure, discovery, or capability
ownership (ADR 0020 §4 and "Prior assumptions"). A record may simultaneously
carry a typed projection and an untyped residual for the same concept — the
verified `equipment:battleaxe` case (`data.properties = ["Versatile (1d10)"]`
beside `weaponProperties[]`) is the standing example **[MAP: ar72 §4.9, D-8]**.
The ADR-level follow-up review remains ADR 0019's own; this document only
records the bounded use discovery may make of the census: as an **input to
exploratory-band candidate generation and to projection-limit disclosure**,
never as an ownership claim.

### 5.7 Durable findings — **must precede bulk disposition**

**Disposition:** sequence. **[DESIGN]** The ~69-finding 2026-07-24 corpus exists
only in bead descriptions and an out-of-repository file; PR #476's
`finding-registry.json` was closed unmerged **[MAP: ar72 §6.1 D-7]**. ADR 0020
§7 requires an explicit disposition per finding, which is unsatisfiable while
the repository cannot enumerate them.

`eshyra-o9bd.19.1.15` ("Foundation 2: truthful audit-fact registry without
executable membership claims") owns this and is explicitly parallel-safe: it
preserves canonical finding identities, alias accounting, statuses, provenance,
owners, and baseline membership **while explicitly disclaiming** executable
exact membership and zero-repeat certification. **[VERIFIED from the bead]**

This design **references** known findings (§2.2, §5) and **creates no competing
finding store**. Any discovery-side finding evidence produced by the experiment
attaches to the registry when it exists; until then it lives in probe reports
only (§13).

### 5.8 The freeze manifest and thaw-note gate — **retain the policy, replace the bar**

**Disposition:** retain the artifact and its policy; the bar it gates is
replaced by §5.9. **[DESIGN]** `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json`
is `status: thawed-reaudit`, audited commit `0f5b3dc`, 13 pinned files
**[VERIFIED]**; enforcement is off in three independent ways
(`THAW_NOTE_CHECK_ENABLED = false`, a red hash check, and the deleted CI
workflow) **[MAP: ar72 §4.10, D-6]**. The *policy* it encodes — a change to
audited pack bytes is a reviewed event — is the only mechanism the repository
has for that, so it is not dropped. Owners `eshyra-2zyy` and `eshyra-o9bd.14`
are unchanged; what changes is the bar they wait on.

### 5.9 The re-freeze bar — **replace the global zero-engine-pending requirement**

**Disposition:** replace, with reasons. **[DESIGN]** The recorded bar ("AT
RE-FREEZE THERE MUST BE ZERO ENGINE-PENDING DETERMINISTIC CLAUSES",
`eshyra-olc5` notes, verbatim and unamended **[VERIFIED from the bead]**)
requires a global negative that the corpus cannot support: `RulesRecord.data` is
`unknown` (`packages/core/src/rules/types.ts:135`), kind validators accept
unregistered `data` fields, and key closure over `mechanics` exists for
`magic-item` only **[MAP: ar72 §7A]**. ADR 0020 "Prior assumptions" item 4
requires its reassessment.

**Replacement bar — re-freeze requires all nine, and none of them is a global
closure claim:**

1. **Source fidelity** — every retained record's content is traceable to the
   licensed source, with the known source-authority defects repaired or
   explicitly re-sourced.
2. **Truthful provenance** — `provenance.sourceRef` and `locator` correspond to
   real source material; a record whose locator cannot be substantiated is not
   frozen as authoritative.
3. **Deterministic reproducibility** — `npm run verify:dnd5e-srd-pack` exits 0
   against the pinned source (the live guard today, wired in CI).
4. **Truthful scope for every audit and readiness artifact** — every artifact in
   §5.1–§5.6 states its scope in-band and claims nothing outside it.
5. **Durable disposition of known findings** — every finding in the registry
   (**§14 W6**, `eshyra-o9bd.19.1.15`) carries an explicit disposition under
   ADR 0020 §7, including retirements that name their replacing responsibility.
6. **Correctness of positively selected capabilities** — each capability in
   force declares operation, inputs, exclusions, revision/identity, and residual
   interpretation, and each fails closed on unrecognized input.
7. **No known source invention** — no compiler-authored content carries source
   provenance or the source licence block.
8. **No unowned live runtime safety contract** — every runtime gate that can
   block a mutation has a live owner and a regression test.
9. **Explicit unresolved discovery and adjudication limits** — the re-freeze
   evidence states what discovery and adjudication do *not* guarantee, rather
   than implying they are complete.

**Explicitly not required:** global deterministic closure; universal discovery
completeness; zero engine-pending clauses; a corpus-wide negative claim of any
kind. Owner: `eshyra-o9bd.14` and `eshyra-2zyy`, with the amendment to
`eshyra-olc5`'s nine-point GREEN definition recorded under `eshyra-olc5` —
all three under **§14 W14 — artifact dispositions and re-freeze policy**.

### 5.10 Starting Wealth — **remove from SRD authority**

**Disposition:** remove. **[DESIGN, aligning with an existing decision]**

`table:starting-wealth-by-class` is produced from a hard-coded literal
(`packages/core/scripts/importers/dnd5e-srd-5.1/emit.ts:127`
`startingWealthTable()`, whose doc-comment claims "Source-backed p. 38",
appended at `:1628`), and the emitted record carries `source: "SRD 5.1 p. 38"`,
`provenance.locator: "p. 38"`, and the full CC-BY-4.0 SRD attribution block.
**[VERIFIED]** The string "Starting Wealth" does not occur anywhere in the
extracted 403-page SRD 5.1 text, and p. 38 is Ranger (Hunter) subclass features
**[MAP: ar72 §6.1 D-1]**. `srdAudit.ts:294` lists the key in
`SRD_5_1_STANDALONE_TABLES`, exempting it from the table-reachability owner
requirement **[VERIFIED]**. It is on a live gameplay path:
`character/rulesPackResolver.ts:1287` resolves it during character creation
**[VERIFIED]**.

The owning bead `eshyra-o9bd.19.2.1` has already **decided** this and its
decision governs: remove the table from the SRD pack; disable the
starting-wealth character-creation path when only the SRD pack is active
(reconciling `srdStartingWealth.ts` and `finalizeCharacter.ts` in the same
change); keep the genuinely-SRD starting-equipment choices; permit starting
wealth only from a separately identified, appropriately licensed supplement.
**[VERIFIED from the bead]**

One clarification this design adds, because the task framing could be read more
permissively: any retained starting-wealth mechanic must be **separate
supplemental content with truthful source identity, truthful provenance, correct
licence identity, explicit campaign or product ownership, and no implication
that the SRD contains it** — and `eshyra-o9bd.19.2.1` additionally **rejects
re-homing the existing table by relabeling it**, because the defect is its
source and redistribution rights, not its label. An original Eshyra table may
eventually be supplied through `eshyra-jhpt`, but it must not reproduce the
unsupported PHB table under a new name. Both constraints hold simultaneously;
the bead's narrower rejection is the operative one. This is blocker **B4**
(§9.4) and probe **P12** (§10.12).

---

## 6. Pilot source identity and route model

### 6.1 Diagnostic-fixture identity

**[DESIGN]** For the first experiment, expected authoritative material is
identified by:

1. the canonical **`RulesRecord.key`** (e.g. `rule:cover`,
   `creature:adult-black-dragon`) — the stable identity the pack already
   guarantees and the stack already indexes (`rules/stack.ts:46`
   `resolveRulesStack` builds `recordsByKey`) **[VERIFIED]**;
2. **`provenance.sourceRef`** — the pack's source identity, already checked by
   `assertProvenanceMatchesPackSource`;
3. **`provenance.locator`** — the page-level source pointer (e.g. `p. 96` for
   `rule:cover`) **[VERIFIED]**;
4. where a fixture must name something narrower than a record, a **test-local
   selector**, restricted to four forms:
   - a **JSON pointer** into the record
     (e.g. `/data/mechanics/saves/0/damageOnSuccess` on `spell:fireball`, or
     `/data/actions/5` for the Acid Breath entry on `creature:adult-black-dragon`
     **[VERIFIED: index 5 of `data.actions`]**);
   - an **existing ambiguity ID** (e.g.
     `ambiguity:cube-of-force-same-face-duration-reset` **[VERIFIED]**);
   - an **existing stable operation ID** (e.g. `press-face-1` on
     `magic-item:cube-of-force`; `hit-target` on
     `magic-item:ammunition-1-2-or-3` **[VERIFIED]**), or an existing clause ID
     already emitted by the compiler (e.g.
     `magic-item:ammunition-1-2-or-3/c1-use`, `fireball:higher-slot`
     **[VERIFIED]**);
   - a **narrowly described source-text predicate**, stated in the fixture as
     prose plus the exact expected substring (e.g. "the success branch
     *or half as much damage on a successful one* must survive into the packet").

**These selectors are diagnostic-fixture identities.** They exist so a test can
say what it expects and can fail precisely. They make **no claim** that the
corpus has been universally decomposed into canonical clauses, that these
identities are stable across pack regeneration beyond their existing guarantees,
or that a selector's absence means the material is absent. A universal
obligation identity was **not** proven by the invalidated PRs
(`eshyra-o9bd.19.7` question 2), and `eshyra-o9bd.19.1.14` owns that question;
this design must not pre-empt it. Where a JSON pointer would need to be invented
because the pack has no structure at that point — `rule:cover` and
`rule:opportunity-attacks` carry only `data.text` **[VERIFIED]** — the fixture
uses the source-text predicate form instead.

### 6.2 Discovery route classes

**[DESIGN]** Nine initial route classes. They are **diagnostic labels for why a
candidate was proposed**, not a closed or universal relationship vocabulary, and
probe evidence may add, split, or retire any of them.

| Route class | Trigger | Existing substrate it can use | Recorded evidence |
|---|---|---|---|
| `direct-state-ref` | a ref already present in campaign state reaches a pack record (`packRef`, `rulesRef`, spell refs, condition rows) | `AssembledContext` already carries these refs but never dereferences them (`jued` §4) | the state field that carried the ref |
| `direct-adventure-ref` | an active adventure run's selected scene/location names a module entity carrying a `rulesRef` | `adventureContext.ts:buildAdventureContextSlice`; module refs validated to `creature`/`stat-block` (`adventure/references.ts:134-141`) **[VERIFIED]** | module id, entity id, ref |
| `explicit-name-or-alias` | player or model text contains an exact record name or an indexed alias | `stack.ts:recordLookupNames` per-kind name index; `lookup.ts` exact/ambiguous contract | the matched name form (the alias route is **not** returned today — `jued` §4) |
| `typed-relationship` | traversal of a **typed** link that already exists in the pack | `mechanics.conditions` relation entries (closed vocabulary in `rules/conditionRelations.ts`: `applies`, `removes`, `prevents`, `suppresses`, `immune`, `advantage`, `disadvantage`, `exclusion`, `gates`, `mention`); `tableRefs`, `progressionTableRef`, `spellTableRefs`, `statBlockRefs`, `parentClass`, feature `source` | source record key, link field, relation value, target key |
| `situation-cue` | a derived situation signal (geometry, movement intent, resource state, condition state) matches a fixture-declared cue | none today; this is the class ADR 0020 §5 exists to create | the cue, its derivation input, and the candidate it proposed |
| `auditor-missing-target` | the turn auditor named a specific record that should have been looked up | `turnAuditor.ts` verdicts carry target-specific missing calls (`jued` §4) | verdict id, named target, attempt number |
| `campaign-rule` | an active campaign rule from `eshyra-jhpt` applies to the situation | none today; §8 interface | rule identity, scope, effective position |
| `campaign-ruling` | an active ruling resolves a discovered `RulesAmbiguity` id | none today; §8 interface | ruling identity, ambiguity id, interpretation id |
| `capability-preflight` | a bounded capability's preflight requires a record to decide availability | `assertMagicItemOperationReady` inputs (`itemState.ts:1888-1911`) **[VERIFIED]** | capability id, operation id, required record |

Three properties are load-bearing:

- **One candidate may carry several routes.** A record reached by
  `direct-state-ref` and `typed-relationship` and `situation-cue` is one
  candidate with three routes.
- **Deduplication is by canonical record key**, and the merge **preserves every
  route and every traversal reason**. Losing a route is a measured failure
  (§13 M3), not an implementation detail. This is the direct application of
  ADR 0020 §4 ("several discovery paths may surface the same clause").
- **`campaign-rule` and `campaign-ruling` candidates come from the
  `eshyra-jhpt` runtime**, never from a discovery-owned store (§8.4).

### 6.3 Candidate priority bands

**[DESIGN]** Three experimental bands. They rank *retention*, not truth.

**Must-consider**

- exact state references (`direct-state-ref`);
- exact adventure-module references (`direct-adventure-ref`);
- explicit exact record mentions (`explicit-name-or-alias`);
- applicable active campaign rules (`campaign-rule`, from `jhpt`);
- applicable active ambiguity rulings (`campaign-ruling`, from `jhpt`);
- records required by a selected capability preflight
  (`capability-preflight`).

**Related**

- one-hop, **explicitly typed** relationships from must-consider material
  (`typed-relationship`). One hop only, in the pilot, and only over links the
  pack already types.

**Exploratory**

- `situation-cue` candidates;
- lexical or semantic candidates;
- `auditor-missing-target` candidates not already selected by another route.

**Overflow rule.** A must-consider candidate may **never** be silently removed
by a packet limit. If the packet budget cannot hold the must-consider set, the
harness emits an explicit overflow record naming every dropped candidate and its
routes, and **the diagnostic probe fails**. A probe that "passes" with a
truncated must-consider set would be exactly the failure idiom ADR 0020 §3
forbids. Related and exploratory candidates may be dropped, but each drop is
recorded with its reason (§13 M6, M7).

**Not decided here:** no production ranker, embedding model, vector database, or
graph database is selected, and none may be introduced by the pilot. Ranking
inside a band is deterministic and simple (route-count then canonical key order)
so that a ranking failure is legible rather than opaque.

### 6.4 What the route model does not claim

It does not claim to enumerate the ways a rule can matter; it does not partition
the corpus; it does not assert that a record with no route is irrelevant; and a
route's absence in a probe result is evidence about the pilot, not about the
rules.

---

## 7. Context-packet design

### 7.1 Required packet content

**[DESIGN]** For each retained candidate, the experimental context packet
carries:

| Field | Content | Source |
|---|---|---|
| canonical record identity | `key`, `kind`, `name` | pack record |
| source provenance | `provenance.sourceRef`, `provenance.locator`, `source` label, licence identity | pack record |
| source prose needed for adjudication | the exact prose fields the fixture requires (`description`, `text`, the specific `actions[i].text`, `higherLevels`, …) | pack record |
| every retrieval reason | the full route list plus the trigger detail for each | discovery stages |
| traversed relationships | source record, link field, relation value, target — for each traversal that produced this candidate | typed-expansion stage |
| known source ambiguity | any `RulesAmbiguity` on the record: `id`, `question`, `interpretations[].id`, `canonicalResolution` (always `null` in the pack, by type: `rules/types.ts:97-108`) **[VERIFIED]** | pack record |
| applicable campaign rule or ruling | active rule/ruling prose, identity, scope, provenance, supersession status | **`eshyra-jhpt`** (§8) |
| deterministic capability availability | the positively selected capability, if any, for the operation in play | capability preflight |
| capability inputs | what the capability requires to run | capability contract |
| capability exclusions | what the capability explicitly does **not** do | capability contract |
| capability revision | the contract's identity/revision (e.g. `derived-magic-item-clauses-v1`) | capability contract |
| residual DM interpretation | what remains a ruling after the capability runs | capability contract |
| projection-limit notes | explicit notes wherever a structured projection is partial | projection-limit stage |

### 7.2 Rules for partial projections

**A typed mechanics projection must not be presented as complete merely because
it exists.** When source prose and a partial projection coexist, the packet:

- **preserves the source prose** verbatim;
- **discloses what the projection omits**, in-band, beside the projection;
- **does not convert projection presence into deterministic readiness** — a
  capability appears in the packet only when a capability contract positively
  selected it;
- **does not suppress** the record's source ambiguity or an applicable campaign
  ruling.

Two verified worked examples define the required behavior:

- **`creature:adult-black-dragon` → `data.actions[5]` "Acid Breath (Recharge
  5–6)".** Prose: "…taking 54 (12d8) acid damage on a failed save, **or half as
  much damage on a successful one**." Projection:
  `{ recharge: {roll: 'd6', minimum: 5, maximum: 6},
  saves: [{ability: 'dexterity', dc: 18}], damage: [{average: 54, dice: '12d8',
  type: 'acid'}] }` — **no `damageOnSuccess`, no success branch, no area
  typing** for the 60-foot line. **[VERIFIED]** The packet must carry the prose
  and a note that the projection omits the success branch and the area. It must
  not present `damage: 12d8` as the adjudicated outcome.
- **`spell:fireball`.** Projection has `saves[0].damageOnSuccess: 'half'`,
  `damage: [{dice: '8d6', type: 'fire'}]`, `scaling.perSlot` and a typed
  `upcast` clause `fireball:higher-slot`, and **no `mechanics.area`** despite
  "a 20-foot-radius sphere" in the description. **[VERIFIED]** The packet must
  carry the area from prose and note that no typed area exists.

### 7.3 What the packet may never do

- present a route-free record as authoritative because it was retrieved;
- present a projection as a capability;
- present "no capability bound" as "no mechanics" or "safe to ignore";
- drop a must-consider candidate silently (§6.3);
- launder a record whose provenance is known-false into DM context as authority
  (probe P12, §10.12);
- claim that its contents were *used* by the model. Presence is measured;
  reliance is not inferable (§13 M-note).

---

## 8. `eshyra-jhpt` campaign-rule integration

### 8.1 Authority

`eshyra-jhpt` — "Campaign rules: durable rulings, house rules, and
disputed-turn replay" — is the **authoritative owner** of active campaign rules
and ambiguity rulings. Its architecture statement already draws the boundary
this design needs: immutable rules packs contain canonical semantics plus source
ambiguity metadata; canonical campaign history contains prose rulings and house
rules; deterministic code owns identity, campaign association, kind, status,
provenance, effective position, ordering, supersession/revocation, context
delivery, and rollback/replay timing. **[VERIFIED from the bead]** All nine
children are OPEN.

### 8.2 The interface discovery requires

**[DESIGN]** Discovery requires a **narrow read interface** and nothing more.
Seven requirements, each mapped to existing `jhpt` ownership:

| # | Requirement | Existing owner | Status |
|---|---|---|---|
| **R1** | Retrieve **active campaign rules applicable to the current situation** at the adjudicated campaign position | `eshyra-jhpt.3` ("supply all active campaign-rule prose on every applicable DM turn … Context assembly must use the same active-at-position query that the auditor will use"), backed by `.2`'s active-rules-at-position query | covered |
| **R2** | Retrieve **active rulings for discovered `RulesAmbiguity` IDs** | `eshyra-jhpt.6` ("look up ambiguity metadata from the active rules stack by stable ID, check campaign storage for an active linked ruling") | covered |
| **R3** | Preserve **ruling identity, campaign scope, provenance, and supersession status** | `eshyra-jhpt.1` (identity, status, origin/provenance, effective position, ordering, supersession/revocation) and `.2` (durable storage of the same) | covered |
| **R4** | Place the active rule or ruling **beside its governing source material** in the context packet | `eshyra-jhpt.3` supplies the set and the ambiguity metadata; **the pairing of a rule with the specific pack record it governs is not stated** | **amendment A1** |
| **R5** | Expose the active ruling to **bounded capability preflight** when execution depends on it | not stated in any `jhpt` child; `.6` stops at DM/auditor context | **amendment A2** |
| **R6** | Preserve **retrieval and application evidence in the turn trace** | `eshyra-jhpt.4` requires auditor parity and rule-identity citation in diagnostics; `.9` proves parity end to end; **durable turn-trace evidence of which rule was retrieved and why is not stated** | **amendment A3** |
| **R7** | Behave correctly in the **absence** case — a discovered ambiguity with no active ruling must preserve uncertainty | `eshyra-jhpt.3` ("must preserve uncertainty and prohibit silent canonical certainty") and `.6` ("surface the published uncertainty instead of inventing certainty"); `.9` scenario 3 proves the unresolved case | covered |

### 8.3 Recommended amendments under `eshyra-jhpt`

**[DESIGN]** These are recommendations to the existing owner, not new
responsibilities elsewhere. None creates a bead in this PR.

- **A1 — `eshyra-jhpt.3` acceptance criterion.** Add: the active-rule projection
  must expose, per rule, the linked ambiguity ID and/or the governing pack
  record key where one exists, so a consumer can place the rule beside its
  source material without re-deriving the association. `.1` already requires a
  ruling to record "the ambiguity ID and selected interpretation ID as
  provenance"; A1 extends the projection, not the domain model.
- **A2 — new child under `eshyra-jhpt`, or an acceptance criterion on
  `eshyra-jhpt.6`.** Define how an active ruling is exposed to a bounded
  capability preflight. The concrete case is verified and blocked today:
  `magic-item:cube-of-force` operation `press-face-1` from state `face-1` hits
  transition `resetsDuration: { kind: 'source-ambiguity', ambiguityId:
  'ambiguity:cube-of-force-same-face-duration-reset' }`, and
  `itemState.ts:matchStateTransition` (`:1318`) throws `ItemStateAmbiguityError`
  (`:153`) with the ambiguity and interpretation IDs. **[VERIFIED]** A ruling
  that selects `same-face-resets` or `different-face-only-resets` is exactly
  what would unblock it — but no path exists from a campaign ruling to that
  code. Note the verified ordering constraint: today
  `assertMagicItemOperationReady` runs at `itemState.ts:1888`, **before** the
  first `matchStateTransition` call (`:1934`), and every `press-face-*`
  operation clause on that record is `engine-pending`, so the readiness gate
  throws first and the ambiguity error is currently unreachable through
  `use_item`. **[VERIFIED]** A2 must therefore be designed with `eshyra-olc5`'s
  readiness owner, not against it.
- **A3 — `eshyra-jhpt.4` or `.9` acceptance criterion.** Require durable
  evidence, in the accepted-turn trace, of which active rules and rulings were
  supplied for the turn and under which identities — so §13 M5 can be measured
  without a discovery-owned store.
- **A4 — dependency wiring.** The discovery campaign-rule integration work
  (**§14 W11 — `eshyra-jhpt` campaign-rule integration**, consumed by
  **§14 W10 — context-packet intervention**) **depends on** `eshyra-jhpt.3`
  (and, for the ruling path, `.6`). It must not proceed by building a
  substitute.

### 8.4 Prohibitions

Discovery must not design, and this document does not design: a campaign-rule
schema; a ruling schema; a persistence table; a recording tool; a supersession
lifecycle; an active-ruling resolver; or a house-rule subsystem. Campaign
**overlay lore** (ADR 0014, `world/campaignOverlayLore.ts`) is **not** a
substitute: it models world canon with truth/significance/visibility, not a
selected rules interpretation tied to an ambiguity (`jued` §7).

### 8.5 The intended boundary

```text
source ambiguity or governing source material      (rules pack, immutable)
   → jhpt campaign rule / ruling resolution        (campaign history)
   → discovery context packet                      (this design)
   → DM adjudication or capability preflight       (model / bounded capability)
   → deterministic state effect                    (state kernel, unchanged)
   → turn evidence                                 (existing accepted-turn trace)
```

Each arrow crosses an ownership boundary named in §4. No arrow may be
short-circuited: in particular, discovery may not resolve an ambiguity, and a
capability may not consult a ruling that did not come through `jhpt`.

---

## 9. Pre-experiment blockers

**[DESIGN]** The runtime experiment cannot establish a valid baseline until
these five are repaired. Each is verified, has a required next state, and needs
permanent regression evidence. None is optional, minor, or deferrable: under the
standing constraint, a defect worth fixing blocks the claim it affects.

### 9.1 B1 — `stat-block` is not accepted by `lookup_rules`

`toolLookupRules.ts` `inputSchema.properties.kind.enum` lists sixteen kinds and
omits `stat-block` (`:76-93`), so `ToolRegistry.invoke` rejects the call before
the tool body runs; the pack contains `stat-block:avatar-of-death` and
`stat-block:giant-fly`, and `adventure/references.ts:134-141` accepts encounter
refs to `creature` **or** `stat-block`. **[VERIFIED]** `jued` reproduced the
`invalid_args` error through a real registry invocation.
**Required next state:** `stat-block` is accepted, with a test that invokes the
registry (not the tool body) for a `stat-block` ref and a test that pins the
enum against `RulesRecordKind`. **Owner:** `eshyra-l3e5`, filed by this work
(**§14 W1 — `stat-block` lookup repair**); coordinate with
`eshyra-o9bd.19.2.4` (discoverability).

### 9.2 B2 — normal CLI play never passes the adventure-module resolver

`packages/cli/src/playTypes.ts:35` `PlayDeps` declares no `resolveAdventureModule`;
`playTurnLoop.ts:96-107` builds `RunTurnDeps` without one;
`contextAssembler.ts` returns an empty adventure slice without it; and
`encounterCombatants.ts:638-642` throws
`start_encounter requires an active adventure module resolver`. The resolver
exists (`packages/cli/src/adventures.ts:56` `makeModuleResolver`, wired at `:101`) but its real
consumer is the read-only `adventures show` path. **[VERIFIED]**
**Required next state:** normal CLI play supplies the resolver; a test exercises
the real `runTurn` handoff (existing CLI tests use a fake `runTurn` and
therefore cannot see this). **Owner:** `eshyra-seoh`, filed by this work
(**§14 W2 — CLI adventure-resolver repair**).

### 9.3 B3 — deterministic pack consumers do not use the strict campaign stack

`campaignRecordLookup.ts:85-98` `lookupCampaignRecord` selects a bundled base by
`packId` alone, ignores system/version and every add-on, and falls back to
`getBundledDnd5eSrdPack()`; `encounterCombatants.ts:527-533` `campaignBasePack`
repeats it. Strict model-facing lookup uses `resolveStrictCampaignRulesStack`
(`:69-76`), which resolves exact system/pack/version **and** ordered add-ons.
Live legacy callers: `actionEconomy.ts:297,374,445`,
`activeEffects.ts:1824,2560,2583,4031`, `attunement.ts:538`,
`usageCounters.ts:785`. **[VERIFIED]**
**Required next state:** deterministic consumers resolve through the same exact
stack as strict lookup, with no silent bundled-D&D fallback; regression evidence
is probe P11's synthetic add-on stack (§10.11). **Owner:** `eshyra-6vpw`,
filed by this work (**§14 W3 — strict campaign-stack repair**).

### 9.4 B4 — Starting Wealth source invention

See §5.10. **Required next state:** the record is removed from SRD authority and
the dependent character-creation path is reconciled in the same change, per the
decision already recorded in `eshyra-o9bd.19.2.1`; probe P12 becomes a
permanent regression guard. **Owner:** `eshyra-o9bd.19.2.1` (existing;
**§14 W4 — source-authority repair**).

### 9.5 B5 — magic-item readiness unrecognized-scope fail-open

`itemExecutionReadiness.ts:19-31` `inSelectedScope` returns `false` for any
scope whose `kind` is neither `'parent'` nor a matching `'variant'`, and
`:76-77` skips such a clause entirely, so it cannot block. **[VERIFIED]**
**Required next state:** an unrecognized scope kind fails closed, with a test
that feeds a malformed scope and asserts the throw. Until then the contract
cannot serve as pilot evidence for probe P8. **Owner:** `eshyra-uiax`, filed
by this work (**§14 W5 — item-readiness fail-open repair**); coordinate with
`eshyra-olc5`.

### 9.6 Sequencing statements

- **The durable finding registry may proceed in parallel.**
  `eshyra-o9bd.19.1.15` is parallel-safe by construction (it makes no executable
  membership claim) and is the only path to an enumerable defect corpus that
  ADR 0020 §7 dispositions require.
- **An offline discovery harness may begin before every runtime blocker lands.**
  Phase 1 (§12.1) consumes fixtures and the real stack resolver; it does not
  depend on B1, B2, or B5. It does depend on B3 only where a probe uses an
  add-on stack (P11).
- **Runtime shadow-mode comparison is not a valid baseline until the applicable
  blockers are fixed.** Specifically: no `stat-block` probe evidence before B1;
  no adventure-context probe evidence (P9) before B2; no deterministic-agreement
  measurement (§13 M11) before B3; no capability-agreement evidence (P8) before
  B5; and no probe may treat `table:starting-wealth-by-class` as SRD authority at
  any time (B4).
- **Campaign-rule integration work depends on or coordinates with
  `eshyra-jhpt`**, and never replaces it (§8.4).

---

## 10. Diagnostic corpus

Twelve probes: ten gameplay discovery probes and two baseline integrity probes.
Each names verified identities. **Each probe is bounded evidence for its named
scenario and is never a completeness unit** (ADR 0020 §4). No probe's success
proves correct adjudication, deterministic capability, or state integrity; no
probe's failure proves the rule is absent from the corpus.

Where the task framing named a record key that does not exist at `f4b3461`, the
verified key is used and the correction is stated in-band.

### 10.1 P1 — Implicit cover

- **Expected primary target:** `rule:cover` (kind `rule`, locator `p. 96`).
  **[VERIFIED]**
- **Player text must not use the word "cover."** Example shape: the PC ducks
  behind a low wall and fires across the courtyard at the sentry.
- **Tests:** `situation-cue` discovery — whether geometry and combat context can
  trigger a potentially governing rule without the rule being named.
- **Substrate reality:** `rule:cover.data` is `{ text: … }` only — no typed
  structure at all. **[VERIFIED]** So no typed route can reach it; only a
  situation cue or a lexical/semantic exploratory candidate can. This is the
  honest hard case, and it is the reason P1 is first.
- **Adjudication-context expectation, from the existing registry:**
  `ENGINE_PROCEDURE_COVERAGE['rule:cover']` is `model-adjudicated-supported`
  with `primitives: ['lookup_rules', 'resolve_check']` and a `contextRequirement`
  naming degree-of-cover selection and the ±2/±5 AC and Dex-save bonuses riding
  `resolve_check` declared modifiers. **[VERIFIED]** The packet must therefore
  present `rule:cover` prose plus "no deterministic capability selects the
  degree of cover; the AC/save bonus rides declared modifiers on
  `resolve_check`."
- **Must-not-include:** a claim that a cover bonus was applied deterministically.

### 10.2 P2 — Opportunity attack trigger

- **Expected primary target:** `rule:opportunity-attacks` (locator `p. 95`).
  **[VERIFIED]**
- **Tests:** trigger timing; exceptions and procedural context; retrieval from
  **movement intent** rather than a rule-name mention.
- **Substrate reality:** `data` is `{ text: … }` only. **[VERIFIED]** The prose
  carries the trigger ("moves out of your reach"), the reaction cost, and three
  exceptions (Disengage, teleport, involuntary movement) — the exceptions are
  the part a discovery failure loses.
- **Adjudication-context expectation:**
  `ENGINE_PROCEDURE_COVERAGE['rule:opportunity-attacks']` is
  `model-adjudicated-supported` with
  `primitives: ['lookup_rules', 'roll', 'spend_turn_resource']` and
  `contextRequirement` "trigger/exclusion ruling; the reaction spend is
  code-owned (F2 turn budget)". **[VERIFIED]**
- **Required retained facts:** the trigger clause **and** all three exception
  clauses. A packet that carries the trigger but drops the exceptions is a
  recorded failure, not a pass.

### 10.3 P3 — Adult Black Dragon Acid Breath

- **Expected primary target:** `creature:adult-black-dragon` (locator `p. 281`),
  selector `/data/actions/5` ("Acid Breath (Recharge 5–6)"). **[VERIFIED]**
- **Tests:** direct entity discovery; preservation of the half-damage-on-success
  source clause.
- **Required retained fact:** the prose substring
  *"or half as much damage on a successful one"* must reach the packet, and the
  packet must state that the typed projection omits it — the entry's `mechanics`
  carries `saves: [{ability: 'dexterity', dc: 18}]` and
  `damage: [{average: 54, dice: '12d8', type: 'acid'}]` with **no**
  `damageOnSuccess` and no success branch. **[VERIFIED]**
- **Must-not-include:** any presentation in which the typed projection
  suppresses or overwrites the faithful prose, or in which `12d8` reads as the
  unconditional outcome.
- **Expected capability status:** none selected; damage arithmetic rides
  `resolve_damage`, and the save/branch decision remains DM adjudication.

### 10.4 P4 — Fireball

- **Expected primary target:** `spell:fireball` (locator `p. 144`).
  **[VERIFIED]**
- **Tests:** explicit entity discovery; retention of area, save, damage,
  successful-save result, scaling, and relevant capability limits.
- **Verified projection state:** `mechanics.saves[0] = {ability: 'dexterity',
  damageOnSuccess: 'half'}`; `mechanics.damage = [{dice: '8d6', type: 'fire'}]`;
  `mechanics.scaling.perSlot = {stat: 'damage', increase: '1d6', baseSlotLevel:
  3}`; a typed `upcast` block with `clauseId: 'fireball:higher-slot'` and
  `disposition: 'complete-typed-upcast'`; and **no `mechanics.area`** despite
  "a 20-foot-radius sphere" in the description. **[VERIFIED]**
- **Required retained facts:** the 20-foot-radius sphere (from prose, with an
  explicit note that no typed area exists), the Dexterity save, 8d6 fire, "half
  as much damage on a successful one", and the per-slot scaling.
- **Expected capability status:** the upcast path is consumed by
  `orchestrator/spellUpcast.ts` (S1 upcast disposition, `:391-402`) and
  `toolSpendSpellSlot.ts` **[VERIFIED]**; no capability owns area geometry or
  target selection. Both must be stated, with exclusions.

### 10.5 P5 — Incapacitation and concentration

- **Expected targets include:** `condition:incapacitated` (locator `p. 358`) and
  `rule:concentration` (locator `p. 102`). **[VERIFIED]**
- **Tests:** state-derived signals (`direct-state-ref` from a condition row and
  an active concentration effect); typed relationship expansion; one situation
  reaching multiple governing records.
- **Verified substrate:** `condition:incapacitated.data.mechanics.effects`
  carries typed `cannotTakeActions` / `cannotTakeReactions`.
  `rule:concentration.data` is `{ text: … }` only, and its prose is where the
  incapacitation link lives ("Being incapacitated or killed. You lose
  concentration on a spell if you are incapacitated or if you die").
  **There is no typed edge from `condition:incapacitated` to
  `rule:concentration` in the pack.** **[VERIFIED]** The pack does carry 559
  typed `mechanics.conditions` relation entries overall, of which 56 name
  `incapacitated` (12 `applies`, 20 `advantage`, 6 `exclusion`, 4 `gates`,
  14 `mention`) **[VERIFIED]** — a real typed-relationship substrate that
  reaches the condition from other records but not the governing rule.
- **Why this probe matters:** it is the clean test of whether a typed route and
  a cue route must combine to reach a governing record, and it measures which
  stage loses `rule:concentration` when it is lost.
- **Expected capability status:** `rule:concentration` is `implemented` in
  `ENGINE_PROCEDURE_COVERAGE` with runtime owners `state/activeEffects.ts`,
  `state/hpLifecycle.ts`, `toolResolveConcentration.ts`, `toolStartEffect.ts`,
  `toolEndEffect.ts` and evidence `activeEffects.test.ts` **[VERIFIED]** — so
  the packet must present a real bounded capability *and* its exclusions
  (`DIRECT_CONCENTRATION_BREAK_CAUSES` is the closed set `['voluntary',
  'forced']` **[VERIFIED]**).

### 10.6 P6 — Action Surge

- **Expected primary target:** `feature:fighter:action-surge` (locator `p. 25`).
  **Correction:** the task framing named `feature:action-surge`; the pack's
  canonical key is `feature:fighter:action-surge`, and feature keys are
  class-qualified throughout. **[VERIFIED]**
- **Tests:** character-state references (`direct-state-ref` from the sheet's
  granted features); feature relationships (`data.source = 'class:fighter'`,
  `data.level = 2`); the boundary between model adjudication and deterministic
  action economy.
- **Verified projection state:** `mechanics.resources = [{reset:
  'short-or-long-rest'}]` — no resource name, no maximum, and no representation
  of the 17th-level "twice before a rest, but only once on the same turn"
  clause. **[VERIFIED]** The packet must disclose both omissions beside the
  prose.
- **Expected capability status:** the extra action interacts with the F2 action
  economy (`state/actionEconomy.ts`, `toolBeginTurn.ts`,
  `toolSpendTurnResource.ts`); the *uses-per-rest* accounting has no owner on
  this record because the projection has no named resource. The packet must not
  imply otherwise.

### 10.7 P7 — Cube of Force

- **Expected primary target:** `magic-item:cube-of-force` (locator `p. 215`).
  **[VERIFIED]**
- **Tests:** source-ambiguity discovery; retrieval of any applicable active
  ruling from `eshyra-jhpt`; the **absence** case when no ruling exists;
  capability preflight behavior while execution remains blocked.
- **Verified ambiguity:** `ambiguity:cube-of-force-same-face-duration-reset`,
  question "whether pressing the already-active face restates the barrier's
  one-minute duration", two interpretations `same-face-resets` and
  `different-face-only-resets`, `canonicalResolution: null`,
  `runtimeDisposition: {status: 'engine-pending', owner: 'campaign-ruling'}`.
  Sources: `p. 215, barrier duration` (clause `barrier-duration`) and
  `p. 215, different-face reset` (clause `different-face-reset`). **[VERIFIED]**
- **Verified runtime state:** the state-machine transition
  `{from: 'face-1', to: 'face-1', via: 'press-face-1', resetsDuration: {kind:
  'source-ambiguity', ambiguityId: 'ambiguity:cube-of-force-same-face-duration-reset'}}`
  exists; `itemState.ts:matchStateTransition` would throw
  `ItemStateAmbiguityError`; but every `press-face-*` operation clause on the
  record is `engine-pending`, and `assertMagicItemOperationReady` runs first
  (`itemState.ts:1888` vs `:1934`), so `use_item` is blocked by readiness before
  the ambiguity is reached. **[VERIFIED]**
- **Expected outcomes:** with **no** active ruling, the packet carries the
  ambiguity, both interpretations, and an explicit "unresolved — owner
  `campaign-ruling`" state, and the capability preflight reports **blocked**
  with its exact blocker clause ids. With an active ruling supplied by `jhpt`,
  the packet carries the ruling beside the ambiguity with identity, scope, and
  provenance — and the capability preflight **still** reports blocked, because
  the readiness clauses are engine-pending independently of the ruling. That
  distinction is the point of the probe.
- **Must-not-include:** any ruling persistence model defined inside the
  discovery experiment (§8.4).

### 10.8 P8 — Positive magic-item capability

**Target selected by generated query, not by hand.** The query enumerated every
`magic-item` record's operations (including state-machine `via` operations),
reconstructed the exact readiness input that `itemState.ts:1888-1911` builds,
and called `assertMagicItemOperationReady` for parent scope. Six
(record, operation) pairs pass at `f4b3461`:
`magic-item:ammunition-1-2-or-3/hit-target`,
`magic-item:boots-of-levitation/cast-levitate`,
`magic-item:candle-of-invocation/burn`,
`magic-item:ioun-stone/grab-orbiting-stone`,
`magic-item:ring-of-shooting-stars/discharge-ball-lightning`,
`magic-item:rope-of-entanglement/escape-rope`. **[VERIFIED]**

**Selected:** `magic-item:ammunition-1-2-or-3`, operation `hit-target` — the
only one of the six whose passing status rests on a **positively owned economy
clause** rather than on the absence of relevant blockers, and the only one that
produces an unambiguous deterministic state effect.

| Field | Exact value | Evidence |
|---|---|---|
| record key | `magic-item:ammunition-1-2-or-3` (locator `p. 207`) | **[VERIFIED]** |
| operation ID | `hit-target` | **[VERIFIED]** |
| readiness identity | `executionReadiness.source = 'derived-magic-item-clauses-v1'`; owning clause `magic-item:ammunition-1-2-or-3/c1-use`, scope `parent`, tag `C1`, representation `{block: 'economies', economyId: 'use'}`, readiness `green`, **no engine hooks** | **[VERIFIED]** |
| required inputs | `use_item { instanceId, operationId: 'hit-target', character? }`; the operation's declared cost `[{economy: 'use', amount: 1}]`; economy `use` is `{kind: 'single-use', onDepleted: {loseProperty: true, becomes: 'nonmagical'}}` | **[VERIFIED]** |
| exclusions | the item's other clause, `…/c2-static-ammunition-rarity-attack-damage` (`{block: 'effects'}`), is **`engine-pending` on `F8: derived combat modifier application`** — the +1/+2/+3 attack and damage bonus is **not** executed. `data.rarity` is the free-text string `"uncommon (+1), rare (+2), or very rare (+3)"`, so which bonus applies is not resolvable from the record either. | **[VERIFIED]** |
| expected effect | stateless single-use spend: the consumed unit splits out of the stack and becomes nonmagical inventory (`itemState.ts:2012-2016`; `splitNonmagicalSingleUseInventory`, defined `:1710`, called `:2127`) | **[VERIFIED]** |

**Tests:** capability availability; declared limits; a successful deterministic
state effect; agreement between discovery preflight and runtime enforcement.

**Why this target is the right pilot evidence:** it exhibits ADR 0020 §3's first
asymmetry on a single record — one clause is a positively executable capability
while another clause of the same record has no engine owner. A packet that
presented this item as "ready" would be exactly the false-completeness failure
the ADR forbids. Two cautions recorded from the same query: **four** of the six
passing operations (`boots-of-levitation/cast-levitate`,
`ioun-stone/grab-orbiting-stone`,
`ring-of-shooting-stars/discharge-ball-lightning`,
`rope-of-entanglement/escape-rope`) declare **no** cost and **no** effects, so
they pass because nothing relevant blocks them — absence of blockers is not
positive capability evidence; and `magic-item:candle-of-invocation/c1-burn-time` is
`green` while still declaring an `F5: duration-budget accounting` hook
**[VERIFIED]**, so "green" does not mean "hook-free". P8 must not be re-pointed
at any of those without re-running the query and restating the evidence.

**Blocked on B5** (§9.5): until the unrecognized-scope fail-open is corrected,
"passes the contract" cannot be trusted as capability evidence.

### 10.9 P9 — Authored adventure encounter

- **Module:** `eshyra:hollow-beneath-emberfall`, "The Hollow Beneath Emberfall"
  (`packages/core/data/adventure-modules/eshyra_hollow-beneath-emberfall/adventure-module.json`).
  **[VERIFIED]**
- **Encounter:** `enc-mouth-ambush` ("Ambush at the Mouth"), location
  `loc-watchtower-mouth`, creatures `[{rulesRef: 'creature:goblin', count: 2,
  role: 'sentry'}]`. **[VERIFIED]**
- **Pack target:** `creature:goblin` (locator `p. 315`), with
  `armorClass.value = 15` and `hitPoints.value = 7` — the exact two fields
  `state/encounterCombatants.ts` reads for encounter seeding. **[VERIFIED]**
- **Tests:** adventure context; direct module references
  (`direct-adventure-ref`); relationship expansion; consistency between the
  discovered record and deterministic encounter creation.
- **Stat-block addressability — stated precisely.** The module contains **no**
  stat-block reference; its only `rulesRef` values across the whole file are
  `creature:goblin` and `magic-item:potion-of-healing` **[VERIFIED]**. So
  stat-block addressability is exercised **not** through this module but through
  (a) `adventure/references.ts:134-141`, which permits encounter creature refs
  to resolve to `creature` **or** `stat-block`, and (b) a direct `lookup_rules`
  probe for `stat-block:avatar-of-death` or `stat-block:giant-fly`, which fails
  today and is blocker B1. The fixture must not pretend the module exercises it.
- **Blocked on B2** (§9.2): with no resolver in normal CLI play, the adventure
  slice is empty and `start_encounter` by authored `encounterId` fails.

### 10.10 P10 — Campaign rule without source ambiguity

- **Requirement:** one representative campaign-rule case owned by `eshyra-jhpt`
  that is **not** merely a choice among a pack `RulesAmbiguity`.
- **Existing `jhpt`-defined case, not invented here:** the material-components
  house rule. `eshyra-jhpt.9` scenario 4 is "Explicit 'no material components'
  house rule is durable prose"; `eshyra-jhpt.8` defines the same rule created
  from an immediate objection ("we don't use spell components") and replayed
  from disputed-turn start; `eshyra-jhpt.1` classifies it as a **house-rule**
  (an intentional override of clear canonical behavior), which is exactly the
  "no source ambiguity" property required. **[VERIFIED from the beads]**
- **Tests:** discovery of an active campaign rule; correct scope; coexistence
  with the underlying source material; precedence presentation that does not
  erase source provenance; trace evidence showing why the rule was included.
- **The fixture does not exist yet and is not invented here.** `jhpt` has
  defined the *scenario* but no durable rule record, storage, or projection
  exists (`eshyra-jhpt.1`, `.2`, `.5` are all OPEN). The acceptance shape P10
  must satisfy when `jhpt` supplies it:
  1. the packet contains the active house-rule prose with its stable identity,
     kind (`house-rule`), status, origin/provenance, and effective campaign
     position;
  2. the governing source material remains present and attributed — the rule
     does not replace or hide the SRD material it overrides;
  3. precedence is *presented*, not silently applied: the packet states that the
     campaign rule governs, and still shows the source;
  4. the retrieval reason is recorded as route `campaign-rule` with the
     applicability signal that selected it;
  5. no ordinary contextual adjudication (cover, visibility, terrain) appears as
     a campaign rule — `eshyra-jhpt.9` scenario 9 already requires this, and P10
     must not weaken it.
- **Dependency:** `eshyra-jhpt.1`, `.2`, `.3` (and `.5` for the authoring path).

### 10.11 P11 — Add-on override (baseline integrity)

- **Setup:** a **synthetic** campaign stack — a base pack plus an add-on that
  overrides or supplies a mechanically consumed record. Synthetic because no
  real add-on corpus exists (`jued` §11), and because `rules/stack.ts` requires
  an explicit `overrides` declaration for a collision and preserves the full
  `overrideChain` (`stack.ts:22`, `:46`, `:202-203`). **[VERIFIED]**
- **Tests:** strict discovery and deterministic execution must resolve the
  **same active record**, the **same system and version**, and the **same
  override chain**.
- **Expected failure today:** `lookup_rules` resolves through
  `resolveStrictCampaignRulesStack` (add-ons included), while
  `lookupCampaignRecord` and `campaignBasePack` resolve base-only and fall back
  to bundled D&D (§9.3). The probe must show the divergence before B3 and its
  absence after. **No silent bundled-D&D fallback is allowed.**
- **Blocked on B3** for the "after" half; the "before" half is the regression
  evidence that B3 was real.

### 10.12 P12 — False SRD authority (baseline integrity)

- **Target:** `table:starting-wealth-by-class`.
- **Expected outcome before repair:** the record is **rejected, quarantined, or
  explicitly marked non-authoritative** by discovery — never surfaced into the
  DM context packet as SRD authority. After repair (B4), the record is absent
  from the SRD pack and the probe asserts its absence plus the reconciled
  character-creation path.
- **Verified false-authority evidence to assert against:** `source: "SRD 5.1 p.
  38"`, `provenance.locator: "p. 38"`, and the full CC-BY-4.0 SRD attribution
  block on a record produced from a hard-coded literal in `emit.ts:127`.
  **[VERIFIED]**
- **Standing rule this probe encodes:** **discovery success must never launder
  known false provenance through the DM context packet.** A retrieval system
  that surfaces an invented rule with authoritative provenance is worse than no
  retrieval system (ADR 0020 §1).

---

## 11. Fixture contract

**[DESIGN]** Each diagnostic fixture declares thirteen fields. No fixture data
is created in this PR; this is the contract the authoring work
(**§14 W7 — diagnostic fixture corpus**) must satisfy.

| # | Field | Content |
|---|---|---|
| 1 | player input | the exact player text, verbatim |
| 2 | relevant campaign state | the minimal state needed: acting character, conditions, active effects, inventory instances, encounter/combat state |
| 3 | relevant adventure state | active run, module id, location/scene selection — or an explicit "none" |
| 4 | relevant campaign-rule state from `jhpt` | active rules/rulings at the campaign position, by identity — or an explicit "none active" |
| 5 | must-include targets | canonical record keys (plus selectors) that **must** appear in the packet |
| 6 | may-include targets | keys whose presence is acceptable and not required |
| 7 | must-not-include targets | keys whose presence is a failure (e.g. `table:starting-wealth-by-class` as authority) |
| 8 | expected route classes | per must-include target, the routes expected to produce it |
| 9 | required retained facts | exact prose substrings, typed values, or selectors that must survive into the packet |
| 10 | required relationship expansion | the exact typed traversals expected, with source, link field, relation, and target |
| 11 | expected ambiguity state | ambiguity ids expected in the packet and whether each is expected resolved or unresolved |
| 12 | expected campaign-rule or ruling state | which rules/rulings must appear, with scope and provenance expectations |
| 13 | expected capability status and limits | the capability (if any) expected available, plus its declared inputs, exclusions, revision, and residual interpretation — **or** an explicit "no capability positively selected" |
| — | expected deterministic state effect | the exact state effect expected, **or** the explicit expectation that there is none |

**Authoring rules.**

- Every identity in fields 5–13 must be verified against the pack or the module
  at authoring time, and the fixture records the commit it was verified at.
- A fixture may supply **oracle signals** for a downstream stage (§12.1), and
  must say so explicitly, so a downstream pass cannot be mistaken for
  end-to-end success.
- A fixture never asserts a count of records ("all N creatures …"). Count-pinning
  is the third recurring failure idiom named by `eshyra-o9bd.19.7`.
- **Fixture expectations are bounded evidence for the named scenario. They are
  not corpus-completeness declarations**, and no report generated from them may
  aggregate them into one.

---

## 12. Experiment phases

Four ordered phases, plus Phase 0. Each has explicit entry and exit criteria.
**[DESIGN]**

### 12.0 Phase 0 — baseline repairs

**Do:** complete the five blockers B1–B5 (§9), each with permanent regression
evidence — a test that fails on the old behavior. Coordinate the campaign-rule
prerequisites with `eshyra-jhpt` (§8.3 A1–A4).

**Exit criteria:** B1, B2, B3, B5 have merged repairs with tests; B4 has merged
removal plus a reconciled character-creation path per `eshyra-o9bd.19.2.1`; the
`jhpt` amendments are recorded on the owning beads.

**Parallel:** the durable finding registry (`eshyra-o9bd.19.1.15`), fixture
authoring, and offline-harness design may all proceed during Phase 0.

### 12.1 Phase 1 — offline stage harness

**Build** an **experiment-only** harness that can execute and inspect the stage
pipeline:

```text
signals → candidates → typed expansion → campaign-rule/ruling join
        → dedup with preserved reasons → priority and retention
        → context packet
```

**Requirements:**

- the harness **returns its trace directly to tests** — no durable store, no
  new database, no readiness artifact;
- it uses the **real active rules-stack resolution** (`resolveRulesStack` /
  `resolveStrictCampaignRulesStack`), not a fixture pack copy, so stack
  semantics and override chains are the real ones;
- it consumes a **narrow `jhpt` campaign-rule/ruling read interface** (§8.2)
  where applicable — behind a seam that a stub satisfies until `jhpt` lands;
- fixtures may supply **oracle signals** so downstream stages can be tested
  independently of signal extraction;
- **signal extraction is tested separately**, so a failure at one stage is never
  hidden by success at another. A probe that passes only because the fixture
  handed it the answer is reported as such.

**Exit criteria:** every probe in §10 that does not require runtime state runs
end-to-end through the harness; every stage boundary emits its own evidence;
each measurement in §13 is computable per probe per stage.

### 12.2 Phase 2 — runtime shadow mode

**Do:** run discovery **after `assembleContext` and before
`renderContextMessage`** — the seam verified at `orchestrator.ts:561` and `:576`
**[VERIFIED]** — and **do not alter DM input**. The DM sees exactly what it sees
today.

**Record:** explicit and derived signals; candidates; all retrieval routes;
relationship traversals; campaign-rule and ruling matches from `jhpt`; dedup
decisions; priority; retained candidates; rejected candidates **with reasons**;
the proposed packet; capability preflight results.

**Attach** shadow evidence to the existing turn-trace authority
(`memory/turnTrace.ts` `TurnTraceRecord`, written at `orchestrator.ts:817`
**[VERIFIED]**) or return it through the existing trace seam. **Do not create** a
competing readiness database, a second campaign-rule store, or a second finding
registry.

**Entry criteria:** the blockers applicable to the probes being shadowed are
repaired (§9.6). **Shadow evidence gathered before that is diagnostic only and
is not a baseline.**

**Exit criteria:** shadow traces exist for the probe corpus over real turns;
every §13 measurement is derivable from the trace without re-running discovery.

### 12.3 Phase 3 — packet intervention

**Do:** inject the packet in **scripted, provider-neutral** tests and compare
against the current baseline. Provider-neutral means through the existing
adapter seam (ADR 0010), not through one provider's agent loop.

**Observe:** whether must-include material reaches the DM; whether routes
survive dedup; whether mandatory candidates survive budgets; whether source
prose remains intact; whether partial-projection limits are explicit; whether
campaign rules and rulings are presented with correct scope and provenance;
whether capability limits are shown correctly; auditor retries; explicit rule
citations or tool calls; accepted deterministic state effects.

**Prohibition:** **do not infer that the model "used" material merely because it
was present.** `jued` §10 records that no trustworthy "used vs ignored" signal
exists; citation and tool-call correlation are suggestive, never proof.

**Entry criteria:** Phase 1 acceptance (offline stages pass for the probe set).

### 12.4 Phase 4 — held-out and live pilot

**Do:** run **held-out variants** of the corpus (probes authored after the
pipeline was tuned, not used to tune it), then bounded live play.

**Use missed rules as evidence for improving:** signal extraction; relationship
traversal; campaign-rule matching; ranking; context retention; capability
presentation; auditor policy.

**They do not establish or refute universal retrieval completeness.** A held-out
miss bounds an awareness-failure rate on that corpus; it says nothing about the
corpus's complement.

**Entry criteria:** shadow evidence exists and provider-neutral scripted tests
pass.

---

## 13. Measurements and acceptance criteria

### 13.1 Per-probe measurements

**[DESIGN]** Twelve measurements, reported **per probe** and, where the phase
supports it, **per stage**. They are deliberately heterogeneous — some are
counts, some are sets, some are booleans, some are diagnoses.

| # | Measurement | Definition |
|---|---|---|
| **M1** | must-target retrieval | for each must-include target: reached the packet, or not |
| **M2** | loss stage | for each missed must-include target: the exact stage that lost it (signals, candidates, expansion, rule join, dedup, priority, packet) |
| **M3** | preserved retrieval-route count | routes recorded per retained candidate, compared with routes produced before dedup |
| **M4** | relationship-expansion result | which declared traversals fired, which did not, and which fired but were dropped later |
| **M5** | campaign-rule/ruling match result | which active rules and rulings were requested from `jhpt`, which matched, and which were placed beside their governing material |
| **M6** | mandatory-candidate retention | whether every must-consider candidate survived the budget; an overflow record fails the probe (§6.3) |
| **M7** | packet size | packet bytes and candidate count, plus the reason recorded for each related/exploratory drop |
| **M8** | false authoritative inclusions | records surfaced as authority whose provenance is known-false or non-authoritative (probe P12's standing check) |
| **M9** | missing source facts | declared required-retained facts (fixture field 9) absent from the packet |
| **M10** | capability preflight agreement with runtime | whether the packet's capability status matches what the runtime capability actually did when invoked |
| **M11** | auditor retry count | retries attributable to missing rule evidence, distinguished from other rejection causes |
| **M12** | accepted state-effect agreement | whether the accepted deterministic state effect matches the fixture's expectation (including the expectation that there is none) |

### 13.2 Independence rules

**Keep these measurements independent.** They must **not** be collapsed into a
completeness score, a readiness score, a coverage percentage, or a universal
pass/fail claim. Specifically:

- M1 (retrieval) may not be reported as coverage of the corpus;
- M10 (capability agreement) may not be read as record or clause completeness;
- M12 (state-effect agreement) may not be read as adjudication correctness;
- a probe's pass is bounded evidence for its named scenario only;
- an aggregate across probes may be reported as a **count of probes passing**,
  never as a rate over the rules universe.

**"Present" is not "used."** No measurement infers model reliance from packet
membership. M11 and explicit citations are correlates, not proof (§12.3).

### 13.3 Phase acceptance criteria

| Phase | Accepted when |
|---|---|
| **0** | B1–B5 repaired with permanent regression evidence; the `jhpt` amendments (§8.3) are recorded on the owning beads |
| **1** | every runtime-independent probe executes end-to-end offline; each stage emits its own trace; signal extraction is separately tested; M1–M9 computable per probe; oracle-supplied stages are labelled as such |
| **2** | shadow traces exist for the probe corpus over real turns, attached to the existing turn-trace seam; M1–M11 derivable from the trace without re-running discovery; no new durable store was introduced |
| **3** | scripted provider-neutral intervention runs produce M1–M12 against a recorded baseline; no must-consider overflow occurred, or every occurrence failed its probe as designed |
| **4** | held-out probes report M1–M12 with the same instrumentation; misses are attributed to a named stage and converted into successor work, not into a claim about coverage |

**No phase is accepted on the basis that nothing failed.** A stage that recorded
no candidates, no routes, and no losses has not passed — it has failed to run
(the "recognizing nothing looks green" idiom that ADR 0020 §3 forbids and that
`eshyra-o9bd.19.7` names as recurring idiom 1).

---

## 14. Implementation decomposition

**[DESIGN]** Recommended successor breakdown. Owning beads are named where they
exist. Four of the five beads created by this work appear in this table — the
four verified runtime and capability defects that had **no** owner (§1.5; they
are reproducible defects, not speculative future work). The fifth,
`eshyra-o9bd.19.8`, owns this design and is not a work item. Every remaining
row names a **proposed** owner without creating one.

| # | Work item | Owning bead | Depends on | Changes architecture? | Parallel-safe? | Required permanent evidence |
|---|---|---|---|---|---|---|
| **W1** | `stat-block` lookup repair (B1) | **`eshyra-l3e5`** (created) | — | no | yes | registry-level invoke test for a `stat-block` ref; schema enum pinned against `RulesRecordKind` |
| **W2** | CLI adventure-resolver repair (B2) | **`eshyra-seoh`** (created) | — | no | yes | a test exercising the real selected-module → `runTurn` handoff; authored-`encounterId` start succeeds |
| **W3** | Strict campaign-stack repair (B3) | **`eshyra-6vpw`** (created) | — | no (restores an existing contract) | yes | synthetic base+add-on stack test proving strict lookup and the deterministic consumer agree on record, system, version, override chain (probe P11) |
| **W4** | Source-authority repair — Starting Wealth (B4) | `eshyra-o9bd.19.2.1` (existing, decision already recorded) | — | no | yes | pack absence assertion; reconciled character-creation path; probe P12 as a standing guard |
| **W5** | Item-readiness fail-open repair (B5) | **`eshyra-uiax`** (created) | — | no | yes | malformed-scope test asserting `ItemExecutionReadinessError` |
| **W6** | Durable finding registry | `eshyra-o9bd.19.1.15` (existing) | — | no (explicitly makes no executable membership claim) | yes | the registry artifact plus its currency check; explicit disclaimer of exact membership |
| **W7** | Diagnostic fixture corpus (§10, §11) | proposed: new child of `eshyra-o9bd.19.8` | fixture contract (this doc) | no | yes | the twelve fixtures, each recording the commit its identities were verified at |
| **W8** | Offline discovery stage harness (Phase 1) | proposed: new child of `eshyra-o9bd.19.8` | W7; a stub of the `jhpt` read interface | **yes** — introduces the discovery stage pipeline as a design surface | yes (design and build), gated for evidence | per-stage traces returned to tests; separate signal-extraction tests; no durable store |
| **W9** | Shadow trace integration (Phase 2) | proposed: new child of `eshyra-o9bd.19.8` | W8 accepted; W1, W2, W3, W5 for the probes that need them | **yes** — adds a runtime observation point at `assembleContext` → `renderContextMessage` | no | shadow evidence attached to the existing `TurnTraceRecord` seam; a test proving DM input is unchanged |
| **W10** | Context-packet intervention (Phase 3) | proposed: new child of `eshyra-o9bd.19.8` | W9; W11 for the rule/ruling fields | **yes** — changes what the DM receives | no | scripted provider-neutral tests; M1–M12 against a recorded baseline |
| **W11** | `eshyra-jhpt` campaign-rule integration (the read interface) | proposed: new child of `eshyra-o9bd.19.8`, **depending on** `eshyra-jhpt.3` (and `.6` for rulings) | `eshyra-jhpt.1`, `.2`, `.3` | no (consumes an owned runtime) | design yes; integration no | interface consumption tests against the real `jhpt` active-at-position query; no discovery-side rule store |
| **W12** | Campaign-rule and ambiguity-resolution implementation | `eshyra-jhpt.1`–`.9` (existing), plus amendments A1–A4 (§8.3) | its own chain | no (already decided by `jhpt`) | yes, independently of discovery | `eshyra-jhpt.9`'s ten end-to-end scenarios |
| **W13** | Capability-contract normalization (ADR 0020 §3 five fields) | proposed: new child of `eshyra-olc5`; consumes the `ENGINE_PROCEDURE_COVERAGE` split (§5.4) | W5; §5.4 split | **yes** — defines the capability contract shape | yes | each capability declares operation, inputs, exclusions, revision, residual interpretation, and fails closed on unrecognized input |
| **W14** | Artifact dispositions and re-freeze policy (§5) | `eshyra-o9bd.14` and `eshyra-2zyy` (existing) for the bar; proposed disposition child under `eshyra-o9bd.19` for §5.1–§5.6 | W6 for finding-registry pointers | **yes** — replaces the re-freeze bar | partly (the in-band scope statements are parallel-safe; the bar amendment is not) | in-band scope statements; identity-pinned censuses; the nine-condition bar recorded on `eshyra-o9bd.14` and amended into `eshyra-olc5`'s GREEN definition |
| **W15** | Held-out and live-play evaluation (Phase 4) | proposed: new child of `eshyra-o9bd.19.8` | W10 | no | no | held-out probe reports with per-stage attribution; no completeness claim |

### 14.1 Parallel-safe early work

- `stat-block` lookup repair (W1, `eshyra-l3e5`);
- CLI adventure-resolver repair (W2, `eshyra-seoh`);
- strict campaign-stack repair (W3, `eshyra-6vpw`);
- Starting Wealth source-authority repair (W4, `eshyra-o9bd.19.2.1`);
- item-readiness fail-open repair (W5, `eshyra-uiax`);
- durable finding registry (W6, `eshyra-o9bd.19.1.15`);
- diagnostic fixture authoring (W7);
- offline stage-harness **design** (W8).

### 14.2 Serialized work

- runtime shadow mode (W9) **after** the baseline repairs applicable to the
  probes being shadowed;
- packet intervention (W10) **after** offline-stage acceptance (Phase 1);
- campaign-rule packet integration (W11) **after** the required `jhpt`
  interface exists (`eshyra-jhpt.3`, plus `.6` for rulings);
- live pilot (W15) **after** shadow evidence and provider-neutral scripted tests
  pass;
- re-freeze (W14's bar) **after** the artifact dispositions and the
  source-authority blocker are resolved.

### 14.3 Standing constraint on the decomposition

**Campaign-rule persistence and ruling lifecycle do not move out of
`eshyra-jhpt`** under any of these items. W11 consumes; it does not own. If an
implementation finds the `jhpt` interface insufficient, the correct response is
an amendment or child under `eshyra-jhpt` (§8.3), never a discovery-local store.

---

## 15. Risks and explicit unresolved questions

### 15.1 Risks

| # | Risk | Why it is credible here | Mitigation in this design |
|---|---|---|---|
| **R1** | Generalizing before the boundary is proven — the exact cause of the 2026-07-27 invalidation (`eshyra-o9bd.19.7`) | discovery is a broad concept and invites a universal relationship model | twelve bounded probes with verified identities; route classes explicitly provisional; no ontology (§3.2) |
| **R2** | A parallel proof system appearing beside the existing readiness machinery | ADR 0017 §8 and ADR 0020 both warn about it; three prior PRs did it | D12: harness returns traces to tests; shadow evidence attaches to the existing turn trace; no durable store (§12.1–§12.2) |
| **R3** | A discovery-local campaign-rule store | it is the cheapest local fix whenever a ruling is needed | §8.4 prohibitions; W11 depends on `jhpt`; probe P7's absence case is a first-class expectation |
| **R4** | A gate that passes by recognizing nothing | four latent instances already exist (`ar72` D-9) | §13.3: a stage with no candidates, routes, or losses has failed to run; must-consider overflow fails the probe |
| **R5** | Fixtures drifting from the pack after regeneration | all §10 identities are pack-dependent | fixtures record the verification commit; the `verify:dnd5e-srd-pack` reproducibility guard is the tripwire; P8's target must be re-derived by query, never hand-edited |
| **R6** | Reading probe results as coverage | the whole history of this program is claims outgrowing evidence | §13.2 independence rules; every probe labelled bounded evidence |
| **R7** | Shadow evidence collected against a broken baseline | four of the five blockers change what the runtime resolves | §9.6 sequencing; per-probe blocker attribution in §10 |
| **R8** | The `jhpt` interface arriving later than the discovery work needs it | all nine `jhpt` children are OPEN and `jhpt` is P2 while this program is P1 | W11 is explicitly serialized; the offline harness consumes a stub behind the same seam; P10 specifies an acceptance shape rather than inventing a fixture |

### 15.2 Questions this design answers, from `ar72` §9

- **Q1 (what replaces the re-freeze bar)** — answered: §5.9's nine conditions.
- **Q4 (readiness bucket mechanism)** — answered: §5.2 narrow, membership
  registries preserved.
- **Q5 (`RULE_DISPOSITIONS` / `ENGINE_PROCEDURE_COVERAGE`)** — answered: §5.3
  retain in scope; §5.4 split three ways with ADR 0018 obligations preserved.
- **Q7 (does D-1's mechanic survive, under what identity)** — answered in §5.10
  by deferring to the decision already recorded on `eshyra-o9bd.19.2.1`.
- **Q8 (how partial projections declare their limits)** — answered: §7.2.
- **Q9 (what `engine:F1`–`F10` is after the transition)** — answered: §5.5, the
  bounded magic-item backlog, with `eshyra-olc5` reassessed against that scope.
- **Q10 (how ambiguity surfaces; campaign-ruling lifecycle)** — answered for the
  *surfacing* half (route classes `campaign-rule`/`campaign-ruling`, §6.2; the
  packet fields, §7.1; probe P7). The lifecycle half stays with `eshyra-jhpt`.

### 15.3 Questions this design deliberately leaves open

- **Q2 (`eshyra-olc5`'s nine-point GREEN definition)** — [OPEN] The amendment is
  scoped by §5.9 but the bead text is not rewritten here; owner `eshyra-olc5`
  (W14).
- **Q3 (whether the finding registry lands before the transition design)** —
  [OPEN, now moot in one direction] This design landed first; §5.7 requires the
  registry **before bulk finding disposition**, which is the sequencing that
  matters.
- **Q6 (capability identity and exclusions)** — [OPEN] W13 defines the contract
  shape; only `derived-magic-item-clauses-v1` has a revision today.
- **Q11 (ADR 0019's one-disposition-per-candidate rule)** — [OPEN] §5.6 bounds
  the use discovery may make of the census; the ADR-level review remains ADR
  0019's own successor.
- **Q12 (what durable identity survives a repaired finding)** — [OPEN] Owner
  `eshyra-o9bd.19.1.15`; §5.4 records the requirement that a closed bead pointer
  may not be the only durable identity.
- **Signal representation** — [OPEN] ADR 0020's first open question. This design
  names the *routes* and the *evidence* a signal must carry, and deliberately
  does not choose the situation representation that produces them; Phase 1's
  separate signal-extraction tests exist to make that choice on evidence.
- **Which signals are explicit versus model-derived** — [OPEN] Probes P1, P2,
  and P5 are the ones whose results should decide it.
- **Ranking beyond three bands** — [OPEN] Deliberately: choosing a ranker before
  M3/M6/M7 evidence exists is the failure mode this design is reacting to.
- **Exact membership of the clause-incompleteness family (`ar72` D-4)** —
  [OPEN] Owner `eshyra-o9bd.19.1.6`/`.19.1.15`; this design asserts no
  membership and P3/P4 are named instances only.

### 15.4 Unresolved evidence conflicts

**None found between the two maps.** Their defect sets are disjoint (§2.2),
their shared seam agrees (§2.4), and the one apparent numeric divergence
(794 vs 795 magic-item readiness clauses) is two different predicates over the
same data, reconciled by re-derivation in §2.3. Where this design differs from
the task framing that commissioned it, the difference is a verified-identity
correction, recorded in-band: `feature:action-surge` → `feature:fighter:action-surge`
(§10.6), and the Hollow Beneath Emberfall module contains no stat-block
reference (§10.9).

---

## Verification record

Commands and probes run from the linked worktree root
(`.worktrees/eshyra-o9bd.19.8`, branch `eshyra-o9bd.19.8`, cut from
`origin/main` `f4b3461`):

```text
npm run agent:preflight                  # parent checkout, before worktree
git worktree add -b eshyra-o9bd.19.8 ... origin/main
npm ci                                   # worktree-local install
jq / rg / sed read-only inspection of the generated pack, the adventure
  module, and every cited source file
npx tsx <generated magic-item readiness query>   # §10.8 target selection
npm run verify:worktree
```

Read-only pack and module queries only; **no generated pack output, production
code, schema, or fixture was changed by this work.** The magic-item probe target
was selected by executing `assertMagicItemOperationReady` over every
`magic-item` record's operations with the exact input shape
`itemState.ts:1888-1911` constructs — six (record, operation) pairs pass, and
the selected one is recorded with its exact evidence in §10.8.

Beads created by this work — the same five accounted for in §1.5:
`eshyra-o9bd.19.8` (this design) and four verified-defect beads with no prior
owner, `eshyra-l3e5` (B1), `eshyra-seoh` (B2), `eshyra-6vpw` (B3), and
`eshyra-uiax` (B5). B4 already had an owner (`eshyra-o9bd.19.2.1`). No other
bead was created, and no existing bead was closed, retired, or reclassified by
this document.

---

*This document is a design. It changed no generated pack output, no production
code, and no schema, and it dispositions no finding.*
