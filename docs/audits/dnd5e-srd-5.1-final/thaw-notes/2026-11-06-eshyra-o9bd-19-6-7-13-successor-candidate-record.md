# Thaw Note — Successor candidate record

## Reason for thaw

The second independent audit (`eshyra-o9bd.19.6.7`) and its repairs (PRs
#710–#716) changed the candidate after the PR #698 candidate record was
written. Bead `eshyra-o9bd.19.6.7.13` authorizes a successor record for the
repaired candidate and moves the active "current candidate evidence" pointer
to it. No pack records, source PDF, importer or engine behaviour change.

## Expected file changes

- New: `docs/audits/dnd5e-srd-5.1-final/2026-11-06-o9bd-19-6-7-13-candidate-pack.md`.
- `2026-11-01-o9bd-19-6-1-candidate-pack.md` gains a historical-scope banner
  only. Its body is unchanged.
- The existing historical-scope banners that named the old record as current
  candidate evidence now name the successor, with acceptance
  (`eshyra-o9bd.19.6.4`) and formal re-freeze (`eshyra-o9bd.14`) as the next
  gates. Their bodies and historical claims are unchanged. Files:
  - `docs/audits/dnd5e-srd-5.1-final/2026-07-01-external-audit-positive-assurances.md`
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
  - `docs/audits/dnd5e-srd-5.1-final/README.md`
  - `docs/audits/dnd5e-srd-5.1-final/audit-methodology.md`
  - `docs/audits/dnd5e-srd-5.1-final/evidence.json`
  - `docs/audits/dnd5e-srd-5.1-final/mechanics-projection-report.md`
  - `docs/audits/dnd5e-srd-5.1-final/o9bd-18-7-6-equipment-mechanics-inventory.json`
  - `docs/audits/dnd5e-srd-5.1-final/o9bd-18-7-6-equipment-mechanics-inventory.md`
  - `docs/audits/dnd5e-srd-5.1-final/provenance.md`
  - `docs/audits/dnd5e-srd-5.1-final/record-counts.md`
- `packages/core/scripts/create-dnd5e-srd-audit-bundle/candidateGates.ts`:
  `CANDIDATE_RECORD_PATH` points at the successor record.

## Freeze manifest

`freeze-manifest.json` is not touched. Its hashes stay the pre-thaw baseline
until `eshyra-o9bd.14`.
