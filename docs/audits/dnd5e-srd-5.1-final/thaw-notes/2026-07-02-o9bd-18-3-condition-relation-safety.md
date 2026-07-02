# Thaw Note — o9bd.18.3 Safe Condition Relation Semantics

**Date:** 2026-07-02
**Beads:** eshyra-o9bd.18.3
**Epic:** eshyra-o9bd.18 (2026-07-01 audit findings) under eshyra-o9bd
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md`

## Reason for thaw

The 2026-07-01 external audit (Codex high-effort finding, independently
confirmed) showed that the eshyra-qqyj relation classifier still recorded
`relation: "applies"` for condition mentions whose source text is prevention,
suppression, removal, or gating — the exact class of defect where a
deterministic tool acting on `applies` would do the **opposite** of the SRD
effect. Confirmed examples in the committed pack:

- `spell:branding-smite` — "can't become invisible until the spell ends"
  recorded as *applying* `invisible`.
- `spell:calm-emotions` — "You can suppress any effect causing a target to be
  charmed or frightened" recorded as *applying* `charmed`.
- `spell:lesser-restoration` — "end … one condition … The condition can be
  blinded, deafened, paralyzed, or poisoned" recorded as *applying* `blinded`.
- `spell:protection-from-evil-and-good` — "The target also can't be charmed,
  frightened, or possessed by them" recorded as *applying* `charmed`.

Root causes: the `applies` patterns (`be X`, `is/are X`, `becomes X`, `knocked
X`) matched inside negated, suppressive, and gating clauses; the vocabulary had
no way to express prevention, suppression, or gating; and the aggregation let a
targeting clause ("you touch a creature … that is charmed") outrank an explicit
removal sentence (`spell:dispel-evil-and-good`).

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` —
      `mechanicsProjections.ts`: the inline classifier moved to the shared
      `packages/core/src/rules/conditionRelations.ts`; `parseConditions` now
      delegates to it.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` —
      regenerated through the importer. Exactly 30 `relation` values changed
      across 21 records; no entry was added or removed, no condition set
      changed, no other field changed (verified by structural JSON diff of
      every record, listed below).
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/` — this thaw note and refreshed
      `freeze-manifest.json` hash for `records.json`.
- [x] Other: new `packages/core/src/rules/conditionRelations.ts` (single shared
      classifier + closed vocabulary + consumer contract);
      `packages/core/src/rules/kindSchemas.ts` now validates
      `mechanics.conditions[].relation` against that shared vocabulary;
      `packages/core/src/rules/srdAudit.ts` gains the
      `condition-relation-safety` audit gate; regression tests in
      `packages/core/test/importers/dnd5e-srd-5.1/mechanicsProjections.test.ts`,
      `packages/core/test/srdStructureAudit.test.ts`, and a pack-wide gate in
      `packages/core/test/srdGeneratedPack.test.ts`.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Relation vocabulary

The closed vocabulary grew from 7 to 10 values. New: `prevents` (effect blocks
the condition), `suppresses` (effect pauses an existing condition without
ending it), `gates` (condition is a precondition/targeting gate, not an
output). Unchanged: `applies`, `removes` (the only two state mutations),
`immune`, `advantage`, `disadvantage`, `exclusion`, `mention`. The
eshyra-o9bd.18.3 acceptance vocabulary maps as: inflicts=`applies`,
prevents=`prevents`, removes=`removes`, suppresses=`suppresses`,
protectsFrom/immunizesAgainst=`immune`, grantsAdvantageAgainst=`advantage`,
excludes=`exclusion`, gatesOn=`gates`, mentions=`mention`. The full contract
for deterministic consumers is the doc comment of
`packages/core/src/rules/conditionRelations.ts`.

## Pack records changed?

Yes — exactly these 30 `relation` values (every one re-verified against the
record's own SRD source text; 512 condition entries were audited in full,
including every spell/hazard/action entry and every negation-bearing creature
entry):

Wrong `applies` fixed (20):

- `spell:branding-smite` invisible → `prevents`
- `spell:calm-emotions` charmed → `suppresses`
- `spell:lesser-restoration` blinded → `removes`
- `spell:protection-from-evil-and-good` charmed → `prevents`
- `spell:magic-circle` charmed → `prevents` ("can't be charmed … by the creature")
- `spell:dispel-evil-and-good` charmed → `removes` ("is no longer charmed")
- `spell:compulsion`, `spell:enthrall`, `spell:suggestion`,
  `spell:mass-suggestion`, `spell:irresistible-dance` charmed → `gates`
  (immunity/auto-success gates: "creatures that can't be charmed are immune")
- `spell:animal-shapes`, `spell:polymorph`, `spell:shapechange`,
  `spell:true-polymorph` unconscious → `mention` (the only mention is the
  negated "isn't knocked unconscious")
- `creature:bearded-devil` frightened → `prevents` (Steadfast: "can't be
  frightened while…")
- `creature:kraken` restrained → `prevents` (Freedom of Movement trait:
  "can't … cause it to be restrained")
- `creature:ice-devil` incapacitated → `gates` (Wall of Ice: "unless the
  creature is incapacitated" / "until the devil is incapacitated")
- `creature:pit-fiend` incapacitated → `gates` (Fear Aura: "unless the pit
  fiend is incapacitated")
- `creature:vampire`, `creature:vampire-spawn` incapacitated → `gates` (stake
  trait precondition) and grappled → `gates` (bite targeting clause: "a
  creature that is grappled by the vampire")

Companion upgrades from `mention`, produced by the same list-aware patterns
(10): `spell:lesser-restoration` deafened/paralyzed/poisoned → `removes`;
`spell:calm-emotions` frightened → `suppresses`;
`spell:protection-from-evil-and-good` and `spell:magic-circle` frightened →
`prevents`; `spell:dispel-evil-and-good` frightened → `removes`.

No genuinely condition-inflicting record changed: hold-person/hold-monster,
fear, sleep, web, hallow's Fear effect, grapple riders, "save or be poisoned"
clauses, etc. all still classify `applies` (overcorrection guards in the
regression tests cover hold-person, a grapple/save rider, hallow, and the
vampire stake paralysis).

## Importer changed?

Yes, via the shared module. Changes to the classifier:

- New relations `prevents`, `suppresses`, `gates` with list-aware patterns
  ("can't be charmed, frightened, or possessed" resolves for every listed
  condition, with single-word list items only so the wildcard cannot swallow
  an unrelated clause).
- `applies` matches are rejected when immediately preceded by a negation
  ("isn't knocked unconscious", "doesn't fall prone", "can't become
  invisible") — this plus the pattern ordering is the guard that prevention/
  removal/immunity phrasing can never be emitted as `applies`.
- Subordinate-clause ("unless/while/until/if … is X", comma-bounded so "If the
  target is a Large or smaller creature, it is grappled" keeps `applies`) and
  relative-clause ("that is grappled") gating patterns.
- `removes` gained the Lesser Restoration "condition can be …" list and a
  list-aware "no longer charmed, frightened, or possessed".
- Aggregation priority: `applies`, `removes`, then `prevents`, `suppresses`,
  `immune`, `advantage`, `disadvantage`, `exclusion`, `gates`, `mention`.

The `condition-relation-safety` audit gate re-derives every emitted
`mechanics.conditions[].relation` from the record's own prose via the same
shared classifier and flags any disagreement, so importer output, schema, and
audit cannot drift and hand-edits cannot reintroduce an unsafe `applies`.

No source extractor behavior changed.

## Commands run

```
npx vitest run packages/core/test/importers/dnd5e-srd-5.1/mechanicsProjections.test.ts packages/core/test/srdStructureAudit.test.ts
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npm run verify:dnd5e-srd-pack
npm run verify:dnd5e-srd-freeze -- --base origin/main
npm run audit-bundle:dnd5e-srd
npm run verify:worktree
```

All passed.

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated with the
  new `records.json` SHA-256
  (`7f14cd09314f94f2e60628a669e9ecacffee68a7c702eb85824d49be1b437af5`).

## Reviewer sign-off notes

Confirm `verify:dnd5e-srd-pack` shows the committed pack matches importer
output exactly, that the generated diff is exactly the 30 `relation` values
listed above (structural JSON diff — no other field on any record changed),
and that the new `condition-relation-safety` category reports zero findings on
the committed pack (`srdGeneratedPack.test.ts`).
