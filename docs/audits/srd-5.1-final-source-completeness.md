# SRD 5.1 Final Source-Completeness Audit

**Audit date:** 2026-06-15  
**Bead:** `eshyra-4a7.9`  
**Source commit:** `4a01872c2aa5f3bc7c0ccf93719e374c173d015d`  
**Source PDF:** `packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf`  
**Source SHA-256:** `2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`

## Result

The committed SRD 5.1 pack meets the intended acceptance bar:

> Source text is captured somewhere, or usable structured game data is
> available.

The audit found no unexplained source structures, no known source gaps, no
structure/coverage findings, no suspicious records, and no generated-pack
drift. No importer or generated-record changes are required.

## Fresh Audit Bundle

Generated with:

```bash
npm run audit-bundle:dnd5e-srd -- \
  .audit-bundles/eshyra-4a7.9-final \
  /tmp/eshyra-4a7.9-final.zip
```

The archive is 6.4 MiB with SHA-256:

```text
fe02909dacf991d33fb8aee6c10d763d37735f2d5728ef7367bba783b90cf575
```

The bundle remains outside version control by repository convention
(`.audit-bundles/` is gitignored). It contains the pinned source PDF, committed
pack, per-page extracted text and positioned items, source inventory and
coverage artifacts, audit reports, and captured verification output.

## Audit Summary

| Check | Result |
| --- | ---: |
| PDF pages | 403 |
| Pack records | 1,772 |
| Source structures inventoried | 2,258 |
| Structures mapped to records | 1,960 |
| Structures mapped to structured child data | 99 |
| Structures mapped to creature taxonomy | 33 |
| Intentionally ignored structures | 166 |
| Unaccounted structures | 0 |
| Known-gap structures | 0 |
| Structure/coverage findings | 0 |
| Suspicious records | 0 |
| Unicode/control findings | 0 |
| Reproducibility diff | 0 |

All 1,772 records have a valid PDF page locator. An independent normalized
name-on-cited-page check found 1,732 literal name matches. The 40 nonliteral
matches were reviewed and are expected:

- table names composed from their owner and caption or column headings;
- wrapped PDF headings, including the Amulet of Proof against Detection and
  Location and appendix titles;
- captionless spell and magic-item tables named for their owning record;
- Acolyte child tables named from their suggested-characteristic category;
- saddle equipment rows normalized from the table's `Saddle` group heading.

Each exception has visible supporting text or table cells on its cited page.

## Focus Areas

### Subclass boundaries

All 12 subclasses have bounded introductory descriptions and separate feature
references. Champion, Life Domain, and School of Evocation were checked
directly against pages 25, 17, and 54. Their descriptions stop before feature
text. The four subclasses with spell tables link those tables through
`spellTableRefs`; Oath of Devotion also preserves its tenets as named child
sections.

### Magic-item boundaries

All 240 expected magic items are present. Figurine of Wondrous Power is emitted
at `magic-item:figurine-of-wondrous-power`, with nine structured variants and a
reference to `stat-block:giant-fly`. Its page 221-222 span ends before Flame
Tongue on page 223. The neighboring records are Feather Token, Figurine of
Wondrous Power, Flame Tongue, Folding Boat, and Frost Brand, matching source
order without swallowed items.

The source-faithful description retains the inline Giant Fly text, but that
flattened copy is not the only representation: the usable fields are emitted
as a standalone stat block and linked from the magic item.

### Embedded stat blocks

Avatar of Death and Giant Fly are both emitted as standalone `stat-block`
records and linked from their containing magic items.

- Avatar of Death includes the complete page 218 block: defenses, movement,
  abilities, senses, languages, challenge/XP notation, two traits, and Reaping
  Scythe.
- Giant Fly includes every field printed in the abbreviated page 222 block:
  size/type/alignment, AC, HP/formula, walking/flying speeds, six abilities,
  senses, and languages. It correctly omits challenge, XP, traits, and actions
  because the source block does not print them.

All 317 creature/NPC records include the core printed stat-block fields:
size, type, alignment, AC, HP, speed, six abilities, senses, languages, and
challenge rating. Optional defenses, skills, traits, actions, reactions, and
legendary actions are emitted only where the source prints them.

### Class progression

All 12 class records link a dedicated progression table. Every table has 20
rows, and each class also carries a 20-level structured `progression` array.
The nine ignored class-table inventory items are only split column-header
fragments such as "Spell Slots per Spell Level"; their data is represented in
the emitted parent tables.

### Dragonborn ancestry

`ancestry:dragonborn` contains a Draconic Ancestry trait with
`tableRefs: ["table:draconic-ancestry"]`. The linked table has all ten source
rows and the three source columns: dragon, damage type, and breath weapon.
Breath Weapon and Damage Resistance remain separate playable traits.

### Document-wide tables

The pack contains 108 table records. Source table structures are either:

- emitted as table records;
- linked as structured child data;
- represented by row records for equipment and poisons; or
- identified as internal column fragments of an emitted table.

No source table remains unaccounted or tracked as a known gap.

## Ignored Source Structures

Every ignored category has an explicit non-content or already-represented
rationale:

| Reason | Count | Rationale |
| --- | ---: | --- |
| `class-progression-table-internal` | 9 | Split column headers inside emitted class tables |
| `deity-table-column-header` | 1 | Column-group header inside emitted deity tables |
| `document-structure` | 48 | Chapter, appendix, alphabetic, or navigation headings |
| `equipment-category-heading` | 3 | Armor categories stored on equipment rows |
| `front-matter` | 2 | Legal heading and erratum contact line |
| `record-group-heading` | 3 | Group headings over emitted trap/disease/poison records |
| `spell-list-header` | 78 | Class/level list headers; membership is on spell records |
| `subclass-spell-table-heading` | 2 | Headings for emitted and linked spell tables |
| `table-rows-emitted-as-records` | 18 | Equipment/poison table structures represented by row records |
| `variant-rule-excluded` | 2 | Explicitly excluded optional variant rules |

The two excluded optional rules are "Variant: Skills with Different Abilities"
and "Variant: Encumbrance". They are deliberate scope exclusions, not parser
loss, and are named explicitly by the source-coverage rules.

## Partial Fields

The generic pack audit reports 53 partially populated field groups. These are
expected optional-field distributions, not completeness findings. The exact
counts are pinned in `packages/core/test/srdGeneratedPack.test.ts`, with
rationales for ancestry/subrace links, class choices, condition levels,
creature optional sections, equipment subtypes, hazard families, magic-item
variants/stat blocks, spell tables/components, the two differently abbreviated
inline stat blocks, and subclass sections/spell tables.

## Verification

The fresh bundle captured successful runs of:

```text
npm run audit:rules-pack -- packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npm run check
npm run typecheck
npm run test
npm run verify:dnd5e-srd-pack
```

All commands exited 0. The reproducibility check confirms that a fresh importer
run matches the committed manifest, records, source inventory, and source
coverage artifacts byte-for-byte.
