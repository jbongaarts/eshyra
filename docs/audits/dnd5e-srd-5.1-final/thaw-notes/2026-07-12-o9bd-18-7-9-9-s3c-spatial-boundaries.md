# Thaw Note — S3c portal and spatial-boundary spell semantics

## Reason for thaw

Implement `eshyra-o9bd.18.7.9.9`, the final S3c slice. The reviewed
deterministic spatial clauses in exactly three existing spell records were
previously accepted metadata-only and now belong in canonical rules-pack data.

## Exact records and ordered payloads

- `spell:gate`

  ```ts
  [
    { kind: 'planeShift', planes: ['current-plane', 'different-plane'] },
    { kind: 'portal', diameterFeetMin: 5, diameterFeetMax: 20, frontOnly: true },
  ]
  ```
- `spell:demiplane`

  ```ts
  [{ kind: 'extradimensionalSpace', dimensionsFeet: 30,
     onEnd: 'occupants-trapped', reconnect: 'previous-or-known' }]
  ```
- `spell:passwall`

  ```ts
  [{ kind: 'passage', maxWidthFeet: 5, maxHeightFeet: 8,
     maxDepthFeet: 20, onEnd: 'safe-ejection' }]
  ```

## Guarded source fields

Gate independently guards the cross-plane portal link, circular opening,
5-to-20-foot diameter, front-and-back faces, front-only traversal, and instant
transport to the nearest unoccupied space. Demiplane independently guards the
shadowy door/demiplane link, 30-foot room dimensions, trapped occupants and
objects on disappearance, reconnect to the caster's previous demiplane, and
reconnect to another creature's known demiplane. Passwall independently guards
passage creation, 5-foot width, 8-foot height, 20-foot depth, safe ejection on
disappearance, and nearest-unoccupied-space ejection by the casting surface.

The planar-ruler veto, named-creature draw and GM-controlled behavior,
wood-or-stone appearance, Medium-door clearance, eligible surface materials,
and no-instability statement remain prose-only. No portal traversal,
orientation/collision, summoning/compulsion, ruler veto, persistent storage,
reconnect lookup, ejection runtime, active-effect links, geometry enforcement,
or spell execution was added.

## Closed schemas and reuse

`portal` uses only `kind`, positive integer `diameterFeetMin`, positive integer
`diameterFeetMax`, and required `frontOnly: true`, with minimum no greater than
maximum. `extradimensionalSpace` uses only positive integer `dimensionsFeet`,
`onEnd: 'occupants-trapped'`, and optional `reconnect: 'previous-or-known'`.
`passage` uses only positive integer `maxWidthFeet`, `maxHeightFeet`, and
`maxDepthFeet`, plus `onEnd: 'safe-ejection'`. Each validator uses
`requireOnlyKeys`; unsupported enums and keys fail. Gate reuses `planeShift`
unchanged, with canonical string identifiers rather than a new travel kind.

## Membership and generated evidence

`ACCEPTED_METADATA_ONLY_SPELLS` changed exactly 15 → 12, with residual keys:
`spell:commune-with-nature`, `spell:creation`, `spell:druidcraft`,
`spell:fabricate`, `spell:identify`, `spell:illusory-script`,
`spell:legend-lore`, `spell:mending`, `spell:move-earth`,
`spell:planar-ally`, `spell:purify-food-and-drink`, `spell:stone-shape`.
Deterministic readiness changed 304 → 307. Regeneration changed exactly three
existing records (`spell:gate`, `spell:demiplane`, `spell:passwall`), with zero
records added or removed. No runtime behavior changed; this is a data-only
rules-pack/compiler boundary.

## Commands and results

The latest `origin/main` remained commit `076cd41a3a585ae80b3b1e38b0ffd4602c612b58`
and was an ancestor of this branch. The generated diff changed exactly three
existing records (`spell:gate`, `spell:demiplane`, `spell:passwall`), with 0
added and 0 removed. The pack manifest, source PDF, inventories, coverage,
source-region ledger, and record-kind counts were unchanged.

```text
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npx vitest run packages/core/test/importers/dnd5e-srd-5.1/mechanicsProjections.test.ts packages/core/test/kindSchemasEffects.test.ts packages/core/test/srdMembershipCorrections.test.ts packages/core/test/dnd5eSrdAuditBundle.test.ts
npm run verify:dnd5e-srd-pack
npm run verify:dnd5e-srd-freeze
npm run verify:worktree
npm run audit-bundle:dnd5e-srd
bd dep cycles
```

Results: focused tests passed 313/313; full worktree verification passed
4,104 tests with 19 skipped across 227 files (the initial run was blocked only
by a missing worktree `better-sqlite3` binding, then `npm rebuild
better-sqlite3` made the rerun green). `verify:dnd5e-srd-pack` passed with 0
records added, removed, or changed during regeneration comparison.
`verify:dnd5e-srd-freeze` passed with all 13 hashes matching. The audit bundle
passed its embedded check, with 0 suspicious findings and 0 structure/coverage
findings. `bd dep cycles` reported no dependency cycles. S3a, S3b, and S3c are
implemented; the S3 family is complete. Exactly three existing records changed
and zero records were added or removed.
