# Thaw note: Four non-condition reference families declared

Bead: `eshyra-o9bd.16.6.2` (parent `eshyra-o9bd.16.6`; audit finding L2-F1 of
`eshyra-o9bd.16.2`)

## Reason for thaw

Four source-grounded families of record-key leaves were emitted but declared
by no relationship declaration, so seeding the referencing record never
retrieved the record its own text names (Find Familiar -> bat/owl, Acolyte ->
light/bless, Dragonborn -> Draconic Ancestry, Hammer of Thunderbolts -> belt of
giant strength and gauntlets of ogre power). The remainder is disclosed under
`eshyra-ry69` in the candidate pack record.

## Change

Five declarations (four families; the ancestry family has two pointers) in
`recordRelationshipDeclarations.ts`, all `reference` with `record-key`
targets:

| kind | pointer | relation | emitted leaves |
| --- | --- | --- | --- |
| spell | `/mechanics/effects/*/creation/forms/*/creatureRef` | `creation-form` | 20 (2 spells) |
| creature | `/traits/*/mechanics/spellcasting/groups/*/spells/*/ref` | `spellcasting-spell` | 313 (36 creatures) |
| ancestry | `/traits/*/tableRefs/*` | `table-reference` | 1 |
| ancestry | `/choices/*/tableRef` | `table-reference` | 1 |
| magic-item | `/mechanics/interItem/requiresItems/*/itemRefs/*` | `requires-item` | 3 (2 items) |

Every emitted leaf resolves. The importer's dead-declaration gate holds.

## Generated change

Only `record-relationships.json` changes (25 -> 30 declarations). `records.json`,
`field-provenance.json` and the source ledgers are byte-identical;
`verify:dnd5e-srd-pack` matches. No pack record changes.

## Pins

The only pre-existing assertion that changed is in
`packages/core/test/discovery/discoveryStages.test.ts` ("lets an active
campaign rule surface governing material by itself"). Spell Fireball is now also
reached by the reverse one-hop traversal of the creature `spellcasting-spell`
references (Lich, Mage, Pit Fiend list it), so its route list gains
`typed-relationship`. The assertion still requires `campaign-rule` to be the
only non-typed route, and now additionally requires the added typed route to be
the spellcasting-spell relation; it is not weakened.

## Freeze state

The freeze guard is intentionally inactive during the re-audit
(`THAW_NOTE_CHECK_ENABLED` false); hash pins are refreshed by the re-freeze
(`eshyra-o9bd.14`), not here.

## Review correction (eshyra-o9bd.16.6.3)

The final review found that the first `requires-item` reason described every
prerequisite as worn attunement equipment. That is false for Sovereign Glue,
whose printed prerequisite (SRD p. 242) is a storage container coated with oil
of slipperiness; the item needs no attunement. The reason reaches the DM through
`lookup_rules`, so it now names both source-backed cases. Only the declaration's
reason text and the matching line of `record-relationships.json` change;
`verify:dnd5e-srd-pack` matches.
