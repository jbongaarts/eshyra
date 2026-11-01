# Thaw Note: Composed display provenance (L1-F2)

Bead: `eshyra-o9bd.16.7.2` (parent `eshyra-o9bd.16.7`; audit lane
`eshyra-o9bd.16.1`, finding L1-F2, blocker, bars 2 and 7; recurrence
fable:F5, fable:F7, opus:F-19).

## Reason for thaw

`field-provenance.json` classified compiler-COMPOSED display strings as
`source-prose`, the only class a consumer may present as verbatim source
authority (`packages/core/src/rules/fieldProvenance.ts`). Those strings are
built from printed headers and cells, so they are truthful and attributable but
not quotations. Shared pointers also covered genuinely verbatim text in sibling
records, so the fix needed a record-scoped declaration, which required a
provenance schema change.

## Schema bump: `field-provenance-v1` to `field-provenance-v2`

- `FieldProvenanceDeclaration` gains an optional `recordKeys` list. A scoped
  declaration applies only to the named records.
- A v1 loader would ignore the scope and present composed text as verbatim, so
  `packLoader` now rejects v1 manifests and validates `recordKeys` (non-empty
  array of non-empty, distinct strings).
- `classifyFieldPointer` takes a REQUIRED `recordKey` parameter. Precedence: a
  scoped declaration naming the record beats every unscoped one; within a tier
  the longest prefix wins. Every caller passes the real record key
  (`walkFieldPointers` callers, `discovery/packet.ts`, and the tests).
- Two scoped declarations may share `(kind, pointerPrefix)` only over disjoint
  record sets. Overlap is rejected at manifest build.
- New dead-scope gate, `assertFieldProvenanceScopesLive`: every `recordKeys`
  entry must name an emitted record of that kind whose data contains the
  declared prefix. It runs in the canonical importer CLI
  (`packages/core/scripts/importers/dnd5e-srd-5.1/cli.ts`) over the written pack,
  not inside `buildPack`, because `buildPack` is also driven by partial fixtures
  that legitimately omit the records a scoped declaration names.

## Declarations changed (`fieldProvenanceDeclarations.ts`)

Unscoped declarations keep `source-prose` for the verbatim majority. Scoped
`source-derived` declarations are added for the composed records only:

| Kind | Pointer | Records | Why composed |
| --- | --- | --- | --- |
| feature | `/choices/*/options/*/text` | `feature:draconic-bloodline:dragon-ancestor` (10 options) | deriveFeatureChoices.ts builds 'Dragon: X; Damage Type: Y' from printed headers and cells (SRD p. 44) |
| feature | `/choices/*/options/*/text` | `feature:circle-of-the-land:circle-spells` (7 options) | level/spell rows under one header, joined into 'Druid Level Nth: ...' (SRD p. 22) |
| magic-item | `/variants/*/text` | `magic-item:elemental-gem` (4) | parseMagicItems.ts sentence from 'Gem / Summoned Elemental' headings and rows (SRD p. 220) |
| magic-item | `/variants/*/text` | `magic-item:horn-of-valhalla` (4) | parseMagicItems.ts sentence from cells under separate headings (SRD p. 226) |
| magic-item | `/variants/*/text` | `magic-item:bag-of-tricks` (3) | parseMagicItems.ts display from separate numbered Creature tables (SRD pp. 210-211) |
| table | `/columns` | `table:travel-pace` | parseTables.ts expands 'Distance per Minute/Hour/Day' from spanning header and subheaders (SRD p. 84). Whole array derived: pointers carry no per-index scope, so 'Pace' and 'Effect' are not split out |
| table | `/rows` | `table:food-drink-and-lodging`, `table:services` | parseTables.ts `foldGroupedItemName` folds group header and sub-item (SRD pp. 73-74). Whole array derived, so the few ungrouped printed rows in these two tables are not split out |
| feature | `/description` | `feature:cleric:destroy-undead`, `feature:druid:wild-shape` | classProgression.ts `trimEmbeddedTable` deletes a printed table span and collapses the seam (sweep finding, see below) |

Limitation, stated plainly: the `/columns` and `/rows` derivations for the three
tables above cover all of each array, because the declaration model cannot
scope by index. That is the honest class for the array as a whole, but it
under-claims a few printed cells. Splitting them needs a per-index scope, which
the schema does not have.

## Sweep: producers that interpolate labels or cells into source-prose fields

Searched `packages/core/scripts/importers/dnd5e-srd-5.1/*.ts` for template
literals, `.join(...)` and `+` concatenation feeding `text`, `description`,
`name`, `columns`, `rows`, `legend`, `label`, and `sourceText` fields, and for
`description: x.length > 0 ? x : name` fallbacks.

Findings:
1. **Fixed.** `trimEmbeddedTable` (classProgression.ts). Two feature
   descriptions have an embedded table span removed and the seam collapsed. Now
   scoped `source-derived` (above).
2. **Checked, verbatim.** `hazard:sphere-of-annihilation` `identicalToText`
   (trapChecks.ts) is a substring of the record's own `description`, so it stays
   `source-prose`.
3. **Checked, no change.** `classProgressionTables.ts` hard-coded `columns` are
   printed header labels transcribed as literals, not interpolated.
   `magicItemAdjudicatedEffects.ts` `sourceText` (with `${ability}`) lives
   inside `mechanics`, which is `compiler-projection`.
   `parseFeatures.ts` and `parseEquipment.ts` `join` calls re-flow printed
   wrapped lines, which the `namedEntry`/`prose` declarations already describe.
   `extract.ts` joins heading fragments, which are not emitted as record text.
4. **Latent, not changed.** `parseActions.ts` and `parseFeats.ts` fall back to
   the entry name when the body is empty, so the name would be presented as
   `source-prose` `/description`. No emitted record hits that path today
   (verified: no record has `description === name`), so the pack is unaffected.
   Follow-up: make an empty body fail closed in the parser instead of
   substituting a label.

## Records and pack

`records.json` is byte-identical before and after. The only regenerated pack
artifact is `field-provenance.json`, which changed from `field-provenance-v1`
to `field-provenance-v2` with the declaration changes above. Verified with
`npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`
and `npm run verify:dnd5e-srd-pack` (matches exactly).

## Tests

- `packages/core/test/importers/dnd5e-srd-5.1/composedDisplayProvenance.test.ts`
  (new): the SRD witnesses (pp. 22, 44, 73-74, 84, 210-211, 220, 226, and the
  two feature splices) classify `source-derived`; positive controls under the
  same pointers (fighting-style, metamagic, crystal-ball, ioun-stone,
  every other table's columns and rows) stay `source-prose`; no unnamed
  feature option or magic-item variant leaks into the derived class; the
  dead-scope gate passes on the committed pack.
- `packages/core/test/rules/fieldProvenanceScopes.test.ts` (new): scoped
  precedence (scope tier beats depth, longest prefix within a tier), unmatched
  records, partial segments, manifest validation (overlap, identical, empty,
  blank, duplicate keys), v2 loader validation and v1 rejection, and dead-scope
  gate cases.
- `fieldProvenanceGate.test.ts` and the discovery provenance tests: existing
  assertions are kept. Only the `classifyFieldPointer` call sites were updated
  to pass a record key (`PROBE_KEY` for unscoped probes, the real key where a
  record is in hand). No assertion was weakened.

## Freeze manifest

`freeze-manifest.json` hashes are NOT updated, and the freeze guard is not
changed. `verify:dnd5e-srd-freeze` already reports hash mismatches on
`records.json`, `manifest.json`, `source-coverage.json`,
`source-region-ledger.json`, and two audit docs. This PR does not touch any of
those files; the mismatch predates this bead (the artifact is in its thawed
re-audit state, `eshyra-o9bd`). Re-freeze (`eshyra-o9bd.14`) owns the refresh.

## Commands run

```
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1/
npm run verify:dnd5e-srd-pack
npx vitest run packages/core/test/rules/fieldProvenanceScopes.test.ts \
  packages/core/test/importers/dnd5e-srd-5.1/composedDisplayProvenance.test.ts \
  packages/core/test/importers/dnd5e-srd-5.1/fieldProvenanceGate.test.ts
npm run verify:worktree
```

Results are recorded in the bead completion report.
