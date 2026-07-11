# Thaw Note — C9 residual creature-mechanics projections

## Reason for thaw

Implement bead `eshyra-o9bd.18.7.9.15`, slice C9 of the reviewed
creature-entry classification. Four entries previously retained only
disconnected generic trigger markers. They now carry three closed mechanics
contracts that preserve their deterministic behavior.

## Exact refs

- `creature:shrieker#reactions:Shriek` — `soundAlarm`: 30-foot disturbance
  range, 300-foot audibility, and 1d4-turn continuation after the disturbance
  leaves.
- `creature:djinni#traits:Elemental Demise`
- `creature:efreeti#traits:Elemental Demise` — shared
  `onDeathBodyDisposal`: disintegration with worn/carried equipment left
  behind. Their distinct warm-breeze and fire/smoke source descriptions remain
  preserved verbatim in the source text.
- `creature:shield-guardian#reactions:Shield` — `reactionAcBonus`: reaction
  cost, attack-on-amulet-wearer trigger, 5-foot guardian/wearer restriction,
  +2 wearer AC, and a boundary of the triggering attack only.

## Membership/readiness delta

Before: 72 reviewed creature refs and 8 registry entries: 2 permanent
accepted-prose refs plus 6 pending findings (C4 2, C9 4).

After: 72 reviewed creature refs and 4 registry entries: the same 2 permanent
accepted-prose refs plus 2 pending C4 findings. C9 contributes zero pending
findings.

## Source and generated-pack evidence

The importer recognizes only the complete current SRD sentences for all four
entries. Any source drift leaves the entry without the C9 projection rather
than creating a broader inference. The contracts suppress the disconnected
generic `triggeredEffect` marker because the trigger, result, and boundary are
represented together by the typed effect.

Regeneration changed exactly four existing creature records above. No records
were added or removed; the source PDF and source manifest are unchanged.

## Expected file changes

- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` — exact source gates.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` —
  exactly the four reviewed C9 projections.
- [x] `docs/audits/dnd5e-srd-5.1-final/` — classification reconciliation,
  this thaw note, and refreshed freeze hash.

## Freeze manifest updated

`freeze-manifest.json` records the regenerated `records.json` SHA-256:
`4a598424f8da6d47a67fa6dc8b4d77fbbbdab8730a4e46dd4bd6a9d9ae6db7fc`.

## Audit bundle path

Verified bundle: `/tmp/eshyra-o9bd-18-7-9-15-audit-bundle`
(`.zip` sibling generated successfully). The bundle's full test run passed:
3,826 tests passed and 19 documented tests skipped.
