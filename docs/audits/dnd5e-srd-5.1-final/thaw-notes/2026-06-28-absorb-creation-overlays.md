# Thaw Note — Absorb character-creation overlays into generated pack data

**Date:** 2026-06-28
**Bead:** eshyra-o9bd.5
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md` (epic eshyra-o9bd)

## Reason for thaw

The frozen SRD pack lacked machine-readable character-creation facts, so the
runtime carried deterministic consumer-side overlays for:

- ancestry ability-score increases;
- ancestry and background language grants;
- class spellcasting ability/preparation facts;
- class starting-equipment choice/fixed grants.

This thaw moves those source-backed facts into importer-owned generated data so
`auditSrdPlayability()` no longer reports `overlay-dependence` findings.
Runtime overlay retirement remains deferred to eshyra-o9bd.15; this change only
adds generated pack data and the resolver/schema surface needed to read it.

## Expected file changes

- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` — adds
      importer-owned creation facts and post-emit enrichment hooks.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` —
      regenerated through the importer.
- [x] `packages/core/src/rules/srdPlayabilityAudit.ts` and tests — flips the
      `overlay-dependence` gate to green.
- [x] `docs/audits/dnd5e-srd-5.1-final/thaw-notes/` — this thaw note.
- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` — refreshed hash
      for changed pinned files.
- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes. Regenerated through the importer (not hand-edited). Record count is
unchanged at 1812; only 26 existing records change:

- 13 `ancestry:*` records gain `data.abilityScoreIncreases` and
  `data.languages` arrays.
- `background:acolyte` changes `data.languages` from the prose string
  `"Two of your choice"` to a structured language-grant array with the same
  text preserved as `sourceText`.
- 12 `class:*` records replace prose-string `startingEquipment.entries` with
  typed `{ kind: "choice", options[], sourceText }` or
  `{ kind: "fixed", text, sourceText }` entries.
- The 8 SRD spellcasting classes also gain `data.spellcastingAbility` and
  `data.spellPreparation` metadata.

No records are added or removed. `manifest.json`, `source-coverage.json`, and
`source-region-ledger.json` are unchanged.

## Importer changed?

Yes. The four runtime overlay tables are copied into importer-owned
`creationFacts.ts`, and the emit/enrichment path attaches those facts to
generated ancestry, background, and class records. Generation remains
fail-closed through rules-pack schema validation.

## Commands run

```
npm run import:dnd5e-srd -- --pdf packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf --out /tmp/eshyra-o9bd-5-scratch
npm run import:dnd5e-srd -- --pdf packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1/
npm run test -- packages/core/test/srdPlayabilityAudit.test.ts
npx tsx -e "import { auditSrdStructure, getBundledDnd5eSrdPack } from './packages/core/src/internal.ts'; const findings = auditSrdStructure(getBundledDnd5eSrdPack()); console.log('structure findings:', findings.length);"
npm run test -- packages/core/test/srdGeneratedPack.test.ts packages/core/test/rulesPackCharacterResolver.test.ts packages/core/test/srdLanguages.test.ts packages/core/test/srdClassStartingEquipment.test.ts
npm run test -- packages/cli/test/characterWizard.test.ts packages/cli/test/play.test.ts packages/core/test/importers/dnd5e-srd-5.1/pipeline.test.ts
npm run verify:worktree
npm run verify:dnd5e-srd-pack
```

All listed commands exited 0. `auditSrdStructure(...)` reported 0 findings.

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated after
      formatting and pack regeneration.

## Audit bundle path

Not regenerated. This child bead updates generated pack fields and the
playability gate baseline only; full audit bundle regeneration remains
eshyra-o9bd.14.

## Reviewer sign-off notes

Confirm the generated diff is limited to the 26 expected existing records and
that every typed `startingEquipment.entries[].sourceText` equals the original
prose line. Confirm `overlay-dependence` is 0 and overlay runtime code remains
in place for eshyra-o9bd.15.
