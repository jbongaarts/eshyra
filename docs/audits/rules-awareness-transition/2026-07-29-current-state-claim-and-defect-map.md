# Current-state claim, authority, and defect map for the ADR 0020 transition

- **Date:** 2026-07-29
- **Bead:** `eshyra-ar72` (child of `eshyra-o9bd.19`)
- **Repository state examined:** `main` @ `7aba2b6` ("Merge PR #482: ADR 0020 …"),
  which is `origin/main` at the time of writing. Generated pack:
  `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`, **1,813 records**.
- **Sibling deliverable:** `eshyra-jued` produces
  `2026-07-29-existing-discovery-substrate-map.md` in this directory (runtime
  discovery flow). This document is the **claim and defect** map. They overlap
  deliberately at the `lookup_rules` / context-assembly seam.

**Nature of this document.** This is an evidence map, not a design and not a
disposition. It does not close, retire, reclassify, or downgrade any finding.
Where it names a decision the transition program must make, that is recorded as
a **question**, never as an answer.

**Evidence conventions used throughout.** Every claim below is tagged:

| Tag | Meaning |
|---|---|
| **[VERIFIED]** | Re-derived in this session by running a command or reading the exact cited symbol/data at `7aba2b6`. |
| **[INFERRED]** | A conclusion drawn from verified facts. The reasoning is stated so it can be attacked. |
| **[QUESTION]** | Unresolved. Explicitly not decided here. |
| **[HISTORICAL]** | Prose that was true of an earlier artifact and is retained as decision history, not as a current claim. |

---

## 1. Executive summary

Eshyra's rules-pack machinery today makes claims of five materially different
kinds, and the repository does not currently distinguish them at the point of
use. ADR 0020's five concerns (source fidelity, discovery, interpretation,
deterministic execution, state integrity) map cleanly onto that confusion, and
holding them apart is what this map is for.

**What is genuinely strong.**

1. **Reproducibility holds.** `npm run verify:dnd5e-srd-pack` exits 0 at
   `7aba2b6`: the committed pack is byte-identical to importer output from the
   pinned PDF, and all three source-accounting artifacts match regenerated
   output exactly. **[VERIFIED]**
2. **The generated pack is the runtime pack** (ADR 0013), reached through
   `getBundledDnd5eSrdPack()` and consumed by `lookup_rules`, character
   creation, encounter seeding, item state, and the campaign binding.
   **[VERIFIED]**
3. **One deterministic capability gate is real and fails closed at runtime:**
   `assertMagicItemOperationReady` (`packages/core/src/state/itemExecutionReadiness.ts`),
   called from `packages/core/src/state/itemState.ts:1888`. It throws when a
   magic item has no trusted derived readiness contract. **[VERIFIED]**
4. **State-integrity commitments are intact and independent of the pack**:
   the Hybrid Contract, atomic `mutateStateBatch`, migration-first schema,
   checkpoint separation, and the ADR 0018 fail-closed single-class guard
   (`UnsupportedCharacterBuildError` / `MULTICLASS_UNSUPPORTED`). **[VERIFIED]**

**What is not what it appears to be.**

5. **Both halves of the freeze gate are currently non-operative.** The
   thaw-note check is switched off in code
   (`THAW_NOTE_CHECK_ENABLED = false`), the hash check **fails today** on
   `records.json`, and the workflow that ran the guard in CI was deleted
   (`30bc00d`). Nothing enforces the freeze manifest. **[VERIFIED]**
6. **A fabricated record carries an SRD provenance locator and the CC-BY
   licence block, and every existing gate passes it.**
   `table:starting-wealth-by-class` is emitted from a hard-coded literal in
   `emit.ts`, cites "SRD 5.1 p. 38", and the string "Starting Wealth" does not
   occur anywhere in the 403-page extracted SRD 5.1 text. Page 38 of that
   source is Ranger (Hunter) subclass features. **[VERIFIED]**
7. **Every "finding" and every ownership pointer in the readiness registries
   names a CLOSED bead.** All five `finding` entries in
   `GAMEPLAY_READINESS_DISPOSITIONS` (410 records) and all eight owner beads in
   `ENGINE_PROCEDURE_COVERAGE` are closed. The validators check only that a
   bead-shaped string is present. **[VERIFIED]**
8. **197 pack records fall into no readiness bucket at all** and therefore
   never require a reviewed disposition. Equipment is separately covered by
   `EQUIPMENT_MECHANICS_REVIEW`; the 87 `table` records and 1 `stat-block`
   record are not. **[VERIFIED]**
9. **`engine:F1`–`engine:F10` is a magic-item artifact, not a corpus
   capability inventory.** `data.executionReadiness` exists on 240 records,
   all `magic-item` (13% of the corpus, one kind). Spells, creatures, hazards,
   features, rules, and equipment have no equivalent. **[VERIFIED]**
10. **The typed spell/creature/hazard mechanics projections have no runtime
    consumer.** No production code reads `mechanics.saves`, `mechanics.damage`,
    or `mechanics.area`. **[VERIFIED]** Their defects are therefore
    **discovery and adjudication-support** defects — a truncated typed
    projection sits beside faithful prose in what `lookup_rules` hands the DM —
    not deterministic-execution defects. **[INFERRED]**
11. **Discovery, as ADR 0020 §5 describes it, does not exist.**
    `contextAssembler.ts` injects no rules material; `lookup_rules` requires an
    exact `kind` plus an exact name or ref; the turn auditor is a model-based
    post-hoc check. **[VERIFIED]**

**What is at risk of being lost.** The 2026-07-24 multi-model finding corpus —
roughly 69 numbered findings across five review streams — exists only in bead
descriptions and in an **out-of-repository** file
(`/mnt/d/eshyra-2026-07-24-audit-repair-bead-plan.md`). PR #476's
`finding-registry.json`, which was to make it durable repository data, was
closed unmerged. **[VERIFIED]** Under ADR 0020 §7 those findings remain open
obligations, and the repository currently cannot enumerate them. **[INFERRED]**

**The unifying observation.** Eshyra's readiness machinery reliably answers
*"does a record contain a mechanics atom?"* and reports zero errors. It has no
predicate for *"is this clause completely and correctly represented?"* and no
predicate for *"is this material discoverable?"* Every green in §4 below should
be read as scoped to the first question only.

---

## 2. Authority reviewed

### 2.1 Accepted architecture decisions

| Authority | Status | What was read for |
|---|---|---|
| `AGENTS.md` | operative | Workflow, freeze/thaw convention, bead policy, importer fix protocol pointer |
| `docs/adr/0020-rules-pack-as-rule-awareness-infrastructure-with-bounded-deterministic-capabilities.md` | Accepted 2026-07-29 | The governing North Star; §3 asymmetries; §7 disposition rules; the reassessment list in Consequences |
| `docs/adr/0007-rules-pack-ingestion-policy.md` | Accepted, §1 narrowed | Source authority, model-assistance boundary (§2–§4 in force verbatim) |
| `docs/adr/0013-runtime-srd-pack-is-the-generated-pack.md` | Accepted | Runtime binds the generated pack; ambiguous-name lookup contract |
| `docs/adr/0017-rules-pack-compiler-and-executable-curation-architecture.md` | Accepted, §2 narrowed by 0020 | Semantic-substrate goal; curated-input rules; §8 audit restraint |
| `docs/adr/0018-single-class-engine-boundary.md` | Accepted | Fail-closed build contract; §6 coverage-reporting obligation |
| `docs/adr/0019-typed-boundary-for-semi-structured-source-strings.md` | Accepted; **follow-up review required by 0020** | Disposition vocabulary; the generated census; the five residual families |
| `docs/rules-pack-compiler.md` | Canonical operating guide | §2.3 correctness dimensions; §6 clause-level ownership; §9 audit restraint; §10 decision procedure |
| `docs/importer-fix-protocol.md` | Operative | Regression-sensitive change mechanics |

### 2.2 Freeze / thaw authority

- `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` — status
  `thawed-reaudit`, audited commit `0f5b3dc`, 13 pinned files.
- `docs/audits/dnd5e-srd-5.1-final/thaw-notes/` — 55 dated notes + `TEMPLATE.md`.
- `packages/core/scripts/verify-dnd5e-srd-freeze/{cli.ts,freeze.ts}` — the
  implementation of both policies.

### 2.3 Audit and design documents

`docs/audits/dnd5e-srd-5.1-final/`: `README.md` (2026-06-17 sign-off),
`provenance.md`, `evidence.json`, `record-counts.md`, `audit-methodology.md`,
`known-source-typos.md`, `mechanics-projection-report.md`,
`2026-07-01-external-audit-positive-assurances.md`, the twelve
`2026-07-0x-o9bd-18-7-*` design/classification artifacts, and
`o9bd-18-7-6-equipment-mechanics-inventory.{md,json}`.
Also `docs/audits/2026-07-12-f3-mutation-lifecycle-audit.md`,
`docs/audits/srd-5.1-rules-section-coverage.md`, and
`docs/inventories/o9bd-18-8-8-semi-structured-boundary.{md,json}`.

### 2.4 Bead state

Read in full: `eshyra-o9bd.19` (epic), `eshyra-olc5` (epic),
`eshyra-o9bd.19.7` (the DESIGN_INVALIDATED handoff, description + notes),
`eshyra-o9bd.19.1.6`, plus the descendant listing of both epics and status
checks on every bead named by a registry, ADR, or disposition (see §6.4).

Also read: `/mnt/d/eshyra-2026-07-24-audit-repair-bead-plan.md`, the source plan
cited by `eshyra-o9bd.19`. **This file is outside the repository.**

### 2.5 Implementation read directly

`packages/core/scripts/create-dnd5e-srd-audit-bundle/{cli.ts,ruleDispositions.ts}`;
`packages/core/src/rules/{types.ts,validate.ts,srdAudit.ts,srdPlayabilityAudit.ts,srdChoiceProseAudit.ts,srdEquipmentResolutionAudit.ts,rulesAmbiguities.ts,conditionRelations.ts,bundledSrdPack.ts,binding.ts,lookup.ts}`;
`packages/core/src/state/{itemExecutionReadiness.ts,itemState.ts,mutateState.ts}`;
`packages/core/src/orchestrator/{toolLookupRules.ts,contextAssembler.ts,turnAuditor.ts,protocol.ts}`;
`packages/core/src/character/characterBuild.ts`;
`packages/core/scripts/verify-dnd5e-srd-freeze/*`;
`packages/core/scripts/importers/dnd5e-srd-5.1/emit.ts`;
`.github/workflows/*`.

### 2.6 Commands run

| Command | Result |
|---|---|
| `npm run verify:dnd5e-srd-pack` | **exit 0** — 0 records added/removed/changed; 0 manifest changes; inventory/coverage/region-ledger each match regenerated output exactly |
| `npm run verify:dnd5e-srd-freeze` | **exit 1** — thaw-note check SKIPPED (disabled); hash check FAILED on `records.json` |
| `npx tsx packages/core/scripts/inventory-semi-structured-boundary.ts --check` | `inventory is current (1793 rows)` |
| `npx vitest run` on `ruleDispositions`, `srdPlayabilityAudit`, `srdChoiceProseAudit`, `srdEquipmentResolutionAudit`, `srdFreezeGuard` | 5 files / 101 tests passed |
| Ad-hoc probes (throwaway, removed) over the loaded pack and the registries | Results quoted inline; every count below is from these |
| `bd show` / `bd list` on the beads in §6.4 | Statuses quoted inline |

---

## 3. Current architectural and runtime claims

### 3.1 The claims Eshyra currently makes

Stated in the order of ADR 0020's five concerns, with each claim's real
strength.

**Source fidelity.**

- *"The committed pack is deterministically reproducible from the pinned
  source."* **[VERIFIED true today.]** `verify:dnd5e-srd-pack` exit 0; source
  SHA-256 `2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`
  matches the source and pack manifests.
- *"Every record carries provenance back to the source artifact"* (ADR 0007
  Consequences). **[VERIFIED as implemented, but weaker than it reads.]**
  `assertProvenanceMatchesPackSource` (`validate.ts:252`) checks only that
  `provenance.sourceRef` equals the pack's source identity. It says nothing
  about whether the record's `locator` or its content correspond to real source
  text. Empirically, rewriting `equipment:battleaxe`'s locator to
  `SRD 5.1 p. 9999` is **accepted** by `validateRulesPack`.
- *"Authoritative pack content is produced by deterministic code running over
  licensed source material"* (ADR 0007 §1/§3). **[VERIFIED violated in at least
  one place]** — see §6.1 finding D-1.

**Discovery.**

- ADR 0020 §5 states the current surface is "a single model-initiated
  `lookup_rules` call plus an auditor that notices, after the fact, that a
  required lookup was missing." **[VERIFIED accurate.]**
  `toolLookupRules.ts` requires `kind` and exactly one of `name`/`ref`; name
  lookup is exact-normalized and returns `ambiguous` rather than guessing;
  there is no topical, relational, or partial retrieval.
  `contextAssembler.ts` imports `bundledSrdPack.js` only for
  `DND5E_SRD_PACK_ID` comparison at line 412 — **no pack material enters the
  per-turn context**.
- `RulesAmbiguity` (3 records: `spell:create-undead`, `magic-item:cube-of-force`,
  `spell:find-familiar`) is validated at pack load
  (`rulesAmbiguities.ts`, `validate.ts:276`) and surfaced in the readiness
  report — but has **no runtime consumer**. It never reaches the DM.
  **[VERIFIED]**

**Interpretation / adjudication.**

- *"`model-adjudicated-supported` is a reviewed, evidence-backed green"*
  (ADR 0017 §6). **[VERIFIED as implemented.]** 108 of 175 engine-procedure
  rows carry it; the validator requires non-empty `primitives` (each checked
  against `DEFAULT_TOOLS`) and a `contextRequirement` string. ADR 0020 §2
  promotes this from earned status to baseline.
- The `contextRequirement` is a **free-text string** that no gate reads
  semantically. This is the handoff's "second recurring idiom" (a required
  free-text field filled to satisfy a validator). **[VERIFIED]**

**Deterministic execution.**

- *"At re-freeze there must be zero engine-pending deterministic clauses"* —
  the 2026-07-25 program decision recorded in `eshyra-olc5` notes and
  `eshyra-o9bd.19`. **[VERIFIED still recorded in the beads, unamended.]**
  ADR 0020's "Prior assumptions this decision changes" item 4 states this rests
  on a global negative the corpus cannot support and **must be reassessed**.
  The beads have not yet been updated. **[VERIFIED]**
- *"1016 magic-item clauses, of which 794 engine-pending"* — real generated
  data, scoped to one record kind. **[VERIFIED]**

**State integrity.**

- Hybrid Contract (`protocol.ts:201`+): all dice and math through tools; canon
  writes through state tools. **[VERIFIED present in the DM system prompt.]**
- `mutateStateBatch` atomicity, `getStateProvenance`, migration-first schema,
  checkpoint separation, ADR 0018 fail-closed build validation. **[VERIFIED
  present.]** ADR 0020 explicitly leaves all of these unweakened.

### 3.2 Claims that have quietly expired

| Expired claim | Where it still reads as current | Evidence |
|---|---|---|
| "FREEZE / SIGN OFF — no blockers found" | `docs/audits/dnd5e-srd-5.1-final/README.md` §1, §11 | Describes commit `0f5b3dc`, 1811 records, 108 tables, 183 features. Current pack: 1813 / 109 / 184. The manifest's `status: thawed-reaudit` is the only in-band signal. **[VERIFIED]** |
| "The freeze guard enforces two policies … fails CI immediately" | same `README.md`, "Freeze protection" | Thaw-note check disabled in code; hash check red; `srd-freeze-guard.yml` deleted at `30bc00d`. **[VERIFIED]** |
| ADR 0019's narrative census ("1,196 grouped string paths … 257 complete … 739 model-adjudicated") | `docs/adr/0019-…md` §"Current repository inventory" | Committed generated census is 1,793 rows: 383 complete / 2 typed-core / 1209 model-adjudicated / 193 not-mechanical / 6 unsupported. ADR 0019 itself designates the generated census as authority, so the prose is **[HISTORICAL]**, not a defect — but it reads as current. **[VERIFIED]** |
| "these owners already exist" for the five ADR 0019 residual families | ADR 0019 §"Current repository inventory" | All five named owner beads are CLOSED; the residuals are still strings in the pack. **[VERIFIED]** — see §6.4. |
| `mechanics-projection-report.md` coverage table | `docs/audits/dnd5e-srd-5.1-final/` | Dated 2026-06-30, predates the `18.7.*` and `18.8.*` thaw work, and has no currency check (unlike the ADR 0019 inventory, which has `--check` plus a test). **[VERIFIED structurally]**; its specific numbers were not re-derived here because its counting method is not documented in-band. |

---

## 4. Claim / artifact map

Each row records: what it claims, its epistemic status, its inputs, its **real**
consumers, its failure direction, whether it rests on absence or
self-certification, and what breaks if it were removed today.

### 4.1 `GAMEPLAY_READINESS_DISPOSITIONS`

- **Path/symbol:** `packages/core/scripts/create-dnd5e-srd-audit-bundle/cli.ts:1256`;
  supporting membership registries `ACCEPTED_PROSE_RECORD_KEYS` (:1236),
  `ACCEPTED_METADATA_ONLY_SPELLS` (:1212),
  `CREATURE_ENTRY_REVIEWED_DISPOSITIONS` (:1194); gate
  `assertGameplayReadinessDispositions` (:1934).
- **Claims:** every *not-yet-modeled* record bucket has an explicit reviewed
  disposition; stale entries fail; `accepted-prose-only` buckets fail by exact
  key membership.
- **Status:** authoritative gate over a **derived view**. The buckets are
  computed from the pack it is judging.
- **Inputs:** the loaded pack; `auditSrdChoiceProse` findings.
- **Real consumers:** the audit-bundle build (`cli.ts`) and
  `packages/core/test/`. **No runtime consumer.** **[VERIFIED]**
- **Current output:** `dispositionErrors: 0`. Nine dispositions:
  `equipment#partial-structure` 7 (finding), `equipment#prose-only` 67
  (finding), `feature#partial-structure` 1 (accepted), `feature#prose-only` 12
  (accepted), `hazard#prose-only` 1 (finding), `rule#partial-structure` 32
  (finding), `rule#prose-only` 303 (finding), `spell#metadata-only` 12
  (accepted), `creature-entry#narrative-prose` 2 (reviewed-per-ref).
  **[VERIFIED]**
- **Fails closed on:** an unreviewed bucket; a stale entry; a `finding` with no
  `bead` field; an unreviewed key inside an `accepted-prose-only` bucket; a
  stale reviewed key. These are real and well-built.
- **Fails open on:**
  1. **Records in no bucket.** 197 records are neither "modeled" nor in
     `partial-structure` nor `prose-only`: 109 `equipment`, 87 `table`, 1
     `stat-block`. `equipment:battleaxe` is the archetype — fully typed weapon
     data whose field names (`damageDie`, `weaponProperties`, …) appear in none
     of the predicates. **[VERIFIED]**
  2. **A `finding` bead is never checked for existence or status.** The
     validator tests `policy.bead === undefined` only. All five `finding`
     entries (410 records) name CLOSED beads. **[VERIFIED]**
  3. **`hasMechanicsProjection` (:964) accepts an empty object.**
     `objectValue(data.mechanics) !== null` marks a record modeled even if
     `mechanics` is `{}`. A sibling predicate,
     `hasSubstantiveMechanicsProjection` (:920), does the stronger check but is
     used only for nested creature entries. Currently 0 records have empty
     `mechanics`, so this is **latent, not active**. **[VERIFIED]**
- **Relies on absence:** yes, structurally. A bucket that is empty produces no
  disposition, and there is no independent enumeration proving the buckets
  partition the corpus.
- **Challenged by:** ADR 0020 §3 ("Any gate, report, or predicate that reads an
  unbound or unrecognized item as satisfied is a defect"); handoff idiom (1)
  (empty failure list on unresolved input).
- **ADR 0020 dimensions:** deterministic capability (its subject),
  discovery (the "modeled" predicate is what decides whether a record is
  reported at all).
- **If removed today:** the audit-bundle build loses its only membership-pinned
  guard against a silent modeling regression in features, spells, and creature
  entries. `ACCEPTED_PROSE_RECORD_KEYS` / `ACCEPTED_METADATA_ONLY_SPELLS` /
  `CREATURE_ENTRY_REVIEWED_DISPOSITIONS` are genuinely load-bearing and should
  not be discarded with the bucket mechanism.

### 4.2 `RULE_DISPOSITIONS`

- **Path/symbol:** `…/ruleDispositions.ts:80`; gate `assertRuleDispositions` (:3177).
- **Claims:** every `rule:*` pack record (335) is classified exactly once as
  `reference-prose` / `definition` / `engine-procedure` / `table-backed` /
  `duplicate`; `duplicate` and `deterministicOwner` pointers resolve;
  `table-backed`/`tableEvidence` rows have non-empty `tableRefs` in the pack.
- **Status:** authoritative registry, **mechanically transcribed** from the
  2026-07-06 classification artifact (`…-o9bd-18-7-8-rule-classification.md`).
  The artifact, not the registry, is the reasoning of record.
- **Inputs:** the classification artifact (by hand-transcription); the pack (for
  key diff and table evidence).
- **Real consumers:** `cli.ts` audit-bundle build; `packages/core/test/ruleDispositions.test.ts`.
  **No runtime consumer.** **[VERIFIED]**
- **Current output:** 0 errors. Census 175 / 96 / 33 / 19 / 12. **[VERIFIED]**
- **Fails closed on:** a new or removed `rule:*` key; a `duplicate` whose owner
  is itself a duplicate; a `deterministicOwner` that is not engine-procedure or
  table-backed; a claimed table with no `tableRefs`.
- **Fails open on:** `EXPECTED_SEMANTIC_CENSUS` is **count-pinned** (:2935). A
  reclassification that keeps class totals equal passes. This is the handoff's
  third recurring idiom ("asserting the SIZE of a blocker set passes for any set
  of that size — assert identities"). **[VERIFIED]**
- **Relies on:** exhaustive membership over `rule:*` records **only**. It makes
  no claim about `spell`, `creature`, `feature`, `equipment`, `magic-item`,
  `hazard`, `table`, or `condition`. Read as a corpus classification it is a
  category error.
- **ADR 0020 dimensions:** adjudication (it fixes the deterministic /
  model-adjudicated boundary for rules), deterministic capability.
- **If removed today:** loss of the only enforced "no unclassified rule record"
  invariant, and the only mechanism forcing a new `rule:*` record through
  review.

### 4.3 `ENGINE_PROCEDURE_COVERAGE`

- **Path/symbol:** `…/ruleDispositions.ts:1669`; validated by
  `validateRuleRegistries` (:3010); reported by `buildRuleDispositionReport` (:3261).
- **Claims:** for each of the 175 `engine-procedure` rows, whether its
  deterministic behavior is `implemented` / `model-adjudicated-supported` /
  `partial` / `unimplemented` / `design-blocked`, with typed evidence
  obligations per status.
- **Status:** authoritative registry, hand-maintained, seeded from the
  2026-07-06 execution-boundary classification.
- **Real consumers:** `cli.ts`; `packages/core/test/`. **No runtime consumer.**
  **[VERIFIED]**
- **Current census:** implemented 39, model-adjudicated-supported 108, partial
  16, unimplemented 2, design-blocked 10; 7 `externalClauses` rows. **[VERIFIED]**
- **Fails closed on:** an `engine-procedure` row with no coverage entry; an
  orphan coverage entry; `implemented` without `runtimeOwner` **and**
  `evidence`; `model-adjudicated-supported` without `primitives` (each checked
  against `DEFAULT_TOOLS`) and `contextRequirement`; `partial` without
  `missing`; `design-blocked` without a bead-shaped `designOwner`.
- **Fails open on:**
  1. **Bead-shape only.** `BEAD_ID_PATTERN` checks a regex. Every
     `designOwner` and every `externalClauses.bead` currently names a CLOSED
     bead: `eshyra-2n1t.1`, `eshyra-2n1t.2`, `eshyra-b69j.13`,
     `eshyra-o9bd.18.7.7`, `.18.7.7.1`, `.18.7.7.2`, `.18.7.8.3`, `.18.7.9`.
     **[VERIFIED]** Note the two categories differ in substance: the
     `design-blocked` rows pointing at `2n1t.1`/`2n1t.2` were *resolved into
     ADR 0018* and ADR 0018 §6 explicitly requires them to keep being reported
     as deliberately deferred — the pointer is stale, the disposition is not.
     The `externalClauses` rows point at closed *implementation* beads and are
     genuinely orphaned.
  2. **`runtimeOwner` / `evidence` path existence is not checked here** — the
     module comment says this deliberately runs in tests "to keep the bundle
     build hermetic" (:3008).
  3. **`EXPECTED_COVERAGE_CENSUS` is count-pinned** (:2983), same idiom as §4.2.
- **Relies on self-certification:** `contextRequirement` and `missing` are
  free-text and no gate reads them.
- **Challenged by:** ADR 0020 §3 (a capability must declare operation, inputs,
  **exclusions**, identity, and residual interpretation — this registry
  declares status and owner, not exclusions or identity).
- **ADR 0020 dimensions:** deterministic capability; adjudication.
- **If removed today:** the repository loses its only written record of *which
  rule procedures are deliberately model-adjudicated versus not yet owned*, and
  ADR 0018 §6's reporting obligation for the multiclass procedures would have
  no implementation.

### 4.4 `srdPlayabilityAudit.ts`

- **Path:** `packages/core/src/rules/srdPlayabilityAudit.ts` (835 lines).
- **Claims:** seven named playable-model gates
  (`untyped-progression-marker`, `null-spellcasting-value`,
  `missing-class-feature-record`, `overlay-dependence`,
  `proficiency-note-bleed`, `choice-coverage`,
  `unresolvable-inline-option-ref`) are clean.
- **Status:** generated evidence with a **closed, enumerated** category set —
  each category is a specific historical defect turned into a checker. It is
  honest about this: the header lists each gate with its owning bead.
- **Real consumers:** exported from `packages/core/src/internal.ts:1031`;
  consumed by `cli.ts:2720` and `packages/core/test/srdPlayabilityAudit.test.ts`.
  **No runtime consumer.** **[VERIFIED]**
- **Current output:** 0 findings. **[VERIFIED]**
- **Fails closed within its declared categories.** It makes **no** claim
  outside them; the header says so ("Gate coverage status … GREEN").
- **Relies on absence:** no. It is a positive list of known defect classes.
- **ADR 0020 dimensions:** source fidelity (partially), deterministic
  capability (character build).
- **If removed today:** seven historical defect classes lose their regression
  guard. This artifact is the closest existing thing to the "permanent finding
  registry" `eshyra-o9bd.19.1.5`/`.1.6` describe, and is a candidate to be
  *strengthened* rather than replaced (ADR 0017 §8, ADR 0020 Consequences
  "Audit-architecture restraint").

### 4.5 `srdChoiceProseAudit.ts`

- **Path:** `packages/core/src/rules/srdChoiceProseAudit.ts` (409 lines);
  `CHOICE_PROSE_ALLOWLIST` (:175).
- **Claims:** no choice-announcing prose in `feature`/`class`/`subclass`/
  `ancestry`/`background` records lacks a structured option catalog or filter.
- **Status:** generated evidence. Deliberately over-detecting; a false positive
  is resolved the same way as a true one.
- **Real consumers:** `internal.ts:1010`; `cli.ts:2724` (both as a report and as
  the `unresolved-choice-prose` bucket input to
  `buildGameplayReadinessReport`); tests. **No runtime consumer.** **[VERIFIED]**
- **Current output:** 0 findings. **[VERIFIED]**
- **Scope limit:** `SCANNED_KINDS` is five kinds (:194). Spell, magic-item,
  creature, rule, equipment, hazard choice prose is out of scope by
  construction. **[VERIFIED]**
- **Relies on self-certification:** a 3-entry allowlist with written reasons
  (`feature:school-of-evocation:sculpt-spells`, `ancestry:rock-gnome`,
  `feature:way-of-the-open-hand:open-hand-technique`). Small, reasoned, and
  visible — but it is an escape hatch that the gate cannot itself audit.
- **ADR 0020 dimensions:** discovery (a catalog buried in prose is not
  addressable), deterministic capability (character build).
- **If removed today:** the `unresolved-choice-prose` readiness bucket loses its
  input and the option-catalog modeling work loses its regression guard.

### 4.6 `srdEquipmentResolutionAudit.ts`

- **Path:** `packages/core/src/rules/srdEquipmentResolutionAudit.ts` (330 lines).
- **Claims:** every starting-equipment filter and every class equipment
  proficiency phrase in the pack resolves to at least one `equipment:` key.
- **Status:** generated evidence backed by a **reviewed closed phrase table**.
- **Fails closed genuinely:** an unknown phrase throws
  `UnresolvedProficiencyPhraseError`; a zero-candidate result throws
  `EquipmentResolutionEmptyError` via `assertEquipmentResolution`. This is one
  of the few artifacts in scope that fails on *unrecognized* input rather than
  returning empty. **[VERIFIED]**
- **Real consumers:** `internal.ts:1020`; `packages/core/test/srdEquipmentResolutionAudit.test.ts`;
  cross-referenced by `inventory-semi-structured-boundary.ts:550`.
  **`assertEquipmentResolution` is never called from production code.**
  **[VERIFIED]**
- **ADR 0020 dimensions:** deterministic capability (character build).
- **If removed today:** a future SRD proficiency phrase could silently resolve
  to nothing during character creation. **[INFERRED]** This is a bounded
  positive capability check in the sense ADR 0020 §3 endorses; it is the model
  the transition should look at first.

### 4.7 `itemExecutionReadiness.ts` — the one runtime capability gate

- **Path/symbol:** `packages/core/src/state/itemExecutionReadiness.ts`,
  `assertMagicItemOperationReady`.
- **Claims:** a magic-item operation is safely executable only when the item
  carries a `derived-magic-item-clauses-v1` readiness contract, no in-scope
  clause is `engine-pending`/`design-blocked`/`red`/`transitional`, every spent
  economy has a semantic owner, and every operation effect has an exact
  readiness clause.
- **Status:** **authoritative runtime contract.** The only artifact in this map
  that changes runtime behavior.
- **Inputs:** `record.data.executionReadiness.clauses[]` from the generated pack;
  the caller's operation/economy/effect ids.
- **Real consumer:** `packages/core/src/state/itemState.ts:1888` (item use
  path); `packages/core/test/itemState.test.ts:1690`. **[VERIFIED]**
- **Fails closed on:** missing/untrusted contract (throws immediately, before
  any state mutation); an economy with no owner; an operation effect with no
  exact clause. This is the correct shape.
- **Fails open on:** `inSelectedScope` returns `false` for any `scope` whose
  `kind` is neither `'parent'` nor a matching `'variant'`. A clause with a
  malformed or unrecognized scope is **silently skipped** and cannot block.
  **[VERIFIED by reading lines 19–31 and 76–77.]** No such clause exists in the
  committed pack, so this is latent. **[INFERRED]**
- **Relies on absence:** no. It requires a positive trusted contract and
  enumerates blockers.
- **ADR 0020 dimensions:** deterministic capability (its subject), state
  integrity (it guards a mutation boundary).
- **If removed today:** 221 of 240 magic items (those with at least one
  `engine-pending` or `design-blocked` clause) would become silently executable
  through `itemState.ts` with no owner for their mechanics. **[VERIFIED count]**

### 4.8 `engine:F1`–`engine:F10`

- **Location:** pack data — `record.data.executionReadiness.clauses[].missingHooks[].engine`.
  Not a code registry; there is no `engine:F*` union type in the repository.
- **Claims:** each magic-item clause names the engine capability families whose
  hooks it still needs.
- **Status:** **generated evidence**, derived by the compiler from the magic-item
  clause registry.
- **Verified shape at `7aba2b6`:** 240 records carry `executionReadiness`, all
  `magic-item`. 1,016 clauses: 794 `engine-pending`, 218 `green`, 3
  `adjudicated-by-design`, 1 `design-blocked`. Missing-hook counts by family:
  **F1 83, F2 226, F3 31, F4 169, F5 391, F6 46, F7 15, F8 310, F9 236,
  F10 9** — an exact match to the table in the 2026-07-24 repair plan.
  221 of 240 items carry ≥1 `engine-pending`/`design-blocked` clause (this is
  the number behind finding `sol:CAP-007`). **[VERIFIED]**
- **Real consumers:** `assertMagicItemOperationReady` reads `missingHooks` for
  its error message; `cli.ts` `buildMagicItemExecutionReadinessReport`
  (:1097) reports the census and **throws** if any magic item lacks a contract
  or has zero clauses. **[VERIFIED]**
- **Critical scope fact:** no other record kind has `executionReadiness`.
  `engine:F*` therefore describes magic-item execution, **not** corpus
  capability coverage. `eshyra-olc5` decomposes ten child epics named
  `Engine F1 … F10` from it. **[VERIFIED]**
- **Taxonomy hazard (recorded in `eshyra-olc5` notes, confirmed here):** three
  unrelated F1–F10 namespaces exist — the pack `engine:F*` families, the
  **CLOSED** epic `eshyra-2n1t`'s F1–F10, and `fable:F1..F8` audit findings.
  `eshyra-2n1t`'s closure is not evidence about `engine:F*`.
- **ADR 0020 dimensions:** deterministic capability; state integrity (via 4.7).
- **If removed today:** `assertMagicItemOperationReady` loses its input and the
  item-use path loses its only safety boundary.

### 4.9 The ADR 0019 inventory / census

- **Paths:** generator `packages/core/scripts/inventory-semi-structured-boundary.ts`;
  artifacts `docs/inventories/o9bd-18-8-8-semi-structured-boundary.{json,md}`.
- **Claims:** every string scalar/array path in every active D&D record kind and
  in the Pathfinder fixture has exactly one disposition (`complete` /
  `typed-core-with-prose-qualifier` / `model-adjudicated` / `unsupported` /
  `not-mechanical`), with a named consumer and owner.
- **Status:** **generated evidence with a real currency gate** —
  `--check` reports `inventory is current (1793 rows)`, and
  `packages/core/test/semiStructuredBoundaryInventory.test.ts:42` asserts both
  committed artifacts are byte-recomputable and pins `recordCounts`. This is
  the strongest-built artifact in the map. **[VERIFIED]**
- **Current census:** 1,793 rows — 383 `complete`, 2
  `typed-core-with-prose-qualifier`, 1,209 `model-adjudicated`, 193
  `not-mechanical`, 6 `unsupported`. **[VERIFIED]**
- **Real consumers:** the two documentation artifacts and the test. **No
  runtime consumer.** **[VERIFIED]**
- **Relies on:** ADR 0019's "exactly one disposition per candidate" rule —
  which ADR 0020 §4 / "Prior assumptions" explicitly flags for follow-up review,
  because it must not be generalized into exclusive ownership at clause,
  procedure, or capability level.
- **Residual `unsupported` families still string-typed in the pack**
  (**[VERIFIED]** by inspection — e.g. `creature:aboleth.data.savingThrows`
  = `"Con +6, Int +8, Wis +6"`, `magic-item:dwarven-thrower.data.attunementRequirement`
  = `"by a dwarf"`): `creature.data.savingThrows`, `creature.data.skills`,
  `creature/stat-block.data.senses`, `equipment.data.properties[]`,
  `magic-item.data.attunementRequirement`. **All five named owner beads are
  CLOSED** — see §6.4.
- **ADR 0020 dimensions:** source fidelity, adjudication, deterministic
  capability.
- **If removed today:** the only field-level census of what the pack does and
  does not type is lost, and the only currency-enforced generated artifact in
  the audit family disappears.

### 4.10 The freeze manifest and thaw-note gate

- **Paths:** `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json`;
  `packages/core/scripts/verify-dnd5e-srd-freeze/{cli.ts,freeze.ts}`;
  `docs/audits/dnd5e-srd-5.1-final/thaw-notes/` (55 notes).
- **Claims:** 13 frozen files match pinned SHA-256 hashes; any PR touching a
  protected path commits an active thaw note.
- **Status:** **authoritative policy whose enforcement is currently off in
  three independent ways.** **[VERIFIED]**
  1. `THAW_NOTE_CHECK_ENABLED = false` (`freeze.ts:72`), suspended by the closed
     bead `eshyra-nsd1`, to be re-enabled by the open bead `eshyra-2zyy`.
  2. The hash check **fails** on `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json`
     (expected `e333e2bc…`, actual `78512d2a…`). Because it is already red, it
     cannot distinguish new drift from accumulated thaw drift.
  3. `.github/workflows/srd-freeze-guard.yml` — the file `FROZEN_EXACT_PATHS`
     still protects — **was deleted** at commit `30bc00d` ("Remove SRD freeze
     guard workflow during re-audit"). No CI workflow invokes
     `verify:dnd5e-srd-freeze`.
- **Test coverage:** `packages/core/test/srdFreezeGuard.test.ts` exercises
  `checkHashes` / `checkThawPolicy` / `isProtectedPath` against **synthetic
  fixtures only** — it deliberately does not touch the real manifest
  (its header says so). So the suite is green while the real gate is red.
  **[VERIFIED]**
- **Consequence for `AGENTS.md`:** the Biome section requires a thaw note under
  `thaw-notes/` for frozen paths. That requirement is currently **convention
  enforced by reviewers**, not by a gate. **[VERIFIED]** This is a
  documentation/enforcement divergence, not an authority conflict — AGENTS.md
  still governs.
- **What still works:** `verify:dnd5e-srd-pack` (reproducibility) **is** wired
  into `.github/workflows/srd-importer-reproducibility.yml` on the relevant
  paths, and it passes. Reproducibility, not the freeze manifest, is the live
  guard on the pack today. **[VERIFIED]**
- **ADR 0020 dimensions:** source fidelity.
- **If removed today:** almost nothing changes operationally, because nothing
  currently runs it. That is precisely why it must be dispositioned rather than
  quietly dropped: the *policy* it encodes (a change to audited pack bytes is a
  reviewed event) is the only mechanism the repository has for that.

### 4.11 `srdAudit.ts` — the structure / coverage audit

- **Path:** `packages/core/src/rules/srdAudit.ts` (1,792 lines);
  `auditSrd`, `auditSrdStructure`, `auditSrdCoverage`.
- **Claims:** structural and source-coverage completeness — the gate whose
  categories are "pinned empty on the committed pack" (per
  `srdPlayabilityAudit.ts`'s header).
- **Real consumers:** `internal.ts:998`; `cli.ts:2344` (audit-bundle build);
  `packages/core/scripts/importers/dnd5e-srd-5.1/sourceRegionLedger.ts:29`.
  **No runtime consumer.** **[VERIFIED]**
- **Contains self-certifying allowlists:** `SRD_5_1_STANDALONE_TABLES` (:290)
  exempts specific tables from the table-reachability owner requirement. It
  currently contains `table:starting-wealth-by-class` (:294) — the fabricated
  record of finding D-1 — so the audit's own exemption list is what keeps that
  record from surfacing as an ownerless table. **[VERIFIED]** Also
  `SRD_5_1_TABLE_OWNERS`, `SRD_5_1_TABLE_ADDITIONAL_REFERRERS`,
  `SRD_5_1_RULE_DUPLICATE_CANONICAL_OWNERS`.
- **Structural limit:** the coverage gates are **source → output** only
  (every source structure must be accounted for). There is no
  **output → source** gate, which is why a compiler-authored record passes
  every one of them. This is exactly finding item 5 in the 2026-07-24 repair
  plan ("Require bidirectional, field-level reconciliation"). **[VERIFIED]**
- **ADR 0020 dimensions:** source fidelity; discovery (table reachability).

### 4.12 Runtime pack consumers (the real dependency surface)

| Consumer | Path | What it reads from the pack |
|---|---|---|
| `lookup_rules` tool | `orchestrator/toolLookupRules.ts` | Whole records by `(kind, ref)` or `(kind, name)`, plus `buildRulesRecordCard` |
| Campaign rules binding | `rules/binding.ts`, `state/campaignRecordLookup.ts` | Pack id resolution, strict stack resolution |
| Character creation / progression | `character/rulesPackResolver.ts`, `character/currency.ts`, `rules/advancementTable.ts`, `state/advancementPolicy.ts` | `class`/`subclass`/`ancestry`/`background`/`feature` structured data: `progression[].advancement`, `choices[]`, `startingEquipment`, proficiencies, `table` columns/rows |
| Encounter seeding | `state/encounterCombatants.ts:556,568` | `armorClass`, `hitPoints` only |
| Magic-item lifecycle | `state/itemState.ts` (+ `itemResetExecutor`, `itemRandomInitialization`, `itemAdoption`, `attunement`, `usageCounters`, `curseState`, `itemDepletion`, `itemTimers`) | `data.mechanics` economies/operations/effects/state machines; `data.executionReadiness` |
| Spell upcast | `orchestrator/spellUpcast.ts:391-402`, `toolSpendSpellSlot.ts` | `mechanics.effects` (S1 upcast disposition) |
| Active effects | `state/activeEffects.ts:1828-1836` | `mechanics.effects` |
| Action economy | `state/actionEconomy.ts` | activation/action-cost mechanics |
| Migration runner | `persistence/migrationRunner.ts` | pack-dir resolution only |
| Adventure modules | `adventure/listModules.ts` | mirrors pack-dir resolution |

**Not read by any production code: `mechanics.saves`, `mechanics.damage`,
`mechanics.area`, `mechanics.conditions`, `mechanics.scaling` (outside the
spell-upcast `effects` path), and `data.mechanics.ambiguities`.** **[VERIFIED
by grep across `packages/core/src` and `packages/cli/src` excluding tests.]**

**[INFERRED]** The corpus of typed spell/creature/hazard mechanics is, today,
material the DM model reads through `lookup_rules` — i.e. **discovery and
adjudication-support surface**, not execution surface. That does not make its
defects less serious. ADR 0020 §1 is explicit that an unfaithful passage placed
into context as authority is *worse* than no discovery system, and a
half-projected `mechanics` block sitting beside faithful prose is exactly that
shape.

---

## 5. Existing deterministic capability and state-kernel commitments

ADR 0020 §3 requires each capability to declare **operation, required inputs,
exclusions, revision/identity, and residual interpretation**. Below is what
today's capabilities actually declare. None declares all five.

### 5.1 Deterministic capabilities in force

| Capability | Path | Operation | Inputs | Exclusions declared? | Identity/revision? | Residual interpretation stated? |
|---|---|---|---|---|---|---|
| Dice / RNG | `orchestrator/dice.ts`, `rng.ts`, `toolRoll.ts` | seeded dice grammar | expression, seed | grammar-bounded (fails on unparseable) | no | prompt-level ("which dice apply stays YOUR ruling") |
| Check/contest/damage resolution | `orchestrator/resolution.ts`, `toolResolveCheck.ts`, `toolResolveContest.ts`, `toolResolveDamage.ts` | d20 + declared modifiers vs DC/AC; damage with typed packets | per-modifier label+source, proficiency `{bonus,multiplier}`, adv/dis booleans, resistances | yes, in prompt: "resolution tools never change state" | no | yes, in prompt |
| Derived math | `orchestrator/calc.ts`, `character/derivedValues.ts` | passive scores, capacity, jump, fall | ability scores, level | AC/attack bonuses explicitly deferred (`derivedValues.ts` → `eshyra-b69j.13`) | no | partially |
| Spell slots (F4) | `state/spellSlots.ts`, `toolSpendSpellSlot.ts` | seed/expend/restore | class progression row | **yes** — ADR 0018 §5 enumerates five prohibitions | ADR 0018 | yes |
| HP / death (F6) | `state/hpLifecycle.ts`, `toolAdjustHp.ts`, `toolRecordDeathSave.ts`, `toolStabilizeCharacter.ts` | HP, temp HP, dying, death saves | HP deltas, save rolls | partial | no | partial |
| Active effects / concentration (F3) | `state/activeEffects.ts`, `toolEndEffect.ts`, `toolResolveConcentration.ts` | effect lifecycle, concentration | effect refs, causes (`DIRECT_CONCENTRATION_BREAK_CAUSES` is a closed set) | yes for break causes | no | partial |
| Item usage / charges / attunement (F5) | `state/itemState.ts`, `usageCounters.ts`, `attunement.ts`, `itemResetExecutor.ts`, `curseState.ts` | charge spend, reset, attune, curse | pack `mechanics` + `executionReadiness` | **yes** — via `assertMagicItemOperationReady` blockers | `derived-magic-item-clauses-v1` (**the only versioned contract in the repo**) | partial |
| Rest (F7) | `state/rest.ts`, `toolRest.ts` | rest processing | clock, resources | `rule:short-rest`/`long-rest` are `unimplemented` in coverage | no | yes (registry `missing`) |
| Action economy (F2) | `state/actionEconomy.ts`, `toolBeginTurn.ts`, `toolSpendTurnResource.ts` | turn budget | budget config | partial | no | partial |
| Currency / inventory (F10) | `character/currency.ts`, `toolGainCurrency.ts`, `toolSpendCurrency.ts`, `toolConvertCurrency.ts`, `state/inventory*.ts` | ledger arithmetic, item custody | currency amounts, item ids | partial | no | partial |
| Character-build boundary | `character/characterBuild.ts` | reject multiclass-shaped state | sheet/draft | **yes, exhaustively** (ADR 0018 §7) | schema v1 | yes |

**[VERIFIED]** for every path and symbol above.
**[INFERRED]** The only capability with an explicit revision identity is the
magic-item readiness contract (`derived-magic-item-clauses-v1`). ADR 0020 §3
requires identity for every capability; today that is a one-off.

### 5.2 State-kernel invariants

| Invariant | Path | Status |
|---|---|---|
| Allowlisted writable columns; typed binding | `state/mutateState.ts:98-174` | **[VERIFIED]** single source of truth; kept in sync with `persistence/schema.ts` by hand (noted in-band as a manual coupling) |
| Atomic batch mutation with pre-commit hook | `state/mutateState.ts:220` (`mutateStateBatch`) | **[VERIFIED]** |
| State provenance | `state/mutateState.ts:233` (`getStateProvenance`) | **[VERIFIED]** |
| Migration-first schema (ADR 0015) | `persistence/migrationRunner.ts`, `schema.ts`; tests `migrationRunner.test.ts`, `migrationLegacyAdoption.test.ts` | **[VERIFIED]** |
| Checkpoint / Dolt separation (ADR 0012/0015) | `persistence/checkpoint/{separation,store,serialize,doltRepo}.ts`; 9 test files | **[VERIFIED]** |
| Single production tool registry | `orchestrator/tools.ts` `createDefaultToolRegistry()` | **[VERIFIED]** — `docs/audits/2026-07-12-f3-mutation-lifecycle-audit.md` establishes there is exactly one, by enumeration |
| Fail-closed single-class build (ADR 0018 §7) | `character/characterBuild.ts:16,22,111` | **[VERIFIED]** `MULTICLASS_UNSUPPORTED` / `UnsupportedCharacterBuildError` present |
| Retired placeholder pack id fails loudly (ADR 0013 §3) | `toolLookupRules.ts:145-153` | **[VERIFIED]** |
| Ambiguous name lookup never silently picks (ADR 0013 §2) | `rules/lookup.ts`, `toolLookupRules.ts:184-190` | **[VERIFIED]** returns `ambiguous` with `candidateKeys` |

ADR 0020 explicitly does not weaken any of these. **None of them depends on a
pack-wide completeness claim.** **[INFERRED]** — each is a positive, locally
verifiable property, which is why they survive the withdrawal of global closure
untouched.

---

## 6. Defect and finding map

**Nothing here is closed, retired, or reclassified.** Each entry records the
original finding, the violated invariant, the evidence, the affected
membership where established, producers and consumers, the applicable ADR 0020
dimensions, the current owner, and the unresolved decision.

Dimension abbreviations: **SF** source fidelity · **DI** discovery ·
**AD** adjudication support · **DC** deterministic capability ·
**SI** state integrity.

### 6.1 Verified-live defects (re-derived in this session)

---

**D-1 — Compiler-authored record carrying SRD provenance and licence**

- **Original finding:** `fable:F1` "unsupported Starting Wealth table";
  `sol:CAP-009`/`opus:F-19` are the adjacent source-authority findings; also
  recorded in the 2026-07-24 audit as the single HIGH item.
- **Violated invariant:** ADR 0007 §1 ("Authoritative rules-pack content is
  produced by deterministic code running over licensed source material") and
  §3 ("Filling gaps the source artifact does not contain"). ADR 0001's
  licence posture.
- **Authoritative evidence:**
  - Producer: `packages/core/scripts/importers/dnd5e-srd-5.1/emit.ts:126-130`
    — a hard-coded 12-row literal, with the comment
    `/** Source-backed p. 38 Starting Wealth by Class table. */`; appended at
    `emit.ts:1628`.
  - Emitted record `table:starting-wealth-by-class` carries
    `"source": "SRD 5.1 p. 38"` and the full CC-BY-4.0 SRD attribution block.
  - **The string "Starting Wealth" does not occur anywhere in the extracted
    403-page SRD 5.1 text.** Verified against
    `/mnt/d/audit-bundle/pdf-text/all-pages.txt`, whose recorded source
    `sha256 = 2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`
    is byte-identical to the currently vendored PDF.
  - Page 38 of that source is **Ranger (Hunter) subclass features** — Giant
    Killer, Horde Breaker, Defensive Tactics, Uncanny Dodge. Not a wealth table.
  - `validateRulesPack` accepts it: `assertProvenanceMatchesPackSource` checks
    only `sourceRef` identity, never locator truth. Empirically confirmed by
    rewriting `equipment:battleaxe`'s locator to `p. 9999` — **accepted**.
  - `srdAudit.ts:294` lists it in `SRD_5_1_STANDALONE_TABLES`, exempting it from
    the table-reachability owner requirement.
  - The thaw note `thaw-notes/2026-07-12-eshyra-2n1t-10-starting-wealth-table.md`
    asserts "The importer now emits the **source-backed**
    `table:starting-wealth-by-class` projection from the SRD p. 38 Starting
    Wealth by Class table" — a self-certification contradicted by the source.
- **Affected membership:** exactly one record, `table:starting-wealth-by-class`
  (12 rows). **[VERIFIED exact.]**
- **Real producers/consumers:** produced by `emit.ts`; consumed at runtime by
  `character/srdStartingWealth.ts` and `character/finalizeCharacter.ts:270-347`,
  and surfaced in the CLI wizard (`packages/cli/src/characterWizard.ts:723-789`).
  **This is a live gameplay path.**
- **Dimensions:** **SF** (primary), **AD** (the DM can retrieve it as SRD
  authority via `lookup_rules`), **DC** (a deterministic character-creation
  path computes from it).
- **Concerns:** source loss / **source invention**; and a licence-attribution
  question that is not a code question.
- **Current owner:** `eshyra-o9bd.19.2.1` ("Correct unsupported and
  compiler-authored source claims") — OPEN.
- **Unresolved decision under ADR 0020:** ADR 0020 §1 makes source fidelity
  *more* load-bearing, not less. **[QUESTION]** Does the correct disposition
  keep the mechanic (as explicitly-labelled supplemental non-SRD content with a
  distinct source and licence identity, per repair-plan item 4), remove it, or
  route starting wealth to campaign-owned content? This map does not decide it.
  **[QUESTION]** Independently: what output→source gate would have caught it,
  given that every existing gate is source→output?

---

**D-2 — Readiness "finding" and coverage-ownership pointers all name closed beads**

- **Original finding:** not a numbered audit finding; discovered in this
  session. Related in kind to `sol:CAP-014` ("readiness artifacts contradict
  corpus") and `opus:F-21` ("zero-finding metadata contradicts readiness").
- **Violated invariant:** the registries' own contracts.
  `GameplayReadinessDispositionPolicyEntry` documents `finding` as
  "deterministic modeling is owed and `bead` names **the open issue** that will
  drive the bucket to zero" (`cli.ts:1066` doc-comment).
  `ENGINE_PROCEDURE_COVERAGE`'s `externalClauses` doc says "bead closure alone
  never auto-upgrades it" — but the inverse case, a closed bead leaving a row
  ownerless, is unhandled.
- **Authoritative evidence (all statuses re-checked in this session):**

  | Registry entry | Records/rows | Named bead | Bead status |
  |---|---|---|---|
  | `equipment#partial-structure` | 7 | `eshyra-o9bd.18.7.6` | **CLOSED** |
  | `equipment#prose-only` | 67 | `eshyra-o9bd.18.7.6` | **CLOSED** |
  | `hazard#prose-only` | 1 | `eshyra-o9bd.18.7.7` | **CLOSED** |
  | `rule#partial-structure` | 32 | `eshyra-o9bd.18.7.8` | **CLOSED** |
  | `rule#prose-only` | **303** | `eshyra-o9bd.18.7.8` | **CLOSED** |
  | `ENGINE_PROCEDURE_COVERAGE` design-blocked ×10 | 10 rows | `eshyra-2n1t.1` (8), `eshyra-2n1t.2` (2) | **CLOSED** (resolved into ADR 0018 / D2 — disposition still valid, pointer stale) |
  | `ENGINE_PROCEDURE_COVERAGE` externalClauses ×7 | `armor-guidance`, `casting-a-spell-saving-throws`, `charges`, `special-weapons`, `spells`, `telepathy`, `weapon-properties` | `b69j.13`, `18.7.7.2`, `18.7.7.1`, `18.7.8.3`, `18.7.7`, `18.7.9`, `18.7.8.3` | **all CLOSED** |

- **Affected membership:** 410 records across the five `finding` buckets
  (7+67+1+32+303); 17 coverage rows. **[VERIFIED exact against the pack.]**
- **Producers/consumers:** the audit-bundle build and tests. No runtime effect.
- **Dimensions:** **DC**, **AD**. Also **DI** for `rule#prose-only`: 303 rule
  records classified as pending are precisely the material an
  awareness-oriented pack must surface well.
- **Concerns:** an obsolete global claim (bucket→zero) *and* live discovery /
  adjudication-support obligations underneath it.
- **Current owner:** no single bead. `eshyra-o9bd.19.1.5` ("Replace audit gates
  with clause-level completeness and a permanent finding registry") is the
  nearest, and it is repointed behind F1 (`eshyra-o9bd.19.1.14`).
- **Unresolved decision under ADR 0020:** **[QUESTION]** Under §7, does a
  `finding` disposition whose global claim ("drive the bucket to zero") is
  withdrawn get *retired with a named replacement responsibility*, or *reshaped*
  into a discovery obligation for those 410 records? §7 requires that retiring
  the claim must not conceal an underlying defect — so the 303 prose-only rule
  records need an answer either way. **[QUESTION]** Should a validator check
  bead existence/status, or is a bead pointer the wrong durable anchor
  (the handoff's question 6: "what identity persists after a finding is
  repaired?").

---

**D-3 — 197 records fall into no readiness bucket**

- **Original finding:** not numbered; adjacent to `sol:CAP-001` ("rule corpus
  not executable") and the ADR 0020 §3 prohibition on treating "not recognized"
  as satisfied.
- **Violated invariant:** the fail-closed promise of
  `assertGameplayReadinessDispositions` — "a non-empty bucket without an entry
  fails the bundle build … so a future audit can never silently rediscover (or
  silently lose) a broad readiness bucket" (`cli.ts:1066` doc-comment).
- **Authoritative evidence:** re-implementing the exact predicates
  (`hasStructuredChoices`, `hasDeterministicGrants`, `hasMechanicsProjection`,
  `hasPartialStructure`, `hasProse`, `cli.ts:849-1006`) over the committed pack
  yields **197 records** that are not "modeled" and match no bucket:
  **109 `equipment`, 87 `table`, 1 `stat-block`.**
  Archetype: `equipment:battleaxe` — `category`, `cost`, `damageDie`,
  `damageType`, `properties[]`, `weaponProperties[]`, `weaponCategory`,
  `weaponRange`, `weight`, and **no** `description`. None of those field names
  appears in any predicate. Similarly `table:*` records carry `columns`/`rows`,
  which `hasPartialStructure` does not test (it tests `tableRefs`).
- **Mitigation that partially covers this:** all 218 `equipment` records are
  separately reviewed by `EQUIPMENT_MECHANICS_REVIEW`
  (`cli.ts` equipment census: 218 total, 174 mechanically active, 117 complete
  typed payloads, 4 model-adjudicated qualifiers, 44 non-mechanical, 0
  unresolved findings), and `table` records have their own reachability report.
  **[VERIFIED]** So the 87 tables + 1 stat-block are the genuinely
  uncovered-by-any-membership-registry remainder. **[INFERRED]**
- **Dimensions:** **DC**, **DI**.
- **Concerns:** an obsolete global claim (the bucket mechanism was never a
  partition) plus a real visibility gap.
- **Current owner:** none.
- **Unresolved decision:** **[QUESTION]** ADR 0020 §4 rejects partitions of the
  rules universe. Should the bucket mechanism be narrowed to an explicitly
  *non-exhaustive* signal set with that stated in-band, or replaced by
  per-kind membership registries of the `EQUIPMENT_MECHANICS_REVIEW` shape?

---

**D-4 — Clause-incomplete typed projections read as fully modeled**

- **Original finding:** `indep:001`/`SOL-001` "atom presence mistaken for
  complete procedures"; `opus:F-25` "79 creature + 8 hazard half-damage
  branches omitted"; `opus:F-32` "multi-save entries type only first save";
  `sol:CAP-003`/`CAP-004`.
- **Violated invariant:** ADR 0017 §2 (the pack must carry semantics a
  deterministic owner can consume "without re-deriving meaning from prose") and
  ADR 0020 §3 ("a deterministic operation does not imply a complete record").
- **Authoritative evidence — the canonical worked example:**
  `creature:adult-black-dragon` → `data.actions[]` "Acid Breath (Recharge 5–6)".
  Its `text` says *"taking 54 (12d8) acid damage on a failed save, **or half as
  much damage on a successful one**."* Its `mechanics` is:
  ```json
  { "recharge": {"roll":"d6","minimum":5,"maximum":6},
    "saves":    [{"ability":"dexterity","dc":18}],
    "damage":   [{"average":54,"dice":"12d8","type":"acid"}] }
  ```
  There is **no** `damageOnSuccess: "half"` and no success branch on the damage
  entry. **[VERIFIED]** Because the entry has a `mechanics` object it counts as
  one of the 1,478 `entriesWithMechanics`, so the readiness report shows
  **`mechanicalProse: 0`** while the clause is wrong. **[VERIFIED]**
- **Second worked example:** `spell:fireball` has `saves[0].damageOnSuccess =
  "half"` and `damage` and `scaling.perSlot` — and **no `mechanics.area`**,
  despite "a 20-foot-radius sphere" in its prose. It is counted among the 307
  `spellsWithDeterministicEffects`. Only **16 of 319** spells carry
  `mechanics.area`; **58** spells describe an area shape in prose without one.
  (This is `fable:F2` "point-origin areas absent" / `opus:F-08`.) **[VERIFIED]**
- **Affected membership — deliberately not asserted as a number.** A
  half-on-success prose predicate over the committed pack returns 82
  records (74 creature/stat-block + 8 hazard) whose prose contains the phrase,
  of which 32 have at least one typed `damageOnSuccess: "half"` somewhere and
  89 records have none typed under a broader traversal. These numbers do not
  match the audit's "79 + 8" and **should not be reconciled by picking one** —
  `eshyra-o9bd.19.1.6` explicitly requires a generated membership query, and
  `eshyra-o9bd.19.7` names count-pinning as the third recurring failure idiom.
  What is established is that the **defect family is live**, with a named,
  reproducible instance. **[VERIFIED for the instance; membership OPEN.]**
- **Real producers/consumers:** produced by the creature/spell mechanics
  projectors. **Consumed by no production code** — see §4.12. The consumer is
  the DM model reading the record through `lookup_rules`.
- **Dimensions:** **SF** (the typed layer misrepresents the source clause),
  **AD** (primary — a truncated projection beside faithful prose is misleading
  authority), **DI** (an area that is not projected is not filterable or
  retrievable by geometry), **DC** (would become an execution defect the moment
  any engine consumes these fields).
- **Concerns:** adjudication support and source representation — **not**, today,
  bounded-capability correctness, because nothing executes it.
- **Current owner:** `eshyra-o9bd.19.4.2`, `.19.4.3` (creatures), `.19.4.1`
  (spells), `.19.4.4` (hazards) — all OPEN, all repointed behind F1
  (`eshyra-o9bd.19.1.14`).
- **Unresolved decision:** **[QUESTION]** ADR 0020 withdraws the global
  executability claim but not the fidelity claim. Is a partially-typed
  `mechanics` block that contradicts its own `text` a *fidelity* defect
  requiring repair, or should partial projections carry an explicit in-band
  incompleteness marker so the DM is told what the projection omits?
  ADR 0020 §5 item 5 ("capability availability *and limits*") points at the
  second, but that is a design decision, not made here.

---

**D-5 — `RulesRecord.data` is `unknown`; kind validators accept unregistered fields**

- **Original finding:** recorded in ADR 0020 Context and in
  `eshyra-o9bd.19.7` question 10 as the reason PR #477's absence proof failed.
- **Violated invariant:** none — this is a *design property*, and the finding is
  that it makes a class of claim unprovable.
- **Authoritative evidence:** `packages/core/src/rules/types.ts:135` —
  `readonly data: unknown`. Empirically: injecting
  `data.totallyMadeUpField = { nonsense: true }` into `spell:fireball` and
  calling `validateRulesPack` → **accepted**. **[VERIFIED]**
- **Dimensions:** **SF**, **DC**, **AD**.
- **Concerns:** an obsolete global claim. ADR 0020 Alternatives §1 records this
  as the decisive reason global deterministic closure was withdrawn.
- **Current owner:** `eshyra-o9bd.19.1.14` (F1) and `eshyra-olc5.3`/`.4`
  ("Certify clause-complete absence for bootstrap source-negative blockers") —
  OPEN.
- **Unresolved decision:** **[QUESTION]** The handoff's only sound position was
  "unclassified structured material must remain UNDERIVED, never absent." Is
  `underived` a status the pack should carry in-band, or a property of an
  external registry? Not decided here.

---

**D-6 — The freeze gate is off in three independent ways**

- Evidence and detail in §4.10. Summarised here so it is preserved as a defect,
  not only as an artifact description.
- **Violated invariant:** `docs/audits/dnd5e-srd-5.1-final/README.md`'s stated
  freeze protection; `AGENTS.md`'s thaw-note requirement for frozen paths.
- **Dimensions:** **SF**.
- **Concerns:** an obsolete global claim (the artifact is thawed by decision)
  **and** a live source-fidelity control gap: with the hash check red and CI
  removed, an accidental pack edit produces no distinct signal.
  Reproducibility (`verify:dnd5e-srd-pack`, wired in CI, passing) is the
  remaining guard, and it catches hand-edits — but not a compiler change that
  regenerates consistently, which is exactly D-1's shape. **[INFERRED]**
- **Current owner:** `eshyra-2zyy` (re-enable thaw gating at re-freeze) and
  `eshyra-o9bd.14` (regenerate + re-freeze) — both OPEN, both explicitly
  blocked on `eshyra-o9bd.19`.
- **Unresolved decision:** **[QUESTION]** ADR 0020 withdrew the closure claim
  that `eshyra-o9bd.14`'s re-freeze bar was written against. What is the
  re-freeze bar now? Until that is answered, both beads are blocked on a gate
  whose definition no longer exists.

---

**D-7 — The 2026-07-24 finding corpus is not repository data**

- **Original finding:** repair-plan item 8 ("Make audit findings durable
  project data"); bead `eshyra-o9bd.19.1.6`.
- **Authoritative evidence:** the finding-to-bead coverage matrix — 12
  `indep:*`, 24 `opus:F-*`, 11 amended `opus:F-*`, 14 `sol:CAP-*`, 8 `fable:F*`
  (≈69 findings) plus the engine-gap tables — exists in
  `/mnt/d/eshyra-2026-07-24-audit-repair-bead-plan.md`, **outside the
  repository**, and in bead descriptions. PR #476's `finding-registry.json`
  (70 aliases, statuses, owners, provenance) was **closed unmerged**;
  `eshyra-o9bd.19.7` classifies it `SALVAGE_AFTER_EXTRACTION` and notes the
  membership fields must be REPLACED. **[VERIFIED]**
- **Dimensions:** all five, indirectly — this is the instrument that keeps the
  others honest.
- **Concerns:** loss of defect corpus.
- **Current owner:** `eshyra-o9bd.19.1.15` (F2, "truthful audit-fact registry
  without executable membership claims") — OPEN, and explicitly parallel-safe
  because it makes no executable membership claim.
- **Unresolved decision:** **[QUESTION]** F2 is unblocked today. Should it land
  before the ADR 0020 transition design, so the transition has an enumerable
  defect corpus to disposition against? ADR 0020 §7 requires every finding to
  receive an explicit disposition; that is not possible while the corpus is not
  in the repository.

---

**D-8 — ADR 0019 residual families: owners closed, residuals unconverted**

- **Original finding:** ADR 0019 §"Current repository inventory" states five
  explicit residual `unsupported` families and asserts "No new bead is created:
  these owners already exist."
- **Authoritative evidence:** all five owners are **CLOSED** —
  `eshyra-o9bd.18.7.9.15` (savingThrows/skills/senses),
  `eshyra-o9bd.18.7.6` (`equipment.data.properties[]`),
  `eshyra-o9bd.18.7.7.1` / `eshyra-o9bd.18.7.7`
  (`magic-item.data.attunementRequirement`). The residuals are still strings:
  `creature:aboleth.data.savingThrows = "Con +6, Int +8, Wis +6"`;
  `magic-item:dwarven-thrower.data.attunementRequirement = "by a dwarf"`;
  `equipment:battleaxe.data.properties = ["Versatile (1d10)"]`. **[VERIFIED]**
- **Note:** `equipment.data.properties[]` has a *parallel* typed projection
  (`weaponProperties[]`) on the same record, so this family is partially
  addressed in practice while remaining `unsupported` in the census.
  **[VERIFIED]**
- **Dimensions:** **SF**, **AD**, **DC**.
- **Current owner:** none live. ADR 0020 names ADR 0019 as requiring follow-up
  review.
- **Unresolved decision:** **[QUESTION]** ADR 0020 §4 says the
  "exactly one disposition per candidate" rule must not generalize into
  exclusive ownership. Does that also change what `unsupported` means when a
  parallel typed projection exists on the same record (the
  `properties[]`/`weaponProperties[]` case)?

---

**D-9 — Latent fail-opens (no current instance, structurally present)**

| # | Location | Fail-open | Current instances |
|---|---|---|---|
| a | `cli.ts:964` `hasMechanicsProjection` | `mechanics: {}` marks a record modeled | 0 **[VERIFIED]** |
| b | `itemExecutionReadiness.ts:19-31,76` `inSelectedScope` | a clause with an unrecognized `scope.kind` is silently skipped and cannot block | 0 **[INFERRED from pack shape]** |
| c | `ruleDispositions.ts:2935,2983` census pins | count-pinned; any equal-size reclassification passes | n/a — structural |
| d | `ruleDispositions.ts` `contextRequirement`, `missing` | free-text fields that a validator requires but never reads | 126 rows carry one |

All four are instances of the idioms `eshyra-o9bd.19.7` enumerates.
**[INFERRED]** They are reported as defects rather than notes because ADR 0020
§3 states that a predicate reading an unrecognized item as satisfied "is a
defect, not a green," irrespective of whether an instance exists today.

### 6.2 Findings carried forward but not re-derived here

The following are recorded in the finding corpus and remain open obligations.
They were **not** independently re-verified in this session; the citation is
the finding, not a fresh proof. Listing them is required by ADR 0020 §7.

| Finding | Substance | Dimensions | Owner bead (all OPEN) |
|---|---|---|---|
| `indep:008` | 23 incomplete locators | SF | `eshyra-o9bd.19.2.2` |
| `indep:009` | ambiguous/unresolved coverage counted as complete | SF, DI | `eshyra-o9bd.19.1.13` |
| `indep:011`, `opus:F-13` | falsely closed language universe; free-text proficiency grants | DC, AD | `eshyra-o9bd.19.3.3` |
| `opus:F-02` | four Pit variants collapsed | AD, DC | `eshyra-o9bd.19.4.4` |
| `opus:F-03`/`F-04`/`F-05`/`F-06`/`F-24` | Indomitable scaling, Arcane/Natural Recovery resets, phantom feature resources, Divine Sense uses | DC | `eshyra-o9bd.19.3.2` |
| `opus:F-07` | Eldritch Invocation effects hoisted to parent | AD, DC | `eshyra-o9bd.19.3.1` |
| `opus:F-11` | Magic Missile base projectile count missing | AD, DC | `eshyra-o9bd.19.4.1` |
| `opus:F-22`, `fable:F8` | duplicate display names unqualified; rule keying/duplication hygiene | DI | `eshyra-o9bd.19.2.4` |
| `opus:F-26` | legendary budget and action costs unmodeled | DC | `eshyra-o9bd.19.4.3` |
| `opus:F-27`, `F-33`, `F-35` | mutually exclusive alternatives flattened; lost DCs; truncated targeting qualifiers | AD, DC | `eshyra-o9bd.19.4.2`/`.4.3` |
| `opus:F-29` | Unicode-minus damage silently dropped | SF | `eshyra-o9bd.19.4.2` |
| `opus:F-30` | Wererat Hand Crossbow swallowed | SF | `eshyra-o9bd.19.2.2` |
| `sol:CAP-002` | condition/action/feat structural gaps — **marked NARROWED** in `eshyra-o9bd.19.1.6`; implementing it literally would regress already-correct typed condition effects | AD | `eshyra-o9bd.19.3.4` |
| `sol:CAP-007` | 221 magic items blocked by engine — **[VERIFIED count]** | DC | `eshyra-olc5.*` |
| `sol:CAP-010` | structured fields omit actual source provenance | SF | `eshyra-o9bd.19.1.3` |
| `sol:CAP-011` | DM discovery / canonical relationships inadequate — **the finding that ADR 0020 §5 elevates to first-class** | DI | `eshyra-o9bd.19.2.4` |
| `fable:F4`, `F5`, `F6`, `F7` | container continuation under-citation; synthesized table headers; inconsistent empty cells; synthesized choice `sourceText` labels | SF | `eshyra-o9bd.19.2.1`/`.2.3` |
| Fable language-set conclusion | recorded in `eshyra-o9bd.19.1.6` as an **adjudication/policy** issue, not a projection defect | AD | `eshyra-o9bd.19.1.6` |
| Three SRD ambiguities | deliberately unresolved; must be regression-tested as unresolved, **not** converted to engine defects | AD | `eshyra-jhpt.6`, `eshyra-jhpt.7` (both OPEN) |

### 6.3 Design-invalidated work (preserved, not defects in itself)

`eshyra-o9bd.19.7` records that PRs **#475**, **#476**, **#477** were closed
unmerged as DESIGN_INVALIDATED on 2026-07-27, branches preserved on origin,
with one shared root cause: *unsettled concepts generalized across the corpus
before their trust boundaries were proven*. Its salvage matrix (which artifacts
are `SALVAGE_AS_IS` / `SALVAGE_AFTER_EXTRACTION` / `DESIGN_INPUT_ONLY` /
`DISCARD` / `REPLACE`) is the authority on what survives. Two items need
extraction before their branches age out, per the bead's own notes:

- `2n1t-engine-closure-reconciliation.md` from #477 — `SALVAGE_AS_IS`, reviewed
  and accepted, **"EXTRACT FIRST so it does not die here"**, and the bead's
  notes record it was **not** done in the F1 design session.
- The adversarial test cases from #475 (`clauseIrContracts.test.ts` T1–T8, the
  base-requirement removal matrix) — directly reusable as F1 acceptance tests.

Unpushed branch `eshyra-o9bd.19.1.1.6` holds commit `7f38879`, deliberately not
pushed, not to be pushed or built on.

### 6.4 Bead-status ledger for every ownership pointer checked

| Bead | Referenced by | Status |
|---|---|---|
| `eshyra-o9bd.19` | epic; ADR 0020 §Bead | OPEN |
| `eshyra-olc5` | epic; ADR 0020 §Bead | OPEN |
| `eshyra-o9bd.19.7` | handoff | OPEN |
| `eshyra-o9bd.19.1.14` (F1) | successor start point | IN_PROGRESS |
| `eshyra-o9bd.19.1.6` (finding registry v1) | `eshyra-o9bd.19.1.15` supersedes | IN_PROGRESS |
| `eshyra-o9bd.19.5.1` (bootstrap ledger) | PR #477 | IN_PROGRESS, design-invalidated |
| `eshyra-o9bd.14`, `eshyra-2zyy` | re-freeze gates | OPEN |
| `eshyra-o9bd.16` | final re-audit | OPEN |
| `eshyra-bv68`, `eshyra-s38f` | obligation registry / source census | OPEN |
| `eshyra-jhpt.6`, `eshyra-jhpt.7` | the three SRD ambiguities | OPEN |
| `eshyra-jued` | sibling discovery-substrate map | IN_PROGRESS |
| `eshyra-nsd1` | disabled the thaw-note gate | **CLOSED** |
| `eshyra-o9bd.18.7.6` / `.18.7.7` / `.18.7.7.1` / `.18.7.7.2` / `.18.7.8` / `.18.7.8.1` / `.18.7.8.3` / `.18.7.9` / `.18.7.9.15` / `.18.8.8` | readiness + coverage + ADR 0019 owners | **all CLOSED** |
| `eshyra-2n1t.1` / `.2` | `design-blocked` owners; resolved into ADR 0018 / D2 | **CLOSED** |
| `eshyra-b69j.13` | `armor-guidance` external clause | **CLOSED** |

---

## 7. Negative-claim and fail-open risks

ADR 0020 §3 forbids reading "unbound", "unclassified", or "not recognized" as
satisfied. Ranked by how load-bearing the negative claim is.

| # | Negative claim in force | Where | Rests on | Risk |
|---|---|---|---|---|
| 1 | "Every not-yet-modeled record has a reviewed disposition" | `assertGameplayReadinessDispositions` | the bucket predicates being exhaustive | **Broken today**: 197 records match no bucket (D-3). |
| 2 | "Every readiness gap has a live owner" | `finding.bead`, `designOwner`, `externalClauses.bead` | a bead-shaped string | **Broken today**: every pointer names a closed bead (D-2). |
| 3 | "No record contains unimplemented mechanics" | withdrawn by ADR 0020; still implied by the `eshyra-olc5` nine-point GREEN and the "zero engine-pending at re-freeze" bar | `data: unknown` with no closed schema | Unprovable (D-5). The beads still record it. |
| 4 | "The frozen artifact has not drifted" | freeze manifest | a hash check that is red and a CI job that was deleted | **Non-operative** (D-6). |
| 5 | "Every record's content is source-backed" | ADR 0007 §1, `assertProvenanceMatchesPackSource` | `sourceRef` identity equality only | **Broken today** (D-1); no output→source gate exists. |
| 6 | "The corpus contains no unrecognized structured fields" | never claimed in code; assumed by absence-style reasoning | kind validators | Validators accept unregistered fields (D-5, **[VERIFIED empirically]**). |
| 7 | "`mechanicalProse: 0` means no residual mechanical prose" | readiness report | an entry having *any* `mechanics` object | Misleading: the dragon breath clause (D-4) is inside a `mechanics` object and is wrong. |
| 8 | "Class census stability implies classification stability" | `EXPECTED_*_CENSUS` | counts | Count-pinned (D-9c). |
| 9 | "The engine capability picture is `engine:F1`–`F10`" | `eshyra-olc5` decomposition | pack `executionReadiness` | Scoped to 240 magic-item records only (§4.8). Not a corpus claim. |
| 10 | "Zero-finding audits mean the corpus is clean" | `opus:F-21`, `sol:CAP-014` | each audit's own declared categories | Every audit in §4 is honest in-band about its scope; the risk is in reading their aggregate as coverage. |

**[INFERRED]** Items 1, 2, 5, and 7 share one shape: a gate whose *recognizer*
is narrower than the population it reports on, so non-recognition is silently
equivalent to satisfaction. That is the handoff's recurring idiom (1) and
ADR 0020 §3's prohibition, expressed at four different layers.

---

## 8. Current producer–consumer dependencies

### 8.1 Compile-time / build-time

```
SRD_CC_v5.1.pdf (sha256 2504d2a0…, 403 pp)
  → extract.ts → PageText[]
  → sections.ts + source-inventory / source-coverage / source-region-ledger
  → parse*.ts + curated specs (document tables, class progression,
                               magic-item clause registry)
  → mechanicsProjections.ts, magicItemPassiveEffects.ts, emit.ts
      ├─ emit.ts:127 startingWealthTable()   ← D-1: NOT source-derived
      └─ derived-magic-item-clauses-v1 executionReadiness (magic-item only)
  → validateRulesPack → manifest.json + records.json  (1,813 records)
```

Verification consumers of that output:

| Consumer | Invoked by | Enforced? |
|---|---|---|
| `verify:dnd5e-srd-pack` | `.github/workflows/srd-importer-reproducibility.yml` (path-gated) | **Yes — passing** |
| `verify:dnd5e-srd-freeze` | nothing | **No** — see D-6 |
| `audit-bundle:dnd5e-srd` (`cli.ts`) → `srdAudit`, `srdPlayabilityAudit`, `srdChoiceProseAudit`, `srdEquipmentResolutionAudit`, `assertRuleDispositions`, `assertGameplayReadinessDispositions`, magic-item readiness | manually, plus `npm test` for the individual modules | Partially — the module tests run in CI; the bundle build does not |
| `inventory-semi-structured-boundary.ts --check` | `packages/core/test/semiStructuredBoundaryInventory.test.ts` | **Yes** |

### 8.2 Runtime

```
records.json
  → packLoader.loadRulesPackFromDirectory → validateRulesPack
  → bundledSrdPack.getBundledDnd5eSrdPack()   [lazy + cached]
      ├─ rules/binding.ts + state/campaignRecordLookup.ts   (campaign stack)
      ├─ orchestrator/toolLookupRules.ts   → lookup_rules  [exact kind+name/ref]
      ├─ character/rulesPackResolver.ts    → creation & progression
      ├─ rules/advancementTable.ts, state/advancementPolicy.ts
      ├─ character/currency.ts, character/srdStartingWealth.ts  ← D-1 path
      ├─ state/encounterCombatants.ts      → armorClass, hitPoints
      └─ state/itemState.ts:1888 → assertMagicItemOperationReady
                                     ← data.executionReadiness (engine:F1..F10)
orchestrator/contextAssembler.ts   → NO pack material in per-turn context
orchestrator/turnAuditor.ts        → model-judged post-hoc missing-call detection
```

**[VERIFIED]** for every edge. Two consequences worth stating plainly:

- The **only** pack semantics that reach deterministic execution are
  character-build data, magic-item mechanics/readiness, `mechanics.effects`
  (spell upcast + active effects), action-economy data, and creature
  `armorClass`/`hitPoints`.
- The **only** pack material that reaches the DM model is what the model itself
  asks for, one exact record at a time, through `lookup_rules`.

### 8.3 Documentation ↔ artifact coupling

| Document | Generated artifact it describes | Currency enforced? |
|---|---|---|
| ADR 0019 | `docs/inventories/o9bd-18-8-8-*` | **Yes** (`--check` + test) — though the ADR's own prose counts are historical |
| `README.md` (audit sign-off) | the pack at `0f5b3dc` | No — describes a superseded artifact |
| `mechanics-projection-report.md` | pack at 2026-06-30 | No |
| `freeze-manifest.json` | 13 frozen files | Gate exists, **not run** |
| `2026-07-06-o9bd-18-7-8-*` classification artifacts | `RULE_DISPOSITIONS` / `ENGINE_PROCEDURE_COVERAGE` | No — transcription is by hand, with an in-band instruction to "regenerate via the same parse", which nothing runs |
| `/mnt/d/eshyra-2026-07-24-audit-repair-bead-plan.md` | the finding corpus | **Not in the repository** (D-7) |

---

## 9. Decisions the transition program must make

Stated as questions with the evidence that constrains each. **None is answered
here.**

1. **What replaces the re-freeze bar?** `eshyra-o9bd.14` and `eshyra-2zyy` are
   blocked on `eshyra-o9bd.19`, whose closure condition was the zero-engine-pending
   claim ADR 0020 withdrew. Until a new bar exists, three open beads are blocked
   on a definition that no longer holds, and the freeze gate stays off (D-6).
2. **How is the 2026-07-25 nine-point GREEN definition amended?** It is still
   recorded verbatim in `eshyra-olc5`'s notes, including "AT RE-FREEZE THERE
   MUST BE ZERO ENGINE-PENDING DETERMINISTIC CLAUSES." ADR 0020's "Prior
   assumptions" item 4 requires reassessment. Points 1–3 and 7–9 of the nine
   look compatible with bounded capabilities; points 5–6 encode the global
   reference-engine claim.
3. **Should F2 (`eshyra-o9bd.19.1.15`, truthful audit-fact registry) land
   before the transition design?** It is parallel-safe by construction and it is
   the only path to an enumerable defect corpus, which ADR 0020 §7's explicit
   dispositions require (D-7).
4. **What is the disposition of the readiness bucket mechanism?** ADR 0020
   §Consequences requires it be "confirmed, narrowed, repurposed, or retired
   **with reasons**." Its membership registries are load-bearing; its bucket
   partition is not exhaustive (D-3) and its finding pointers are dead (D-2).
   Those three parts may deserve different answers.
5. **What is the disposition of `RULE_DISPOSITIONS` / `ENGINE_PROCEDURE_COVERAGE`?**
   Note the split inside `design-blocked`: the multiclass rows are an ADR 0018
   obligation to keep reporting; the `externalClauses` rows are orphaned. Note
   also that ADR 0020 §7 makes decisions at procedure/operation level, which is
   what `ENGINE_PROCEDURE_COVERAGE` already does — it may be the closest
   existing thing to a bounded-capability register.
6. **What is a deterministic capability's declared identity and exclusions?**
   ADR 0020 §3 requires five fields. Only the magic-item contract has a
   revision (`derived-magic-item-clauses-v1`); only ADR 0018 §5 and
   `characterBuild.ts` state exclusions exhaustively (§5.1).
7. **Does D-1's mechanic survive, and under what source identity?** And what
   output→source gate replaces the source→output-only coverage model?
8. **How should partial projections declare their own limits?** ADR 0020 §5
   item 5 requires context packets to carry "capability availability *and
   limits*"; D-4 is the case that needs it.
9. **What is `engine:F1`–`engine:F10` after the transition?** It is real
   generated evidence about 240 magic items and the input to the one live
   runtime gate — and `eshyra-olc5` decomposes ten epics from it as if it were
   a corpus inventory.
10. **How do the three `RulesAmbiguity` records reach the DM?** They are
    validated, reported, and owned (`eshyra-jhpt.6`/`.7`) but have no runtime
    consumer. ADR 0020 §5 item 5 names "known ambiguity" as context-packet
    content.
11. **Does ADR 0019's one-disposition-per-candidate rule change?** ADR 0020
    requires the follow-up review and forbids generalizing it to clause,
    procedure, or capability level. The `properties[]` / `weaponProperties[]`
    case (D-8) is a concrete test.
12. **What durable identity survives a repaired finding?** `eshyra-o9bd.19.7`
    question 6 records that the durable-obligation / transient-violation split
    "IS SOUND AND SHOULD SURVIVE" while its membership did not. D-2 is the same
    question at the registry level.

---

## 10. Evidence gaps and uncertainties

1. **Exact membership of D-4 is not established.** Deliberately. Different
   predicates give different counts (this session: 82 records matching the
   half-on-success prose phrase; the audit says 79 + 8). `eshyra-o9bd.19.1.6`
   requires a generated membership query; picking a number would repeat the
   failure it was written to prevent.
2. **The finding corpus was read from outside the repository.** Section 6.2 is
   transcribed from `/mnt/d/eshyra-2026-07-24-audit-repair-bead-plan.md`, which
   `eshyra-o9bd.19` names as its source plan. Those rows are **not**
   independently re-verified against the pack.
3. **The PDF text used for D-1 came from a stale audit bundle**
   (`/mnt/d/audit-bundle/`, generated at commit `46b86f1`, pack 1,650 records).
   Its *pack* is stale; its *pdf-text* is derived from a PDF whose recorded
   SHA-256 is byte-identical to the currently vendored source, so the
   source-text evidence is sound. The pack-side evidence for D-1 was taken from
   the current committed `records.json`, not from that bundle.
4. **PR #475/#476/#477 diffs were not read.** Their state is taken from
   `eshyra-o9bd.19.7`, which is the designated authority on their salvage
   classification. The branches are preserved on origin if a successor needs
   them.
5. **`mechanics-projection-report.md`'s numbers were not re-derived.** Its
   counting method is not documented in-band and top-level vs nested `mechanics`
   give materially different totals; asserting drift would have been
   unjustified.
6. **The audit-bundle build was not run.** `npm run audit-bundle:dnd5e-srd`
   writes to `.audit-bundles/` and copies a ZIP to a host path; the individual
   gates were exercised directly instead, which is what §2.6 records.
7. **No live-model behavior was observed.** All statements about what the DM
   model does or does not receive are statements about code paths
   (`contextAssembler`, `toolLookupRules`, `turnAuditor`), not about model
   behavior in play.
8. **`eshyra-jued`'s substrate map was not read** — it was in progress
   concurrently. Any disagreement between the two documents at the
   `lookup_rules` / context-assembly seam should be resolved in favour of
   whichever cites the tighter code evidence.
9. **Test-suite state.** Only the five audit-related test files were run in
   isolation (101 tests, all passing) plus the documentation checks in §"Verification".
   The full suite was not re-run; no source or generated file was modified by
   this work.

---

## 11. Handoff to the integrated transition design

**What this map hands over.**

- A verified inventory of every artifact named in ADR 0020's reassessment list,
  with its epistemic status, real consumers, and failure direction (§4).
- A verified statement of which deterministic capabilities and state-kernel
  invariants exist independently of any global pack claim, and therefore
  survive the withdrawal untouched (§5).
- A preserved defect corpus: nine re-derived live defects with reproducible
  evidence (§6.1), the carried-forward finding list (§6.2), and a bead-status
  ledger showing which ownership pointers are dead (§6.4).
- Ten ranked negative-claim risks (§7) and a producer–consumer dependency map
  (§8).
- Twelve decisions, framed as questions (§9).

**What the transition design must not read into this map.**

- **No artifact here is declared obsolete or safe to delete.** ADR 0020
  requires each to be confirmed, narrowed, repurposed, or retired *with
  reasons*. §4 supplies the reasons-input, not the verdict.
- **Missing capability bindings are not evidence of missing mechanics.** The
  794 engine-pending magic-item clauses, the 303 prose-only rule records, and
  the 197 bucket-less records are statements about Eshyra, per ADR 0020 §3.
- **The five dimensions are kept independent throughout and must stay so.**
  D-4 in particular is *not* a deterministic-execution defect today, because
  nothing executes those fields — but it is a live source-fidelity and
  adjudication-support defect, and it would become an execution defect the
  moment a capability consumed the field.
- **Every defect in §6 blocks approval of the claim it affects.** None is
  optional or nonblocking.

**Suggested first reads for the successor.** `eshyra-o9bd.19.7` in full
(especially the eleven trust-boundary questions and the salvage matrix); ADR
0020 §3 and §7; then §6.1 D-1, D-2, and D-4 of this document, which are the
three defects with reproducible instances and live consumers.

**Two items with a clock on them.** (a) The `2n1t-engine-closure-reconciliation.md`
extraction from PR #477's preserved branch, which `eshyra-o9bd.19.7` flags as
"EXTRACT FIRST so it does not die here" and which its own notes record as not
yet done. (b) The finding corpus (D-7), which is repository-external today.

---

*This document changed no generated pack output and no production code. It is
evidence only.*
