# Thaw Note — Magic-item / rule table-owner links (eshyra-o9bd.8.1)

**Date:** 2026-06-28
**Bead:** eshyra-o9bd.8.1 (first slice of eshyra-o9bd.8)
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md` (epic eshyra-o9bd)

## Reason for thaw

Deficiency #7: gameplay-critical option/variant tables were emitted as
standalone `table` records but were not reachable from the record whose entry
they belong to (only 10 of 108 tables had an owner link). This first
eshyra-o9bd.8 slice links the cleanest, largest category — magic-item
variant/effect tables and the 1:1 economy/reference `rule` tables — via
`owner.data.tableRefs`, and adds an audit gate that enforces the relationship.

The de-flatten half of the deficiency is already satisfied at import time:
`stripEmbeddedTableProse` + `assertNoEmbeddedTableLinearization` (eshyra-3anh)
remove any linearized table rows from owner prose and fail the build closed if a
captured table span survives in prose. No owner here embeds its table rows; the
links are purely additive.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` — new `linkOwnedTables.ts`
      post-emit pass, wired into `emit.ts`.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` —
      regenerated through the importer.
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/` — this thaw note and refreshed freeze
      manifest hash.
- [x] Other: `packages/core/src/rules/srdAudit.ts` adds the
      `SRD_5_1_TABLE_OWNERS` map and the `table-owner-link` audit gate.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes. Regenerated through the importer (not hand-edited). Record count is
unchanged at 1812; no records are added or removed. 34 owner records gain a
`data.tableRefs` array (29 magic items covering 31 tables — Cube of Force owns
2, Bag of Tricks owns 3 — plus 5 economy rules: ability-scores-and-modifiers,
food-drink-and-lodging, lifestyle-expenses, services, trade-goods). Records with
a `tableRefs` link rise from 10 to 44. `manifest.json`,
`source-coverage.json`, and `source-region-ledger.json` are unchanged.

## Importer changed?

Yes. `linkOwnedTables.ts` adds `data.tableRefs` to each owner named in the
reviewed `SRD_5_1_TABLE_OWNERS` map, fail-closed if any mapped table or owner is
missing. The `table-owner-link` audit (`srdAudit.ts`) independently enforces
that each owned table is referenced exactly once, by its expected owner and no
other record.

The remaining eshyra-o9bd.8 scope is deferred to sibling beads:

- `eshyra-o9bd.8.2` — rule/background/subclass owners that need source judgment
  (multiclassing, objects, madness, sentient magic items, acolyte background,
  draconic-bloodline subclass).
- `eshyra-o9bd.8.3` — classify the deliberately-standalone reference tables
  (deities, languages, DCs, CR/size reference) and add the completeness gate.

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
reviewed partial-field baseline for magic-item/rule `tableRefs`.

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated
      (`records.json` hash).

## Audit bundle path

Not regenerated. This child bead adds targeted table-link metadata, an audit
gate, and test coverage only; full audit bundle regeneration remains
eshyra-o9bd.14.

## Reviewer sign-off notes

Confirm the generated `records.json` diff is limited to the 34 expected owner
records gaining a `tableRefs` array (no added/removed records, no prose change),
that each multi-table owner (Cube of Force, Bag of Tricks) lists its full sorted
set, and that the `table-owner-link` gate is clean for the committed pack.
