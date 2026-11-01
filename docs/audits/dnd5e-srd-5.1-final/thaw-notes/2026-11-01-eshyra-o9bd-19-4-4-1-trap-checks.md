# Thaw note: Trap ability checks, dispel DCs, and Sphere of Annihilation trap

Bead: `eshyra-o9bd.19.4.4.1` (parent `eshyra-o9bd.19.4.4`; audit aliases
opus:F-23, opus:F-01, sol:CAP-006, indep:007)

## Reason for thaw

`deriveHazardMechanics` projected only saves, damage, and conditions, so every
printed trap ability check (detect, disarm, escape, pry, slow) and every printed
dispel-magic DC was silently dropped, and `hazard:sphere-of-annihilation`
projected nothing at all (opus:F-23).

## Change

New `trapChecks.ts` projects, per trap record (and per `hazard:pits` variant,
from that variant's own text only), every DC-bearing sentence that is not a
saving throw as exactly one `mechanics.checks` entry
(`{dc, ability?, skill?, tool?, text}`) or `mechanics.dispels` entry
(`{spell, dc, text}`), in printed order, values verbatim from the sentence.
Shape 3 ("The DC to spot X is N") carries no ability or skill. A skill must be
one of the 18 SRD skills. The dispel spell key resolves fail-closed against the
emitted spells. A DC-bearing non-save sentence matching no printed shape makes
the importer throw.

`hazard:sphere-of-annihilation` additionally carries `data.identicalToRef`
(`magic-item:sphere-of-annihilation`) with `data.identicalToText` (the two
contiguous verbatim sentences), and one `data.versions[]` entry (the three
"Some versions of the trap include" sentences, `likeSpellRef`
`spell:antipathy-sympathy`, `likeSpellAspect` `sympathy`, and the DC 18 dispel).
The DC 18 dispel lives only on the version. Relationship declarations:
`otherwise-identical-to`, `effect-like-spell`, `dispelled-by`; field provenance
declares the new `data` fields. `validateDnd5eHazard`/`optMechanics` validate
the new shapes (additive only). Engine boundary: projection only; no runtime,
state, or hook change; detection/disarm resolution stays DM-adjudicated.

## Generated change

Only `kind: hazard` trap records change in `records.json`: collapsing-roof,
falling-net, fire-breathing-statue, poison-darts, poison-needle, rolling-sphere
gain `mechanics.checks`/`dispels`; the Simple, Hidden, and Locking Pit variants
gain `checks`; sphere-of-annihilation gains the projection above. No records
added or removed. `field-provenance.json` and `record-relationships.json`
change only by the new declarations.

## Pinned values that legitimately changed

- `srdGeneratedPack.test.ts` partially-populated baseline: hazard `mechanics`
  missing 2 to 1 (the sphere now has mechanics); new hazard rows
  `identicalToRef`, `identicalToText`, `versions` (each 24 of 25 missing).
- `alternativeOptionProjections.test.ts` (pits): the first three variants were
  asserted to have no mechanics because they have no save. They now carry their
  own printed `checks`; the assertion keeps its intent (no save, damage, or
  condition from the Spiked Pit leaks) and now requires that any mechanics key
  set is exactly `checks`.
- `findingRegistry.test.ts`: rows with `statusReasoning` 50 to 54 and the
  narrowed list gains `hazard-and-healing-potion` and `hazard-completeness`
  (ADR 0020 narrowing requested by the bead).
- `create-dnd5e-srd-audit-bundle/cli.ts`: the `hazard#prose-only` disposition
  was removed because the bucket is now empty (the Sphere of Annihilation trap
  was its only member); `dnd5eSrdAuditBundle.test.ts` requires removing stale
  entries. The magic-item side of Sphere of Annihilation is not touched.
- Semi-structured boundary inventory regenerated (1865 to 1882 grouped paths,
  all new hazard fields classified `model-adjudicated`).

## Registry dispositions

`sphere-prose` accepted (repair named); `hazard-success-branches` accepted
(PR #567); `hazard-and-healing-potion` and `hazard-completeness` narrowed under
ADR 0020.

## Evidence

`packages/core/test/importers/dnd5e-srd-5.1/trapChecksProjection.test.ts`:
exact sphere projection and resolved relationships; a census derived from the
committed pack text; shape 3 entries carry no ability or skill.

## Commands run

`npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`,
`npm run verify:dnd5e-srd-pack`, `npx tsx scripts/inventory-semi-structured-boundary.ts`,
`npm run verify:worktree` (see commit/bead notes for the result).

## Freeze manifest updated?

The SRD freeze guard is intentionally inactive until the re-freeze bead
(`eshyra-o9bd.14`); `freeze-manifest.json` is not re-hashed here.
