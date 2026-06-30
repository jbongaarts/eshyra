# Thaw Note — Mechanics Projections

**Date:** 2026-06-30
**Beads:** eshyra-ngcj.6, eshyra-ngcj.6.1, eshyra-ngcj.6.2, eshyra-ngcj.6.3
**Epic:** eshyra-ngcj
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md`

## Reason for thaw

The SRD pack is source-complete, but many gameplay mechanics remained prose-only
after the prior modeling slices. This thaw adds first-pass deterministic,
source-backed mechanics projections so gameplay tooling can query common spell,
creature/action, feature, ancestry, feat, and hazard mechanics without parsing
canonical prose at runtime.

The source prose remains canonical. Projections are optional, conservative, and
omitted when the SRD text is ambiguous or outside the supported first-pass
patterns.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` — new
      `mechanicsProjections.ts`; `emit.ts` wires projections into generated
      records.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` —
      regenerated through the importer with optional `mechanics` fields.
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json` —
      `source-region-ledger.json` has one expected classification adjustment for
      `creature:guard` caused by nested action mechanics; target key unchanged.
- [x] `docs/audits/dnd5e-srd-5.1-final/` — this thaw note, refreshed
      `freeze-manifest.json` hashes, and
      `mechanics-projection-report.md`.
- [x] Other: `packages/core/src/rules/kindSchemas.ts` validates the new optional
      mechanics fields; importer/generated-pack tests document the reviewed
      partial-field baseline.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes. The canonical pack was regenerated through the importer, not hand-edited.
Record counts are unchanged; no records were added or removed.

Records with at least one mechanics projection:

- `spell`: 319 / 319
- `creature`: 314 / 317
- `stat-block`: 1 / 2
- `feature`: 76 / 184
- `ancestry`: 12 / 13
- `background`: 0 / 1
- `feat`: 1 / 1
- `hazard`: 24 / 25
- `action`: 1 / 10

Representative records are listed in
`docs/audits/dnd5e-srd-5.1-final/mechanics-projection-report.md`.

`source-region-ledger.json` changes one `creature:guard` source region from
`record` to `child-of:creature:guard` because the matching prose now includes a
nested action projection. The `targetKey` remains `creature:guard`.

## Importer changed?

Yes. A new conservative projection module derives high-confidence typed fields
from already-extracted SRD prose:

- spell concentration, attack, save, damage, condition, and scaling hints;
- creature/stat-block/action attack, recharge, save, damage, and condition
  hints;
- feature/ancestry/feat rest-reset resources and simple effects such as extra
  attack, critical range, advantage, resistance, proficiency, and explicit spell
  grants;
- hazard save, damage, and condition hints.

No source extractor behavior changed.

## Commands run

```
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npm run verify:dnd5e-srd-pack
npx vitest run packages/core/test/importers/dnd5e-srd-5.1/emit.test.ts packages/core/test/rulesPack.test.ts
npm run check
npm run typecheck
npm run test
npm run verify:worktree
```

All passed. `npm run check` and `npm run verify:worktree` still print the
existing Biome schema-version info (`2.5.1` schema vs CLI `2.5.0`) and exit 0.

After updating `freeze-manifest.json`, run:

```
npm run verify:dnd5e-srd-freeze -- --base origin/main
```

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated with:
  - `records.json` SHA-256
    `1e3a021c6f7db4f24e244d27a52d7f07cdbba8ef4b7df0c8a25f1607ecfb702a`
  - `source-region-ledger.json` SHA-256
    `31e016e91eeab0a5c6bfbefd59388d2502dd3ec1c38ab21bb7155705eeace408`

## Audit bundle path

Not regenerated. This is a targeted gameplay-modeling projection slice; the
committed projection report documents the changed coverage. Full audit bundle
regeneration remains epic-level work.

## Reviewer sign-off notes

Confirm that `verify:dnd5e-srd-pack` shows the committed pack matches importer
output exactly, `verify:dnd5e-srd-freeze -- --base origin/main` passes, and the
generated diff is limited to optional mechanics projections plus the one
`source-region-ledger.json` classification adjustment described above.

