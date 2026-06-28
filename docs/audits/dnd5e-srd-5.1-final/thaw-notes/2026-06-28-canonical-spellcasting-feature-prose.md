# Thaw Note — Canonical spellcasting feature prose ownership

**Date:** 2026-06-28
**Bead:** eshyra-o9bd.4
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md` (epic eshyra-o9bd)

## Reason for thaw

The frozen SRD pack split spellcasting mechanics across sibling feature records
for classes whose class table grants first-level spellcasting subsections such
as `Cantrips` or `Spellbook`. For example, `feature:cleric:spellcasting` was a
stub while `feature:cleric:cantrips` carried preparing, casting, ability, ritual,
and focus rules. Wizard similarly spread spellcasting mechanics across
`feature:wizard:spellcasting`, `feature:wizard:cantrips`, and
`feature:wizard:spellbook`.

This thaw makes `feature:<class>:spellcasting` the canonical owner of complete
spellcasting prose for Cleric, Druid, Sorcerer, and Wizard. Subordinate records
keep only their own subsection text. Warlock remains `feature:warlock:pact-magic`.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` — deterministic
      post-parse canonicalization and source-inventory ownership updates.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` —
      regenerated through the importer.
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json` —
      regenerated coverage and region-ledger ownership for moved spellcasting
      prose.
- [x] `docs/audits/dnd5e-srd-5.1-final/` — this thaw note and refreshed freeze
      manifest hashes.
- [x] Other: `packages/core/src/rules/srdAudit.ts` and tests update the
      swallowed-heading audit to allow these intentional spellcasting child
      subsection labels.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes. Regenerated through the importer (not hand-edited). Record count is
unchanged at 1812; only 8 existing feature records change:

- `feature:cleric:spellcasting` absorbs the Cleric cantrips/preparing/casting
  spellcasting prose, while `feature:cleric:cantrips` is trimmed to Cantrips.
- `feature:druid:spellcasting` absorbs the Druid cantrips/preparing/casting
  spellcasting prose, while `feature:druid:cantrips` is trimmed to Cantrips.
- `feature:sorcerer:spellcasting` absorbs the Sorcerer cantrips/slots/known
  spellcasting prose, while `feature:sorcerer:cantrips` is trimmed to Cantrips.
- `feature:wizard:spellcasting` absorbs the Wizard Cantrips and Spellbook
  subsection prose, while `feature:wizard:spellbook` is trimmed to Spellbook.

No records are added or removed. `manifest.json` is unchanged.
`source-coverage.json` and `source-region-ledger.json` change to reflect the
canonical feature owners.

## Importer changed?

Yes. The class-progression enrichment now moves spellcasting subsection prose to
the canonical spellcasting feature records after feature extraction. The source
inventory coverage mapping is updated so spellcasting boilerplate is attributed
to those same owners. Partial importer fixtures skip absent move pairs; the full
generated-pack tests pin the complete SRD output.

## Commands run

```
npm run import:dnd5e-srd -- --pdf packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf --out /tmp/eshyra-o9bd-4-scratch
npm run import:dnd5e-srd -- --pdf packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1/
npm run test -- packages/core/test/srdGeneratedPack.test.ts packages/core/test/importers/dnd5e-srd-5.1/pipeline.test.ts packages/core/test/srdStructureAudit.test.ts
npx tsx -e "import { auditSrdStructure, getBundledDnd5eSrdPack } from './packages/core/src/internal.ts'; const findings = auditSrdStructure(getBundledDnd5eSrdPack()); console.log('structure findings:', findings.length); if (findings.length) console.log(findings.slice(0,10));"
```

All listed commands exited 0. `auditSrdStructure(...)` reported 0 findings.

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated

## Audit bundle path

Not regenerated. This child bead updates generated pack ownership and targeted
audit gates only; full audit bundle regeneration remains eshyra-o9bd.14.

## Reviewer sign-off notes

Confirm the generated diff is limited to the 8 expected existing feature
records, that Cleric/Druid/Sorcerer/Wizard spellcasting mechanics live on the
canonical spellcasting feature records, and that the subordinate Cantrips or
Spellbook records retain only their own subsection prose.
