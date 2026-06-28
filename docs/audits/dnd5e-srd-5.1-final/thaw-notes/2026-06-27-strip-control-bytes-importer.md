# Thaw Note — Strip C0 control bytes from frozen importer files (eshyra-lupf.4 adjacent)

**Date:** 2026-06-27
**PR:** eshyra-lupf.4 advancement policy / #337

## Reason for thaw

PR #337 strengthens the repo-wide hidden-Unicode guard
(`scripts/check-hidden-unicode.mjs`) to also reject raw ASCII/C0 control bytes
(`U+0000..U+001F` and `U+007F DELETE`, except TAB/LF/CR), after a literal NUL in
non-frozen source (`advancementPolicy.ts`) made GitHub render that `.ts` file as
binary and suppress its diff. With the rule enforced repo-wide, the guard
surfaced **pre-existing** control bytes in two frozen importer files. These are
cosmetic hygiene fixes with **no behavioral or output change**; leaving them
suppressed-by-omission was rejected (same reasoning as the
`2026-06-23-biome-lint-hygiene-freeze-verifier` thaw), so the source is fixed
and the rule stays globally enforced:

- `ancestryOptions.ts` built an **ephemeral in-memory index key** by joining
  page + table name with a literal `U+0000` NUL
  (`` `${page}\0${name.toLowerCase()}` ``) in two spots. Replaced with a
  collision-free JSON tuple key (`JSON.stringify([page, name.toLowerCase()])`).
  The map is internal scratch state built and consumed within
  `linkAncestryOptionTables`; it is never serialized, so emitted pack records
  are byte-for-byte identical (the hash-pinned `records.json` is untouched and
  its hash check still passes).
- `README.md` contained a stray `U+0008 BACKSPACE` inside a documented regex
  cell (`` `^Appendix<BS>/` ``). Restored to the obviously intended
  `` `^Appendix\b/` `` (word-boundary), which is what the surrounding
  documentation describes. Documentation-only.

No audited SRD artifact content (PDF, pack records, manifests, source ledgers,
audit evidence) is touched.

## Expected file changes

- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/ancestryOptions.ts` —
      NUL-separated internal index key → JSON tuple key (no output change)
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/README.md` — stray
      `U+0008` → intended `\b` in a documented regex (docs only)
- [x] `docs/audits/dnd5e-srd-5.1-final/thaw-notes/` — this thaw note
- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`
- [ ] `docs/audits/dnd5e-srd-5.1-final/` (other than this thaw note)

## Source PDF changed?

No.

## Pack records changed?

No. The `ancestryOptions.ts` change only affects an internal index key used
during linking; generated `records.json` output is unchanged (its pinned hash
still matches).

## Importer changed?

Yes, but only cosmetically: two internal map-key string literals in
`ancestryOptions.ts` switch from a NUL separator to a JSON tuple. The
page/name pairing, lookups, and emitted `tableRefs` are unchanged.

## Commands run

```
npm run verify:dnd5e-srd-freeze
npm run check
npm run typecheck
npm test
```

`verify:dnd5e-srd-freeze` hash check passes (13/13; none of the changed files
are hash-pinned) and the changed-path check passes with this thaw note present.
`check:hidden-unicode` now reports a clean tree. Full suite green.

## Freeze manifest updated?

Not required — neither changed file is hash-pinned in `freeze-manifest.json`
(only the SRD PDF/manifest, the pack data JSONs, and the audit docs are hashed).
The hash check is unaffected by these changes.

- [ ] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated (n/a)

## Audit bundle path

Not regenerated — no audited artifact content changed.

## Reviewer sign-off notes

Confirm the `ancestryOptions.ts` diff is limited to the two internal index-key
literals (NUL → JSON tuple) with no change to emitted records, and that the
`README.md` diff is the single `U+0008` → `\b` regex correction. No
freeze-policy logic (`freeze.ts`, `freeze-manifest.json`) is altered.
