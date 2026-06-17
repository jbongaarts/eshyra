# Provenance — D&D 5e SRD 5.1 Generated Rules Pack

This file records the source, importer, and artifact provenance for the frozen
`rules:dnd5e-srd-5.1` pack as verified by the final audit on **2026-06-17 (UTC)**.

## Source

| Field | Value |
| --- | --- |
| Source title | System Reference Document 5.1 (D&D 5e SRD 5.1) |
| Source version | 5.1 |
| Publisher | Wizards of the Coast LLC |
| License | Creative Commons Attribution 4.0 International (**CC-BY-4.0**, SPDX `CC-BY-4.0`) |
| License URL | https://creativecommons.org/licenses/by/4.0/legalcode |
| Vendored PDF path | `packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf` |
| PDF SHA-256 | `2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0` |
| PDF size | 3,158,713 bytes |
| PDF pages | 403 |
| Source manifest | `packages/core/sources/dnd5e-srd-5.1/manifest.json` |

The vendored PDF SHA-256 was recomputed during the audit (`sha256sum`) and the
audit bundle's hash check (`reports/source-hash-verification.txt`); both equal
the value pinned in the source manifest and the pack manifest's `source.sourceHash`.

### Required attribution (do not paraphrase)

> This work includes material taken from the System Reference Document 5.1
> ("SRD 5.1") by Wizards of the Coast LLC and available at
> https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is
> licensed under the Creative Commons Attribution 4.0 International License
> available at https://creativecommons.org/licenses/by/4.0/legalcode.

> [!NOTE]
> CC-BY-4.0 governs the **vendored SRD source and the records extracted from it**
> (the `rules:dnd5e-srd-5.1` pack). It is independent of the repository's own
> source-code license (PolyForm Noncommercial 1.0.0, added in PR #231 / commit
> `0f5b3dc`). PR #231 touched no SRD pack, importer, or source file, so the pack
> content at the audited commit is byte-identical to the content commit
> `67648aa` (PR #230).

## Importer

| Field | Value |
| --- | --- |
| Importer source | `packages/core/scripts/importers/dnd5e-srd-5.1/` |
| Importer entrypoint | `npm run import:dnd5e-srd` (`tsx packages/core/scripts/importers/dnd5e-srd-5.1/cli.ts`) |
| Reproducibility check | `npm run verify:dnd5e-srd-pack` |
| Audit bundle generator | `npm run audit-bundle:dnd5e-srd` |
| Generated pack path | `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/` |

The importer is a one-time deterministic generator pinned to the vendored PDF
above. `verify:dnd5e-srd-pack` re-runs it into a temp directory and byte-diffs
the output against the committed pack; at the audited commit it exits 0
("committed pack matches importer output exactly").

## Audited artifact

| Field | Value |
| --- | --- |
| Repo commit (audited) | `0f5b3dcce1de96630e01532d138b1286c948b668` |
| Branch | `main` (audit report authored on `docs/srd-final-audit`) |
| SRD content commit | `67648aa` (PR #230), merged via `35e1ce5` |
| Audit date/time | 2026-06-17T02:31–02:33Z |
| Audit bundle path | `.audit-bundles/dnd5e-srd-audit-bundle/` (gitignored; regenerate with `npm run audit-bundle:dnd5e-srd`) |
| Record count | 1811 |

### Generated-artifact SHA-256 (committed copies at the audited commit)

| Artifact | SHA-256 |
| --- | --- |
| `records.json` | `497359e59e2e49722f6469ae323c5c12f917acdbf1c3550d782b4db1e7fde8bb` |
| `manifest.json` | `42a6081e35d4da711da48641e4041fe7eec3ff1c363736cc1c7c784feb5570b8` |
| `source-inventory.json` | `48134b09cb7626aeff5f3c51659f5856ea7f8dbc0021702db1e866e76c3707f2` |
| `source-coverage.json` | `ead5779a66054b2647d947155c50136e406af145a62499e2f47863691e4c427f` |
| `source-region-ledger.json` | `7baf47c2fe3456e0e095b0bc70765ce6916574b8ef1398f38036af43d89d4540` |

**Byte-for-byte equality was verified two independent ways:**

1. `verify:dnd5e-srd-pack` regenerated `records.json`, `source-inventory.json`,
   `source-coverage.json`, and `source-region-ledger.json` from the PDF and
   reported every one as matching the committed copy exactly (0 records
   added/removed/changed, 0 manifest changes).
2. The freshly generated audit bundle's copies of all five artifacts above hash
   identically to the committed pack files (`sha256sum` comparison, all MATCH).

## Known faithful SRD source typos (do NOT "fix" in the importer)

These are verbatim errors in the **source PDF**. The importer preserves them per
`docs/importer-fix-protocol.md`; "fixing" them would make the pack diverge from
the licensed source. Each was confirmed by rendering the source PDF page during
this audit. See [`known-source-typos.md`](./known-source-typos.md) for the
rendered-page evidence.

| Record | Field | Faithful source text | PDF page |
| --- | --- | --- | --- |
| `spell:animal-friendship` | description | "…harms the target, **the spells ends**." | p. 115 |
| `spell:animal-friendship` | higherLevels | "…one additional **beast t level above 1st**." (source omits "for each slo[t]") | p. 115 |
| `spell:animal-messenger` | higherLevels | "…using a spell slot of **3nd level** or higher…" | p. 115 |
