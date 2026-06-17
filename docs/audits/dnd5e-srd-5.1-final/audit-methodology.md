# Audit Methodology — D&D 5e SRD 5.1 Final Importer Audit

How the final audit at commit `0f5b3dc` was performed, so a future maintainer can
re-run or extend it. The audit independently re-derived results rather than
trusting prior audit summaries.

## Principles

1. **Reproduce, don't trust.** Every gate was re-run from a clean `npm ci`.
2. **Adversarial.** Each automated "flag" was chased to the source PDF and
   resolved as faithful or escalated — none were waved off as cosmetic.
3. **Defeat two-column interleave.** Where text mattered, source text was
   reconstructed from per-page **coordinate items** (x/y) split into columns and
   read top-to-bottom, and the highest-risk areas were **rendered to images**
   (poppler `pdftoppm`) and read directly.

## The three required adversarial checks

1. **Each record ↔ source (accuracy/completeness).** Spot-checked record fields
   against rendered PDF pages (spells p.115, armor p.63, Teleport table p.186,
   Artifacts p.252, races p.5) plus whole-pack scripted field checks; backed by
   `verify:dnd5e-srd-pack` proving the whole pack regenerates byte-identically
   from the PDF.
2. **Each record type ↔ source (nothing missing).** Enforced by the importer's
   fail-closed `source-coverage.json` (`unaccounted = 0`) and the `auditSrd`
   structure/coverage audit (0 findings against the source-derived required
   name/key sets for magic items, ancestries, tables, creatures, NPCs, rules).
3. **Source content lacking a record type.** Enforced by
   `source-region-ledger.json` (`unrepresented = 0`, `broadStructuralIgnores =
   0`): every contiguous prose region is owned by a record/child or is an
   explicitly reasoned ignore. The 84 ignores were inspected individually.

## Tooling used

- **Built-in gates:** `verify:dnd5e-srd-pack`, `audit-bundle:dnd5e-srd`,
  `audit:rules-pack`, `check`, `typecheck`, `test`.
- **Audit bundle:** regenerated at HEAD; `metadata.json`, `reports/*.json`, and
  `command-output/*.txt` cross-checked; bundle artifact copies hashed against the
  committed pack.
- **Independent scripts (scratch, not committed):**
  - whole-pack scan (duplicate keys, missing fields, forbidden tokens, empty
    prose, dangling/lowercase fragments, flattened-table signatures, stat-block
    bleed, table structural integrity);
  - column-aware spell-list reconstruction from PDF coordinate items (pp.105–113)
    with bidirectional cross-check against `spell.classes`/`spell.level`.
- **PDF rendering:** poppler `pdftoppm` at 150–300 DPI, full pages and cropped
  regions, read as images.

## What would make this audit fail (regression signals)

- `verify:dnd5e-srd-pack` exits non-zero (importer output drifted from committed
  pack or from the source artifacts).
- `source-coverage.json` `unaccounted > 0` or any `knownGap > 0`.
- `source-region-ledger.json` `unrepresented > 0` or `broadStructuralIgnores > 0`.
- `auditSrd` findings > 0, `suspiciousRecords > 0`, or unicode findings > 0.
- Any flattened-table signature reappearing in a prose field, or any inline
  stat block bleeding into a *neighboring* record.
- Any of the documented faithful source typos *changing* (that means an
  unfaithful importer edit), or a new prose truncation that the source render
  does not justify.

## Environment notes

- Node 24.16.0 (LTS, per ADR 0008); npm 11.13.0.
- `dolt` binary absent → Dolt-gated checkpoint suites skip (documented).
- Live-API integration suites skip without a provider key (documented).
- The audit bundle and any rendered images are **not** committed (see the
  report §12 / `.gitignore`); only these durable summary documents are.
