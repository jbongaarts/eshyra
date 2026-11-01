> **Historical scope — generated 2026-06-30 for `eshyra-ngcj.6` from the then-current regenerated pack (source commit not recorded here).** This report is preserved as evidence of that snapshot, not as a claim about the current pack. Any completeness or sign-off conclusion is withdrawn by ADR 0020 and the 2026-06-28 re-audit thaw. The operative bar is §5.9 of `docs/audits/rules-awareness-transition/2026-07-30-integrated-transition-design.md`. Current candidate evidence is [the candidate record](./2026-11-01-o9bd-19-6-1-candidate-pack.md); later gates are `eshyra-o9bd.19.6.3` / `eshyra-o9bd.16`.

# D&D 5e SRD 5.1 Mechanics Projection Report

Generated for eshyra-ngcj.6 on 2026-06-30 after regenerating the canonical
rules pack with the deterministic importer.

## Coverage Summary

Records with at least one `mechanics` projection:

- `spell`: 319 / 319
- `creature`: 314 / 317
- `stat-block`: 1 / 2
- `feature`: 76 / 184
- `ancestry`: 12 / 13
- `background`: 0 / 1
- `feat`: 1 / 1
- `hazard`: 24 / 25
- `action`: 1 / 10

## Representative Projected Records

- `spell:fire-bolt`
- `spell:hold-person`
- `spell:aid`
- `creature:goblin`
- `creature:adult-red-dragon`
- `feature:fighter:second-wind`
- `feature:champion:improved-critical`
- `ancestry:dwarf`
- `feat:grappler`
- `hazard:assassins-blood`
- `action:dodge`

## Notes

The projection layer is intentionally partial. It derives only high-confidence
fields from existing SRD prose: concentration flags, explicit attack/save/damage
patterns, condition mentions, rest-reset resources, simple feature effects, and
hazard save/damage patterns. Records without a clear pattern retain their
canonical prose and no invented mechanics fields.

