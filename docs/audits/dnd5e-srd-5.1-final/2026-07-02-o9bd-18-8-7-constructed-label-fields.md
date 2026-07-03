# Constructed vs. Verbatim Label Fields — `eshyra-o9bd.18.8.7`

**Bead:** `eshyra-o9bd.18.8.7` (child of epic `eshyra-o9bd.18.8`)

**Finding source:** Fable P4 observation from the 2026-07-01 external audit
round — synthesized labels such as `"Coinage"`, `"Armor Guidance"`,
`"Saddle, Military"`, and `Acolyte`'s `choices[].sourceText` values like
`"Acolyte Personality Traits (d8)."` are constructed rather than verbatim
source text. Not harmful for discoverability, but `sourceText` in particular
is a misleading field name if read as "guaranteed verbatim."

## Inventory

### `sourceText` fields (schema-validated in `kindSchemas.ts`)

| Field path | Verbatim in current data? |
| --- | --- |
| `class.data.startingEquipment.entries[].sourceText` | Yes (sampled) |
| `ancestry.data.languages[].sourceText` | Yes (sampled) |
| `ancestry.data.abilityScoreIncreases[].sourceText` | Yes (sampled) |
| `class.data.spellPreparation.sourceText` / `.scaling.sourceText` | Yes (sampled) |
| `background.data.choices[].sourceText`, `ancestry.data.choices[].sourceText` | **Mixed** — verbatim for `draconicAncestry`/`tool`/`skill`/`cantrip`/`language` categories; **constructed** `"<table name> (<die>)."` pointer for the rolled-table categories (`personalityTrait`/`ideal`/`bond`/`flaw`), currently only exercised by `background:acolyte` |

### `name`/title fields called out in the finding

| Literal | Record | Status |
| --- | --- | --- |
| `"Coinage"` | `rule:coinage` | Matches the SRD section heading — verbatim, not an issue |
| `"Armor Guidance"` | `rule:armor-guidance` | **Constructed** — the importer splits and retitles part of the equipment chapter's prose to avoid colliding with `rule:armor-class`; rationale already documented inline at `scripts/importers/dnd5e-srd-5.1/index.ts` near the equipment-chapter split (eshyra-7qit) |
| `"Saddle, Military"` | `equipment:saddle-military` | Reproduces the SRD equipment-table row label (comma-inverted, as printed) — verbatim, not an issue |
| `"Acolyte Bonds"` (and sibling table titles) | `table:acolyte-bonds` etc. | Verbatim SRD table caption; only becomes non-verbatim when *reused* to build the `choices[].sourceText` pointer above |

## Disposition

Renaming `sourceText`/`name` pack-wide was considered and rejected: both
fields are stable, load-bearing identifiers used across the importer, schema
validators, runtime lookup (`RulesRecord.name`), and generated pack data —
a rename would be a breaking schema/data migration for a P4 discoverability
nit with no reported harm. Instead:

- `CreationChoice.sourceText` (`packages/core/src/character/srdCreationChoices.ts`)
  and its schema validator (`optCreationChoices` in
  `packages/core/src/rules/kindSchemas.ts`) had their doc comments corrected:
  they previously claimed unconditional verbatim-ness, which was actually
  false for the four Acolyte rolled-table choices. The comments now state the
  verbatim/constructed split explicitly.
- `RulesRecord.name` (`packages/core/src/rules/types.ts`) gained a doc comment
  noting the importer occasionally normalizes/retitles a heading for
  disambiguation, so callers must not assume it is always a literal quote.
- **Explicit non-issue rationale** (this document) for `"Coinage"`,
  `"Saddle, Military"`, and the other `sourceText` field paths sampled above:
  reviewed and confirmed verbatim or, for `"Armor Guidance"`, already
  documented at the point the label is constructed. No further code change
  needed for these.

## Scope and non-closure

This closes only `eshyra-o9bd.18.8.7`. It does not touch the generated pack,
importer, or any frozen artifact path in `freeze-manifest.json` — only
doc-comment clarifications in `packages/core/src` — so no thaw note or
freeze-manifest hash update applies.
