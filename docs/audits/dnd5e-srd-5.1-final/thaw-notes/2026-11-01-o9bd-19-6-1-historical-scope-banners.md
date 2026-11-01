# Thaw Note — Historical audit scope banners

## Reason for thaw

Add in-band scope banners to historical audit and design artifacts that make
completeness, exhaustive ownership, readiness, sign-off, or re-freeze claims.
Their 2026-06-17, 2026-07-01, and 2026-07-06 conclusions must not be mistaken
for claims about the current candidate. The child beads
`eshyra-o9bd.19.6.1.1` and `eshyra-o9bd.19.6.1.3` authorize these
documentation changes. No pack records, source PDF, or importer behavior are
changed.

## Expected file changes

Historical Markdown artifacts receive a blockquote banner; generated equipment
inventory JSON carries additive `historicalScope` metadata; its historical
record data remains byte-for-byte unchanged.
Existing bodies and historical claims remain unchanged.

- `docs/audits/dnd5e-srd-5.1-final/README.md` (already bannered by .1.1)
- `docs/audits/dnd5e-srd-5.1-final/provenance.md` (already bannered by .1.1)
- `docs/audits/dnd5e-srd-5.1-final/record-counts.md` (already bannered by .1.1)
- `docs/audits/dnd5e-srd-5.1-final/audit-methodology.md` (already bannered by .1.1)
- `docs/audits/dnd5e-srd-5.1-final/evidence.json` (already scoped by .1.1)
- `docs/audits/dnd5e-srd-5.1-final/2026-07-01-external-audit-positive-assurances.md` (already bannered by .1.1)
- `docs/audits/dnd5e-srd-5.1-final/mechanics-projection-report.md` (already bannered by .1.1)
- `docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-7-3-magic-item-mechanics-inventory.md`
- `docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-7-magic-item-state-contract-design.md`
- `docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-8-1-rule-disposition-layer-design.md`
- `docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-8-3-engine-coverage-inventory.md`
- `docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-8-execution-boundary-classification.md`
- `docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-8-rule-classification.md`
- `docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-9-c1-changeshape-contract-design.md`
- `docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-9-membership-classification.md`
- `docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-9-s1-summoning-contract-design.md`
- `docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-9-small-contracts-design.md`
- `docs/audits/dnd5e-srd-5.1-final/o9bd-18-7-6-equipment-mechanics-inventory.md` and `.json`

The banners identify each artifact's date and preserved snapshot, withdraw its
old conclusions under ADR 0020, point to §5.9 of the integrated transition
design, and link the current candidate and later gates.

## Deliberately left unbannered

- `2026-07-02-o9bd-18-8-7-constructed-label-fields.md`: a narrow source/field
  finding; it makes no completeness, exhaustive ownership, readiness, sign-off,
  or re-freeze claim.
- `finding-registry.md` and `finding-registry.json`: the current registry
  contract explicitly disclaims complete membership, closure readiness,
  capability evidence, and current-pack violation claims. S1 only corrects the
  six affected row evidence descriptions; row `engine-capability-ownership`
  remains untouched.
- `known-source-typos.md`: source-backed statements about three named printed
  typos and their exact pack behavior; it makes no corpus-completeness or
  freeze-readiness claim.
- `2026-11-01-o9bd-19-6-1-candidate-pack.md` and `freeze-manifest.json`:
  current candidate/status records with explicit bounded scope, not historical
  claims.

## Scope and verification

No historical body text was rewritten; Markdown banners are prepended and
`historicalScope` is additive metadata on the generated JSON inventory. Its
per-record historical data remains unchanged. `freeze-manifest.json`
hashes remain unchanged by design: refreshing the manifest and final audit
evidence is owned by the re-freeze bead `eshyra-o9bd.14`.
