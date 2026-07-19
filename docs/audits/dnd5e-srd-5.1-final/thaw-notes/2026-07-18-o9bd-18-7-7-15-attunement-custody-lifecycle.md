# Thaw note: explicit magic-item attunement and custody lifecycle

Bead: `eshyra-o9bd.18.7.7.15`  
Review follow-up: PR #455

The frozen SRD pack was intentionally thawed to make reviewed M7 lifecycle
semantics executable without treating every curse-family payload as an
attunement or custody restriction. The curated projection now identifies the
three character curse states attached by attunement (Armor of Vulnerability,
Berserker Axe, and Shield of Missile Attraction), the Robe of the Archmagi
alignment effect that is an attunement precondition rather than a live curse,
and the Berserker Axe state that prevents voluntary relinquishment. Existing
`blocksUnattune` and `blocksDoff` declarations remain the authoritative Orb of
Dragonkind and Demon Armor constraints.

These fields are source-grounded semantic references, not runtime-readiness
flags. Schema validation requires every referenced effect or state definition
to exist. Runtime fail-closed gates can therefore distinguish attunement onset,
persistent bonds, voluntary possession restrictions, worn/doff restrictions,
and unrelated M7 state such as Oathbow oaths, Sword of Wounding target wounds,
and Ring of Mind Shielding soul occupancy.

Generated scope:

- no records were added or removed;
- exactly four magic-item records changed;
- Armor of Vulnerability, Berserker Axe, and Shield of Missile Attraction gain
  explicit attunement-attached state references;
- Robe of the Archmagi gains an explicit attunement-precondition effect
  reference;
- Berserker Axe additionally gains one voluntary-relinquishment state
  reference;
- `records.json` contains 25 added lines and no removed lines;
- manifest and source inventory/coverage/region-ledger artifacts are unchanged;
- the vendored PDF and its SHA-256 are unchanged;
- canonical regeneration and `verify:dnd5e-srd-pack` are byte-identical.

Verification:

```text
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npm run verify:dnd5e-srd-pack
npm run verify:dnd5e-srd-freeze -- --base origin/main
npm run typecheck
```

Updated frozen `records.json` SHA-256:

`e333e2bccd5907231d549b28f44e300e1421e149c38b395176cd3244503ea9f2`
