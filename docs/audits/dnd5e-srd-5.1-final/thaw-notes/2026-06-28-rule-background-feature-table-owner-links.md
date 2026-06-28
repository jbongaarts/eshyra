# Thaw Note — Rule / background / feature table-owner links (eshyra-o9bd.8.2)

**Date:** 2026-06-28
**Bead:** eshyra-o9bd.8.2 (second slice of eshyra-o9bd.8)
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md` (epic eshyra-o9bd)
**Builds on:** `2026-06-28-magic-item-table-owner-links.md` (eshyra-o9bd.8.1)

## Reason for thaw

Deficiency #7 continued. eshyra-o9bd.8.1 linked magic-item and clean 1:1
economy/reference tables. This slice resolves and links the owners that needed
per-table source judgment, extending `SRD_5_1_TABLE_OWNERS` and the
`table-owner-link` audit gate. Each owner was confirmed by SRD page and prose:

| Table | Owner | Evidence |
| --- | --- | --- |
| `table:multiclassing-prerequisites` | `rule:prerequisites` | p. 56, "as shown in the Multiclassing Prerequisites table" |
| `table:multiclassing-proficiencies` | `rule:proficiencies` | p. 57, "as shown in the Multiclassing Proficiencies table" |
| `table:multiclass-spellcaster-spell-slots-per-spell-level` | `rule:spellcasting` | p. 57-58, multiclass spellcasting section |
| `table:character-advancement` | `rule:experience-points` | p. 56-57, "as shown in the Character Advancement table" |
| `table:creating-spell-slots` | `feature:sorcerer:font-of-magic` | p. 43, Font of Magic conversion table |
| `table:object-armor-class`, `table:object-hit-points` | `rule:objects` | p. 203 |
| `table:short-term-madness`, `table:long-term-madness`, `table:indefinite-madness` | `rule:madness-effects` | p. 201-202, "short-term, long-term, or indefinite" |
| `table:sentient-magic-item-alignment` | `rule:creating-sentient-magic-items-alignment` | p. 251, "roll on the following table" |
| `table:sentient-magic-item-senses` | `rule:creating-sentient-magic-items-senses` | p. 251 |
| `table:sentient-magic-item-communication` | `rule:communication` | p. 251 |
| `table:sentient-magic-item-special-purpose` | `rule:special-purpose` | p. 251-252 |
| `table:acolyte-*` (bonds/flaws/ideals/personality-traits) | `background:acolyte` | p. 61 suggested-characteristics roll tables |
| `table:draconic-bloodline-draconic-ancestry` | `feature:draconic-bloodline:dragon-ancestor` | p. 44, Dragon Ancestor selects the dragon type |

Where multiple records mention a table in prose (e.g. Character Advancement is
also referenced by `rule:multiclassing-proficiency-bonus`), only the single
owning record gains a `tableRefs` link; prose mentions never create links. The
`table-owner-link` gate enforces exactly-once ownership.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` — none new; the existing
      `linkOwnedTables.ts` pass consumes the extended map.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` —
      regenerated through the importer.
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/` — this thaw note, refreshed freeze
      manifest hash, and a wording correction to the 8.1 thaw note (32 not 31
      magic-item tables; fixture-tolerant not fail-closed).
- [x] Other: `packages/core/src/rules/srdAudit.ts` (extended
      `SRD_5_1_TABLE_OWNERS`) and `kindSchemas.ts` (optional `tableRefs` on the
      `background` kind).

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes. Regenerated through the importer (not hand-edited). Record count is
unchanged at 1812; no records are added or removed. 13 owner records gain a
`data.tableRefs` array (10 rules, 2 features, 1 background) covering 19 tables.
Records with a `tableRefs` link rise from 44 to 57. `manifest.json`,
`source-coverage.json`, and `source-region-ledger.json` are unchanged.

## Importer changed?

No new importer code. The map lives in `srdAudit.ts`; `linkOwnedTables.ts`
(eshyra-o9bd.8.1) already wires every present owner. `kindSchemas.ts` now allows
an optional `data.tableRefs` on `background` records (the Acolyte owner).

Remaining eshyra-o9bd.8 scope (eshyra-o9bd.8.3): classify the deliberately
owner-less reference tables (deities, languages, DCs, CR/size reference) into a
documented allowlist and add the completeness gate.

## Commands run

```
npm run import:dnd5e-srd -- --pdf packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1/
npm run verify:dnd5e-srd-pack
npm run verify:dnd5e-srd-freeze -- --base origin/main
npm run check
npm run typecheck
npm test
```

All listed commands exited 0 after updating the freeze-manifest hash and the
reviewed partial-field baseline for rule/feature `tableRefs`.

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated
      (`records.json` hash).

## Audit bundle path

Not regenerated. Targeted table-link metadata + audit-map + test coverage only;
full audit bundle regeneration remains eshyra-o9bd.14.

## Reviewer sign-off notes

Confirm the generated `records.json` diff is limited to the 13 expected owner
records gaining a `tableRefs` array (no added/removed records, no prose change),
that each owner choice matches the source evidence in the table above, and that
the `table-owner-link` gate is clean for the committed pack.
