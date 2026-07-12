# Thaw Note — S3b ward-boundary spell semantics

## Reason for thaw

Implement `eshyra-o9bd.18.7.9.8`, the reviewed S3b ward-boundary slice. This
thaw graduates exactly Private Sanctum and Tiny Hut from accepted
metadata-only status into deterministic canonical rules-pack data. It does
not implement runtime ward enforcement, spatial collision, teleportation,
planar-travel, line-of-effect, inventory, or spell execution behavior.

## Exact records and ordered payloads

- `spell:private-sanctum`

  ```ts
  [
    {
      kind: 'wardedArea',
      dimensions: { shape: 'cube', minimumSideFeet: 5, maximumSideFeet: 100 },
      blocks: ['sound', 'vision', 'divination-sensors', 'divination-targeting', 'teleportation', 'planar-travel'],
      chooseProperties: true,
    },
    { kind: 'permanenceAfterRepetition', period: 'day', count: 365, result: 'permanent' },
  ]
  ```

- `spell:tiny-hut`

  ```ts
  [
    {
      kind: 'wardedArea',
      blocks: ['creatures', 'objects', 'spell-effects'],
      occupantLimit: { count: 9, maxSize: 'medium' },
      castingTimeOccupantsExempt: true,
    },
    { kind: 'triggeredEffect', trigger: 'caster-leaves-warded-area', result: 'spell-ends' },
  ]
  ```

Tiny Hut retains its separate top-level `area` metadata:
`{ shape: 'hemisphere', size: 10, unit: 'foot', origin: 'self' }`.

## Source guards

Private Sanctum independently guards the 5–100-foot cube dimensions,
any-or-all property selection, sound boundary, vision including darkvision,
divination-sensor boundary, divination-targeting boundary, teleportation
boundary, planar-travel boundary, and daily casting on one spot for one year.

Tiny Hut independently guards the exact `spell.range` value
`Self (10-foot-radius hemisphere)`, caster departure, nine Medium-or-smaller
occupants, larger/excessive-count casting failure, casting-time creatures and
objects passing freely, all other creatures and objects being barred, and
spells/magical effects being unable to cross or be cast through. Missing or
changed clauses throw labeled `S3b spell projection for <spell> is missing
reviewed source clause: <label>` errors.

## Schema and data boundary

The new closed `wardedArea` schema accepts only `kind`, nonempty unique
canonical `blocks`, optional true markers, and the approved nested dimension
or occupant-limit objects. Dimensions require `chooseProperties`; the
Private Sanctum menu cannot coexist with Tiny Hut occupant fields; occupant
limit and casting-time exemption must occur together. All nested objects reject
extra keys. The payload is canonical data only; engine enforcement remains a
later boundary.

## Membership and generated evidence

`ACCEPTED_METADATA_ONLY_SPELLS` changes exactly from 17 to 15 by removing
`spell:private-sanctum` and `spell:tiny-hut`. Deterministic spell readiness
changes from 302 to 304. Regeneration changes exactly the two existing spell
records, with zero records added or removed; manifests, source inventories,
coverage, source-region ownership, record counts, and source PDF remain
unchanged. Gate, Demiplane, and Passwall receive no S3c projections.

## Commands and results

```text
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npx vitest run packages/core/test/importers/dnd5e-srd-5.1/mechanicsProjections.test.ts packages/core/test/kindSchemasEffects.test.ts packages/core/test/srdMembershipCorrections.test.ts packages/core/test/dnd5eSrdAuditBundle.test.ts
npm run verify:dnd5e-srd-pack
npm run verify:dnd5e-srd-freeze
npm run verify:worktree
npm run audit-bundle:dnd5e-srd
```

Results: focused tests 265 passed; `verify:dnd5e-srd-pack` passed with 0
records added/removed/changed during regeneration comparison;
`verify:dnd5e-srd-freeze` passed with all 13 hashes matching;
`verify:worktree` passed with 4,056 tests passed and 19 skipped; and the audit
bundle passed its embedded check, typecheck, test, and pack verification. The
audit reported 0 suspicious findings and 0 structure/coverage findings.
Audit bundle path: `.audit-bundles/dnd5e-srd-audit-bundle.zip`.

S3c and parent S3 remain open.

## Reviewer sign-off checklist

- [x] Exactly Private Sanctum and Tiny Hut are projected.
- [x] `wardedArea` is closed-schema validated with incompatibility rules.
- [x] Every emitted constant has an independent source-field guard.
- [x] Ordered committed-pack payloads and Tiny Hut area metadata are pinned.
- [x] Membership and readiness deltas are reconciled 17 → 15 and 302 → 304.
- [x] Final pack, freeze, worktree, audit-bundle, and generated-diff review complete.
