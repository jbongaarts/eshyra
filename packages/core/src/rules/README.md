# `rules/` — Rules-Pack Subsystem

This directory owns everything related to the cross-system rules-pack model:
the type definitions, validators, loaders, the runtime D&D SRD pack loader, and
the in-memory Pathfinder fixture.

## Pack model (source files)

| File | Responsibility |
|------|---------------|
| `types.ts` | Core types for `RulesPack`, `RulesRecord`, `RulesPackMeta`, `RulesPackLicense`, `RecordProvenance`, and related shapes |
| `kindSchemas.ts` | Zod schemas for each record kind; used by the validator and importer pipeline |
| `validate.ts` | Deterministic pack validator — checks structural correctness and license completeness of a `RulesPack` |
| `license.ts` | License helper utilities shared across pack loading and validation |
| `packLoader.ts` | On-disk pack loader: `loadRulesPackFromDirectory` reads `manifest.json` + `records.json` from a pack directory |
| `stack.ts` | Rules-pack stack resolver — merges an ordered list of packs for a campaign, applying override semantics. Duplicate normalized names within a kind are allowed (ADR 0013); name lookup reports them as ambiguous |
| `lookup.ts` | `lookupRulesRecord`: typed lookup across a resolved pack stack. Key/ref lookup is canonical and deterministic; name lookup returns `not_found`, the single match, or an `ambiguous` result listing candidate keys |
| `bundledSrdPack.ts` | Runtime loader for the bundled D&D 5e SRD pack: `getBundledDnd5eSrdPack` (lazy + cached) plus the canonical pack-id/system/version constants and the retired placeholder id (ADR 0013) |
| `binding.ts` | Campaign-to-pack binding model: `readCampaignRulesBinding`, `DEFAULT_DND5E_SRD_BINDING` |

## Runtime D&D SRD pack and the Pathfinder fixture

Gameplay resolves D&D rules against the **importer-generated** SRD 5.1 pack
shipped under `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/` and loaded
at runtime by `bundledSrdPack.ts` (`getBundledDnd5eSrdPack`, lazy + cached).
This is the durable, audited rules product. The former `dnd5eSrd.ts` adapter
and its three-record `DND5E_SRD_RULES_PACK` placeholder have been **removed**
(ADR 0013).

`pathfinder2eRemaster.ts` remains a hand-authored fixture that exports a fully
constructed `RulesPack` constant for use without disk I/O. It is **temporary**,
targeted for replacement by the 0m9.8 Pathfinder 2e Remaster importer; applying
the same runtime-pack treatment is deferred with that importer work.

## Retired legacy SRD catalog (`srd/`)

The hand-authored `rules/srd/` catalog (`SRD_CATALOG`, `lookupSrdRecord`,
`buildSrdIndex`, and the `Srd*` types) has been **removed** (eshyra-b69j.3 /
eshyra-x50w, completing the migration ADR 0013 anticipated). It predated the
rules-pack model and its only remaining caller was character creation, which now
resolves classes, spells, and ancestries against the runtime generated pack.

Character creation resolves rules through
`character/rulesPackResolver.ts` (`RulesPackCharacterResolver`,
`getBundledDnd5eCharacterResolver`), a thin adapter over `getBundledDnd5eSrdPack`
+ `resolveRulesStack` + `lookupRulesRecord`. It narrows generated `data: unknown`
into typed class/spell/ancestry fields (e.g. class `hitDie`, spell `classes`)
and centralises display-name/key matching so callers never need internal ids.

The former `rules/dnd5eSrd.ts` adapter (which wrapped `SRD_CATALOG` into the
`DND5E_SRD_RULES_PACK` placeholder) was likewise removed under ADR 0013.

## Generated/seed pack data on disk

On-disk pack data lives at:

```
packages/core/data/rules-packs/<packId-safe>/manifest.json
packages/core/data/rules-packs/<packId-safe>/records.json
```

The `<packId-safe>` convention replaces `:` with `__` (e.g. `rules:dnd5e-srd`
becomes `rules__dnd5e-srd`). This directory is the authoritative target for
packs produced by the 0m9 importers. `packLoader.ts` loads it via
`loadRulesPackFromDirectory`.

## Ingestion policy

See `docs/adr/0007-rules-pack-ingestion-policy.md` for what model-assisted
generation is permitted during pack ingestion.
