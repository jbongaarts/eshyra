# Spell-list structured coverage thaw

Date: 2026-07-12. Bead: `eshyra-o9bd.18.8.3`.

The pp.105–113 class spell lists were previously covered by
`ignored:spell-list-header`. They are now owned by the typed
`structured-field:spell.data.classes` classification, with source class,
level, member count, and resolved spell keys retained in both coverage
artifacts. The source-positioned ownership is applied before broad text/name
matching, including the p.109 Ranger `Commune with Nature` / `Tree Stride`
sentinel, so it cannot be claimed by `table:circle-of-the-land-forest`.

The shared reconstruction remains exact: 70 class/level groups and 778 class-
spell memberships, with bidirectional parity and 319 unchanged spell records.
Only `source-coverage.json`, `source-region-ledger.json`, and their audit
documentation/provenance hashes changed; `records.json` and `manifest.json`
were byte-identical to `origin/main`.

Regenerated with `npm run import:dnd5e-srd` and verified with
`npm run verify:dnd5e-srd-pack`.
