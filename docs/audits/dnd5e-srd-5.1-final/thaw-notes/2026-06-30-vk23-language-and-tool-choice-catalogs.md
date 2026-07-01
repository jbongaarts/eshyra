# Thaw Note — vk23 Language and Tool Choice Catalogs

**Date:** 2026-06-30
**Beads:** eshyra-8r8f
**Epic:** eshyra-ajpc
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md`

## Reason for thaw

The vk23 gameplay audit found several open-ended SRD choices that were
structured enough (`choose: N`) but had no enumerable `from` domain, so
deterministic character creation had nothing to prompt from besides
re-parsing prose: Half-Elf/Human/Acolyte "extra language(s) of your choice",
High Elf's extra-language creation choice, Bard's "three musical instruments
of your choice", and Monk's "one type of artisan's tools or one musical
instrument".

Investigation found the pack already had the raw catalogs elsewhere but not
wired to these choices: `table:standard-languages` already lists the 8 SRD
Standard Languages with a `languageOptions` projection, and every
`equipment` `tool`-category record's shared `description` prefix ("Artisan's
Tools.", "Musical Instrument.", "Gaming Set.") already groups the 17 artisan
tools and 10 musical instruments by type — this thaw makes those groupings
into named catalogs and wires them into the affected choices' `from` fields.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` —
      `creationFacts.ts`: the `choose()` language-grant helper now attaches
      `from: SRD_5_1_STANDARD_LANGUAGES`; new `enrichClassToolChoiceDomains`
      attaches the artisan-tools/musical-instrument catalog to Bard's and
      Monk's `toolProficiencyChoices[0]`. `emit.ts` wires the new enricher
      into the class-record pipeline.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` —
      regenerated through the importer. `from` added to exactly 6 entries:
      `ancestry:half-elf`/`ancestry:human`/`background:acolyte`'s
      `languages[0]`, `ancestry:high-elf`'s `extra-language` creation choice,
      and `class:bard`/`class:monk`'s `toolProficiencyChoices[0]`. No other
      field or record changed.
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/` — this thaw note and refreshed
      `freeze-manifest.json` hash for `records.json`.
- [x] Other:
      `packages/core/src/character/srdCreationChoices.ts` — new
      `SRD_5_1_STANDARD_LANGUAGES`/`SRD_5_1_ARTISAN_TOOLS`/
      `SRD_5_1_MUSICAL_INSTRUMENTS` catalogs, and High Elf's `extra-language`
      creation choice now carries `from`.
      `packages/core/src/rules/kindSchemas.ts` — validates the new
      `languages[].from` field.
      `packages/core/src/character/rulesPackResolver.ts` /
      `requiredChoices.ts` — `ResolvedLanguageGrant` now carries `from`
      through from the pack, and `chooseableLanguages` prefers the
      pack-sourced domain over its previously-hardcoded standard-languages
      list (kept only as a defensive fallback for a pack without one).
      `packages/core/src/character/srdLanguages.ts` — the source-cited
      regression-oracle facts also gained `from` so the oracle test stays a
      faithful independent check of the generated pack.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes, additively. Record counts are unchanged. Exactly 6 records changed,
each gaining one `from` array on an existing `choose`-bearing entry:

- `ancestry:half-elf` — `languages[0].from`: 8 Standard Languages.
- `ancestry:human` — `languages[0].from`: 8 Standard Languages.
- `ancestry:high-elf` — `choices[].extra-language.from`: 8 Standard
  Languages.
- `background:acolyte` — `languages[0].from`: 8 Standard Languages.
- `class:bard` — `toolProficiencyChoices[0].from`: 10 Musical Instruments.
- `class:monk` — `toolProficiencyChoices[0].from`: 17 Artisan's Tools + 10
  Musical Instruments (27 total) — the SRD choice is "one type of artisan's
  tools OR one musical instrument".

## Importer changed?

Yes, minimally. `creationFacts.ts`'s `choose()` helper (used for every
ancestry/background language grant with a free-choice component) now
attaches the Standard Languages catalog. A new `enrichClassToolChoiceDomains`
function, keyed by class key (mirroring the existing `ARTISAN_TOOL_OPTIONS`
Dwarf-specific pattern), attaches the tool/instrument catalog to the two
class records whose `toolProficiencyChoices` prose names an open
musical-instrument/artisan-tool domain. No extractor behavior changed; no new
prose parsing was added.

## Commands run

```
npx vitest run packages/core/test/srdChoiceDomains.test.ts packages/core/test/requiredChoices.test.ts packages/core/test/srdLanguages.test.ts
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npm run verify:dnd5e-srd-pack
npm run audit-bundle:dnd5e-srd
npm run verify:dnd5e-srd-freeze -- --base origin/main
npm run check
npm run typecheck
npm run test
npm run verify:worktree
```

All passed (3227 tests). Fixing the fallout in three regression tests that
hard-coded the pre-thaw language-grant shape
(`srdGeneratedPack.test.ts`, `pipeline.test.ts`,
`rulesPackCharacterResolver.test.ts`) and one source-cited oracle
(`srdLanguages.test.ts`) is a schema-intent change, not a weakened
expectation: each now asserts the full `from` domain rather than omitting it.

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated with the
  new `records.json` SHA-256.

## Audit bundle path

Regenerated locally at `.audit-bundles/dnd5e-srd-audit-bundle` (gitignored).
`npm run audit-bundle:dnd5e-srd` reports 0 playability/choice-prose/overlay
findings.

## Reviewer sign-off notes

Confirm `verify:dnd5e-srd-pack` shows the committed pack matches importer
output exactly, `verify:dnd5e-srd-freeze -- --base origin/main` passes, and
the generated diff is limited to the 6 `from` additions described above —
same record count, same fixed/choose values, only a new enumerable domain.
