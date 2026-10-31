# Thaw note: per-clause dawn/dusk charge recharge ownership

Bead: `eshyra-9ooo.1` (owning spec `eshyra-9ooo`)

## Reason for thaw

Land the already implemented F5 dawn/dusk dice-regain executor only for the
clause shapes it fully owns. Keep `magic-item-usage-recharge` out of
`LANDED_MAGIC_ITEM_ENGINE_HOOKS`: 207 clauses across 53 items still share the
hook, and many carry depletion consequences or reset shapes this runtime
contract does not own.

An economy clause loses the hook only when it is a charges economy with a
positive integer maximum, exactly one reset entry containing only `at` and
`amount`, where `at` is dawn or dusk and `amount` is a supported dice notation
or `all`, and it has no `onDepleted`. An operation clause loses the hook only
when every cost spends such an economy and has a positive integer or `variable`
amount. Other clauses keep the hook.

## Runtime evidence and boundary

- `useItem` accepts `variable` costs and refuses a spend larger than the
  remaining charges without changing state. The focused runtime regression is
  `itemState.test.ts`.
- The newly ready Wand of Secrets `detect-secret` operation spends one charge
  through `useItem`; crossing dawn with seeded `1d3` from 2 remaining restores
  to the maximum of 3. This uses the unmodified bundled record and no readiness
  waiver (`itemChargeDawnRecharge.test.ts`).
- On the unmodified Pipes of the Sewers record, the operation preflight still
  refuses `call-rat-swarms` because `m4-pipes-of-the-sewers` remains
  engine-pending on creature-grant lifecycle, controlled-entity action budget,
  and cooldown/identity ownership. The recharge clause becoming green does not
  make that operation executable.
- The real-pack recharge test also checks the Pipes preflight refusal without a
  readiness waiver, then exercises the reset executor on that real record:
  from 2 of 3 charges, seeded `1d3` dawn regain is capped at 3. The
  independent `useItem` variable-overdraw regression covers the spend guard.
- Compiler counterfactuals keep the hook for any `onDepleted`, a 7-day reset
  (`{at: 'days', days: 7}`), or multiple reset entries. Supported fixed and
  variable operation costs lose it only when every referenced economy
  qualifies.

## Generated change

Only magic-item `executionReadiness` changes: no records are added, removed, or
otherwise reprojected. Seventy-three clauses move from engine-pending to green
(22 economy clauses and 51 operation clauses); 53 other charge-recharge
clauses remain pending. Census: engine-pending 749 to 676, green 260 to 333,
adjudicated-by-design 358 unchanged, design-blocked 1 unchanged, total 1368
unchanged.

The exact changed item/clauses are:

- Cube of Force: `c1-economy-charges`; `c1-operation-press-face-1` through
  `press-face-5`.
- Cubic Gate: `c1-economy-charges`; `c1-operation-cast-gate`,
  `c1-operation-cast-plane-shift`.
- Eyes of Charming: `c1-economy-charges`; `c1-operation-cast-charm-person`.
- Gem of Seeing: `c1-economy-charges`; `c1-operation-gain-truesight`.
- Hammer of Thunderbolts: `c1-economy-charges`;
  `c1-operation-hurl-thunderclap`.
- Helm of Teleportation: `c1-economy-charges`;
  `c1-operation-cast-teleport`.
- Mace of Terror: `c1-economy-charges`;
  `c1-operation-release-terror-wave`.
- Medallion of Thoughts: `c1-economy-charges`;
  `c1-operation-cast-detect-thoughts`.
- Orb of Dragonkind: `c1-economy-charges`;
  `c1-operation-cast-cure-wounds`, `cast-daylight`, `cast-death-ward`,
  `cast-scrying`.
- Pipes of Haunting: `c1-economy-charges`;
  `c1-operation-play-haunting-tune`.
- Pipes of the Sewers: `c1-economy-charges`;
  `c1-operation-call-rat-swarms`.
- Ring of Animal Influence: `c1-economy-charges`;
  `c1-operation-cast-animal-friendship`, `cast-fear`, `cast-speak-with-animals`.
- Ring of Elemental Command: `c1-economy-charges`;
  `c1-operation-cast-burning-hands`, `cast-chain-lightning`,
  `cast-control-water`, `cast-create-or-destroy-water`, `cast-fireball`,
  `cast-gust-of-wind`, `cast-ice-storm`, `cast-stone-shape`, `cast-stoneskin`,
  `cast-wall-of-fire`, `cast-wall-of-ice`, `cast-wall-of-stone`,
  `cast-wind-wall`, `dominate-air-elemental`, `dominate-earth-elemental`,
  `dominate-fire-elemental`, `dominate-water-elemental`.
- Ring of Evasion: `c1-economy-charges`;
  `c1-operation-turn-failed-dex-save-into-success`.
- Ring of Shooting Stars: `c1-economy-charges`;
  `c1-operation-cast-faerie-fire`, `create-ball-lightning`,
  `launch-shooting-stars`.
- Ring of the Ram: `c1-economy-charges`; `c1-operation-break-object`,
  `c1-operation-spectral-ram-attack`.
- Robe of Scintillating Colors: `c1-economy-charges`;
  `c1-operation-display-scintillating-colors`.
- Robe of Stars: `c1-economy-stars`; `c1-operation-cast-magic-missile`.
- Staff of Withering: `c1-economy-charges`;
  `c1-operation-withering-strike`.
- Trident of Fish Command: `c1-economy-charges`;
  `c1-operation-cast-dominate-beast`.
- Wand of Magic Detection: `c1-economy-charges`;
  `c1-operation-cast-detect-magic`.
- Wand of Secrets: `c1-economy-charges`; `c1-operation-detect-secret`.

Four operations become newly ready: Gem of Seeing `gain-truesight`, Ring of
Evasion `turn-failed-dex-save-into-success`, Ring of the Ram `break-object`,
and Wand of Secrets `detect-secret`. Pipes of the Sewers remains refused on
its m4 grant contract.

## Verification

- `npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`
- `npm run verify:dnd5e-srd-pack`
- `npx vitest run packages/core/test/importers/dnd5e-srd-5.1/magicItemCompiler.test.ts packages/core/test/itemChargeDawnRecharge.test.ts packages/core/test/srdGeneratedPack.test.ts`
- `npm run verify:worktree`

Semi-structured inventory outputs were regenerated with the temporary tsx
script calling `writeCommittedOutputs()` (1865 rows). The regenerated
`records.json` SHA-256 is
`faf690c134f10ffb461918476e2b064a8efe7f037d80e740eccf427787caa142`.

## Integration note (supervisor, eshyra-9ooo)

This branch was cut from PR #694 before its review repair (eshyra-7f0h.3), which
types Candle of Invocation `cast-gate` as a `spell:gate` castSpell with one
engine-pending clause. Merged with that repair and regenerated, the counts above
shift by that one clause: engine-pending 750 -> 677, green 260 -> 333, total
1369 (unchanged by this bead). The 73 clauses moved by this bead and the four
newly ready operations are unchanged. records.json SHA-256 after integration:
`11c671e96040ab6db21457dcc4afeb65bc32eb51b34244443aaebe112dac576a`.
