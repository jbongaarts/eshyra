# Thaw note: magic-item spell casting-time overrides

Bead: `eshyra-olc5.9.2`  
Related capability: `eshyra-olc5.9`

The SRD pack is intentionally changed to preserve the general `rule:spells`
contract: spells cast from items use their normal casting time unless the item
explicitly changes it. Using an action to expend charges and cast a spell does
not change that spell's casting time. The Orb of Dragonkind's scrying, Staff of
the Magi's conjure elemental, and Staff of the Woodlands' awaken operations
therefore lose their typed activation cost and carry verbatim adjudicated
clauses citing `rule:spells`. Existing control, held, and charge fields remain
where they apply.

The remaining printed casting-time overrides are Ring of Jumping's bonus-action
jump and Elemental Gem's action to break the gem. Runtime conformance proves
that conjure elemental's one-minute casting time spends no turn resource while
the staff still spends seven charges, and that Ring of Jumping spends the bonus
action. The generated pack retains 240 magic items and 357 operations; green
readiness clauses remain 219 and engine-pending clauses remain 797; 19 ready
operations remain unchanged. The task prompt anticipated 23, while the
repository's generated-pack readiness baseline records 19. The semi-structured
boundary inventory was regenerated because the generated activation fields
changed.

Generated pack changes are limited to the three operation records and their
source-backed execution-readiness clauses. The importer activation census and
faithful-operation corpus are the source inputs; `records.json` is regenerated,
not hand-edited. Canonical importer verification passes, and the semi-structured
boundary inventory check passes at 1,853 rows.

Updated `records.json` SHA-256:

`b10703f817c04564ed2d838a3cd20ab75e52bc2283ad6496d42cfb716b3f3afd`
