# Thaw Note — vk23 Spell-Workflow Modeling & Filter/Parsing Fixes

**Date:** 2026-06-30
**Beads:** eshyra-vk23.1, eshyra-vk23.2, eshyra-vk23.3, eshyra-vk23.4
**Epic:** eshyra-vk23 (follow-up to the eshyra-ngcj SRD gameplay-modeling audit)
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md`

## Reason for thaw

The SRD pack is source-complete, but the ngcj audit bundle surfaced
gameplay-modeling quality gaps: some machine-readable mechanics fields held
clipped prose, Warlock invocation prerequisites were mis-parsed, the core class
spell workflows were prose-only, and a few choices still used free-text filters.
This thaw lands four targeted, source-backed importer changes that make the pack
trustworthy for deterministic tool consumption. The canonical SRD prose remains
authoritative; every structured field is derived from it through the importer.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` —
      `mechanicsProjections.ts` (fail-closed `spellGrants`), `emit.ts`
      (spell-grant resolver wiring), `deriveFeatureChoices.ts` (structured spell
      workflows + invocation prerequisite grammar + Expertise character-state
      filter), `creationFacts.ts` + `classProgression.ts` (preparation formula).
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` —
      regenerated through the importer.
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/` — this thaw note and refreshed
      `freeze-manifest.json` records.json hash.
- [x] Other: `packages/core/src/rules/kindSchemas.ts` (validates structured
      `spellGrants`, `preparationFormula`, and `choose | chooseFormula |
      unsupported`); `packages/core/src/character/srdClassSpellcasting.ts` and
      `rulesPackResolver.ts` (runtime oracle + resolver carry
      `preparationFormula`); importer/generated-pack/audit tests.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes. The canonical pack was regenerated through the importer, not hand-edited.
Record counts are unchanged; no records were added or removed. Only `feature`
and `class` record `data` changed, in four bounded slices:

- **vk23.1 — `spellGrants` fail-closed.** 11 garbage prose `spellGrants`
  removed across class/cantrip/spellbook features; the one real grant
  (`feature:warlock:pact-boon` → `find familiar`) and `ancestry:tiefling`'s
  Infernal Legacy (now both `hellish-rebuke` + `darkness`) became structured
  `{ spell: 'spell:<slug>' }` refs. `feature:wizard:cantrips` and
  `feature:wizard:spell-mastery` lost their `mechanics` block entirely (their
  only projected mechanics was clipped prose).
- **vk23.3 — Warlock invocation prerequisites.** Five options
  (Book of Ancient Secrets, Chains of Carceri, Lifedrinker, Thirsting Blade,
  Voice of the Chain Master) now carry their full `Pact of the <X> feature`
  prerequisite instead of a truncated `Pact of`, with the leaked continuation
  removed from the option body.
- **vk23.2 — class spell workflows.** Structured `choices` on the ten caster
  features: spell/cantrip `spellFilter` objects, known-caster spells-known +
  level-up replacement, prepared-caster `chooseFormula` daily preparation, the
  Wizard spellbook starting contents + growth, and Mystic Arcanum at the
  11th/13th/15th/17th tiers. `class:cleric/druid/paladin/wizard` gain a
  structured `spellPreparation.preparationFormula`; `class:paladin`'s
  `spellPreparation.sourceText` was completed with the SRD preparation-formula
  sentence it was missing.
- **vk23.4 — free-text filters.** `feature:bard:expertise` and
  `feature:rogue:expertise` `from` changed from the prose string
  `"your skill proficiencies"` to a structured `characterStateFilter`
  (Rogue additionally lists `thieves-tools`).

No record kind/count churn; no `source-*.json` artifact changed (their hashes
are unchanged in the freeze manifest).

## Importer changed?

Yes — derivation/projection logic only; no source-extractor behavior changed.

- `mechanicsProjections.ts`: `spellGrants` is now resolved against the emitted
  spell set and emitted only as validated `spell:` refs; otherwise omitted.
- `deriveFeatureChoices.ts`: structured spell-workflow derivation, an explicit
  closed grammar for invocation prerequisites (replacing a capitalized-word
  lookahead that matched the lowercase "the" inside "Pact of the …"), and the
  Expertise character-state filter.
- `creationFacts.ts` / `classProgression.ts`: curated, source-backed
  `preparationFormula` threaded onto `spellPreparation`.

## Commands run

```
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npm run verify:dnd5e-srd-pack
npm run typecheck
npm run check
npm run test
npm run verify:worktree
npm run verify:dnd5e-srd-freeze -- --base origin/main
```

`verify:dnd5e-srd-pack` reports the committed pack matches importer output
exactly. `typecheck`/`check` pass; `test` is green (3168 passed, 19 skipped).
`check`/`verify:worktree` still print the existing Biome schema-version info
(`2.5.1` schema vs CLI `2.5.0`) and exit 0 (tracked by eshyra-vk23.7).

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated with:
  - `records.json` SHA-256
    `d31fab3bb0c4c29ff83662e2334186f7eb2fd6f47dc2fac1c2e89d7d7df75f6c`
  - all other pinned hashes unchanged (only `records.json` changed).

## Audit bundle path

Not regenerated. These are targeted gameplay-modeling slices; the committed
diff and the choice-prose audit (now 0 findings) document the changed coverage.
Full audit bundle regeneration remains epic-level work.

## Reviewer sign-off notes

Confirm that `verify:dnd5e-srd-pack` shows the committed pack matches importer
output exactly, `verify:dnd5e-srd-freeze -- --base origin/main` passes, and the
generated diff is limited to the four bounded slices above (no record
add/remove, no `source-*.json` change). The `srd-choice-prose-audit` gate drops
from 10 findings to 0; reviewed partial-field baselines move mechanics 108→110
and choices 130→128, both explained in the bead commits.
