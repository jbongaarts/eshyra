# Known Faithful SRD 5.1 Source Typos

The importer reproduces the vendored SRD 5.1 PDF **verbatim**, including the
source's own errors. Per [`docs/importer-fix-protocol.md`](../../importer-fix-protocol.md),
these must **not** be "corrected" in the importer — doing so would make the pack
diverge from the licensed source and break the byte-reproducibility contract
(`verify:dnd5e-srd-pack`).

Each typo below was confirmed during the final audit by **rendering the source
PDF page** (poppler `pdftoppm`) and reading it directly — not from text
extraction, which can interleave two-column layouts.

## Confirmed against the source PDF (p. 115)

### `spell:animal-friendship`

- **description** ends: "…If you or one of your companions harms the target,
  **the spells ends**." — the source prints "the spells ends" (should be "the
  spell ends"). Faithful.
- **higherLevels**: "…you can affect one additional **beast t level above
  1st**." — the source itself drops "for each slo" from "for each slot level",
  printing "beast t level above 1st". This is a **source** garble, not an
  importer truncation: the rendered PDF shows exactly this text. Faithful.

### `spell:animal-messenger`

- **higherLevels**: "If you cast this spell using a spell slot of **3nd level**
  or higher…" — the source prints "3nd level" (should be "3rd level"). Faithful.

## Why these are not blockers

The frozen-artifact standard treats *importer-introduced* garble/omission as a
blocker. These three are the opposite: the pack is **correct precisely because it
matches the source**. The third one (`beast t level above 1st`) was specifically
chased down because it superficially looks like a dropped-token extraction bug;
the page render proves the source PDF contains the identical garble, so
"repairing" it would be an unfaithful edit.

If a future importer change ever makes any of these strings *differ* from the
source, that is the regression to investigate — not the strings themselves.
