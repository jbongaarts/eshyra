# Final Importer Audit — D&D 5e SRD 5.1 Rules Pack

**Pack:** `rules:dnd5e-srd-5.1`
**Audited commit:** `0f5b3dcce1de96630e01532d138b1286c948b668`
**Audit date:** 2026-06-17 (UTC)
**Auditor pass:** official final freeze-hardening audit (independent re-verification)

---

## Freeze protection

The `rules:dnd5e-srd-5.1` pack is frozen. The freeze guard enforces two policies:

- **Hash policy** — SHA-256 hashes of frozen files are pinned in
  [`freeze-manifest.json`](./freeze-manifest.json). Any change to those bytes
  fails CI immediately.
- **Thaw-note policy** — a PR that touches any frozen path must also commit an
  active thaw note under [`thaw-notes/`](./thaw-notes/). Thaw notes are not a
  bypass; the hash check still runs and the freeze manifest must be updated
  consistently.

**To check locally:**

```bash
npm run verify:dnd5e-srd-freeze
```

**To make an intentional change:**

1. Copy [`thaw-notes/TEMPLATE.md`](./thaw-notes/TEMPLATE.md) to
   `thaw-notes/<date>-<short-reason>.md` and fill it in.
2. Make the change and regenerate affected artifacts.
3. Update `freeze-manifest.json` with the new hashes
   (run `npm run verify:dnd5e-srd-freeze` to see the mismatch, then update).
4. Update audit/provenance evidence consistently.

---

## 1. Final sign-off verdict

> ## ✅ FREEZE / SIGN OFF — no blockers found.
>
> The committed `rules:dnd5e-srd-5.1` pack is **deterministic and reproducible**,
> **faithful to the vendored SRD 5.1 PDF**, **complete across all generated
> record kinds**, fully **covered by the source-inventory / source-coverage /
> source-region-ledger artifacts** (0 unaccounted, 0 known-gap, 0 unrepresented
> prose, 0 broad structural ignores), and **clean of every known importer
> failure mode**. It is suitable to treat as a frozen audited artifact.

This audit independently re-ran every gate and adversarially challenged the
artifact against the source PDF rather than relying on prior audit summaries.
All flags raised during the audit were chased to the source and resolved as
**faithful** (see §9–§10). Zero blockers remain.

## 2. Exact commit audited

| | |
| --- | --- |
| Repo commit (HEAD at audit) | `0f5b3dcce1de96630e01532d138b1286c948b668` |
| SRD content commit | `67648aa` — "Strip embedded table linearizations from SRD prose (eshyra-3anh)" (PR #230), merged via `35e1ce5` |
| Relationship | HEAD `0f5b3dc` (PR #231, PolyForm license) touched **no** SRD pack/importer/source file, so pack content at HEAD is byte-identical to `67648aa`. Confirmed by `git show --stat` and by re-running the importer at HEAD. |

## 3. Bundle path and source hash

| | |
| --- | --- |
| Audit bundle | `.audit-bundles/dnd5e-srd-audit-bundle/` (regenerated at HEAD; **gitignored** — see §12) |
| Bundle commit (`metadata.json`) | `0f5b3dcce1de96630e01532d138b1286c948b668` (= HEAD ✓) |
| Source PDF | `packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf` |
| Source SHA-256 | `2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0` (matches source + pack manifests ✓) |
| PDF size / pages | 3,158,713 bytes / 403 pages |

Generated artifact hashes and the full provenance chain are in
[`provenance.md`](./provenance.md); the machine-readable summary is in
[`evidence.json`](./evidence.json).

## 4. Commands run and results

The audit distinguishes commands **independently re-run during this audit** from
command output **captured inside the regenerated bundle**.

### 4a. Independently re-run during this audit

| Command | Exit | Result |
| --- | --- | --- |
| `npm ci` | 0 | Clean install on Node 24.16.0 (LTS, per ADR 0008). 1 npm-audit advisory — out of scope for the pack (§10). |
| `npm run verify:dnd5e-srd-pack` | 0 | Regenerated pack from PDF → **0 records added/removed/changed, 0 manifest changes**; `source-inventory.json`, `source-coverage.json`, `source-region-ledger.json` each "matches regenerated output exactly". |
| `npm run audit-bundle:dnd5e-srd` | 0 | Fresh bundle at HEAD; thresholds all zero (§6–§7). |
| `npm run check` | 0 | Biome + hidden-unicode over 288 files. 2 infos = pre-existing `biome.json` `recommended → preset` deprecation (config-only, non-blocking). |
| `npm run typecheck` | 0 | `tsc --build --force` clean. |
| `npm test` | 0 | **1788 passed / 19 skipped** (111 files passed / 4 skipped). Skips are the documented live-API integration + Dolt-gated checkpoint suites (dolt binary absent). |

`npm ci` was run despite no repo policy requiring it, to make the reproducibility
proof a clean-room result.

### 4b. Captured inside the regenerated bundle (`command-output/`)

The bundle generator runs these itself at HEAD and stores stdout/stderr/exit:

| Captured command | Exit |
| --- | --- |
| `audit:rules-pack` (on the committed pack) | 0 |
| `check` | 0 |
| `typecheck` | 0 |
| `test` (1788 passed / 19 skipped) | 0 |
| `verify:dnd5e-srd-pack` ("matches importer output exactly") | 0 |

Both the independent and bundle-captured runs of `check`, `typecheck`, `test`,
and `verify` agree: all exit 0.

## 5. Record counts by kind

Total **1811** records (authoritative `countsByKind` from `auditPack`; reconciles
with the importer's category counts printed by `verify:dnd5e-srd-pack`).

| Kind | Count | Kind | Count |
| --- | ---: | --- | ---: |
| action | 10 | hazard | 25 |
| ancestry | 13 | magic-item | 240 |
| background | 1 | rule | 335 |
| class | 12 | spell | **319** |
| condition | 15 | stat-block | 2 |
| creature | 317 | subclass | 12 |
| equipment | 218 | table | **108** |
| feat | 1 | **TOTAL** | **1811** |
| feature | 183 | | |

Breakdowns (see [`record-counts.md`](./record-counts.md)): creature = 296
monsters + 21 NPCs; hazard = 8 traps + 14 poisons + 3 diseases; stat-block =
Avatar of Death + Giant Fly (inline); 30 creatures carry legendary actions; 2
creatures carry variants; 125 magic items require attunement. Every record
carries a `provenance.locator` (0 missing), a uniform CC-BY-4.0 license block (1
distinct), and `systemId = dnd5e-srd`.

## 6. Source-coverage summary

From `source-coverage.json` (re-verified byte-equal and regenerated at HEAD).
The importer **fails closed** if any source structure is unaccounted.

| Metric | Value |
| --- | ---: |
| Inventory items (typography-derived source structures) | 2258 |
| → mapped to a record | 1444 |
| → child-of another record | 462 |
| → ambiguous ownership (name shared by ≥2 records) | 187 |
| → taxonomy | 33 |
| → represented by structured field (`spell.data.classes`) | 78 |
| → reasoned ignore | 54 |
| **→ unaccounted** | **0** ✅ |
| **→ known-gap** | **0** ✅ |

`ambiguous` (187) remains a truthful status for source occurrences whose
normalized text has multiple candidate records. The coverage report now retains
the candidates and exact occurrence provenance instead of inventing a winner.
Its diagnostics separately report 92 duplicate-text groups, 37 explicitly
resolved groups, 55 suspicious-owner groups, and 75 unresolved-owner groups.
These are reviewer evidence, not a zero-warning gate; the source-accounting
gate still requires `unaccounted = 0` and `known-gap = 0`.

## 7. Source-region ledger summary

From `source-region-ledger.json` (re-verified byte-equal and regenerated at HEAD).
This is the contiguous-prose accounting gate: every prose region must be owned by
a record/child or be an explicitly reasoned ignore.

| Metric | Value |
| --- | ---: |
| Ledger entries | 2685 |
| Prose regions | 2658 |
| → owned by a record | 2122 |
| → child-of a record | 448 |
| → represented by structured field (`spell.data.classes`) | 83 |
| → intentionally ignored: front-matter | 2 |
| Pure document structure (headings, no prose) | 27 |
| **Unrepresented prose** | **0** ✅ |
| **Broad structural ignores** | **0** ✅ |

The 2 intentionally-ignored regions are front-matter (the page-1 Legal
Information preamble and the page-2 blank). The 83 spell-list regions on
pp.105–113 are explicitly owned by the structured `spell.data.classes`
relationship, with source class/level, member count, and resolved spell keys in
the artifact evidence. **No spell-list content is hidden behind an ignore.**

## 8. High-risk areas audited

Reconciled source ↔ records across the required page ranges, using both
coordinate-aware (x/y) de-interleaved text reconstruction (defeating two-column
interleave) and **direct PDF page rendering** for the highest-risk areas:

- **p. 3–7 races/ancestry** — 13 ancestry records (base + subraces); Draconic
  Ancestry table reconciled (rendered p. 5).
- **p. 8–57 classes/features/subclasses** — 12 classes, 12 subclasses, 183
  features, 12 class-progression tables (`The Barbarian` … `The Wizard`, 20 rows
  each); `The Wizard` slot grid verified.
- **p. 62–74 equipment/armor/weapons** — 218 equipment records across 7
  categories; armor stats (ac/type/stealth/strength) reconciled with the Armor
  table (rendered p. 63); chain-shirt/leather boundary clean (§9).
- **p. 75–84 feats / ability scores / adventuring** — `rule:feats`,
  `rule:using-ability-scores`, ability-check rules present.
- **p. 90–103 combat/spellcasting rules** — combat/spellcasting `rule:` records
  present; stat-block heading rules correctly separated from creature actions.
- **p. 105–114 spell lists + start of descriptions** — full bidirectional
  spell-list reconstruction (§9); rendered p. 115.
- **p. 196–205 traps/diseases/poisons** — 8 traps + 3 diseases + 14 poisons
  (hazard kind); `rule:sample-traps`, `rule:complex-traps` present.
- **p. 206–252 magic items** — 240 magic items; sentient-item rules+tables;
  Artifacts heading + Orb of Dragonkind (rendered p. 252); Deck of Many Things,
  Necklace of Prayer Beads, Teleport tables (rendered p. 186).
- **p. 253–260 monster stat-block rules** — `rule:actions`@259,
  `rule:legendary-actions`@260, `rule:monsters-reactions`@259 are the
  stat-block *rules explanations*, not per-creature bleed.
- **p. 261–357 monsters** — 317 creature records (30 legendary, 2 variants);
  Shrieker, Giant Rat, Swarm of Insects verified (§9).
- **p. 358–365 conditions/pantheons/planes** — 15 conditions; 4 pantheon tables
  (Celtic/Egyptian/Greek/Norse).
- **p. 394–403 NPC appendix** — 21 NPC creature records; `rule:appendix-mm-b…`.

## 9. Prior known failure modes — confirmed fixed

| Historical failure mode | Status | Evidence |
| --- | --- | --- |
| Embedded **table** linearization in owner prose (PR #230) | ✅ Fixed | Scripted scan = 0 flattened-table signatures in any prose field; strip tests pass for Necklace of Prayer Beads, Deck of Many Things, Teleport, Armor of Resistance; clean `table:*` records retained (108 tables, 1077 rows, 0 structural issues). |
| Chain Shirt tail bleeding into Leather | ✅ Fixed | `equipment:chain-shirt` and `equipment:leather` each carry only their own description; no cross-tail. |
| Avatar of Death / card text bleeding into Defender & Demon Armor | ✅ Fixed | Tested anti-bleed guards; column de-interleave verified; stat block stays in the Deck entry where the source prints it. |
| Per-creature `Actions`/`Reactions`/`Legendary Actions` headings becoming global rules | ✅ Correct | No `rule:` named exactly "Actions"/"Legendary Actions" at any creature page; the only such rules are the p.259–260 stat-block rules explanations. |
| Shrieker action/reaction ownership | ✅ Correct | `creature:shrieker`: Shriek is a **reaction**, no actions, False Appearance trait — exactly per source. |
| Section-intro prose dropped (Feats, Conditions, Using Ability Scores, Spellcasting, Magic Items A–Z, Sample Traps, Adventuring Gear, Appendix MM-A/B) | ✅ Present | Each captured as a `rule:` with real prose (e.g. `rule:feats` 833ch, `rule:conditions` 741ch, `rule:using-ability-scores` 815ch). |
| Subclass-overview prose (Martial Archetypes, Monastic Traditions, Sacred Oaths, Ranger/Roguish Archetypes, Sorcerous Origins, Otherworldly Patrons, Arcane Traditions) | ✅ Present | All 8 present as `rule:` records with prose. |
| Subclass spell-table intros (Oath of Devotion, The Fiend) | ✅ Present | `rule:` intro + `table:oath-of-devotion-spells` / `table:fiend-expanded-spells`. |
| Light/Medium/Heavy Armor category prose | ✅ Present | `rule:light-armor`, `rule:medium-armor`, `rule:heavy-armor-category`. |
| Equipment item mechanics (Acid, Alchemist's Fire, Antitoxin, Holy Water, Healer's Kit, Hunting Trap, Basic Poison, Lamp, Bullseye Lantern, Tinderbox) | ✅ Present | All present (under faithful qualified keys, e.g. `equipment:acid-vial`, `equipment:lantern-bullseye`). |
| Variants (Skills with Different Abilities, Encumbrance, Diseased Giant Rats, Insect Swarms) | ✅ Present | Two as `rule:variant-*`; two as structured `creature.variants` on Giant Rat / Swarm of Insects. |
| Magic items (Orb of Dragonkind, Sentient items, Artifacts, Deck of Many Things + Avatar of Death, Necklace of Prayer Beads, Teleport) | ✅ Present | All present; Orb is a 3165ch artifact magic-item; Artifacts heading correctly structural (Orb is the only SRD artifact). |
| Half-Dragon Template | ✅ Present | `rule:half-dragon-template` + `table:half-dragon-breath-weapon` + `table:half-dragon-damage-resistance`. |
| Giant Fly / Avatar of Death inline stat blocks | ✅ Present | `stat-block:giant-fly`, `stat-block:avatar-of-death`, each linked from its owner via `data.statBlockRefs`. |
| Spell-list membership (pp.105–113) | ✅ Exact | 70 class/level groups; 778 PDF references ↔ 778 record memberships, 0 discrepancies; coverage owned by `spell.data.classes`. |

### Spell-list bidirectional proof

Class spell lists (pp.105–113) were reconstructed **independently** from the PDF
coordinate items (column-split by x, read top-to-bottom per column) and
cross-checked against the pack:

- **778 PDF spell-list references** (class,spell pairs) checked.
- **70 class/level groups** reconstructed with source page and heading context.
- **778 record class-membership pairs** — exact match.
- 319 distinct listed spells = 319 spell records.
- Per class: Bard 112, Cleric 105, Druid 105, Paladin 31, Ranger 37, Sorcerer
  120, Warlock 64, Wizard 204.
- Direction 1 (PDF → record): 0 missing records, 0 level mismatches, 0
  class-not-in-record.
- Direction 2 (record → PDF): 0 memberships absent from the PDF lists.

High-risk boundary spells spot-checked complete and correctly classed: Animal
Friendship, Animal Messenger, Fly, Shield, Darkvision, Wish (2889ch), Word of
Recall, Hunter's Mark, Teleport (3006ch, crosses p.185–186).

### Whole-pack scripted checks (all clean)

| Check | Findings |
| --- | ---: |
| Duplicate keys | 0 |
| Missing required top-level fields / provenance locator | 0 |
| `undefined` / `NaN` / `[object Object]` / `TODO` / `FIXME` | 0 |
| Empty primary prose where source prose exists | 0 |
| Embedded flattened-table signatures in prose | 0 |
| Dangling connector endings | 0 |
| Lowercase continuation-fragment starts | 0 |
| Table structural issues (missing cols/rows, ragged rows, empty headers) | 0 |

(10 "non-terminal-punctuation" prose endings were inspected and are all faithful
bulleted-list / formula endings, e.g. ability-check example lists and the Ranger
spellcasting DC formula — not truncations.)

## 10. Remaining non-blocking concerns

No blockers. Three transparency notes for future maintainers:

1. **Inline stat blocks retained in owner prose (by design).** Avatar of Death
   (in `magic-item:deck-of-many-things`) and Giant Fly (in
   `magic-item:figurine-of-wondrous-power`) appear verbatim in the owner's
   `description` *and* as structured `stat-block:*` records linked by
   `data.statBlockRefs`. This is faithful — the source physically prints each
   stat block inside the owner entry — and is **explicitly required by the audit
   spec** and enforced by dedicated tests. The embedded ability-score line is
   column-linearized; a maintainer could optionally extend the PR #230
   table-strip policy to inline stat blocks for stylistic consistency. Not a
   defect; the structured records are the clean authoritative form.
2. **npm-audit advisory.** `npm ci` reports 1 high-severity advisory in the
   dependency tree. Unrelated to the generated pack; tracked under dependency
   maintenance.
3. **Biome config deprecation.** `npm run check` emits 2 `info` notices for
   `biome.json` (`recommended → preset`). Config-only, exits 0.

## 11. Final recommendation

**FREEZE / SIGN OFF.** Treat `rules:dnd5e-srd-5.1` at commit `0f5b3dc` as a
frozen, audited artifact. The pack is reproducible from the pinned PDF, faithful
to the source (including verbatim source typos), complete and fully accounted for
by the coverage/ledger gates, and free of every known importer failure mode. The
importer remains a one-time historical generator; the durable product is the
committed pack under `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`.

## 12. Committed vs. local artifacts (why no ZIP)

This audit commits only durable, human-reviewable summaries (this report,
`provenance.md`, `evidence.json`, `record-counts.md`, `known-source-typos.md`,
`audit-methodology.md`). It does **not** commit the audit bundle, the bundle ZIP,
rendered PDF page images, or scratch scripts, because:

- `.audit-bundles/` is already **gitignored** in this repo — committing it would
  fight an existing convention. The bundle is explicitly designed as a
  regenerate-on-demand local review artifact (`npm run audit-bundle:dnd5e-srd`).
- The bundle is large (full per-page PDF text + coordinate JSON for 403 pages)
  and is fully reproducible from the pinned commit + PDF, so committing it adds
  bulk without adding trust.
- Every fact the bundle would prove is captured here as a hash, count, or
  exit-code, with reproduction instructions. The provenance hashes pin the exact
  bytes audited.

A maintainer who wants the raw bundle runs the one command above at commit
`0f5b3dc`; `metadata.json` will show the same commit and source hash recorded in
[`provenance.md`](./provenance.md).

---

### How to reproduce this audit

```bash
git checkout 0f5b3dcce1de96630e01532d138b1286c948b668
npm ci
npm run verify:dnd5e-srd-pack     # exit 0 = byte-reproducible
npm run audit-bundle:dnd5e-srd    # regenerates .audit-bundles/dnd5e-srd-audit-bundle
npm run check && npm run typecheck && npm test
```

See [`audit-methodology.md`](./audit-methodology.md) for the adversarial method,
[`record-counts.md`](./record-counts.md) for full counts, and
[`known-source-typos.md`](./known-source-typos.md) for the rendered-page typo
evidence.
