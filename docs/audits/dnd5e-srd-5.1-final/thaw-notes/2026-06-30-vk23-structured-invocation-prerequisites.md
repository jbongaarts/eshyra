# Thaw Note — Structured Warlock Invocation Prerequisites

**Date:** 2026-06-30
**Beads:** eshyra-vk23.9
**Epic:** eshyra-vk23 (follow-up to eshyra-vk23.3)
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md`

## Reason for thaw

eshyra-vk23.3 fixed the invocation prerequisite STRINGS, but deterministic tools
still had to parse prose like `"12th level, Pact of the Blade feature"`. This
thaw adds a structured `prerequisites` clause array on each Eldritch Invocation
option, derived from the (already source-validated) prerequisite prose, which is
preserved verbatim in the `prerequisite` field. The SRD prose remains
canonical; the structured field is its machine-readable parse.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` — `deriveFeatureChoices.ts`
      parses the prerequisite grammar into typed clauses.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` —
      regenerated through the importer.
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/` — this thaw note and refreshed
      `freeze-manifest.json` records.json hash.
- [x] Other: `packages/core/src/rules/kindSchemas.ts` validates the new optional
      `prerequisites` clause array; importer/generated-pack tests.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes — `feature:warlock:eldritch-invocations` only. Every invocation option that
carries a `prerequisite` string gains a parallel structured `prerequisites`
array. No records added/removed; no other record changed. The 24 emitted
clauses are three closed forms:

- `level`   — `{ kind: 'level', classRef: 'class:warlock', level: N }`
  (scoped to the granting class, per "a level prerequisite refers to your level
  in this class").
- `pactBoon`— `{ kind: 'pactBoon', ref: 'pact-boon:pact-of-the-<blade|chain|tome>' }`.
- `cantrip` — `{ kind: 'cantrip', ref: 'spell:eldritch-blast' }`.

Every emitted ref resolves to a real record (pact-boon option ids, the
`spell:eldritch-blast` record, and `class:warlock`), asserted by a whole-pack
test.

## Importer changed?

Yes — derivation only. `parseOptionCatalog` now also parses the matched
prerequisite prose into typed clauses via `parsePrerequisiteClauses`, throwing
on any unrecognized clause so a parser regression fails closed. No source
extractor behavior changed.

## Commands run

```
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npm run verify:dnd5e-srd-pack
npm run typecheck
npm run check
npm run test
npm run verify:dnd5e-srd-freeze -- --base origin/main
```

`verify:dnd5e-srd-pack` reports the committed pack matches importer output
exactly. typecheck/check/test pass. `check` still prints the pre-existing Biome
schema-version info and exits 0 (tracked by eshyra-vk23.7).

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated with:
  - `records.json` SHA-256
    `e9c923c61ad7d252eae0cb61a15d1a413b95e82e92dff50dde205acfe8c7ddde`
  - all other pinned hashes unchanged (only `records.json` changed).

## Audit bundle path

Not regenerated. This is a targeted modeling slice on a single feature record.

## Reviewer sign-off notes

Confirm `verify:dnd5e-srd-pack` matches exactly, `verify:dnd5e-srd-freeze --base
origin/main` passes, and the generated diff is limited to structured
`prerequisites` arrays added to `feature:warlock:eldritch-invocations` options
(prose `prerequisite` preserved).
