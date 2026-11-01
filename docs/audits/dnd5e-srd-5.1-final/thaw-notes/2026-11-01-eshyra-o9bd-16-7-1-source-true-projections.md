# Thaw note: source-true spell roll-modifier subjects, Empty Body force exception, save-owned attack damage

Bead: `eshyra-o9bd.16.7.1` (parent `eshyra-o9bd.16.7`; audit lane
`eshyra-o9bd.16.1` findings L1-F3, L1-F4, L1-F5)

## Reason for thaw

Three retained typed projections contradicted the vendored SRD (ADR-0020
bar 1). Design rule: state the source truthfully in the existing vocabulary
(`kindSchemas.ts`, no new fields or kinds) or omit the projection (the
authoritative prose stays for DM adjudication).

## Change (`mechanicsProjections.ts` only)

- **L1-F3.** The spell roll-modifier subject is the nearest candidate only
  when it is the grammatical subject: a candidate that is the object of a
  preposition (`against|to|of|...`), sits in an embedded clause
  (`when|if|while|...`), or is followed before the verb by another noun phrase
  is rejected. Two explicit forms were added: "other creatures have
  (dis)advantage on attack rolls against the target/it" and "the next attack
  roll made against this/the target ... has (dis)advantage", both with the
  existing subject `attackers-against-target`.
- **L1-F4.** The `resistance to all damage` grammar rejects a following
  `but|except|other than|apart from|aside from` exception.
- **L1-F5.** Damage printed after a save clause inside the Hit sentence is
  owned by the save (`damageOnFailure`, `damageOnSuccess: half` where printed;
  no damage on success is the absence of `damageOnSuccess`), removed from
  `attacks[].hitDamage` and from entry `damage`; flat hit damage ("1 piercing
  damage") is the hit when the save owns all dice damage. Condition-only saves
  after on-hit damage are unchanged.

## Source quotes (SRD 5.1, vendored PDF)

- p. 28 Empty Body: "you also have resistance to all damage but force damage."
- pp. 151-152 Guiding Bolt: "the next attack roll made against this target
  before the end of your next turn has advantage".
- p. 158 Irresistible Dance: "While the target is affected by this spell,
  other creatures have advantage on attack rolls against it."
- p. 155 Holy Aura: "Creatures of your choice in that radius when you cast
  this spell shed dim light ... and have advantage on all saving throws, and
  other creatures have disadvantage on attack rolls against them".
- p. 147 Foresight: "other creatures have disadvantage on attack rolls
  against the target for the duration".
- p. 374 Giant Centipede: "Hit: 4 (1d4 + 2) piercing damage, and the target
  must succeed on a DC 11 Constitution saving throw or take 10 (3d6) poison
  damage."
- p. 378 Giant Scorpion: "the target must make a DC 12 Constitution saving
  throw, taking 22 (4d10) poison damage on a failed save, or half as much
  damage on a successful one."

## Generated change (records.json only; 21 records)

Spells and features (5):
- `feature:monk:empty-body`: `damageResistance types:all` removed (omitted).
- `spell:guiding-bolt`: subject `target` -> `attackers-against-target`, scope
  `attack-rolls` -> the printed next-attack limit.
- `spell:irresistible-dance`: subject `target` -> `attackers-against-target`,
  scope `attack rolls against it` -> `attack-rolls`.
- `spell:holy-aura`: the single wrong `caster` modifier removed (the chosen
  creatures in the radius have no representation in the vocabulary; the
  attackers-against-them clause refers to the same unnamed recipients).
- `spell:foresight`: gains the printed `attackers-against-target`
  disadvantage (previously unprojected); its existing target advantage is
  unchanged.
- No other spell changed (all 45 roll modifiers re-checked; controls Dominate x3,
  Blur, Hunter's Mark, Shocking Grasp, Haste, Resurrection, Vicious Mockery,
  Symbol are byte-identical).

Creatures (16 records): Assassin (Shortsword, Light Crossbow),
Giant Centipede, Giant Poisonous Snake, Giant Scorpion, Giant Spider, Giant
Wasp, Giant Wolf Spider, Guardian Naga (Bite, and Spit Poison whose attack now
carries no hit damage), Imp, Phase Spider, Purple Worm, Quasit, Spirit Naga
(the audited 14 attacks), plus the same-class siblings Poisonous Snake, Scorpion
and Spider (flat 1 piercing hit; the dice poison was previously the only
`hitDamage`, the piercing dropped). Controls unchanged: Bone Devil, Erinyes,
Ettercap, Balor.

## Pinned values / tests

New permanent evidence `test/importers/dnd5e-srd-5.1/sourceFidelityProjections.test.ts`
(generalized pack invariants plus the exact witnesses and controls above). No
existing test was weakened.

## Freeze

Freeze manifest hashes and the freeze guard were not touched (guard is
intentionally inactive pending the re-freeze bead).

## Existing pin changed (source-false premise, strengthened not weakened)

`creatureAttackGrammar.test.ts` "projects every printed Hit damage term into
hitDamage or alternatives" required the save-owned poison (e.g. Giant Centipede,
SRD p. 374: "the target must succeed on a DC 11 Constitution saving throw or
take 10 (3d6) poison damage") to appear in unconditional `hitDamage`. That
premise is source-false. The test now partitions the Hit sentence at the save
clause: direct terms must equal the projected hit terms exactly as before, and
the save-owned terms must equal `saves[0].damageOnFailure`.

## Derived artifacts regenerated

`docs/inventories/o9bd-18-8-8-semi-structured-boundary.{json,md}` regenerated
with `packages/core/scripts/inventory-semi-structured-boundary.ts` (the Empty
Body `types` row disappears; `damageOnFailure` populations rise).
