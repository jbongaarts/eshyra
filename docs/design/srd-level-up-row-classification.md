# Frozen SRD Strict Level-Up Row Classification

This note classifies the frozen D&D 5e SRD 5.1 class-progression rows that do
not resolve under `resolveClassLevel`'s strict level-up read shape. The frozen
pack rows use feature entries shaped like `{ "name": "..." }` with no `ref`;
strict level-up parsing intentionally treats those rows as malformed rather
than guessing.

Scope for `eshyra-fxrs`: classify the rows and preserve fail-closed behavior.
Do not modify generated pack data, change importer output, regenerate pack
data, implement the level-up engine, or relax parser behavior.

## Categories

- **Subclass-context mapping candidate:** the row names a subclass feature slot.
  A future compatibility layer can map it only after the character sheet has a
  selected subclass and can choose the frozen subclass feature record at the
  same level. The class-only resolver must keep failing closed.
- **Improvement semantics required:** the row names an improvement to an
  existing feature, not a new feature record. Mapping it to the original feature
  ref would look resolved while losing the level-specific mechanical change, so
  the row remains unsupported until the engine has explicit improvement
  semantics.
- **Alias mapping candidate:** the row appears to be a stable label mismatch
  for an existing frozen feature record. A future compatibility layer may map
  the alias to that record, but level-up application can still require choices.
- **No frozen record:** no existing frozen feature/rule/table record provides a
  deterministic mapping. Keep unsupported and fail closed until a source-backed
  importer thaw or pack revision adds the missing record.
- **Malformed spellcasting placeholder:** the row's feature refs resolve, but
  strict spellcasting parsing rejects the frozen row. Keep unsupported and fail
  closed until a source-backed importer thaw or compatibility rule can preserve
  the intended "no spellcasting at this level" meaning without accepting
  malformed values broadly.

## Row Decisions

| Class | Level | Frozen row label | Decision | Existing frozen record evidence |
| --- | ---: | --- | --- | --- |
| Barbarian | 6 | Path feature | Subclass-context mapping candidate | `feature:path-of-the-berserker:mindless-rage` |
| Barbarian | 10 | Path feature | Subclass-context mapping candidate | `feature:path-of-the-berserker:intimidating-presence` |
| Barbarian | 14 | Path feature | Subclass-context mapping candidate | `feature:path-of-the-berserker:retaliation` |
| Bard | 6 | Bard College feature | Subclass-context mapping candidate | `feature:college-of-lore:additional-magical-secrets` |
| Bard | 14 | Bard College feature | Subclass-context mapping candidate | `feature:college-of-lore:peerless-skill` |
| Cleric | 2 | Divine Domain feature | Subclass-context mapping candidate | `feature:life-domain:channel-divinity-preserve-life` |
| Cleric | 6 | Divine Domain feature | Subclass-context mapping candidate | `feature:life-domain:blessed-healer` |
| Cleric | 8 | Divine Domain feature | Subclass-context mapping candidate | `feature:life-domain:divine-strike` |
| Cleric | 17 | Divine Domain feature | Subclass-context mapping candidate | `feature:life-domain:supreme-healing` |
| Cleric | 20 | Divine Intervention improvement | Improvement semantics required | `feature:cleric:divine-intervention` is the base feature, not the improvement |
| Druid | 4 | Wild Shape improvement | Improvement semantics required | `feature:druid:wild-shape` is the base feature, not the improvement |
| Druid | 6 | Druid Circle feature | Subclass-context mapping candidate | `feature:circle-of-the-land:lands-stride` |
| Druid | 8 | Wild Shape improvement | Improvement semantics required | `feature:druid:wild-shape` is the base feature, not the improvement |
| Druid | 10 | Druid Circle feature | Subclass-context mapping candidate | `feature:circle-of-the-land:natures-ward` |
| Druid | 14 | Druid Circle feature | Subclass-context mapping candidate | `feature:circle-of-the-land:natures-sanctuary` |
| Fighter | 7 | Martial Archetype feature | Subclass-context mapping candidate | `feature:champion:remarkable-athlete` |
| Fighter | 10 | Martial Archetype feature | Subclass-context mapping candidate | `feature:champion:additional-fighting-style` |
| Fighter | 15 | Martial Archetype feature | Subclass-context mapping candidate | `feature:champion:superior-critical` |
| Fighter | 18 | Martial Archetype feature | Subclass-context mapping candidate | `feature:champion:survivor` |
| Monk | 6 | Monastic Tradition feature | Subclass-context mapping candidate | `feature:way-of-the-open-hand:wholeness-of-body` |
| Monk | 9 | Unarmored Movement improvement | Improvement semantics required | `feature:monk:unarmored-movement` is the base feature, not the improvement |
| Monk | 11 | Monastic Tradition feature | Subclass-context mapping candidate | `feature:way-of-the-open-hand:tranquility` |
| Monk | 17 | Monastic Tradition feature | Subclass-context mapping candidate | `feature:way-of-the-open-hand:quivering-palm` |
| Paladin | 7 | Sacred Oath feature | Subclass-context mapping candidate | `feature:oath-of-devotion:aura-of-devotion` |
| Paladin | 15 | Sacred Oath feature | Subclass-context mapping candidate | `feature:oath-of-devotion:purity-of-spirit` |
| Paladin | 18 | Aura improvements | Improvement semantics required | `feature:paladin:aura-of-protection` and `feature:paladin:aura-of-courage` are base aura features, not the improvement |
| Paladin | 20 | Sacred Oath feature | Subclass-context mapping candidate | `feature:oath-of-devotion:holy-nimbus` |
| Ranger | 1 | `spellcasting.spellsKnown: null` | Malformed spellcasting placeholder | Existing feature refs are valid; the strict failure is the null spellcasting value |
| Ranger | 6 | Favored Enemy and Natural Explorer improvements | Improvement semantics required | `feature:ranger:favored-enemy` and `feature:ranger:natural-explorer` are base features, not the improvements |
| Ranger | 7 | Ranger Archetype feature | Subclass-context mapping candidate | `feature:hunter:defensive-tactics` |
| Ranger | 10 | Natural Explorer improvement | Improvement semantics required | `feature:ranger:natural-explorer` is the base feature, not the improvement |
| Ranger | 11 | Ranger Archetype feature | Subclass-context mapping candidate | `feature:hunter:multiattack` |
| Ranger | 14 | Favored Enemy improvement | Improvement semantics required | `feature:ranger:favored-enemy` is the base feature, not the improvement |
| Ranger | 15 | Ranger Archetype feature | Subclass-context mapping candidate | `feature:hunter:superior-hunters-defense` |
| Rogue | 1 | Thieves Cant | No frozen record | No `Thieves' Cant` / `Thieves Cant` feature record exists in the frozen pack |
| Rogue | 9 | Roguish Archetype feature | Subclass-context mapping candidate | `feature:thief:supreme-sneak` |
| Rogue | 13 | Roguish Archetype feature | Subclass-context mapping candidate | `feature:thief:use-magic-device` |
| Rogue | 17 | Roguish Archetype feature | Subclass-context mapping candidate | `feature:thief:thiefs-reflexes` |
| Sorcerer | 6 | Sorcerous Origin feature | Subclass-context mapping candidate | `feature:draconic-bloodline:elemental-affinity` |
| Sorcerer | 14 | Sorcerous Origin feature | Subclass-context mapping candidate | `feature:draconic-bloodline:dragon-wings` |
| Sorcerer | 18 | Sorcerous Origin feature | Subclass-context mapping candidate | `feature:draconic-bloodline:draconic-presence` |
| Warlock | 6 | Otherworldly Patron feature | Subclass-context mapping candidate | `feature:the-fiend:dark-ones-own-luck` |
| Warlock | 10 | Otherworldly Patron feature | Subclass-context mapping candidate | `feature:the-fiend:fiendish-resilience` |
| Warlock | 14 | Otherworldly Patron feature | Subclass-context mapping candidate | `feature:the-fiend:hurl-through-hell` |
| Wizard | 6 | Arcane Tradition feature | Subclass-context mapping candidate | `feature:school-of-evocation:potent-cantrip` |
| Wizard | 10 | Arcane Tradition feature | Subclass-context mapping candidate | `feature:school-of-evocation:empowered-evocation` |
| Wizard | 14 | Arcane Tradition feature | Subclass-context mapping candidate | `feature:school-of-evocation:overchannel` |
| Wizard | 20 | Signature Spell | Alias mapping candidate | `feature:wizard:signature-spells` |

## Test Boundary

`packages/core/test/rulesPackCharacterResolver.test.ts` locks this unsupported
set with an expected-failure fixture derived from the frozen pack. The test
walks every committed class progression row through strict `resolveClassLevel`
and compares the malformed rows to the explicit 48-row list above. Future work
that intentionally adds a compatibility layer must update both the test fixture
and this classification, with separate tests for any newly supported mappings.
