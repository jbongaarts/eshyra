# Thaw note: creature attack Hit-clause components (A3-F3)

Bead: `eshyra-o9bd.19.6.7.11` (dispatch `.19.6.7.11.1`); audit lane
`eshyra-o9bd.19.6.7.3` finding A3-F3 (registry classes
creature-statblock-mechanics and unicode-minus-damage).

## Failure class

`parseAttack` (`mechanicsProjections.ts`) listed only dice components in
`attacks[].hitDamage` and treated a flat "N type damage" as a fallback only when
the clause had no dice, and its dice grammar accepted U+2212 but not the U+2013
en dash the SRD prints in some stat blocks. A Hit clause could therefore lose a
printed component with no disclosure.

## Grammar changes

- Flat "N type damage" terms are projected anywhere in the (pre-save) Hit
  clause, as `{amount, type}` in print order, unless they are the tail of a dice
  term. "1 piercing damage plus 7 (3d4) poison damage" -> two entries, both
  shared across modes exactly as the existing `plus` rider logic does.
- `DAMAGE_TERM_RE` and `normalizeDice` accept U+2013 as a minus ("1 (1d4 – 1)"
  -> `1d4 - 1`).
- `mechanics.damage` for an attack whose Hit clause mixes flat and dice
  components is built from `hitDamage` (the dice-only `parseDamage` would drop
  the flat part), as already done for save-owned damage.
- In-band disclosure: when the direct Hit clause (before an in-sentence save)
  prints more "damage" than the grammar projected, the attack carries
  `hitDamageNotProjected` = the printed clause verbatim.

## Membership (re-derived from the committed pack and the SRD PDF)

All 515 creature entries with an attack lead-in were scanned for flat
components, en dashes and empty/missing hitDamage. Pack records changed
(`records.json` only; three creatures, no other kind or record):

- `creature:flying-snake` Bite (SRD p. 372 "Hit: 1 piercing damage plus 7 (3d4)
  poison damage."): `hitDamage` and `damage` gain `{amount 1, piercing}` before
  the poison entry.
- `creature:jackal` Bite (pp. 382-383, "1 (1d4 – 1) piercing damage", U+2013):
  gains `hitDamage` and `damage` `[{average 1, dice "1d4 - 1", piercing}]`.
- `creature:djinni` Scimitar (SRD "Hit: 12 (2d6 + 5) slashing damage plus 3
  (1d6) lightning or thunder damage (djinni's choice)"): a third member the
  audit's corpus parse missed. Its choice-of-type rider is not projected (its
  `hitDamage`/`damage` were already slashing-only); it now carries
  `hitDamageNotProjected` with the printed clause. Projecting it needs
  `typeOptions` with per-option conditions; tracked as a follow-up bead.

Flat-only attacks (Badger, Bat, Cat, Crab, Hawk, Lizard, Owl, Quipper, Rat, Raven, Sprite, Weasel) and flat-plus-save attacks
(Poisonous Snake, Scorpion, Spider, Homunculus, Sprite) are unchanged.

## Tests

`creatureAttackGrammar.test.ts`: the generalized pack invariant now derives
printed terms in print order including flat components and U+2013 dice (this
strengthens the earlier dice-only expectation; nothing weakened), and asserts
that a clause printing more damage than listed carries the disclosure while a
fully listed one does not; Flying Snake, Jackal and Djinni are pinned.
`mechanicsProjections.test.ts` adds focused grammar units (flat+plus, en dash,
minus, disclosure).

The derived semi-structured boundary inventory (`docs/inventories/o9bd-18-8-8-*`) was regenerated: one new row (`hitDamageNotProjected`) and population shifts on the creature hitDamage/damage rows.

Freeze manifest hashes and `freeze-manifest.json` were not touched.
