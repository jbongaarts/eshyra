# Thaw Note — S3a trigger-based spell semantics

## Reason for thaw

Implement `eshyra-o9bd.18.7.9.7` from the reviewed S3 design. This thaw
graduates exactly Alarm, Magic Mouth, and Contingency from accepted
metadata-only status by projecting their deterministic trigger and lifecycle
boundaries. It does not complete S3: Private Sanctum, Tiny Hut, Gate,
Demiplane, and Passwall remain pending S3b/S3c beads.

## Exact records and final payloads

- `spell:alarm`

  ```ts
  {
    kind: 'triggeredEffect',
    trigger: 'tiny-or-larger-creature-touches-or-enters-warded-area-excluding-designated-creatures',
    result: 'chosen-mental-alarm-within-1-mile-that-wakes-caster-or-audible-hand-bell-for-10-seconds-within-60-feet',
    condition: 'warded-door-window-or-area-no-larger-than-20-foot-cube',
  }
  ```

- `spell:magic-mouth`

  ```ts
  {
    kind: 'triggeredEffect',
    trigger: 'specified-visual-or-audible-circumstance-occurs-within-30-feet-of-object',
    result: 'object-recites-stored-message-up-to-25-words-once-or-repeatedly-as-chosen',
  }
  ```

- `spell:contingency`

  ```ts
  [
    { kind: 'spellStoring', maximumSpellLevel: 5, capacity: 1, castingTime: '1-action', target: 'self' },
    { kind: 'triggeredEffect', trigger: 'specified-circumstance-first-occurs-before-contingency-ends', result: 'stored-spell-immediately-takes-effect-on-self-and-contingency-ends' },
    { kind: 'exclusiveInstance', maxActive: 1, replacement: 'previous-ends' },
    { kind: 'componentPresenceTermination', component: 'ivory-statuette-of-self', location: 'on-your-person' },
  ]
  ```

## Source gating and contracts

The importer uses exact labeled guards against `spell.description` for every
constant: Alarm checks the cube, Tiny+ touch/entry, exclusions, alarm-mode
choice, one-mile/waking mental behavior, and 60-foot/10-second audible
behavior. Magic Mouth checks the 25-word limit, visual/audible trigger,
30-foot boundary, and once/repeat choice. Contingency checks the fifth-level
cap, one-action casting time, self-target eligibility, circumstance trigger,
first-occurrence immediate activation and termination, exclusive replacement,
and component-on-person termination. A missing or changed clause throws the
labeled `S3a spell projection ... missing reviewed source clause` error.

`triggeredEffect` is reused unchanged. `exclusiveInstance` and
`componentPresenceTermination` are new closed schema kinds. `spellStoring`
retains its existing shape and now accepts optional `castingTime: '1-action'`
and `target: 'self'`; no runtime spell execution or component inventory
enforcement is introduced.

## Membership and generated evidence

`ACCEPTED_METADATA_ONLY_SPELLS` changes exactly from 20 to 17 by removing
`spell:alarm`, `spell:contingency`, and `spell:magic-mouth`. Deterministic spell
readiness changes from 299 to 302; the remaining metadata-only membership is
the 17-key set asserted by the audit bundle. The generated `records.json`
diff changes exactly those three existing spell records; no records are added
or removed, and source text, metadata, tables, manifests, inventories,
coverage, and source-region ownership remain unchanged. The source PDF is
unchanged.

## Commands and results

The following completed successfully in this worktree:

```text
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npx vitest run packages/core/test/importers/dnd5e-srd-5.1/mechanicsProjections.test.ts packages/core/test/kindSchemasEffects.test.ts packages/core/test/srdMembershipCorrections.test.ts packages/core/test/dnd5eSrdAuditBundle.test.ts  # 241 passed
npm run verify:dnd5e-srd-pack  # passed; 0 records added/removed/changed during regeneration comparison
npm run verify:dnd5e-srd-freeze  # passed; all 13 hashes match
npm run verify:worktree  # passed; check, typecheck, and full test suite green
npm run audit-bundle:dnd5e-srd  # passed; 0 suspicious, 0 structure/coverage findings
```

Audit bundle: `.audit-bundles/dnd5e-srd-audit-bundle.zip` in this worktree.

## Reviewer sign-off checklist

- [x] Exactly the three S3a keys are projected and removed from membership.
- [x] All constants have labeled source-clause guards.
- [x] New kinds and extended `spellStoring` are closed-schema validated.
- [x] Exact ordered arrays and substantive trigger results are pinned.
- [x] S3b/S3c remain open and unprojected.
- [x] Source PDF is unchanged.
- [x] Pack verification, freeze verification, full worktree verification, and audit-bundle generation reviewed.
