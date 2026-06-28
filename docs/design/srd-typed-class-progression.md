# Typed Class Progression (`advancement[]`)

This note defines the typed class-progression model introduced by
**eshyra-o9bd.2**, replacing the untyped `features`/`resources`/`spellcasting`
row shape so a level-up engine never infers from display names.

## Schema

Each `class.data.progression[]` row is:

```ts
{
  level: number,
  proficiencyBonus: string,   // e.g. "+2"
  advancement: AdvancementEntry[],
}
```

`AdvancementEntry` is a discriminated union on `kind`:

- `featureGrant` — `{ ref, name, detail? }`. A concrete feature record granted at
  this level. `detail` preserves a repeated-use parenthetical (Fighter Action
  Surge "(one use)" → "two uses").
- `subclassFeatureSlot` — `{ slotName, subclassLevel }`. The level grants a
  feature determined by the character's chosen subclass; the concrete feature is
  resolved from the subclass at `subclassLevel`.
- `featureImprovement` — `{ targetRefs, label }`. A level-specific improvement to
  existing feature(s) (Druid Wild Shape, Cleric Divine Intervention). The
  engine blocks until improvement application is implemented; it never silently
  re-grants the base feature.
- `resourceProgression` — `{ resource, value }`. A class resource column (Rages,
  Ki Points, Sneak Attack dice, …). `value` is an integer or a verbatim token
  ("Unlimited", "1d6").
- `spellcastingProgression` — `{ cantripsKnown?, spellsKnown?, slots?, pactSlots?,
  invocationsKnown? }`. Present only when the row has usable spellcasting data;
  non-applicable values are **omitted**, never `null` (so Ranger level 1, which
  has no spellcasting, emits no entry).

`choiceGrant` is intentionally **not** emitted by .2; structured choice modeling
(ASI-vs-feat, Fighting Style, etc.) is eshyra-o9bd.9.

## Classification (importer)

Untyped source rows are classified from the source-backed table in
`srd-level-up-row-classification.md` (PR #336):

1. Name resolves to a feature record, or to an alias
   (`FEATURE_ALIASES`: "Signature Spell" → `feature:wizard:signature-spells`,
   "Thieves Cant" → `feature:rogue:thieves-cant`) → `featureGrant`.
2. Name is in `FEATURE_IMPROVEMENTS` → `featureImprovement` with mapped
   `targetRefs`.
3. Name ends with "feature" (an unresolved subclass slot) → `subclassFeatureSlot`.
4. Otherwise the importer **throws** (fail-closed) — no raw label is emitted.

## Consumers

- `rulesPackResolver.ts` parses `advancement[]` into `ResolvedClassLevel`
  (`featureRefs`, `subclassFeatureSlots`, `featureImprovements`, `spellcasting`),
  failing closed (`malformed`) on an unknown kind.
- `levelUpEngine.ts` reads the typed slices directly — no display-name
  heuristics.
- `srdPlayabilityAudit.ts` (eshyra-o9bd.11) validates that every row carries a
  typed `advancement[]` of known kinds with no null spellcasting and no dangling
  grant/improvement ref.
