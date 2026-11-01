# Thaw Note — Historical audit scope banners

## Reason for thaw

Add in-band scope banners to the historical audit reports and evidence so their
2026-06-17 and 2026-07-01 conclusions cannot be mistaken for claims about the
current candidate. The child bead `eshyra-o9bd.19.6.1.1` authorizes these
documentation changes. No pack or importer files are changed.

## Expected file changes

- `docs/audits/dnd5e-srd-5.1-final/README.md`
- `docs/audits/dnd5e-srd-5.1-final/provenance.md`
- `docs/audits/dnd5e-srd-5.1-final/record-counts.md`
- `docs/audits/dnd5e-srd-5.1-final/audit-methodology.md`
- `docs/audits/dnd5e-srd-5.1-final/evidence.json`

## Scope and verification

The historical body text is preserved. Markdown files receive a blockquote
banner; `evidence.json` receives a `historicalScope` field because it is a JSON
artifact. The 2026-06-30 mechanics projection report and 2026-07-01 external
assurance report also receive banners; they are not hash-pinned. No source PDF,
pack record, or importer code changed.

`npm run verify:worktree` is the required worktree gate. `freeze-manifest.json`
hashes remain unchanged by design: updating that manifest and the final audit
evidence is owned by the re-freeze bead `eshyra-o9bd.14`.
