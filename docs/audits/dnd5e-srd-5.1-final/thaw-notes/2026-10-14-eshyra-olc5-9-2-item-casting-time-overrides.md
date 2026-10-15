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

`dc96fbd8b93399b97fbf456a2b98da9dfe5cccbf34deb214244e234196c08146`

## Review r2 repair (PR #661)

The Orb of Dragonkind scrying clause now carries only its own `scrying (3 charges)` span. Its earlier full-sentence span duplicated the shared Orb spell sentence, and triage deduplication then dropped the clause that governs all five Orb casts. The shared clause (`triage-activation-cast-cure-wounds-0`) is restored, and the normal-casting-time note no longer claims the sentence prints only the charge use.

The later `eshyra-olc5.11.4` state-machine repair also changed `records.json`.
Its regenerated SHA-256 is:

`0ff61e8a709827d897c693dfcc8550d10cbaa7e08de04a683c82e11b67b22196`
